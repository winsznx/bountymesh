import { getFnNamePrefix, getServiceNamePrefix, ZERO_ADDRESS } from 'sails-js';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type {
  BountyAcceptedEvent,
  BountyAcceptedFilter,
  BountyCancelledEvent,
  BountyCancelledFilter,
  BountyClaimedEvent,
  BountyClaimedFilter,
  BountyPostedEvent,
  BountyPostedFilter,
  BountyRejectedEvent,
  BountyRejectedFilter,
  BountyRevokedEvent,
  BountyRevokedFilter,
  BountyStatusName,
  BountySubmittedEvent,
  BountySubmittedFilter,
  BountyTimedOutEvent,
  BountyTimedOutFilter,
  BountyWithdrawnEvent,
  BountyWithdrawnFilter,
  Unsubscribe,
} from './types.js';
import { BOUNTY_STATUS_BY_DISCRIMINANT } from './types.js';
import type { Track } from './errors.generated.js';

export type EventName =
  | 'BountyPosted'
  | 'BountyClaimed'
  | 'BountySubmitted'
  | 'BountyAccepted'
  | 'BountyWithdrawn'
  | 'BountyCancelled'
  | 'BountyRejected'
  | 'BountyTimedOut'
  | 'BountyRevoked';

export interface EventTypeMap {
  BountyPosted: BountyPostedEvent;
  BountyClaimed: BountyClaimedEvent;
  BountySubmitted: BountySubmittedEvent;
  BountyAccepted: BountyAcceptedEvent;
  BountyWithdrawn: BountyWithdrawnEvent;
  BountyCancelled: BountyCancelledEvent;
  BountyRejected: BountyRejectedEvent;
  BountyTimedOut: BountyTimedOutEvent;
  BountyRevoked: BountyRevokedEvent;
}

export interface FilterTypeMap {
  BountyPosted: BountyPostedFilter;
  BountyClaimed: BountyClaimedFilter;
  BountySubmitted: BountySubmittedFilter;
  BountyAccepted: BountyAcceptedFilter;
  BountyWithdrawn: BountyWithdrawnFilter;
  BountyCancelled: BountyCancelledFilter;
  BountyRejected: BountyRejectedFilter;
  BountyTimedOut: BountyTimedOutFilter;
  BountyRevoked: BountyRevokedFilter;
}

const PAYLOAD_TYPE: Record<EventName, string> = {
  BountyPosted:
    '(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32","title":"String","description":"String","acceptance":"String","deadline":"Option<u32>"})',
  BountyClaimed:
    '(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})',
  BountySubmitted:
    '(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})',
  BountyAccepted:
    '(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})',
  BountyWithdrawn:
    '(String, String, {"id":"u64","worker":"[u8;32]","amount":"u128","withdrawn_at":"u32"})',
  // v1.1 — v2 transition events. last_state decoded as u8 discriminant.
  BountyCancelled:
    '(String, String, {"id":"u64","by":"[u8;32]","refunded":"u128","cancelled_at":"u32"})',
  BountyRejected:
    '(String, String, {"id":"u64","by":"[u8;32]","worker":"[u8;32]","reason":"Option<String>","rejected_at":"u32"})',
  BountyTimedOut:
    '(String, String, {"id":"u64","last_state":"u8","called_by":"[u8;32]","refunded_to":"[u8;32]","timed_out_at":"u32"})',
  BountyRevoked:
    '(String, String, {"id":"u64","by":"[u8;32]","refunded_to":"[u8;32]","revoked_at":"u32"})',
};

interface InternalSub {
  filter: unknown;
  cb: (e: unknown) => void | Promise<void>;
}

interface ChainHeader {
  hash: { toHex: () => HexString };
}

interface EventRecord {
  event: {
    section: string;
    method: string;
    data: { message: { source: { eq: (x: HexString) => boolean }; destination: { eq: (x: HexString) => boolean }; payload: { toHex: () => HexString } } };
  };
  phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber: () => number } };
}

/**
 * Internal event multiplexer for BountyMeshClient.
 *
 * Design:
 *   - ONE underlying chain-head subscription per BountyMeshClient instance,
 *     opened lazily on the first .on() call across any event type.
 *   - Per-event subscription registry (5 typed events). Each registration
 *     gets a filter + callback; dispatch decodes the event payload once per
 *     incoming block and fans out to matching subscribers.
 *   - On last-unsubscribe across all event types, the underlying subscription
 *     tears down — a client that never subscribed pays zero WS overhead.
 *
 * Transport choice (subscribeNewHeads, not gearEvents.subscribeToGearEvent):
 *   subscribeToGearEvent's callback receives only the event object — no block
 *   hash, no extrinsic context. Consumers need blockHash + txHash per event
 *   (explorer links, indexer correlation), so we subscribe at the block-head
 *   level, fetch system.events at that block via api.at(blockHash), and pull
 *   txHash from the extrinsic phase. One subscription, all the metadata.
 *
 * Not exported from package public API; consumers see only the 5 onBountyX
 * methods on BountyMeshClient.
 */
