import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type {
  BountyAcceptedEvent,
  BountyAcceptedFilter,
  BountyMeshClient,
  TxResult,
  Unsubscribe,
} from '@bountymesh/sdk';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import { PendingAcceptMonitor, SignerMutex } from '../../src/fsm/index.js';
import type { PendingAcceptEntry } from '../../src/state/types.js';
import { WorkerStateFile } from '../../src/state/worker-state.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const WORKER_ADDR = `0x${'aa'.repeat(32)}` as const;
const SUBMIT_TX = `0x${'ab'.repeat(32)}` as const;
const WITHDRAW_TX = `0x${'cd'.repeat(32)}` as const;
const BLOCK = `0x${'ef'.repeat(32)}` as const;
const ENVELOPE_HASH = `0x${'11'.repeat(32)}` as const;
const INDEXER_URL = 'http://test-indexer.invalid';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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

function mkEntry(id: string): PendingAcceptEntry {
  return {
    id,
    submit_tx_hash: SUBMIT_TX,
    submit_block_number: 100,
    envelope_sha256: ENVELOPE_HASH,
    added_at: '2026-05-19T12:00:00.000Z',
  };
}

interface MockClientCtx {
  client: BountyMeshClient;
  withdrawCalls: bigint[];
  setWithdrawResult: (
    fn: (id: bigint) => Promise<TxResult<null>>,
  ) => void;
  trigger: (e: BountyAcceptedEvent) => void;
}

function mockClient(): MockClientCtx {
  let onAcceptedCb: ((e: BountyAcceptedEvent) => void) | null = null;
  let withdrawHandler: ((id: bigint) => Promise<TxResult<null>>) | null = null;
  const ctx: MockClientCtx = {
    client: {} as BountyMeshClient,
    withdrawCalls: [],
    setWithdrawResult: (fn) => {
      withdrawHandler = fn;
    },
    trigger: (e) => {
      if (onAcceptedCb) onAcceptedCb(e);
    },
  };
  ctx.client = {
    onBountyAccepted: async (
      _filter: BountyAcceptedFilter | null,
      cb: (e: BountyAcceptedEvent) => void,
    ): Promise<Unsubscribe> => {
      onAcceptedCb = cb;
      return () => {
        onAcceptedCb = null;
      };
    },
    withdraw: async (id: bigint) => {
      ctx.withdrawCalls.push(id);
      if (withdrawHandler) return withdrawHandler(id);
      return { ok: true, value: null, txHash: WITHDRAW_TX, blockHash: BLOCK };
    },
  } as unknown as BountyMeshClient;
  return ctx;
}

function fixtureEvent(id: bigint): BountyAcceptedEvent {
  return {
    id,
    poster: `0x${'cc'.repeat(32)}`,
    worker: WORKER_ADDR,
    reward: 2_000_000_000_000n,
    settledAt: 100,
    blockHash: BLOCK,
    txHash: `0x${'dd'.repeat(32)}`,
  };
}

interface Fixture {
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  historyPath: string;
  mutex: SignerMutex;
  clientCtx: MockClientCtx;
  monitor: PendingAcceptMonitor;
  fetchCalls: { url: string; body: unknown }[];
  setFetchResponse: (resp: Response | (() => Promise<Response>)) => void;
}

