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

import { GearApi, BaseGearProgram } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { TypeRegistry } from '@polkadot/types';
import { TransactionBuilder, H256, getServiceNamePrefix, getFnNamePrefix, ZERO_ADDRESS, ActorId } from 'sails-js';
import type { SailsError, TrackEnum, BountyStatus } from './_shim.js';

export class SailsProgram {
  public readonly registry: TypeRegistry;
  public readonly bountyService: BountyService;
  private _program?: BaseGearProgram;

  constructor(public api: GearApi, programId?: `0x${string}`) {
    const types: Record<string, any> = {
      Error: {"_enum":["SelfLoop","MarketPaused","RewardBelowMinimum","InsufficientPayment","TitleTooLong","DescriptionTooLong","AcceptanceTooLong","PayloadTooLong","IdSpaceExhausted","BountyNotFound","BountyNotOpen","BountyNotClaimed","BountyNotSubmitted","BountyNotAccepted","AlreadyWithdrawn","Unauthorized","ZeroHashRejected","DeadlineNotReached","NoDeadlineSet","BountyAlreadyTerminal","ReasonTooLong"]},
      TrackEnum: {"_enum":["Services","Social","Economy","Open"]},
      BountyStatus: {"_enum":["Open","Claimed","Submitted","Accepted","Rejected","Cancelled","TimedOut","Revoked"]},
    }

    this.registry = new TypeRegistry();
    this.registry.setKnownTypes({ types });
    this.registry.register(types);
    if (programId) {
      this._program = new BaseGearProgram(programId, api);
    }

    this.bountyService = new BountyService(this);
  }

  public get programId(): `0x${string}` {
    if (!this._program) throw new Error(`Program ID is not set`);
    return this._program.id;
  }

  /**
   * Initialize the BountyMesh program.
   * 
   * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
   * protocol_fee_bps = 0 at launch.
   * paused = false at launch.
  */
  newCtorFromCode(code: Uint8Array | Buffer | HexString, min_reward: number | string | bigint, auto_settle_blocks: number): TransactionBuilder<null> {
    const builder = new TransactionBuilder<null>(
      this.api,
      this.registry,
      'upload_program',
      null,
      'New',
      [min_reward, auto_settle_blocks],
      '(u128, u32)',
      'String',
      code,
      async (programId) =>  {
        this._program = await BaseGearProgram.new(programId, this.api);
      }
    );
    return builder;
  }

  /**
   * Initialize the BountyMesh program.
   * 
   * Owner = msg::source() (immutable for hackathon scope; AdminService lands later).
   * protocol_fee_bps = 0 at launch.
   * paused = false at launch.
  */
  newCtorFromCodeId(codeId: `0x${string}`, min_reward: number | string | bigint, auto_settle_blocks: number) {
    const builder = new TransactionBuilder<null>(
      this.api,
      this.registry,
      'create_program',
      null,
      'New',
      [min_reward, auto_settle_blocks],
      '(u128, u32)',
      'String',
      codeId,
      async (programId) =>  {
        this._program = await BaseGearProgram.new(programId, this.api);
      }
    );
    return builder;
  }
}

export class BountyService {
  constructor(private _program: SailsProgram) {}

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
  public accept(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Accept',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  /**
   * Cancel an Open bounty. Poster-only. Refunds the full escrow + any attached value.
   * 
   * Status: Open → Cancelled (terminal).
   * Caller MUST be the original poster.
   * Refund: caller == value-target (poster), so `CommandReply::with_value(reward + value)`
   * rides on the reply atomically.
  */
  public cancel(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Cancel',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  /**
   * Claim an Open bounty. First wallet wins; second caller gets Err(BountyNotOpen).
   * 
   * Claim is not payable. Any attached value is refunded defensively via
   * CommandReply::with_value(value) on both Ok and Err branches.
  */
  public claim(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Claim',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  /**
   * Post a new bounty. Payable: `msg::value()` must be >= reward; excess refunded.
   * 
   * All error branches return `CommandReply::new(Err(...)).with_value(value)` so
   * the caller's attached value rides back to them on the reply. Per
   * `agent-paid-service.md` "Critical correctness note": `msg::send_bytes` does
   * NOT fire on Err returns in sails-rs 0.10 — only the reply carries value atomically.
  */
  public post(title: string, description: string, acceptance: string, reward: number | string | bigint, deadline: number | null, track: TrackEnum): TransactionBuilder<{ ok: number | string | bigint } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: number | string | bigint } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Post',
      [title, description, acceptance, reward, deadline, track],
      '(String, String, String, u128, Option<u32>, TrackEnum)',
      'Result<u64, Error>',
      this._program.programId,
    );
  }

