import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import { InflightSerializer } from '../../src/filter/serializer.js';
import { recoverInflight } from '../../src/lifecycle/resume.js';
import type { MainFsm } from '../../src/fsm/main.js';
import type { Candidate } from '../../src/discovery/types.js';
import { WorkerStateFile } from '../../src/state/worker-state.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const WORKER_ADDR = `0x${'aa'.repeat(32)}` as const;
const OTHER_WORKER = `0x${'bb'.repeat(32)}` as const;
const POST_TX = `0x${'11'.repeat(32)}` as const;
const SUBMIT_TX = `0x${'22'.repeat(32)}` as const;
const INDEXER_URL = 'http://test-resume-indexer.invalid';

function silentLogger(): Logger {
  const noop = (): void => undefined;
  return {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    trace: noop,
    fatal: noop,
    child: function (): Logger {
      return this as unknown as Logger;
    },
    level: 'info',
  } as unknown as Logger;
}

interface MockFsmCtx {
  fsm: MainFsm;
  runCalls: Candidate[];
  resolveRun: () => void;
  rejectRun: (err: Error) => void;
}

function mockFsm(opts: { throws?: boolean } = {}): MockFsmCtx {
  const runCalls: Candidate[] = [];
  let resolveRun: () => void = () => undefined;
  let rejectRun: (err: Error) => void = () => undefined;
  const fsm = {
    run: async (c: Candidate): Promise<'Submitted'> => {
      runCalls.push(c);
      if (opts.throws) throw new Error('mock fsm threw');
      // Hang until resolved by the test (so we can inspect mid-flight state).
      await new Promise<void>((r) => {
        resolveRun = r;
      });
      return 'Submitted';
    },
  } as unknown as MainFsm;
  return { fsm, runCalls, resolveRun: () => resolveRun(), rejectRun };
}

interface IndexerBountyRowShape {
  id: string;
  poster: string;
  worker: string | null;
  reward: string;
  track: string;
  status: string;
  postedAt: number;
  submittedAt: number | null;
  title: string | null;
  description: string | null;
  acceptance: string | null;
  deadline: number | null;
  postTxHash: string | null;
  submitTxHash: string | null;
  withdrawn: boolean;
}

