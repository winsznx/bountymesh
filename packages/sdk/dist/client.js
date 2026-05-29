import { SailsProgram } from './generated/lib.js';
import { adaptErr } from './errors.js';
import { SubscriptionManager } from './events.js';
const HEX_64 = /^0x[0-9a-fA-F]{64}$/;
const HEX_64_LOWER = /^0x[0-9a-f]{64}$/;
/**
 * resultHash normalization for submit():
 *   1. Input is trimmed and lowercased before any check (so '0xABC' === '0xabc' for our purposes).
 *   2. Must start with '0x'.
 *   3. After the '0x' prefix:
 *        - if EMPTY or all-'0' (any length: '0x', '0x0', '0x00', …, '0x' + 64 zeros): treated as zero hash → throw TypeError matching /zero hash/i.
 *        - else must match exactly 64 hex chars (32 bytes); otherwise throw TypeError.
 *   4. Returns the normalized lowercase hex string for forwarding to sails-js.
 *
 * Rationale: the contract rejects all-zero H256 via ZeroHashRejected per CLAUDE.md.
 * Pre-checking client-side saves a round-trip + gas + a defensive refund, and surfaces
 * the error at the call site (synchronous TypeError) instead of inside an awaited reply.
 * Distinct from TxErr: a TypeError here is a programmer error; a TxErr is a chain-level rejection.
 */
