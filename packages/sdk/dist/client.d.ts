import { SailsProgram } from './generated/lib.js';
import type { BountyAcceptedEvent, BountyAcceptedFilter, BountyClaimedEvent, BountyClaimedFilter, BountyMeshClientOptions, BountyPostedEvent, BountyPostedFilter, BountySubmittedEvent, BountySubmittedFilter, BountyWithdrawnEvent, BountyWithdrawnFilter, PostArgs, TxResult, Unsubscribe } from './types.js';
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
}
//# sourceMappingURL=client.d.ts.map