function mockIndexerFetch(
  response: IndexerBountyRowShape | null | (() => Promise<never>),
): typeof fetch {
  return (async () => {
    if (typeof response === 'function') return response();
    return new Response(JSON.stringify({ data: { bountyById: response } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function fixtureRow(overrides: Partial<IndexerBountyRowShape> = {}): IndexerBountyRowShape {
  return {
    id: '7',
    poster: `0x${'cc'.repeat(32)}`,
    worker: null,
    reward: '2000000000000',
    track: 'Services',
    status: 'Open',
    postedAt: 100,
    submittedAt: null,
    title: 'resume-fixture-title',
    description: 'resume-fixture-desc',
    acceptance: 'resume-fixture-acc',
    deadline: null,
    postTxHash: POST_TX,
    submitTxHash: null,
    withdrawn: false,
    ...overrides,
  };
}

describe('recoverInflight', () => {
  let tmpDir: string;
  let statePath: string;
  let historyPath: string;
  let workerState: WorkerStateFile;
  let dedup: WorkHistoryDedup;
  let serializer: InflightSerializer;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  beforeEach(() => {
    const ts = `${Date.now()}-${Math.random()}`;
    statePath = join(tmpDir, `state-${ts}.json`);
    historyPath = join(tmpDir, `history-${ts}.jsonl`);
    workerState = new WorkerStateFile(statePath);
    workerState.load();
    dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    serializer = new InflightSerializer();
  });

  it('inflight=null → no-op (no chain query, no FSM call)', async () => {
    const fsmCtx = mockFsm();
    let fetchCalled = false;
    const fetchFn: typeof fetch = (async () => {
      fetchCalled = true;
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn,
    });

    assert.equal(fetchCalled, false, 'no indexer query');
    assert.equal(fsmCtx.runCalls.length, 0, 'no FSM call');
  });

  it('Claimed-by-me → constructs Candidate, calls FSM.run with phase=resume; serializer acquired', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const row = fixtureRow({ status: 'Claimed', worker: WORKER_ADDR });

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(row),
    });

    // FSM was fired (fire-and-forget; recoverInflight returns immediately).
    // Microtask flush so the void-fired promise's first await runs.
    await new Promise((r) => setImmediate(r));
    assert.equal(fsmCtx.runCalls.length, 1, 'FSM.run called once');
    const candidate = fsmCtx.runCalls[0];
    assert.equal(candidate.id, 7n);
    assert.equal(candidate.title, 'resume-fixture-title');
    assert.equal(candidate.phase, 'resume');
    assert.equal(serializer.isInflight(), true, 'serializer pre-acquired before FSM.run');
    assert.equal(serializer.inflightId(), 7n);

    // Release the hanging mock FSM run so it doesn't leak.
    fsmCtx.resolveRun();
  });

  it('Claimed-by-other → log + clearInflight + abandoned history; no FSM call', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const row = fixtureRow({ status: 'Claimed', worker: OTHER_WORKER });

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(row),
    });

    assert.equal(fsmCtx.runCalls.length, 0, 'FSM NOT called');
    assert.equal(workerState.current().inflight, null);
    assert.equal(serializer.isInflight(), false);

    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(rec.status, 'abandoned');
    assert.equal((rec.tx_hashes as Record<string, string>).post, POST_TX);
  });

  it('Submitted → reconstruct pending_accept (sentinel envelope_sha256), clearInflight, no FSM call', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const row = fixtureRow({
      status: 'Submitted',
      worker: WORKER_ADDR,
      submitTxHash: SUBMIT_TX,
      submittedAt: 200,
    });

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(row),
    });

    assert.equal(fsmCtx.runCalls.length, 0);
    assert.equal(workerState.current().inflight, null);
    const pending = workerState.current().pending_accept;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, '7');
    assert.equal(pending[0].submit_tx_hash, SUBMIT_TX);
    assert.equal(pending[0].submit_block_number, 200);
    assert.equal(pending[0].envelope_sha256, `0x${'0'.repeat(64)}`, 'sentinel zero hash');
  });

  it('Accepted → same reconstruction path; Monitor will catch via boot-resume', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const row = fixtureRow({
      status: 'Accepted',
      worker: WORKER_ADDR,
      submitTxHash: SUBMIT_TX,
      submittedAt: 200,
    });

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(row),
    });

    assert.equal(fsmCtx.runCalls.length, 0);
    assert.equal(workerState.current().inflight, null);
    assert.equal(workerState.current().pending_accept.length, 1);
  });

  it('Open (unexpected) → clearInflight, no history, no FSM call', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const row = fixtureRow({ status: 'Open' });

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(row),
    });

    assert.equal(fsmCtx.runCalls.length, 0);
    assert.equal(workerState.current().inflight, null);
    // No history line for Open case.
    if (existsSync(historyPath)) {
      assert.equal(readFileSync(historyPath, 'utf-8').trim(), '');
    }
  });

  it('bounty not in indexer → abandoned history + clearInflight', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();

    await recoverInflight({
      workerState,
      fsm: fsmCtx.fsm,
      dedup,
      historyPath,
      indexerBaseUrl: INDEXER_URL,
      workerAddress: WORKER_ADDR,
      serializer,
      logger: silentLogger(),
      fetchFn: mockIndexerFetch(null), // bountyById returns null
    });

    assert.equal(fsmCtx.runCalls.length, 0);
    assert.equal(workerState.current().inflight, null);
    const lines = readFileSync(historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(rec.status, 'abandoned');
  });

  it('indexer query throws → orchestrator throws (boot fails, operator intervenes)', async () => {
    await workerState.setInflight(7n);
    const fsmCtx = mockFsm();
    const throwingFetch: typeof fetch = (async () => {
      throw new Error('indexer down');
    }) as unknown as typeof fetch;

    await assert.rejects(
      () =>
        recoverInflight({
          workerState,
          fsm: fsmCtx.fsm,
          dedup,
          historyPath,
          indexerBaseUrl: INDEXER_URL,
          workerAddress: WORKER_ADDR,
          serializer,
          logger: silentLogger(),
          fetchFn: throwingFetch,
        }),
      /indexer down/,
    );
    // Inflight remains set on query failure — operator decides.
    assert.equal(workerState.current().inflight, '7');
    assert.equal(fsmCtx.runCalls.length, 0);
  });
});