function normalizeAndAssertNonZeroHash(value) {
    if (typeof value !== 'string') {
        throw new TypeError('resultHash must be a 0x-prefixed 32-byte hex string');
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized.startsWith('0x')) {
        throw new TypeError('resultHash must be a 0x-prefixed 32-byte hex string');
    }
    const body = normalized.slice(2);
    if (body.length === 0 || /^0+$/.test(body)) {
        throw new TypeError('resultHash must not be the zero hash (the contract rejects ZeroHashRejected; pre-check saves a round-trip)');
    }
    if (!HEX_64_LOWER.test(normalized)) {
        throw new TypeError('resultHash must be a 0x-prefixed 32-byte (64 hex char) string');
    }
    return normalized;
}
function isInjectedSigner(s) {
    return (typeof s === 'object' &&
        s !== null &&
        typeof s.address === 'string' &&
        s.signer != null);
}
function isKeyringPair(s) {
    return (typeof s === 'object' &&
        s !== null &&
        typeof s.sign === 'function' &&
        typeof s.address === 'string');
}
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
export class BountyMeshClient {
    program;
    signer;
    events;
    constructor(opts) {
        if (typeof opts.programId !== 'string' || !HEX_64.test(opts.programId)) {
            throw new TypeError('programId must be a 0x-prefixed 32-byte hex string');
        }
        if (!isKeyringPair(opts.signer) && !isInjectedSigner(opts.signer)) {
            throw new TypeError('signer must be an IKeyringPair (Node) or { address, signer } (browser injection)');
        }
        this.program = new SailsProgram(opts.api, opts.programId);
        this.signer = opts.signer;
        this.events = new SubscriptionManager(opts.api, opts.programId, this.program.registry);
    }
    async post(args) {
        const tx = this.program.bountyService.post(args.title, args.description, args.acceptance, args.reward, args.deadline ?? null, args.track);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        tx.withValue(args.reward);
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return {
                ok: true,
                value: { bountyId: BigInt(reply.ok) },
                txHash,
                blockHash,
            };
        }
        return {
            ok: false,
            error: adaptErr(reply.err),
            txHash,
            blockHash,
        };
    }
    async claim(id) {
        const tx = this.program.bountyService.claim(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        // Claim is not payable — no withValue(). Contract has defensive refund on
        // attached value, but attaching from the client would inflate gas and
        // create a refund roundtrip on every claim.
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    async submit(id, resultPayload, resultHash) {
        // Pre-validation BEFORE any chain interaction. Throws TypeError on malformed
        // or all-zero hash — see normalizeAndAssertNonZeroHash above.
        const normalizedHash = normalizeAndAssertNonZeroHash(resultHash);
        const tx = this.program.bountyService.submit(id, resultPayload, normalizedHash);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        // Submit is not payable — no withValue() (same shape as claim).
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    async accept(id) {
        const tx = this.program.bountyService.accept(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        // Accept is not payable and state-flip-only — Submitted → Accepted. The
        // escrowed reward does NOT move here; that happens later when the worker
        // pulls via Withdraw. Per MASTER_PRD §5.2 (two-phase settlement) and §8
        // (caller-vs-target rule): Accept's caller is the poster, value-target
        // would be the worker, so the natural primitive for value transfer would
        // be msg::send_bytes — but Accept transfers no value, so neither
        // CommandReply::with_value nor msg::send_bytes carries reward here.
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
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
    async withdraw(id) {
        const tx = this.program.bountyService.withdraw(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    async onBountyPosted(filter, cb) {
        return this.events.on('BountyPosted', filter, cb);
    }
    async onBountyClaimed(filter, cb) {
        return this.events.on('BountyClaimed', filter, cb);
    }
    async onBountySubmitted(filter, cb) {
        return this.events.on('BountySubmitted', filter, cb);
    }
    async onBountyAccepted(filter, cb) {
        return this.events.on('BountyAccepted', filter, cb);
    }
    async onBountyWithdrawn(filter, cb) {
        return this.events.on('BountyWithdrawn', filter, cb);
    }
    // ============================================================
    // v1.1 — v2 transition methods (Cancel / Reject / Timeout / Revoke)
    // ============================================================
    /**
     * Cancel an Open bounty. Poster-only. Refunds the full escrow + any
     * attached value via CommandReply::with_value(reward + value) on the reply.
     * Status flip: Open → Cancelled (terminal).
     */
    async cancel(id) {
        const tx = this.program.bountyService.cancel(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    /**
     * Reject a Submitted bounty. Poster-only. Optional ≤500-char reason is
     * persisted on-chain for indexer visibility. Refunds the full escrow.
     * Status flip: Submitted → Rejected (terminal).
     */
    async reject(id, reason = null) {
        const tx = this.program.bountyService.reject(id, reason);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    /**
     * Permissionless watchdog: force a stuck bounty into TimedOut after the
     * configured deadline block. Requires `bounty.deadline` set AND
     * `current_block > deadline`. Pushes escrow to poster's mailbox via
     * `msg::send_bytes(poster, [], reward)` — caller's defensive value rides
     * back on the reply via `with_value(value)`.
     * Status flip: {Open|Claimed|Submitted} → TimedOut (terminal).
     */
    async timeout(id) {
        const tx = this.program.bountyService.timeout(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    /**
     * Owner emergency: forcibly Revoke a bounty in any non-Revoked state.
     * Caller MUST be `state.owner` (set immutably at construction). Non-
     * withdrawn escrow is pushed to the original poster via `msg::send_bytes`.
     * Status flip: {any non-Revoked} → Revoked (terminal).
     */
    async revoke(id) {
        const tx = this.program.bountyService.revoke(id);
        if (isInjectedSigner(this.signer)) {
            tx.withAccount(this.signer.address, { signer: this.signer.signer });
        }
        else {
            tx.withAccount(this.signer);
        }
        await tx.calculateGas();
        const sent = await tx.signAndSend();
        const reply = await sent.response();
        const { txHash, blockHash } = sent;
        if ('ok' in reply) {
            return { ok: true, value: null, txHash, blockHash };
        }
        return { ok: false, error: adaptErr(reply.err), txHash, blockHash };
    }
    // ============================================================
    // v1.1 — v2 event subscriptions
    // ============================================================
    async onBountyCancelled(filter, cb) {
        return this.events.on('BountyCancelled', filter, cb);
    }
    async onBountyRejected(filter, cb) {
        return this.events.on('BountyRejected', filter, cb);
    }
    async onBountyTimedOut(filter, cb) {
        return this.events.on('BountyTimedOut', filter, cb);
    }
    async onBountyRevoked(filter, cb) {
        return this.events.on('BountyRevoked', filter, cb);
    }
}
//# sourceMappingURL=client.js.map