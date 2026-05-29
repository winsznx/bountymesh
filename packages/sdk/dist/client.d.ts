import { SailsProgram } from './generated/lib.js';
import type { BountyAcceptedEvent, BountyAcceptedFilter, BountyCancelledEvent, BountyCancelledFilter, BountyClaimedEvent, BountyClaimedFilter, BountyMeshClientOptions, BountyPostedEvent, BountyPostedFilter, BountyRejectedEvent, BountyRejectedFilter, BountyRevokedEvent, BountyRevokedFilter, BountySubmittedEvent, BountySubmittedFilter, BountyTimedOutEvent, BountyTimedOutFilter, BountyWithdrawnEvent, BountyWithdrawnFilter, PostArgs, TxResult, Unsubscribe } from './types.js';
import type { HexString } from '@gear-js/api/types';
/**
 * BountyMeshClient — ergonomic wrapper around the auto-generated sails-js client.
 *
 * Verified against sails-js@0.5.1 (node_modules/sails-js/lib/transaction-builder.d.ts):
 *   - bountyService.post(...) returns TransactionBuilder<{ ok: u64 } | { err: SailsError }>
 *   - .withAccount(string | IKeyringPair, signerOptions?): this
 *   - .withValue(bigint): this
 *   - .calculateGas(allowOtherPanics?, increaseGas?): Promise<this>
 *   - .signAndSend(): Promise<IMethodReturnType<ResponseType>>
 *       where IMethodReturnType = { msgId, blockHash, txHash, isFinalized, response }
 *       and `response` is itself an async fn returning the decoded ResponseType.
 */
export declare class BountyMeshClient {
    readonly program: SailsProgram;
    private readonly signer;
    private readonly events;
    constructor(opts: BountyMeshClientOptions);
    post(args: PostArgs): Promise<TxResult<{
        bountyId: bigint;
    }>>;
    /**
     * Post with staged lifecycle callbacks for richer UX (3-state buttons:
     * signing → submitted → finalized). Returns the same TxResult as `post`.
     *
     * Callback timing:
     *   onSigning     fires before the wallet extension popup is opened
     *   onSubmitted   fires when the runtime accepts the tx (txHash known)
     *   onFinalized   fires when the contract reply lands ok (bountyId known)
     *   onError       fires on any throw (signer rejection, network drop, etc.)
     *
     * Note that `onFinalized` does NOT fire on contract-typed `Err` replies —
     * those resolve the returned TxResult with `ok: false` instead, mirroring
     * `post`. `onError` is reserved for transport / signer failures.
     */
    postWithCallback(args: PostArgs, callbacks?: {
        onSigning?: () => void;
        onSubmitted?: (txHash: HexString) => void;
        onFinalized?: (bountyId: bigint, txHash: HexString) => void;
        onError?: (error: Error) => void;
    }): Promise<TxResult<{
        bountyId: bigint;
    }>>;
    claim(id: bigint): Promise<TxResult<null>>;
    submit(id: bigint, resultPayload: string, resultHash: `0x${string}`): Promise<TxResult<null>>;
    accept(id: bigint): Promise<TxResult<null>>;
    /**
     * Withdraw the escrowed reward. Worker-initiated two-phase settlement closure.
     *
     * Per MASTER_PRD §8 (caller-vs-target rule):
     *   caller (msg::source()) == bounty.worker == value-target → CommandReply::with_value
     *
     * The contract returns `CommandReply::new(Ok(()).with_value(value + reward))`,
     * which delivers the reward to the worker's balance directly on the reply tx
     * — one atomic transfer combining any defensive refund of attached value
     * with the actual reward. No second hop (no outbound message, no mailbox
     * claim). The implemented surface contains zero outbound-message primitives;
     * value-routing for Withdraw is end-to-end via the reply.
     *
     * Idempotent: a second Withdraw on the same bountyId returns Err(AlreadyWithdrawn)
     * without moving value. The `bounty.withdrawn` flag flips on the first successful
     * call and is checked on entry.
     *
     * Withdraw is not payable from the caller's perspective — we attach no value;
     * the contract still defensively refunds any incidental attached value as part
     * of the same with_value reply.
     */
    withdraw(id: bigint): Promise<TxResult<null>>;
    onBountyPosted(filter: BountyPostedFilter | null, cb: (e: BountyPostedEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyClaimed(filter: BountyClaimedFilter | null, cb: (e: BountyClaimedEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountySubmitted(filter: BountySubmittedFilter | null, cb: (e: BountySubmittedEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyAccepted(filter: BountyAcceptedFilter | null, cb: (e: BountyAcceptedEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyWithdrawn(filter: BountyWithdrawnFilter | null, cb: (e: BountyWithdrawnEvent) => void | Promise<void>): Promise<Unsubscribe>;
    /**
     * Cancel an Open bounty. Poster-only. Refunds the full escrow + any
     * attached value via CommandReply::with_value(reward + value) on the reply.
     * Status flip: Open → Cancelled (terminal).
     */
    cancel(id: bigint): Promise<TxResult<null>>;
    /**
     * Reject a Submitted bounty. Poster-only. Optional ≤500-char reason is
     * persisted on-chain for indexer visibility. Refunds the full escrow.
     * Status flip: Submitted → Rejected (terminal).
     */
    reject(id: bigint, reason?: string | null): Promise<TxResult<null>>;
    /**
     * Permissionless watchdog: force a stuck bounty into TimedOut after the
     * configured deadline block. Requires `bounty.deadline` set AND
     * `current_block > deadline`. Pushes escrow to poster's mailbox via
     * `msg::send_bytes(poster, [], reward)` — caller's defensive value rides
     * back on the reply via `with_value(value)`.
     * Status flip: {Open|Claimed|Submitted} → TimedOut (terminal).
     */
    timeout(id: bigint): Promise<TxResult<null>>;
    /**
     * Owner emergency: forcibly Revoke a bounty in any non-Revoked state.
     * Caller MUST be `state.owner` (set immutably at construction). Non-
     * withdrawn escrow is pushed to the original poster via `msg::send_bytes`.
     * Status flip: {any non-Revoked} → Revoked (terminal).
     */
    revoke(id: bigint): Promise<TxResult<null>>;
    onBountyCancelled(filter: BountyCancelledFilter | null, cb: (e: BountyCancelledEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyRejected(filter: BountyRejectedFilter | null, cb: (e: BountyRejectedEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyTimedOut(filter: BountyTimedOutFilter | null, cb: (e: BountyTimedOutEvent) => void | Promise<void>): Promise<Unsubscribe>;
    onBountyRevoked(filter: BountyRevokedFilter | null, cb: (e: BountyRevokedEvent) => void | Promise<void>): Promise<Unsubscribe>;
}
//# sourceMappingURL=client.d.ts.map