import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { BountyMeshClient, TxResult } from '@bountymesh/sdk';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import { SignerMutex, processWithdraw } from '../../src/fsm/index.js';
import type { PendingAcceptEntry } from '../../src/state/types.js';
import { WorkerStateFile } from '../../src/state/worker-state.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

const SUBMIT_TX = `0x${'ab'.repeat(32)}` as const;
const WITHDRAW_TX = `0x${'cd'.repeat(32)}` as const;
const BLOCK = `0x${'ef'.repeat(32)}` as const;
const ENVELOPE_HASH = `0x${'11'.repeat(32)}` as const;

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
  withdrawCalls: number;
  setWithdrawResult: (
    r: TxResult<null> | (() => Promise<TxResult<null>>),
  ) => void;
}

function mockClient(): MockClientCtx {
  let nextResult: TxResult<null> | (() => Promise<TxResult<null>>) | null = null;
  const ctx: MockClientCtx = {
    client: {} as BountyMeshClient,
    withdrawCalls: 0,
    setWithdrawResult: (r) => {
      nextResult = r;
    },
  };
  ctx.client = {
    withdraw: async (_id: bigint) => {
      ctx.withdrawCalls++;
      if (nextResult === null) {
        return { ok: true, value: null, txHash: WITHDRAW_TX, blockHash: BLOCK };
      }
      if (typeof nextResult === 'function') return nextResult();
      return nextResult;
    },
  } as unknown as BountyMeshClient;
  return ctx;
}

interface Fixture {
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  historyPath: string;
  mutex: SignerMutex;
  clientCtx: MockClientCtx;
  deps: Parameters<typeof processWithdraw>[1];
}

describe('processWithdraw', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  function setup(): Fixture {
    const ts = `${Date.now()}-${Math.random()}`;
    const statePath = join(tmpDir, `state-${ts}.json`);
    const historyPath = join(tmpDir, `history-${ts}.jsonl`);
    const workerState = new WorkerStateFile(statePath);
    workerState.load();
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    const mutex = new SignerMutex();
    const clientCtx = mockClient();
    const deps = {
      client: clientCtx.client,
      workerState,
      dedup,
      historyPath,
      signerMutex: mutex,
      logger: silentLogger(),
    };
    return { workerState, dedup, historyPath, mutex, clientCtx, deps };
  }

  beforeEach(() => {
    /* per-test fresh paths via setup() */
  });

  it('Withdraw Ok → done history line + entry cleared', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    const result = await processWithdraw(mkEntry('7'), fix.deps);
    assert.equal(result, 'Done');
    assert.equal(fix.workerState.current().pending_accept.length, 0);

    const lines = readFileSync(fix.historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(rec.status, 'done');
    assert.equal(rec.envelope_sha256, ENVELOPE_HASH);
    const txs = rec.tx_hashes as Record<string, string>;
    assert.equal(txs.submit, SUBMIT_TX);
    assert.equal(txs.withdraw, WITHDRAW_TX);
  });

  it("AlreadyWithdrawn → treat as Done (idempotent recovery)", async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));
    fix.clientCtx.setWithdrawResult({
      ok: false,
      error: 'AlreadyWithdrawn',
      txHash: WITHDRAW_TX,
      blockHash: BLOCK,
    });

    const result = await processWithdraw(mkEntry('7'), fix.deps);
    assert.equal(result, 'Done');
    assert.equal(fix.workerState.current().pending_accept.length, 0);

    const rec = JSON.parse(
      readFileSync(fix.historyPath, 'utf-8').trim(),
    ) as Record<string, unknown>;
    assert.equal(rec.status, 'done');
  });

  it("Withdraw Err (other code) → abandoned history line + entry cleared", async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));
    fix.clientCtx.setWithdrawResult({
      ok: false,
      error: 'Unauthorized',
      txHash: WITHDRAW_TX,
      blockHash: BLOCK,
    });

    const result = await processWithdraw(mkEntry('7'), fix.deps);
    assert.equal(result, 'Abandoned');
    assert.equal(fix.workerState.current().pending_accept.length, 0);

    const rec = JSON.parse(
      readFileSync(fix.historyPath, 'utf-8').trim(),
    ) as Record<string, unknown>;
    assert.equal(rec.status, 'abandoned');
    assert.equal(rec.envelope_sha256, ENVELOPE_HASH);
    const txs = rec.tx_hashes as Record<string, string>;
    assert.equal(txs.submit, SUBMIT_TX);
    assert.equal(txs.withdraw, undefined);
  });

  it('Withdraw throws → no state mutations, throw propagates, pending NOT cleared', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));
    fix.clientCtx.setWithdrawResult(() => Promise.reject(new Error('transport down')));

    await assert.rejects(
      () => processWithdraw(mkEntry('7'), fix.deps),
      /transport down/,
    );
    assert.equal(fix.workerState.current().pending_accept.length, 1);
    // No history line written.
    if (existsSync(fix.historyPath)) {
      assert.equal(readFileSync(fix.historyPath, 'utf-8').trim(), '');
    }
  });

  it('idempotent on retry: second call sees no entry and returns Done (no-op)', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    const first = await processWithdraw(mkEntry('7'), fix.deps);
    assert.equal(first, 'Done');
    assert.equal(fix.clientCtx.withdrawCalls, 1);

    // Second call: entry no longer in pending; in-mutex re-read sees absence;
    // returns 'Done' without calling client.withdraw again.
    const second = await processWithdraw(mkEntry('7'), fix.deps);
    assert.equal(second, 'Done');
    assert.equal(fix.clientCtx.withdrawCalls, 1, 'withdraw NOT called twice');

    // Only ONE history line.
    const lines = readFileSync(fix.historyPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
  });

  it('atomic-write FIRST: history append throws → pending NOT cleared, mutex released', async () => {
    const fix = setup();
    await fix.workerState.addPendingAccept(mkEntry('7'));

    // Force the history-writer to fail by removing the dedup's loaded flag —
    // appendHistoryRecord calls dedup.markSeen which throws WorkHistoryNotLoadedError.
    const brokenDedup = new WorkHistoryDedup(fix.historyPath); // NOT loaded
    const depsWithBroken = { ...fix.deps, dedup: brokenDedup };

    await assert.rejects(() => processWithdraw(mkEntry('7'), depsWithBroken));
    assert.equal(
      fix.workerState.current().pending_accept.length,
      1,
      'pending NOT cleared when history-write fails',
    );

    // Mutex released (try/finally inside runExclusive). Next acquire works.
    const ok = await fix.mutex.runExclusive(async () => 'next');
    assert.equal(ok, 'next');
  });
});
