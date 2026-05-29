/* AUTO-GENERATED from packages/sdk/idl/bountymesh.idl by scripts/generate-client.sh.
 * Run `make sdk-codegen` to regenerate. Do not edit by hand.
 * Drift detection: `make sdk-check-codegen-drift` (or `npm run check-codegen-drift`).
 *
 * Post-processing applied to sails-js-cli@0.5.1 output (working against @gear-js/api@0.44.2):
 *   1. `HexString` import split out of `@gear-js/api` (re-exported via subpath `/types`).
 *   2. `{ data: { message } }` callback param given `:any` — sails-js-cli predates strict @gear-js/api callback typing; refining the type belongs upstream.
 *   3. Error type renamed to SailsError to avoid shadowing the global Error class.
 *   4. global.d.ts stripped; same string-literal unions re-emitted module-scoped in _shim.ts.
 */
/* eslint-disable */
import { BaseGearProgram } from '@gear-js/api';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, getServiceNamePrefix, getFnNamePrefix, ZERO_ADDRESS } from 'sails-js';
export class SailsProgram {
    api;
    registry;
    bountyService;
    _program;
    constructor(api, programId) {
        this.api = api;
        const types = {
            Error: { "_enum": ["SelfLoop", "MarketPaused", "RewardBelowMinimum", "InsufficientPayment", "TitleTooLong", "DescriptionTooLong", "AcceptanceTooLong", "PayloadTooLong", "IdSpaceExhausted", "BountyNotFound", "BountyNotOpen", "BountyNotClaimed", "BountyNotSubmitted", "BountyNotAccepted", "AlreadyWithdrawn", "Unauthorized", "ZeroHashRejected"] },
            TrackEnum: { "_enum": ["Services", "Social", "Economy", "Open"] },
        };
        this.registry = new TypeRegistry();
        this.registry.setKnownTypes({ types });
        this.registry.register(types);
        if (programId) {
            this._program = new BaseGearProgram(programId, api);
        }
        this.bountyService = new BountyService(this);
    }
    get programId() {
        if (!this._program)
            throw new Error(`Program ID is not set`);
        return this._program.id;
    }
    /**
     * Initialize the BountyMesh program.
     *
     * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
     * protocol_fee_bps = 0 at launch.
     * paused = false at launch.
    */
    newCtorFromCode(code, min_reward, auto_settle_blocks) {
        const builder = new TransactionBuilder(this.api, this.registry, 'upload_program', null, 'New', [min_reward, auto_settle_blocks], '(u128, u32)', 'String', code, async (programId) => {
            this._program = await BaseGearProgram.new(programId, this.api);
        });
        return builder;
    }
    /**
     * Initialize the BountyMesh program.
     *
     * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
     * protocol_fee_bps = 0 at launch.
     * paused = false at launch.
    */
    newCtorFromCodeId(codeId, min_reward, auto_settle_blocks) {
        const builder = new TransactionBuilder(this.api, this.registry, 'create_program', null, 'New', [min_reward, auto_settle_blocks], '(u128, u32)', 'String', codeId, async (programId) => {
            this._program = await BaseGearProgram.new(programId, this.api);
        });
        return builder;
    }
}
export class BountyService {
    _program;
    constructor(_program) {
        this._program = _program;
    }
    /**
     * Accept the worker's submission. Poster's wallet-signed acknowledgement.
     *
     * Status flips Submitted → Accepted. NO value transfer — the reward stays in
     * program escrow until the worker pulls it via Withdraw. Two-phase settlement
     * per the PRD §5.2 redesign: Accept is the poster's signal, Withdraw is the
     * worker's signal. Both are wallet-signed calls; both count toward the
     * leaderboard's integrationsIn slice.
     *
     * Accept is not payable. Any attached value is refunded defensively.
    */
    accept(id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BountyService', 'Accept', id, 'u64', 'Result<Null, Error>', this._program.programId);
    }
    /**
     * Claim an Open bounty. First wallet wins; second caller gets Err(BountyNotOpen).
     *
     * Claim is not payable. Any attached value is refunded defensively via
     * CommandReply::with_value(value) on both Ok and Err branches.
    */
    claim(id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BountyService', 'Claim', id, 'u64', 'Result<Null, Error>', this._program.programId);
    }
    /**
     * Post a new bounty. Payable: `msg::value()` must be >= reward; excess refunded.
     *
     * All error branches return `CommandReply::new(Err(...)).with_value(value)` so
     * the caller's attached value rides back to them on the reply. Per
     * `agent-paid-service.md` "Critical correctness note": `msg::send_bytes` does
     * NOT fire on Err returns in sails-rs 0.10 — only the reply carries value atomically.
    */
    post(title, description, acceptance, reward, deadline, track) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BountyService', 'Post', [title, description, acceptance, reward, deadline, track], '(String, String, String, u128, Option<u32>, TrackEnum)', 'Result<u64, Error>', this._program.programId);
    }
    /**
     * Submit the worker's result payload + hash. Status flips Claimed → Submitted.
     *
     * Auth: caller must equal bounty.worker.
     * Hash invariant: result_hash must be non-zero. All-zero H256 is rejected per
     * the operator gotcha — workers generate hashes via `openssl dgst -sha256` over
     * the payload bytes, never with a constant value.
     *
     * Submit is not payable. Any attached value is refunded defensively.
    */
    submit(id, result_payload, result_hash) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BountyService', 'Submit', [id, result_payload, result_hash], '(u64, String, H256)', 'Result<Null, Error>', this._program.programId);
    }
    /**
     * Worker pulls the escrowed reward. Two-phase settlement closure.
     *
     * Withdraw is the only method that:
     * - Does NOT change bounty.status (bounty stays Accepted).
     * - Does NOT touch index maps (status doesn't move).
     * - DOES flip exactly one field (`bounty.withdrawn`).
     * - DOES deliver value to the worker — combined with any defensive refund
     * into a single `CommandReply::with_value(value + reward)`.
     *
     * Primitive choice: because Withdraw is worker-initiated (msg::source() ==
     * bounty.worker == reward target), `CommandReply::with_value` is the correct
     * primitive — it delivers value directly to the caller's balance on the
     * reply. AutoSettle (caller ≠ target, deferred) would use `msg::send_bytes`
     * for the same reason inverted. See PRD §8 Escrow integrity.
     *
     * Withdraw is not payable, but any attached value is refunded defensively
     * alongside the reward in a single reply.
     * Idempotency: a second call returns Err(AlreadyWithdrawn) without moving value.
    */
    withdraw(id) {
        if (!this._program.programId)
            throw new Error('Program ID is not set');
        return new TransactionBuilder(this._program.api, this._program.registry, 'send_message', 'BountyService', 'Withdraw', id, 'u64', 'Result<Null, Error>', this._program.programId);
    }
    subscribeToBountyPostedEvent(callback) {
        return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }) => {
            ;
            if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
                return;
            }
            const payload = message.payload.toHex();
            if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyPosted') {
                callback(this._program.registry.createType('(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32","title":"String","description":"String","acceptance":"String","deadline":"Option<u32>"})', message.payload)[2].toJSON());
            }
        });
    }
    subscribeToBountyClaimedEvent(callback) {
        return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }) => {
            ;
            if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
                return;
            }
            const payload = message.payload.toHex();
            if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyClaimed') {
                callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})', message.payload)[2].toJSON());
            }
        });
    }
    subscribeToBountySubmittedEvent(callback) {
        return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }) => {
            ;
            if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
                return;
            }
            const payload = message.payload.toHex();
            if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountySubmitted') {
                callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})', message.payload)[2].toJSON());
            }
        });
    }
    subscribeToBountyAcceptedEvent(callback) {
        return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }) => {
            ;
            if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
                return;
            }
            const payload = message.payload.toHex();
            if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyAccepted') {
                callback(this._program.registry.createType('(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})', message.payload)[2].toJSON());
            }
        });
    }
    subscribeToBountyWithdrawnEvent(callback) {
        return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }) => {
            ;
            if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
                return;
            }
            const payload = message.payload.toHex();
            if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyWithdrawn') {
                callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","amount":"u128","withdrawn_at":"u32"})', message.payload)[2].toJSON());
            }
        });
    }
}
//# sourceMappingURL=lib.js.map