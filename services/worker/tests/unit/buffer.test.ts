import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  BootBuffer,
  BootBufferOverflowError,
  BOOT_BUFFER_CAPACITY,
} from '../../src/discovery/buffer.js';
import type { Candidate } from '../../src/discovery/types.js';

function makeCandidate(id: bigint, phase: 'live' | 'catchup' = 'live'): Candidate {
  return {
    id,
    poster: `0x${'aa'.repeat(32)}`,
    reward: 1_000_000_000_000n,
    track: 'Services',
    postedAt: 100,
    title: `bounty-${id}`,
    description: `desc-${id}`,
    acceptance: `acc-${id}`,
    deadline: null,
    blockHash: phase === 'live' ? `0x${'bb'.repeat(32)}` : null,
    txHash: `0x${'cc'.repeat(32)}`,
    phase,
  };
}

describe('BootBuffer', () => {
  it('push during buffering enqueues; consumer never invoked', async () => {
    const buf = new BootBuffer();
    const received: Candidate[] = [];

    buf.push(makeCandidate(1n));
    buf.push(makeCandidate(2n));

    assert.equal(buf.currentState(), 'buffering');
    assert.equal(buf.size(), 2);
    assert.equal(received.length, 0);
  });

  it('drainAndGoHot dispatches queued candidates in FIFO order then flips', async () => {
    const buf = new BootBuffer();
    const received: bigint[] = [];

    buf.push(makeCandidate(1n));
    buf.push(makeCandidate(2n));
    buf.push(makeCandidate(3n));

    await buf.drainAndGoHot((c) => {
      received.push(c.id);
    });

    assert.deepEqual(received, [1n, 2n, 3n]);
    assert.equal(buf.currentState(), 'hot');
    assert.equal(buf.size(), 0);
  });

  it('push after drainAndGoHot dispatches directly (hot state)', async () => {
    const buf = new BootBuffer();
    const received: bigint[] = [];

    await buf.drainAndGoHot((c) => {
      received.push(c.id);
    });
    assert.equal(buf.currentState(), 'hot');

    buf.push(makeCandidate(42n));
    // hot-path is fire-and-forget through Promise.resolve; let microtasks flush.
    await new Promise((r) => setImmediate(r));

    assert.deepEqual(received, [42n]);
  });

  it('drainAndGoHot dedup: matching bountyIds skipped', async () => {
    const buf = new BootBuffer();
    const received: bigint[] = [];

    buf.push(makeCandidate(1n));
    buf.push(makeCandidate(2n));
    buf.push(makeCandidate(3n));

    await buf.drainAndGoHot(
      (c) => {
        received.push(c.id);
      },
      new Set([2n]),
    );

    assert.deepEqual(received, [1n, 3n]);
  });

  it('push during drain (between awaited dispatches) queues, then drains in next pass', async () => {
    const buf = new BootBuffer();
    const received: bigint[] = [];

    buf.push(makeCandidate(1n));

    // Consumer that, during dispatch of id=1, enqueues id=2 into the buffer.
    // Since drainAndGoHot is still running (state='buffering' until the loop's
    // empty-check), the push enqueues. Next loop pass drains it.
    let pushedDuringDrain = false;
    await buf.drainAndGoHot((c) => {
      received.push(c.id);
      if (!pushedDuringDrain) {
        pushedDuringDrain = true;
        buf.push(makeCandidate(2n));
      }
    });

    assert.deepEqual(received, [1n, 2n]);
    assert.equal(buf.currentState(), 'hot');
  });

  it('push throws BootBufferOverflowError when capacity reached during buffering', () => {
    const buf = new BootBuffer(); // default capacity 100
    for (let i = 0; i < BOOT_BUFFER_CAPACITY; i++) {
      buf.push(makeCandidate(BigInt(i)));
    }
    assert.equal(buf.size(), BOOT_BUFFER_CAPACITY);

    assert.throws(
      () => buf.push(makeCandidate(BigInt(BOOT_BUFFER_CAPACITY))),
      (err: unknown) => {
        assert.ok(err instanceof BootBufferOverflowError);
        assert.equal(err.capacity, BOOT_BUFFER_CAPACITY);
        return true;
      },
    );
  });
});
