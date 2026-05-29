import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Logger } from 'pino';
import { ShutdownSequence } from '../../src/lifecycle/shutdown.js';

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

describe('ShutdownSequence', () => {
  it('runs steps in locked order, awaiting each before next (no overlap)', async () => {
    const order: string[] = [];
    const seq = new ShutdownSequence(
      [
        {
          name: 'step-1',
          fn: async () => {
            order.push('start-1');
            await sleep(20);
            order.push('end-1');
          },
        },
        {
          name: 'step-2',
          fn: async () => {
            order.push('start-2');
            await sleep(20);
            order.push('end-2');
          },
        },
        {
          name: 'step-3',
          fn: async () => {
            order.push('start-3');
            await sleep(20);
            order.push('end-3');
          },
        },
      ],
      silentLogger(),
    );

    await seq.shutdown();
    // Strict sequential — each step's start MUST follow the prior step's end.
    assert.deepEqual(order, [
      'start-1',
      'end-1',
      'start-2',
      'end-2',
      'start-3',
      'end-3',
    ]);
  });

  it('idempotent: second shutdown() invocation is a no-op', async () => {
    let calls = 0;
    const seq = new ShutdownSequence(
      [{ name: 'step', fn: async () => { calls++; } }],
      silentLogger(),
    );
    await seq.shutdown();
    await seq.shutdown();
    assert.equal(calls, 1);
  });

  it('continues on step failure (logs, runs subsequent steps)', async () => {
    const order: string[] = [];
    const seq = new ShutdownSequence(
      [
        {
          name: 'step-1',
          fn: async () => {
            order.push('1');
          },
        },
        {
          name: 'step-2',
          fn: async () => {
            throw new Error('step-2 failed');
          },
        },
        {
          name: 'step-3',
          fn: async () => {
            order.push('3');
          },
        },
      ],
      silentLogger(),
    );

    // shutdown() does NOT throw, even when step-2 throws.
    await seq.shutdown();
    assert.deepEqual(order, ['1', '3'], 'step-3 ran even though step-2 threw');
  });
});
