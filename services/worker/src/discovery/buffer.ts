/**
 * BootBuffer — FSM-based holding queue for live BountyPosted events that
 * arrive during boot (between Stage B-2 subscribe and Stage B-6 drain).
 *
 * Two states:
 *   - 'buffering' : push() enqueues. drainAndGoHot() drains FIFO then flips.
 *   - 'hot'       : push() fire-and-forget dispatches directly to consumer.
 *
 * Atomic flip: drainAndGoHot loops until queue empty, then flips state in
 * the same synchronous tick as the empty-check (no await between). JS
 * single-threaded → no other code runs between check and flip → no events
 * lost on the boundary.
 *
 * Overflow: push() throws BootBufferOverflowError when queue.length ===
 * capacity during 'buffering'. Indexer probe + catch-up taking too long
 * is operator intervention territory; refusing to silently drop events.
 */

import type { Candidate, CandidateConsumer } from './types.js';

export const BOOT_BUFFER_CAPACITY = 100;

export class BootBufferOverflowError extends Error {
  readonly capacity: number;
  constructor(capacity: number) {
    super(
      `BootBuffer overflow: ${capacity} candidates buffered while still in buffering state. ` +
        `Indexer probe + catch-up is too slow; refusing to drop events.`,
    );
    this.name = 'BootBufferOverflowError';
    this.capacity = capacity;
  }
}

type State = 'buffering' | 'hot';

export class BootBuffer {
  private state: State = 'buffering';
  private queue: Candidate[] = [];
  private consumer: CandidateConsumer | null = null;
  private readonly capacity: number;

  constructor(capacity: number = BOOT_BUFFER_CAPACITY) {
    this.capacity = capacity;
  }

  push(c: Candidate): void {
    if (this.state === 'hot') {
      // Consumer is guaranteed non-null: drainAndGoHot is the only path
      // to 'hot' and it sets consumer first. Fire-and-forget; the consumer
      // owns its own error handling (P2 §C: pipeline catches unhandled).
      Promise.resolve(this.consumer!(c)).catch(() => {
        /* consumer error handling is the consumer's responsibility */
      });
      return;
    }

    if (this.queue.length >= this.capacity) {
      throw new BootBufferOverflowError(this.capacity);
    }
    this.queue.push(c);
  }

  currentState(): State {
    return this.state;
  }

  size(): number {
    return this.queue.length;
  }

  /**
   * Drain the buffer in FIFO order, then atomically flip to 'hot'.
   *
   * Re-checks the queue in a loop because new push() calls may enqueue
   * during the awaited consumer dispatches (state is still 'buffering'
   * until the loop exits, so concurrent pushes correctly enqueue rather
   * than dispatch). The exit branch (queue empty + flip to hot) runs in
   * a single synchronous tick — no await between check and assignment —
   * so no event is lost.
   *
   * `dedupIds` skips bountyIds that have already been surfaced (typically
   * the IDs returned by the catch-up GraphQL query). Catchup and live can
   * race on the same bountyId at boot; dedup ensures the consumer sees
   * each ID at most once during the drain.
   */
  async drainAndGoHot(
    consumer: CandidateConsumer,
    dedupIds?: ReadonlySet<bigint>,
  ): Promise<void> {
    if (this.state === 'hot') {
      throw new Error('BootBuffer.drainAndGoHot called twice');
    }
    this.consumer = consumer;

    for (;;) {
      if (this.queue.length === 0) {
        // Atomic flip — no await between this check and the assignment.
        this.state = 'hot';
        return;
      }
      const drained = this.queue;
      this.queue = [];
      for (const c of drained) {
        if (dedupIds?.has(c.id)) continue;
        await consumer(c);
      }
    }
  }
}