function setup(): Fixture {
  const tmpDir = makeTmpDir();
  const ts = `${Date.now()}-${Math.random()}`;
  const statePath = join(tmpDir, `state-${ts}.json`);
  const historyPath = join(tmpDir, `history-${ts}.jsonl`);
  const workerState = new WorkerStateFile(statePath);
  workerState.load();
  const dedup = new WorkHistoryDedup(historyPath);
  dedup.load();
  const mutex = new SignerMutex();
  const clientCtx = mockClient();

  const fetchCalls: { url: string; body: unknown }[] = [];
  let nextResponse: Response | (() => Promise<Response>) = new Response(
    JSON.stringify({ data: { allBounties: { nodes: [] } } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
  const fetchFn: typeof fetch = async (input, init) => {
    fetchCalls.push({
      url: typeof input === 'string' ? input : String(input),
      body: init?.body,
    });
    if (typeof nextResponse === 'function') return nextResponse();
    return nextResponse;
  };

  const monitor = new PendingAcceptMonitor({
    client: clientCtx.client,
    workerState,
    dedup,
    historyPath,
    signerMutex: mutex,
    indexerBaseUrl: INDEXER_URL,
    workerAddress: WORKER_ADDR,
    logger: silentLogger(),
    fetchFn,
  });

  return {
    workerState,
    dedup,
    historyPath,
    mutex,
    clientCtx,
    monitor,
    fetchCalls,
    setFetchResponse: (r) => {
      nextResponse = r;
    },
  };
}

describe('PendingAcceptMonitor', () => {
  const dirs: string[] = [];
  before(() => {
    // makeTmpDir/cleanup is per-test inside setup; track for after().
  });
  after(() => {
    for (const d of dirs) cleanupTmpDir(d);
  });

  it('live event for pending entry → fires processWithdraw → done history + cleared', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    await fix.monitor.start();
    fix.clientCtx.trigger(fixtureEvent(7n));
    // Let mutex critical section complete.
    await sleep(30);

    assert.deepEqual(fix.clientCtx.withdrawCalls, [7n]);
    assert.equal(fix.workerState.current().pending_accept.length, 0);
    const rec = JSON.parse(
      readFileSync(fix.historyPath, 'utf-8').trim(),
    ) as Record<string, unknown>;
    assert.equal(rec.status, 'done');
    assert.equal(rec.id, '7');
  });

  it('live event for non-pending bountyId → ignored, no withdraw called', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    await fix.monitor.start();
    fix.clientCtx.trigger(fixtureEvent(999n)); // not in pending
    await sleep(30);

    assert.equal(fix.clientCtx.withdrawCalls.length, 0);
    assert.equal(fix.workerState.current().pending_accept.length, 1);
    if (existsSync(fix.historyPath)) {
      assert.equal(readFileSync(fix.historyPath, 'utf-8').trim(), '');
    }
  });

  it('multiple pending entries handled independently via separate live events', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));
    await fix.workerState.addPendingAccept(mkEntry('8'));
    await fix.workerState.addPendingAccept(mkEntry('9'));

    await fix.monitor.start();
    fix.clientCtx.trigger(fixtureEvent(8n));
    await sleep(20);
    fix.clientCtx.trigger(fixtureEvent(7n));
    await sleep(30);

    // Two withdraws executed, in mutex-acquired order.
    assert.deepEqual(fix.clientCtx.withdrawCalls.sort(), [7n, 8n]);
    const remaining = fix.workerState.current().pending_accept.map((e) => e.id);
    assert.deepEqual(remaining, ['9']);
  });

  it('boot-resume: pre-existing pending entries with chain status=Accepted → processed via indexer query', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));
    await fix.workerState.addPendingAccept(mkEntry('8'));

    // Mock indexer: returns id=7 already Accepted (worker missed the BountyAccepted event).
    fix.setFetchResponse(
      new Response(
        JSON.stringify({ data: { allBounties: { nodes: [{ id: '7' }] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await fix.monitor.start();
    await sleep(50); // let boot-resume processWithdraw complete

    assert.deepEqual(fix.clientCtx.withdrawCalls, [7n]);
    const remaining = fix.workerState.current().pending_accept.map((e) => e.id);
    assert.deepEqual(remaining, ['8']);
    // Verify the GraphQL query was issued exactly once.
    assert.equal(fix.fetchCalls.length, 1);
    assert.match(fix.fetchCalls[0].url, /\/graphql$/);
  });

  it('boot-resume: indexer query fails → log + fall through to live subscription', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    fix.setFetchResponse(() => Promise.reject(new Error('indexer down')));

    // start() should NOT throw; live path still works.
    await fix.monitor.start();
    // Live event still triggers processWithdraw.
    fix.clientCtx.trigger(fixtureEvent(7n));
    await sleep(30);

    assert.deepEqual(fix.clientCtx.withdrawCalls, [7n]);
    assert.equal(fix.workerState.current().pending_accept.length, 0);
  });

  it('events arriving during boot-resume are buffered and drained after flip-to-active', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    // Slow indexer query: 50ms delay.
    fix.setFetchResponse(async () => {
      await sleep(50);
      return new Response(
        JSON.stringify({ data: { allBounties: { nodes: [] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    // Start the monitor; do NOT await yet. Trigger an event DURING the query.
    const startPromise = fix.monitor.start();
    // Wait a tick so the subscription is open but the indexer query is still in-flight.
    await sleep(10);
    fix.clientCtx.trigger(fixtureEvent(7n));

    await startPromise;
    await sleep(30);

    // The buffered event should have been drained → withdraw executed.
    assert.deepEqual(fix.clientCtx.withdrawCalls, [7n]);
    assert.equal(fix.workerState.current().pending_accept.length, 0);
  });

  it('concurrent Accepts for the SAME id (boot-resume + live race) → mutex serializes, only one withdraw via re-read dedup', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    // Indexer says 7 is Accepted (boot-resume triggers processWithdraw).
    fix.setFetchResponse(
      new Response(
        JSON.stringify({ data: { allBounties: { nodes: [{ id: '7' }] } } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await fix.monitor.start();
    // Immediately also trigger live event for 7 (worst-case race).
    fix.clientCtx.trigger(fixtureEvent(7n));
    await sleep(50);

    // Both paths fire processForEventId → both acquire mutex. First one
    // withdraws + clears pending. Second one re-reads, sees empty, no-ops.
    assert.equal(fix.clientCtx.withdrawCalls.length, 1, 'only ONE withdraw despite two triggers');
    assert.equal(fix.workerState.current().pending_accept.length, 0);
    const lines = readFileSync(fix.historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1, 'only ONE history line');
  });
});
