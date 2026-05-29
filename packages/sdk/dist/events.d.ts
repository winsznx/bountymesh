import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type { BountyAcceptedEvent, BountyAcceptedFilter, BountyClaimedEvent, BountyClaimedFilter, BountyPostedEvent, BountyPostedFilter, BountySubmittedEvent, BountySubmittedFilter, BountyWithdrawnEvent, BountyWithdrawnFilter, Unsubscribe } from './types.js';
export type EventName = 'BountyPosted' | 'BountyClaimed' | 'BountySubmitted' | 'BountyAccepted' | 'BountyWithdrawn';
export interface EventTypeMap {
    BountyPosted: BountyPostedEvent;
    BountyClaimed: BountyClaimedEvent;
    BountySubmitted: BountySubmittedEvent;
    BountyAccepted: BountyAcceptedEvent;
    BountyWithdrawn: BountyWithdrawnEvent;
}
export interface FilterTypeMap {
    BountyPosted: BountyPostedFilter;
    BountyClaimed: BountyClaimedFilter;
    BountySubmitted: BountySubmittedFilter;
    BountyAccepted: BountyAcceptedFilter;
    BountyWithdrawn: BountyWithdrawnFilter;
}
/**
 * Internal event multiplexer for BountyMeshClient.
 *
 * Design (per MASTER_PRD §10 + Phase 2 senior-review concern #5):
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
export declare class SubscriptionManager {
    private readonly api;
    private readonly programId;
    private readonly registry;
    private readonly subs;
    private underlyingUnsub;
    private opening;
    constructor(api: GearApi, programId: HexString, registry: TypeRegistry);
    on<E extends EventName>(eventName: E, filter: FilterTypeMap[E] | null, cb: (e: EventTypeMap[E]) => void | Promise<void>): Promise<Unsubscribe>;
    private totalSubCount;
    private openUnderlying;
    private dispatch;
    private normalize;
    private matchesFilter;
}
//# sourceMappingURL=events.d.ts.map