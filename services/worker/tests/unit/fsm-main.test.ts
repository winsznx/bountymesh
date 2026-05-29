import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type {
  BountyMeshClient,
  TxResult,
} from '@bountymesh/sdk';
import type { AdapterOutput, WorkAdapter } from '../../src/adapter/index.js';
import type { Candidate } from '../../src/discovery/types.js';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import { InflightSerializer } from '../../src/filter/serializer.js';
import { MainFsm, SignerMutex } from '../../src/fsm/index.js';
import { WorkerStateFile } from '../../src/state/worker-state.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const WORKER_ADDR = `0x${'aa'.repeat(32)}` as const;
const TX = `0x${'11'.repeat(32)}` as const;
const BLOCK = `0x${'22'.repeat(32)}` as const;

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 7n,
    poster: `0x${'cc'.repeat(32)}`,
    reward: 2_000_000_000_000n,
    track: 'Services',
    postedAt: 100,
    title: 'fsm-test-title',
    description: 'fsm-test-desc',
    acceptance: 'fsm-test-acc',
    deadline: null,
    blockHash: `0x${'33'.repeat(32)}`,
    txHash: `0x${'44'.repeat(32)}`,
    phase: 'live',
    ...overrides,
  };
}

function adapterOutput(overrides: Partial<AdapterOutput> = {}): AdapterOutput {
  return {
    output_inline: 'work-product',
    output_blob_url: null,
    output_blob_sha256: null,
    upstream: {
      provider: 'mock',
      model: 'mock-0',
      request_canonical: { system: 'sys', user: 'usr' },
      response_sha256: `0x${'ee'.repeat(32)}`,
      response_body_inline: 'work-product',
      attempts: 1,
      request_at: '2026-05-19T12:00:00.000Z',
      response_at: '2026-05-19T12:00:01.000Z',
      error: null,
    },
    ...overrides,
  };
}

interface MockClientHooks {
  claim?: (id: bigint) => Promise<TxResult<null>>;
  submit?: (
    id: bigint,
    payload: string,
    hash: `0x${string}`,
  ) => Promise<TxResult<null>>;
}

interface ClientWithCounts {
  client: BountyMeshClient;
  claimCalls: number;
  submitCalls: number;
}

function mockClient(hooks: MockClientHooks = {}): ClientWithCounts {
  const ctx: ClientWithCounts = { client: {} as BountyMeshClient, claimCalls: 0, submitCalls: 0 };
  ctx.client = {
    claim: async (id: bigint) => {
      ctx.claimCalls++;
      if (hooks.claim) return hooks.claim(id);
      return { ok: true, value: null, txHash: TX, blockHash: BLOCK };
    },
    submit: async (id: bigint, payload: string, hash: `0x${string}`) => {
      ctx.submitCalls++;
      if (hooks.submit) return hooks.submit(id, payload, hash);
      return { ok: true, value: null, txHash: TX, blockHash: BLOCK };
    },
  } as unknown as BountyMeshClient;
  return ctx;
}

interface AdapterCall {
  candidate: Candidate;
  crashResumed: boolean;
}

function mockAdapter(out: AdapterOutput): { adapter: WorkAdapter; calls: AdapterCall[] } {
  const calls: AdapterCall[] = [];
  const adapter: WorkAdapter = {
    name: 'mock',
    version: '0.0.1',
    execute: async (c, opts) => {
      calls.push({ candidate: c, crashResumed: opts.crashResumed });
      return out;
    },
  };
  return { adapter, calls };
}

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

interface FsmFixture {
  fsm: MainFsm;
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  serializer: InflightSerializer;
  historyPath: string;
  statePath: string;
  clientCtx: ClientWithCounts;
  adapterCalls: AdapterCall[];
}

interface FsmFixtureOpts {
  client?: ClientWithCounts;
  adapter?: { adapter: WorkAdapter; calls: AdapterCall[] };
}

