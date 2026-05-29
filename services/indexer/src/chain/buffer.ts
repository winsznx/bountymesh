/**
 * In-memory pending-events buffer (Path A — Step 3 Q2).
 *
 * Map<blockHash, BufferedEvent[]>. Optimistic events from the SDK live here
 * until the finalized-heads listener confirms canonicality.
 *
 * Eviction:
 *   - take(blockHash): canonical block, removes and returns events
 *   - drop(blockHash): orphaned/reorged block, removes without returning
 *   - clear(): WS disconnect, wipes everything (concern #4)
 *
 * Block number derivation:
 *   The SDK's normalized events don't carry blockNumber explicitly, but each
 *   has an event-specific `*At` field (postedAt, claimedAt, etc.) that IS the
 *   block height at emission time. The contract's invariant (CLAUDE.md:
 *   "all emit AFTER state commit") guarantees `*At` == block-of-event.
 *   eventBlockNumber() extracts it without an extra RPC.
 */

import type { HexString } from '@gear-js/api/types';
import type {
  BountyAcceptedEvent,
  BountyClaimedEvent,
  BountyPostedEvent,
  BountySubmittedEvent,
  BountyWithdrawnEvent,
} from '@bountymesh/sdk';

export type EventName =
  | 'BountyPosted'
  | 'BountyClaimed'
  | 'BountySubmitted'
  | 'BountyAccepted'
  | 'BountyWithdrawn';

export type BufferedEvent =
  | ({ eventName: 'BountyPosted' } & BountyPostedEvent)
  | ({ eventName: 'BountyClaimed' } & BountyClaimedEvent)
  | ({ eventName: 'BountySubmitted' } & BountySubmittedEvent)
  | ({ eventName: 'BountyAccepted' } & BountyAcceptedEvent)
  | ({ eventName: 'BountyWithdrawn' } & BountyWithdrawnEvent);

export function eventBlockNumber(e: BufferedEvent): number {
  switch (e.eventName) {
    case 'BountyPosted':
      return e.postedAt;
    case 'BountyClaimed':
      return e.claimedAt;
    case 'BountySubmitted':
      return e.submittedAt;
    case 'BountyAccepted':
      return e.settledAt;
    case 'BountyWithdrawn':
      return e.withdrawnAt;
  }
}

export function eventBountyId(e: BufferedEvent): bigint {
  return e.id;
}

export class PendingBuffer {
  private readonly byBlock: Map<HexString, BufferedEvent[]> = new Map();

  push(event: BufferedEvent): void {
    const existing = this.byBlock.get(event.blockHash);
    if (existing) {
      existing.push(event);
    } else {
      this.byBlock.set(event.blockHash, [event]);
    }
  }

  /** Removes and returns events for the given block. Returns [] if not buffered. */
  take(blockHash: HexString): BufferedEvent[] {
    const events = this.byBlock.get(blockHash) ?? [];
    this.byBlock.delete(blockHash);
    return events;
  }

  /** Removes the entry without returning. Used for orphaned/reorged blocks. */
  drop(blockHash: HexString): void {
    this.byBlock.delete(blockHash);
  }

  /** Wipes all buffered blocks. Used on WS disconnect (concern #4). */
  clear(): void {
    this.byBlock.clear();
  }

  /**
   * Returns block hashes whose blockNumber ≤ N. Used by the finalized-heads
   * listener to identify buffered blocks that should now be canonical-verified.
   */
  blockHashesUpTo(blockNumber: number): HexString[] {
    const out: HexString[] = [];
    for (const [hash, events] of this.byBlock) {
      const first = events[0];
      if (!first) continue;
      if (eventBlockNumber(first) <= blockNumber) out.push(hash);
    }
    return out;
  }

  /** Count of distinct blocks currently buffered (/health metric). */
  blockCount(): number {
    return this.byBlock.size;
  }

  /** Count of total events across all buffered blocks (/health metric). */
  size(): number {
    let total = 0;
    for (const arr of this.byBlock.values()) total += arr.length;
    return total;
  }

  /** Test-only peek without removing. */
  peek(blockHash: HexString): readonly BufferedEvent[] {
    return this.byBlock.get(blockHash) ?? [];
  }
}
