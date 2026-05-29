import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, H256, ActorId } from 'sails-js';
import type { SailsError, TrackEnum } from './_shim.js';
export declare class SailsProgram {
    api: GearApi;
    readonly registry: TypeRegistry;
    readonly bountyService: BountyService;
    private _program?;
    constructor(api: GearApi, programId?: `0x${string}`);
    get programId(): `0x${string}`;
    /**
     * Initialize the BountyMesh program.
     *
     * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
     * protocol_fee_bps = 0 at launch.
     * paused = false at launch.
    */
    newCtorFromCode(code: Uint8Array | Buffer | HexString, min_reward: number | string | bigint, auto_settle_blocks: number): TransactionBuilder<null>;
    /**
     * Initialize the BountyMesh program.
     *
     * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
     * protocol_fee_bps = 0 at launch.
     * paused = false at launch.
    */
    newCtorFromCodeId(codeId: `0x${string}`, min_reward: number | string | bigint, auto_settle_blocks: number): TransactionBuilder<null>;
}
export declare class BountyService {
    private _program;
    constructor(_program: SailsProgram);
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
    accept(id: number | string | bigint): TransactionBuilder<{
        ok: null;
    } | {
        err: SailsError;
    }>;
    /**
     * Claim an Open bounty. First wallet wins; second caller gets Err(BountyNotOpen).
     *
     * Claim is not payable. Any attached value is refunded defensively via
     * CommandReply::with_value(value) on both Ok and Err branches.
    */
    claim(id: number | string | bigint): TransactionBuilder<{
        ok: null;
    } | {
        err: SailsError;
    }>;
    /**
     * Post a new bounty. Payable: `msg::value()` must be >= reward; excess refunded.
     *
     * All error branches return `CommandReply::new(Err(...)).with_value(value)` so
     * the caller's attached value rides back to them on the reply. Per
     * `agent-paid-service.md` "Critical correctness note": `msg::send_bytes` does
     * NOT fire on Err returns in sails-rs 0.10 — only the reply carries value atomically.
    */
    post(title: string, description: string, acceptance: string, reward: number | string | bigint, deadline: number | null, track: TrackEnum): TransactionBuilder<{
        ok: number | string | bigint;
    } | {
        err: SailsError;
    }>;
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
    submit(id: number | string | bigint, result_payload: string, result_hash: H256): TransactionBuilder<{
        ok: null;
    } | {
        err: SailsError;
    }>;
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
    withdraw(id: number | string | bigint): TransactionBuilder<{
        ok: null;
    } | {
        err: SailsError;
    }>;
    subscribeToBountyPostedEvent(callback: (data: {
        id: number | string | bigint;
        poster: ActorId;
        reward: number | string | bigint;
        track: TrackEnum;
        posted_at: number;
        title: string;
        description: string;
        acceptance: string;
        deadline: number | null;
    }) => void | Promise<void>): Promise<() => void>;
    subscribeToBountyClaimedEvent(callback: (data: {
        id: number | string | bigint;
        worker: ActorId;
        claimed_at: number;
    }) => void | Promise<void>): Promise<() => void>;
    subscribeToBountySubmittedEvent(callback: (data: {
        id: number | string | bigint;
        worker: ActorId;
        result_hash: H256;
        submitted_at: number;
    }) => void | Promise<void>): Promise<() => void>;
    subscribeToBountyAcceptedEvent(callback: (data: {
        id: number | string | bigint;
        poster: ActorId;
        worker: ActorId;
        reward: number | string | bigint;
        settled_at: number;
    }) => void | Promise<void>): Promise<() => void>;
    subscribeToBountyWithdrawnEvent(callback: (data: {
        id: number | string | bigint;
        worker: ActorId;
        amount: number | string | bigint;
        withdrawn_at: number;
    }) => void | Promise<void>): Promise<() => void>;
}
//# sourceMappingURL=lib.d.ts.map