export class SubscriptionManager {
  private readonly api: GearApi;
  private readonly programId: HexString;
  private readonly registry: TypeRegistry;
  private readonly subs: Map<EventName, Set<InternalSub>> = new Map();
  private underlyingUnsub: (() => void) | null = null;
  private opening: Promise<void> | null = null;

  constructor(api: GearApi, programId: HexString, registry: TypeRegistry) {
    this.api = api;
    this.programId = programId;
    this.registry = registry;
  }

  async on<E extends EventName>(
    eventName: E,
    filter: FilterTypeMap[E] | null,
    cb: (e: EventTypeMap[E]) => void | Promise<void>,
  ): Promise<Unsubscribe> {
    let set = this.subs.get(eventName);
    if (!set) {
      set = new Set();
      this.subs.set(eventName, set);
    }
    const entry: InternalSub = { filter, cb: cb as InternalSub['cb'] };
    set.add(entry);

    if (!this.underlyingUnsub) {
      if (!this.opening) this.opening = this.openUnderlying();
      await this.opening;
    }

    return () => {
      set!.delete(entry);
      if (this.totalSubCount() === 0 && this.underlyingUnsub) {
        this.underlyingUnsub();
        this.underlyingUnsub = null;
        this.opening = null;
      }
    };
  }

  private totalSubCount(): number {
    let n = 0;
    for (const set of this.subs.values()) n += set.size;
    return n;
  }

  private async openUnderlying(): Promise<void> {
    const unsub = await this.api.rpc.chain.subscribeNewHeads(async (header: ChainHeader) => {
      const blockHash = header.hash.toHex();
      try {
        const apiAt = await this.api.at(blockHash);
        const records = (await apiAt.query.system.events()) as unknown as EventRecord[];
        let signedBlock: { block: { extrinsics: Array<{ hash: { toHex: () => HexString } }> } } | null = null;

        for (const { event, phase } of records) {
          if (event.section !== 'gear' || event.method !== 'UserMessageSent') continue;
          const message = event.data.message;
          if (!message.source.eq(this.programId) || !message.destination.eq(ZERO_ADDRESS)) continue;

          const payloadHex = message.payload.toHex();
          if (getServiceNamePrefix(payloadHex) !== 'BountyService') continue;
          const fnName = getFnNamePrefix(payloadHex);
          if (!(fnName in PAYLOAD_TYPE)) continue;
          const evName = fnName as EventName;

          const set = this.subs.get(evName);
          if (!set || set.size === 0) continue;

          let txHash: HexString = '0x' as HexString;
          if (phase.isApplyExtrinsic) {
            if (!signedBlock) {
              signedBlock = (await this.api.rpc.chain.getBlock(blockHash)) as unknown as { block: { extrinsics: Array<{ hash: { toHex: () => HexString } }> } };
            }
            const idx = phase.asApplyExtrinsic.toNumber();
            const ext = signedBlock.block.extrinsics[idx];
            if (ext) txHash = ext.hash.toHex();
          }

          this.dispatch(evName, payloadHex, blockHash, txHash);
        }
      } catch (err) {
        // Per-block errors stay scoped; never tear down the subscription.
        console.error('[SubscriptionManager] dispatch error:', err);
      }
    });
    this.underlyingUnsub = unsub as unknown as () => void;
  }

  private dispatch(
    eventName: EventName,
    payloadHex: HexString,
    blockHash: HexString,
    txHash: HexString,
  ): void {
    const set = this.subs.get(eventName);
    if (!set || set.size === 0) return;

    const decoded = this.registry.createType(PAYLOAD_TYPE[eventName], payloadHex);
    const raw = (decoded as unknown as { toJSON: () => unknown[] }).toJSON()[2] as Record<string, unknown>;
    const normalized = this.normalize(eventName, raw, blockHash, txHash);

    for (const sub of set) {
      if (!this.matchesFilter(eventName, normalized, sub.filter)) continue;
      void (async () => {
        try {
          await sub.cb(normalized);
        } catch (err) {
          console.error('[SubscriptionManager] callback error:', err);
        }
      })();
    }
  }

