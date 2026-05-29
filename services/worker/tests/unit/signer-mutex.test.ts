import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SignerMutex } from '../../src/fsm/signer-mutex.js';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('SignerMutex', () => {
  it('runExclusive returns the inner fn return value', async () => {
    const m = new SignerMutex();
    const r = await m.runExclusive(async () => 42);
    assert.equal(r, 42);

    const s = await m.runExclusive(async () => 'hello');
    assert.equal(s, 'hello');
  });

  it('sequential acquires do not block (no extra wait beyond fn duration)', async () => {
    const m = new SignerMutex();
    const start = Date.now();
    await m.runExclusive(async () => {
      await sleep(20);
    });
    await m.runExclusive(async () => {
      await sleep(20);
    });
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 40, `elapsed should be ≥40ms, got ${elapsed}`);
    assert.ok(elapsed < 200, `elapsed should be <200ms (no leaks), got ${elapsed}`);
  });

  it('concurrent acquires serialize FIFO (Promise.all order assertion)', async () => {
    // Discipline note C: this test MUST use Promise.all + observe ordering.
    // Sequential awaits would trivially serialize and prove nothing about
    // the mutex's contended path.
    const m = new SignerMutex();
    const order: string[] = [];
    await Promise.all([
      m.runExclusive(async () => {
        order.push('start-1');
        await sleep(20);
        order.push('end-1');
      }),
      m.runExclusive(async () => {
        order.push('start-2');
        await sleep(20);
        order.push('end-2');
      }),
    ]);

    // Either ordering is valid (whichever Promise.all task acquired first).
    // The critical invariant: NEITHER task's start-N can interleave with
    // the other's end-N. e.g., ['start-1','start-2',...] would prove the
    // mutex didn't serialize — that case must NOT occur.
    const ok =
      JSON.stringify(order) === JSON.stringify(['start-1', 'end-1', 'start-2', 'end-2']) ||
      JSON.stringify(order) === JSON.stringify(['start-2', 'end-2', 'start-1', 'end-1']);
    assert.ok(ok, `expected strict-serialization order, got: ${order.join(',')}`);
  });

  it('lock released when fn throws — next acquire succeeds, throw propagates', async () => {
    const m = new SignerMutex();

    await assert.rejects(
      m.runExclusive(async () => {
        throw new Error('fn-failed');
      }),
      /fn-failed/,
    );

    // Lock must be released by runExclusive's internal try/finally; next
    // acquire should not deadlock and should run normally.
    const r = await m.runExclusive(async () => 'after-throw');
    assert.equal(r, 'after-throw');
  });
});