  /**
   * Reject a Submitted bounty. Poster-only. Refunds the full escrow + any attached value.
   * 
   * Status: Submitted → Rejected (terminal).
   * Caller MUST be the original poster.
   * The optional `reason` (≤ 500 chars) is persisted on-chain for indexer visibility.
   * Refund: same primitive as Cancel — caller == value-target (poster).
  */
  public reject(id: number | string | bigint, reason: string | null): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Reject',
      [id, reason],
      '(u64, Option<String>)',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  /**
   * Owner emergency: forcibly Revoke a bounty in any state.
   * 
   * Caller MUST be `state.owner` (set immutably at construction).
   * If bounty has not been withdrawn, escrow is pushed to the original poster.
   * If bounty has already been withdrawn (Accepted + withdrawn=true), no
   * escrow movement — status flip only.
   * Refund: caller (owner) ≠ value-target (poster). Same primitive as Timeout:
   * `msg::send_bytes` to poster + `with_value(value)` reply refund.
  */
  public revoke(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Revoke',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
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
  public submit(id: number | string | bigint, result_payload: string, result_hash: H256): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Submit',
      [id, result_payload, result_hash],
      '(u64, String, H256)',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  /**
   * Permissionless watchdog: force a stuck bounty into TimedOut after deadline.
   * 
   * Status: Open | Claimed | Submitted → TimedOut (terminal).
   * Caller is anyone — this is the canonical permissionless watchdog pattern.
   * Deadline MUST be set AND `exec::block_height() > deadline`.
   * Refund: caller ≠ value-target (poster). Per the primitive rule, escrow is
   * pushed to poster's mailbox via `msg::send_bytes(poster, [], reward)`;
   * caller's attached value rides back on the reply via `with_value(value)`.
   * This is the FIRST `msg::send_bytes` invocation in the contract surface.
  */
  public timeout(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Timeout',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
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
  public withdraw(id: number | string | bigint): TransactionBuilder<{ ok: null } | { err: SailsError }> {
    if (!this._program.programId) throw new Error('Program ID is not set');
    return new TransactionBuilder<{ ok: null } | { err: SailsError }>(
      this._program.api,
      this._program.registry,
      'send_message',
      'BountyService',
      'Withdraw',
      id,
      'u64',
      'Result<Null, Error>',
      this._program.programId,
    );
  }

  public subscribeToBountyPostedEvent(callback: (data: { id: number | string | bigint; poster: ActorId; reward: number | string | bigint; track: TrackEnum; posted_at: number; title: string; description: string; acceptance: string; deadline: number | null }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyPosted') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32","title":"String","description":"String","acceptance":"String","deadline":"Option<u32>"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; poster: ActorId; reward: number | string | bigint; track: TrackEnum; posted_at: number; title: string; description: string; acceptance: string; deadline: number | null });
      }
    });
  }

  public subscribeToBountyClaimedEvent(callback: (data: { id: number | string | bigint; worker: ActorId; claimed_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyClaimed') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; worker: ActorId; claimed_at: number });
      }
    });
  }

  public subscribeToBountySubmittedEvent(callback: (data: { id: number | string | bigint; worker: ActorId; result_hash: H256; submitted_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountySubmitted') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; worker: ActorId; result_hash: H256; submitted_at: number });
      }
    });
  }

  public subscribeToBountyAcceptedEvent(callback: (data: { id: number | string | bigint; poster: ActorId; worker: ActorId; reward: number | string | bigint; settled_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyAccepted') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; poster: ActorId; worker: ActorId; reward: number | string | bigint; settled_at: number });
      }
    });
  }

  public subscribeToBountyWithdrawnEvent(callback: (data: { id: number | string | bigint; worker: ActorId; amount: number | string | bigint; withdrawn_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyWithdrawn') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","worker":"[u8;32]","amount":"u128","withdrawn_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; worker: ActorId; amount: number | string | bigint; withdrawn_at: number });
      }
    });
  }

  public subscribeToBountyCancelledEvent(callback: (data: { id: number | string | bigint; by: ActorId; refunded: number | string | bigint; cancelled_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyCancelled') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","by":"[u8;32]","refunded":"u128","cancelled_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; by: ActorId; refunded: number | string | bigint; cancelled_at: number });
      }
    });
  }

  public subscribeToBountyRejectedEvent(callback: (data: { id: number | string | bigint; by: ActorId; worker: ActorId; reason: string | null; rejected_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyRejected') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","by":"[u8;32]","worker":"[u8;32]","reason":"Option<String>","rejected_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; by: ActorId; worker: ActorId; reason: string | null; rejected_at: number });
      }
    });
  }

  public subscribeToBountyTimedOutEvent(callback: (data: { id: number | string | bigint; last_state: BountyStatus; called_by: ActorId; refunded_to: ActorId; timed_out_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyTimedOut') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","last_state":"BountyStatus","called_by":"[u8;32]","refunded_to":"[u8;32]","timed_out_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; last_state: BountyStatus; called_by: ActorId; refunded_to: ActorId; timed_out_at: number });
      }
    });
  }

  public subscribeToBountyRevokedEvent(callback: (data: { id: number | string | bigint; by: ActorId; refunded_to: ActorId; revoked_at: number }) => void | Promise<void>): Promise<() => void> {
    return this._program.api.gearEvents.subscribeToGearEvent('UserMessageSent', ({ data: { message } }: any) => {;
      if (!message.source.eq(this._program.programId) || !message.destination.eq(ZERO_ADDRESS)) {
        return;
      }

      const payload = message.payload.toHex();
      if (getServiceNamePrefix(payload) === 'BountyService' && getFnNamePrefix(payload) === 'BountyRevoked') {
        callback(this._program.registry.createType('(String, String, {"id":"u64","by":"[u8;32]","refunded_to":"[u8;32]","revoked_at":"u32"})', message.payload)[2].toJSON() as unknown as { id: number | string | bigint; by: ActorId; refunded_to: ActorId; revoked_at: number });
      }
    });
  }
}