  private normalize(
    eventName: EventName,
    raw: Record<string, unknown>,
    blockHash: HexString,
    txHash: HexString,
  ): EventTypeMap[EventName] {
    switch (eventName) {
      case 'BountyPosted':
        return {
          id: BigInt(raw.id as string | number),
          poster: raw.poster as HexString,
          reward: BigInt(raw.reward as string | number),
          track: raw.track as Track,
          postedAt: raw.posted_at as number,
          title: raw.title as string,
          description: raw.description as string,
          acceptance: raw.acceptance as string,
          deadline: raw.deadline as number | null,
          blockHash,
          txHash,
        } satisfies BountyPostedEvent;
      case 'BountyClaimed':
        return {
          id: BigInt(raw.id as string | number),
          worker: raw.worker as HexString,
          claimedAt: raw.claimed_at as number,
          blockHash,
          txHash,
        } satisfies BountyClaimedEvent;
      case 'BountySubmitted':
        return {
          id: BigInt(raw.id as string | number),
          worker: raw.worker as HexString,
          resultHash: raw.result_hash as HexString,
          submittedAt: raw.submitted_at as number,
          blockHash,
          txHash,
        } satisfies BountySubmittedEvent;
      case 'BountyAccepted':
        return {
          id: BigInt(raw.id as string | number),
          poster: raw.poster as HexString,
          worker: raw.worker as HexString,
          reward: BigInt(raw.reward as string | number),
          settledAt: raw.settled_at as number,
          blockHash,
          txHash,
        } satisfies BountyAcceptedEvent;
      case 'BountyWithdrawn':
        return {
          id: BigInt(raw.id as string | number),
          worker: raw.worker as HexString,
          amount: BigInt(raw.amount as string | number),
          withdrawnAt: raw.withdrawn_at as number,
          blockHash,
          txHash,
        } satisfies BountyWithdrawnEvent;
      case 'BountyCancelled':
        return {
          id: BigInt(raw.id as string | number),
          by: raw.by as HexString,
          refunded: BigInt(raw.refunded as string | number),
          cancelledAt: raw.cancelled_at as number,
          blockHash,
          txHash,
        } satisfies BountyCancelledEvent;
      case 'BountyRejected':
        return {
          id: BigInt(raw.id as string | number),
          by: raw.by as HexString,
          worker: raw.worker as HexString,
          reason: (raw.reason as string | null) ?? null,
          rejectedAt: raw.rejected_at as number,
          blockHash,
          txHash,
        } satisfies BountyRejectedEvent;
      case 'BountyTimedOut': {
        const ls = raw.last_state as number;
        const lastState: BountyStatusName =
          BOUNTY_STATUS_BY_DISCRIMINANT[ls] ?? 'Open';
        return {
          id: BigInt(raw.id as string | number),
          lastState,
          calledBy: raw.called_by as HexString,
          refundedTo: raw.refunded_to as HexString,
          timedOutAt: raw.timed_out_at as number,
          blockHash,
          txHash,
        } satisfies BountyTimedOutEvent;
      }
      case 'BountyRevoked':
        return {
          id: BigInt(raw.id as string | number),
          by: raw.by as HexString,
          refundedTo: raw.refunded_to as HexString,
          revokedAt: raw.revoked_at as number,
          blockHash,
          txHash,
        } satisfies BountyRevokedEvent;
    }
  }

  private matchesFilter(
    eventName: EventName,
    event: EventTypeMap[EventName],
    filter: unknown,
  ): boolean {
    if (!filter) return true;
    switch (eventName) {
      case 'BountyPosted': {
        const e = event as BountyPostedEvent;
        const f = filter as BountyPostedFilter;
        if (f.track !== undefined && e.track !== f.track) return false;
        if (f.minReward !== undefined && e.reward < f.minReward) return false;
        if (f.poster !== undefined && e.poster.toLowerCase() !== f.poster.toLowerCase()) return false;
        return true;
      }
      case 'BountyClaimed': {
        const e = event as BountyClaimedEvent;
        const f = filter as BountyClaimedFilter;
        if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase()) return false;
        return true;
      }
      case 'BountySubmitted': {
        const e = event as BountySubmittedEvent;
        const f = filter as BountySubmittedFilter;
        if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase()) return false;
        return true;
      }
      case 'BountyAccepted': {
        const e = event as BountyAcceptedEvent;
        const f = filter as BountyAcceptedFilter;
        if (f.poster !== undefined && e.poster.toLowerCase() !== f.poster.toLowerCase()) return false;
        if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase()) return false;
        return true;
      }
      case 'BountyWithdrawn': {
        const e = event as BountyWithdrawnEvent;
        const f = filter as BountyWithdrawnFilter;
        if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase()) return false;
        return true;
      }
      case 'BountyCancelled': {
        const e = event as BountyCancelledEvent;
        const f = filter as BountyCancelledFilter;
        if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase()) return false;
        return true;
      }
      case 'BountyRejected': {
        const e = event as BountyRejectedEvent;
        const f = filter as BountyRejectedFilter;
        if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase()) return false;
        if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase()) return false;
        return true;
      }
      case 'BountyTimedOut': {
        const e = event as BountyTimedOutEvent;
        const f = filter as BountyTimedOutFilter;
        if (f.refundedTo !== undefined && e.refundedTo.toLowerCase() !== f.refundedTo.toLowerCase()) return false;
        return true;
      }
      case 'BountyRevoked': {
        const e = event as BountyRevokedEvent;
        const f = filter as BountyRevokedFilter;
        if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase()) return false;
        if (f.refundedTo !== undefined && e.refundedTo.toLowerCase() !== f.refundedTo.toLowerCase()) return false;
        return true;
      }
    }
  }
}
