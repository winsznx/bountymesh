import { getFnNamePrefix, getServiceNamePrefix, ZERO_ADDRESS } from 'sails-js';
import { BOUNTY_STATUS_BY_DISCRIMINANT } from './types.js';
const PAYLOAD_TYPE = {
    BountyPosted: '(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32","title":"String","description":"String","acceptance":"String","deadline":"Option<u32>"})',
    BountyClaimed: '(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})',
    BountySubmitted: '(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})',
    BountyAccepted: '(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})',
    BountyWithdrawn: '(String, String, {"id":"u64","worker":"[u8;32]","amount":"u128","withdrawn_at":"u32"})',
    // v1.1 — v2 transition events. last_state decoded as u8 discriminant.
    BountyCancelled: '(String, String, {"id":"u64","by":"[u8;32]","refunded":"u128","cancelled_at":"u32"})',
    BountyRejected: '(String, String, {"id":"u64","by":"[u8;32]","worker":"[u8;32]","reason":"Option<String>","rejected_at":"u32"})',
    BountyTimedOut: '(String, String, {"id":"u64","last_state":"u8","called_by":"[u8;32]","refunded_to":"[u8;32]","timed_out_at":"u32"})',
    BountyRevoked: '(String, String, {"id":"u64","by":"[u8;32]","refunded_to":"[u8;32]","revoked_at":"u32"})',
};
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
    api;
    programId;
    registry;
    subs = new Map();
    underlyingUnsub = null;
    opening = null;
    constructor(api, programId, registry) {
        this.api = api;
        this.programId = programId;
        this.registry = registry;
    }
    async on(eventName, filter, cb) {
        let set = this.subs.get(eventName);
        if (!set) {
            set = new Set();
            this.subs.set(eventName, set);
        }
        const entry = { filter, cb: cb };
        set.add(entry);
        if (!this.underlyingUnsub) {
            if (!this.opening)
                this.opening = this.openUnderlying();
            await this.opening;
        }
        return () => {
            set.delete(entry);
            if (this.totalSubCount() === 0 && this.underlyingUnsub) {
                this.underlyingUnsub();
                this.underlyingUnsub = null;
                this.opening = null;
            }
        };
    }
    totalSubCount() {
        let n = 0;
        for (const set of this.subs.values())
            n += set.size;
        return n;
    }
    async openUnderlying() {
        const unsub = await this.api.rpc.chain.subscribeNewHeads(async (header) => {
            const blockHash = header.hash.toHex();
            try {
                const apiAt = await this.api.at(blockHash);
                const records = (await apiAt.query.system.events());
                let signedBlock = null;
                for (const { event, phase } of records) {
                    if (event.section !== 'gear' || event.method !== 'UserMessageSent')
                        continue;
                    const message = event.data.message;
                    if (!message.source.eq(this.programId) || !message.destination.eq(ZERO_ADDRESS))
                        continue;
                    const payloadHex = message.payload.toHex();
                    if (getServiceNamePrefix(payloadHex) !== 'BountyService')
                        continue;
                    const fnName = getFnNamePrefix(payloadHex);
                    if (!(fnName in PAYLOAD_TYPE))
                        continue;
                    const evName = fnName;
                    const set = this.subs.get(evName);
                    if (!set || set.size === 0)
                        continue;
                    let txHash = '0x';
                    if (phase.isApplyExtrinsic) {
                        if (!signedBlock) {
                            signedBlock = (await this.api.rpc.chain.getBlock(blockHash));
                        }
                        const idx = phase.asApplyExtrinsic.toNumber();
                        const ext = signedBlock.block.extrinsics[idx];
                        if (ext)
                            txHash = ext.hash.toHex();
                    }
                    this.dispatch(evName, payloadHex, blockHash, txHash);
                }
            }
            catch (err) {
                // Per-block errors stay scoped; never tear down the subscription.
                console.error('[SubscriptionManager] dispatch error:', err);
            }
        });
        this.underlyingUnsub = unsub;
    }
    dispatch(eventName, payloadHex, blockHash, txHash) {
        const set = this.subs.get(eventName);
        if (!set || set.size === 0)
            return;
        const decoded = this.registry.createType(PAYLOAD_TYPE[eventName], payloadHex);
        const raw = decoded.toJSON()[2];
        const normalized = this.normalize(eventName, raw, blockHash, txHash);
        for (const sub of set) {
            if (!this.matchesFilter(eventName, normalized, sub.filter))
                continue;
            void (async () => {
                try {
                    await sub.cb(normalized);
                }
                catch (err) {
                    console.error('[SubscriptionManager] callback error:', err);
                }
            })();
        }
    }
    normalize(eventName, raw, blockHash, txHash) {
        switch (eventName) {
            case 'BountyPosted':
                return {
                    id: BigInt(raw.id),
                    poster: raw.poster,
                    reward: BigInt(raw.reward),
                    track: raw.track,
                    postedAt: raw.posted_at,
                    title: raw.title,
                    description: raw.description,
                    acceptance: raw.acceptance,
                    deadline: raw.deadline,
                    blockHash,
                    txHash,
                };
            case 'BountyClaimed':
                return {
                    id: BigInt(raw.id),
                    worker: raw.worker,
                    claimedAt: raw.claimed_at,
                    blockHash,
                    txHash,
                };
            case 'BountySubmitted':
                return {
                    id: BigInt(raw.id),
                    worker: raw.worker,
                    resultHash: raw.result_hash,
                    submittedAt: raw.submitted_at,
                    blockHash,
                    txHash,
                };
            case 'BountyAccepted':
                return {
                    id: BigInt(raw.id),
                    poster: raw.poster,
                    worker: raw.worker,
                    reward: BigInt(raw.reward),
                    settledAt: raw.settled_at,
                    blockHash,
                    txHash,
                };
            case 'BountyWithdrawn':
                return {
                    id: BigInt(raw.id),
                    worker: raw.worker,
                    amount: BigInt(raw.amount),
                    withdrawnAt: raw.withdrawn_at,
                    blockHash,
                    txHash,
                };
            case 'BountyCancelled':
                return {
                    id: BigInt(raw.id),
                    by: raw.by,
                    refunded: BigInt(raw.refunded),
                    cancelledAt: raw.cancelled_at,
                    blockHash,
                    txHash,
                };
            case 'BountyRejected':
                return {
                    id: BigInt(raw.id),
                    by: raw.by,
                    worker: raw.worker,
                    reason: raw.reason ?? null,
                    rejectedAt: raw.rejected_at,
                    blockHash,
                    txHash,
                };
            case 'BountyTimedOut': {
                const ls = raw.last_state;
                const lastState = BOUNTY_STATUS_BY_DISCRIMINANT[ls] ?? 'Open';
                return {
                    id: BigInt(raw.id),
                    lastState,
                    calledBy: raw.called_by,
                    refundedTo: raw.refunded_to,
                    timedOutAt: raw.timed_out_at,
                    blockHash,
                    txHash,
                };
            }
            case 'BountyRevoked':
                return {
                    id: BigInt(raw.id),
                    by: raw.by,
                    refundedTo: raw.refunded_to,
                    revokedAt: raw.revoked_at,
                    blockHash,
                    txHash,
                };
        }
    }
    matchesFilter(eventName, event, filter) {
        if (!filter)
            return true;
        switch (eventName) {
            case 'BountyPosted': {
                const e = event;
                const f = filter;
                if (f.track !== undefined && e.track !== f.track)
                    return false;
                if (f.minReward !== undefined && e.reward < f.minReward)
                    return false;
                if (f.poster !== undefined && e.poster.toLowerCase() !== f.poster.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyClaimed': {
                const e = event;
                const f = filter;
                if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase())
                    return false;
                return true;
            }
            case 'BountySubmitted': {
                const e = event;
                const f = filter;
                if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyAccepted': {
                const e = event;
                const f = filter;
                if (f.poster !== undefined && e.poster.toLowerCase() !== f.poster.toLowerCase())
                    return false;
                if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyWithdrawn': {
                const e = event;
                const f = filter;
                if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyCancelled': {
                const e = event;
                const f = filter;
                if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyRejected': {
                const e = event;
                const f = filter;
                if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase())
                    return false;
                if (f.worker !== undefined && e.worker.toLowerCase() !== f.worker.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyTimedOut': {
                const e = event;
                const f = filter;
                if (f.refundedTo !== undefined && e.refundedTo.toLowerCase() !== f.refundedTo.toLowerCase())
                    return false;
                return true;
            }
            case 'BountyRevoked': {
                const e = event;
                const f = filter;
                if (f.by !== undefined && e.by.toLowerCase() !== f.by.toLowerCase())
                    return false;
                if (f.refundedTo !== undefined && e.refundedTo.toLowerCase() !== f.refundedTo.toLowerCase())
                    return false;
                return true;
            }
        }
    }
}
//# sourceMappingURL=events.js.map