describe('MainFsm.run', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  beforeEach(() => {
    /* per-test fresh paths via setup() below */
  });

  function setup(opts: FsmFixtureOpts = {}): FsmFixture {
    const ts = `${Date.now()}-${Math.random()}`;
    const statePath = join(tmpDir, `state-${ts}.json`);
    const historyPath = join(tmpDir, `history-${ts}.jsonl`);
    const workerState = new WorkerStateFile(statePath);
    workerState.load();
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    const serializer = new InflightSerializer();
    const clientCtx = opts.client ?? mockClient();
    const adapter = opts.adapter ?? mockAdapter(adapterOutput());
    const fsm = new MainFsm({
      client: clientCtx.client,
      adapter: adapter.adapter,
      workerState,
      dedup,
      historyPath,
      serializer,
      signerMutex: new SignerMutex(),
      workerAddress: WORKER_ADDR,
      getCurrentBlock: async () => 200,
      logger: silentLogger(),
    });
    return {
      fsm,
      workerState,
      dedup,
      serializer,
      historyPath,
      statePath,
      clientCtx,
      adapterCalls: adapter.calls,
    };
  }

  it('(a) happy: Claim Ok → Adapter Ok → Submit Ok → pending_accept written, serializer released, history empty', async () => {
    const fix = setup();
    fix.serializer.tryAcquire(7n);

    const state = await fix.fsm.run(candidate({ id: 7n }));

    assert.equal(state, 'Submitted');
    assert.equal(fix.workerState.current().inflight, null);
    const pending = fix.workerState.current().pending_accept;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, '7');
    assert.equal(pending[0].submit_tx_hash, TX);
    assert.match(pending[0].envelope_sha256, /^0x[0-9a-f]{64}$/);
    assert.equal(fix.serializer.isInflight(), false);
    // worker.history.jsonl should not exist (or be empty) — no done record yet.
    if (existsSync(fix.historyPath)) {
      assert.equal(readFileSync(fix.historyPath, 'utf-8').trim(), '');
    }
  });

  it('(b) claim-Err: Abandoned → history line with status=abandoned, only post in tx_hashes, envelope null', async () => {
    const clientCtx = mockClient({
      claim: async () => ({ ok: false, error: 'BountyNotOpen', txHash: TX, blockHash: BLOCK }),
    });
    const fix = setup({ client: clientCtx });
    fix.serializer.tryAcquire(7n);
    const cand = candidate({ id: 7n, txHash: `0x${'44'.repeat(32)}` });

    const state = await fix.fsm.run(cand);

    assert.equal(state, 'Abandoned');
    assert.equal(fix.workerState.current().inflight, null);
    assert.equal(fix.serializer.isInflight(), false);
    // Adapter should NOT have been called.
    assert.equal(fix.adapterCalls.length, 0);

    const lines = readFileSync(fix.historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(rec.id, '7');
    assert.equal(rec.status, 'abandoned');
    assert.equal(rec.envelope_sha256, null);
    const txs = rec.tx_hashes as Record<string, string>;
    assert.equal(txs.post, `0x${'44'.repeat(32)}`);
    assert.equal(txs.claim, undefined);
    assert.equal(txs.submit, undefined);
  });

  it('(c) adapter failure: still submits failure envelope → Submitted, history empty', async () => {
    const failure = adapterOutput({
      output_inline: null,
      upstream: {
        provider: 'mock',
        model: 'mock-0',
        request_canonical: { system: 'sys', user: 'usr' },
        response_sha256: null,
        response_body_inline: null,
        attempts: 2,
        request_at: '2026-05-19T12:00:00.000Z',
        response_at: '2026-05-19T12:02:00.000Z',
        error: 'anthropic[500]: internal_error',
      },
    });
    const fix = setup({ adapter: mockAdapter(failure) });
    fix.serializer.tryAcquire(7n);

    const state = await fix.fsm.run(candidate({ id: 7n }));

    assert.equal(state, 'Submitted');
    const pending = fix.workerState.current().pending_accept;
    assert.equal(pending.length, 1, 'pending_accept written even on adapter-failure');
    assert.equal(fix.serializer.isInflight(), false);
    // history.jsonl: should NOT contain a record (failure is on-chain via envelope).
    if (existsSync(fix.historyPath)) {
      assert.equal(readFileSync(fix.historyPath, 'utf-8').trim(), '');
    }
  });

  it('(d) submit-Err: Abandoned → history with FULL tx_hashes (post + claim) + envelope_sha256 populated', async () => {
    const clientCtx = mockClient({
      submit: async () => ({ ok: false, error: 'BountyNotClaimed', txHash: TX, blockHash: BLOCK }),
    });
    const fix = setup({ client: clientCtx });
    fix.serializer.tryAcquire(7n);
    const cand = candidate({ id: 7n, txHash: `0x${'44'.repeat(32)}` });

    const state = await fix.fsm.run(cand);

    assert.equal(state, 'Abandoned');
    assert.equal(fix.workerState.current().inflight, null);
    assert.equal(fix.serializer.isInflight(), false);

    const lines = readFileSync(fix.historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(rec.status, 'abandoned');
    const txs = rec.tx_hashes as Record<string, string>;
    assert.equal(txs.post, `0x${'44'.repeat(32)}`);
    assert.equal(txs.claim, TX);
    assert.match(rec.envelope_sha256 as string, /^0x[0-9a-f]{64}$/);
  });

  it('(e) write-ordering fault injection: pending_accept atomic-write fails → throws, serializer NOT released, inflight remains', async () => {
    const fix = setup();
    fix.serializer.tryAcquire(7n);

    // Force addPendingAccept to throw on the call that happens at SUBMITTED closure.
    fix.workerState.addPendingAccept = async () => {
      throw new Error('simulated disk failure on pending_accept');
    };

    await assert.rejects(
      () => fix.fsm.run(candidate({ id: 7n })),
      /simulated disk failure on pending_accept/,
    );

    assert.equal(fix.serializer.isInflight(), true, 'serializer NOT released after write failure');
    assert.equal(fix.serializer.inflightId(), 7n);
    assert.equal(
      fix.workerState.current().inflight,
      '7',
      'inflight remains set; caller transitions to WaitingForOperatorIntervention',
    );
  });

  it('(f) crash-resume: pre-set workerState.inflight === candidate.id → Claim NOT called, adapter receives crashResumed=true', async () => {
    const fix = setup();
    // Pre-populate inflight as if a prior process crashed mid-Working.
    await fix.workerState.setInflight(7n);
    fix.serializer.tryAcquire(7n);

    const state = await fix.fsm.run(candidate({ id: 7n }));

    assert.equal(state, 'Submitted');
    assert.equal(fix.clientCtx.claimCalls, 0, 'Claim must NOT be called on resume');
    assert.equal(fix.adapterCalls.length, 1);
    assert.equal(fix.adapterCalls[0].crashResumed, true);
    assert.equal(fix.workerState.current().inflight, null);
    assert.equal(fix.workerState.current().pending_accept.length, 1);
  });
});
