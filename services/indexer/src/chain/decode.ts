/**
 * Local block-events decoder for backfill (Step 5d).
 *
 * Backfill walks historical blocks via `api.at(blockHash).query.system.events()`
 * and decodes each BountyService UserMessageSent into a typed BufferedEvent —
 * the same shape the SDK's onBountyX callbacks produce.
 *
 * Why duplicate vs reuse SDK's SubscriptionManager decoder:
 *   The SDK's decoder is private to SubscriptionManager (events.ts) and not
 *   exported. The local duplication is isolated to one file, ~100 LoC, with no
 *   public API contract concerns. Eventual unification: extract
 *   decodeBlockEvents() to SDK public surface; consume from both
 *   subscriptions.ts and decode.ts; delete the indexer's local duplicate.
 *
 * Wire-shape source of truth:
 *   PAYLOAD_TYPE entries below are byte-equal to the SDK's events.ts map.
 *   If the SDK changes (e.g., new event type lands), this file's PAYLOAD_TYPE
 *   diverges and decoded events drift silently. Mitigation: 5d.2 integration
 *   test exercises ALL 5 event types end-to-end through this decoder against
 *   live-chain encoding. CI failure surfaces the drift loudly.
 *
 * Cross-tree note (the @polkadot/util-multiple-versions warning):
 *   SailsProgram is imported from the SDK's compiled output (via node_modules
 *   deep path). It instantiates @polkadot/types from the SDK's tree. The
 *   registry's createType() returns objects whose .toJSON() is a plain JS
 *   value — tree-safe. The decoder is tree-safe by design.
 */

import { getFnNamePrefix, getServiceNamePrefix, ZERO_ADDRESS } from 'sails-js';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { TypeRegistry } from '@polkadot/types';
import { rpcWithRetry } from './retry.js';
// Deep import of the SDK's compiled SailsProgram (same pattern as
// tests/harness/deployProgram.ts).
import { SailsProgram } from '../../node_modules/@bountymesh/sdk/dist/generated/lib.js';
import type { BufferedEvent, EventName } from './buffer.js';

const PAYLOAD_TYPE: Record<EventName, string> = {
  BountyPosted:
    '(String, String, {"id":"u64","poster":"[u8;32]","reward":"u128","track":"TrackEnum","posted_at":"u32","title":"String","description":"String","acceptance":"String","deadline":"Option<u32>"})',
  BountyClaimed: '(String, String, {"id":"u64","worker":"[u8;32]","claimed_at":"u32"})',
  BountySubmitted:
    '(String, String, {"id":"u64","worker":"[u8;32]","result_hash":"H256","submitted_at":"u32"})',
  BountyAccepted:
    '(String, String, {"id":"u64","poster":"[u8;32]","worker":"[u8;32]","reward":"u128","settled_at":"u32"})',
  BountyWithdrawn:
    '(String, String, {"id":"u64","worker":"[u8;32]","amount":"u128","withdrawn_at":"u32"})',
  // v2 events — last_state is the SCALE u8 discriminant of BountyStatus
  // (0=Open, 1=Claimed, 2=Submitted, 3=Accepted, 4=Rejected, 5=Cancelled,
  // 6=TimedOut, 7=Revoked). Decoded as u8 to avoid needing the BountyStatus
  // typeinfo metadata in the registry.
  BountyCancelled:
    '(String, String, {"id":"u64","by":"[u8;32]","refunded":"u128","cancelled_at":"u32"})',
  BountyRejected:
    '(String, String, {"id":"u64","by":"[u8;32]","worker":"[u8;32]","reason":"Option<String>","rejected_at":"u32"})',
  BountyTimedOut:
    '(String, String, {"id":"u64","last_state":"u8","called_by":"[u8;32]","refunded_to":"[u8;32]","timed_out_at":"u32"})',
  BountyRevoked:
    '(String, String, {"id":"u64","by":"[u8;32]","refunded_to":"[u8;32]","revoked_at":"u32"})',
};

/**
 * Construct a typed registry by instantiating the SDK's SailsProgram. The
 * registry is the load-bearing piece for decode — it carries the SCALE type
 * definitions from the bountymesh IDL. One registry per (api, programId) pair;
 * boot.ts creates it once at Stage 3 and passes via deps.
 */
export function createProgramRegistry(api: GearApi, programId: HexString): TypeRegistry {
  const program = new SailsProgram(api, programId);
  return program.registry;
}

interface SubstrateEventRecord {
  event: {
    section: string;
    method: string;
    data: {
      message: {
        source: { eq: (x: HexString) => boolean };
        destination: { eq: (x: HexString) => boolean };
        payload: { toHex: () => HexString };
        details?: { toMessageId?: { toHex: () => HexString } } | { toJSON?: () => unknown };
        id?: { toHex: () => HexString };
      };
      id?: { toHex: () => HexString };
    };
  };
  phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber: () => number } };
}

interface ExtrinsicShape {
  isSigned: boolean;
  hash: { toHex: () => HexString };
  method: {
    section: string;
    method: string;
    args: Array<{ toHex: () => HexString }>;
  };
}

interface SignedBlockShape {
  block: { extrinsics: ExtrinsicShape[] };
}

/**
 * Collect tx hashes of signed `gear.sendMessage` extrinsics targeting our
 * program in this block, preserving block order.
 *
 * Why this exists (Bug #12 fix): UserMessageSent events on gear are emitted
 * by the `gear::run` unsigned system extrinsic that drains the message queue
 * — NOT by the user's signed gear.sendMessage. `phase.asApplyExtrinsic` for
 * a UserMessageSent therefore always points to `gear::run`, whose extrinsic
 * hash is a deterministic constant per chain spec.
 *
 * The user's actual extrinsic is the signed `gear.sendMessage(programId, …)`
 * earlier in the same block. We pair the i-th such extrinsic with the i-th
 * broadcast UserMessageSent in the same block — gear processes the queue in
 * FIFO order, so this 1:1 ordering holds for direct sends.
 *
 * High-load note: under heavy mainnet load gear may defer queue draining to
 * the next block, which would break this same-block pairing. Mitigation
 * paths when that happens: (a) walk back to the previous block's
 * gear.sendMessage if same-block has fewer signed extrinsics than events;
 * (b) correlate via details.to on the reply (non-broadcast) UserMessageSent.
 * The walk-back was prototyped via MessageQueued.id lookup but rejected as
 * over-engineering for hackathon-grade volume.
 */
interface UserSend {
  txHash: HexString;
  /** SCALE-encoded sails call payload: [String service][String fn][args]. */
  callPayloadHex: HexString;
}

function collectUserSends(
  signedBlock: SignedBlockShape,
  programId: HexString,
): UserSend[] {
  const out: UserSend[] = [];
  for (const ext of signedBlock.block.extrinsics) {
    if (!ext.isSigned) continue;
    if (ext.method.section !== 'gear' || ext.method.method !== 'sendMessage') continue;
    const destProgramId = ext.method.args[0]?.toHex?.();
    if (destProgramId !== programId) continue;
    // gear.sendMessage(destination, payload, gas_limit, value, keep_alive):
    // args[1] is the SCALE-encoded sails call payload.
    const callPayloadHex = ext.method.args[1]?.toHex?.() ?? ('0x' as HexString);
    out.push({ txHash: ext.hash.toHex(), callPayloadHex });
  }
  return out;
}

/**
 * Decode the result_payload arg out of a Submit call payload.
 *
 * Symmetric with the SDK's encode side (generated lib.ts: submit() builds the
 * call from type string '(u64, String, H256)' through the same registry). The
 * sails call envelope is [String service][String fn][args-tuple]; we decode the
 * full envelope as '(String, String, (u64, String, H256))' and take args[1].
 *
 * Defensive: any decode failure returns null. The bounty row still updates with
 * result_hash + status from the event; result_payload is backfillable later.
 */
function decodeSubmitResultPayload(
  registry: TypeRegistry,
  callPayloadHex: HexString,
): string | null {
  try {
    const decoded = registry.createType(
      '(String, String, (u64, String, H256))',
      callPayloadHex,
    ) as unknown as { toJSON: () => unknown[] };
    const tuple = decoded.toJSON();
    const args = tuple[2] as [unknown, string, unknown];
    return typeof args[1] === 'string' ? args[1] : null;
  } catch {
    return null;
  }
}

/**
 * Decode all BountyService events from a single historical block.
 * Returns BufferedEvent[] (same discriminated union the SDK's onBountyX
 * subscribers produce), ordered as they appear in the block's events.
 *
 * Reads: 1× api.at(blockHash) + 1× api.at(blockHash).query.system.events()
 *      + 1× api.rpc.chain.getBlock(blockHash) iff any event was found.
 * 2 RPCs per empty block, 3 RPCs per block with at least one event.
 */
export async function decodeBlockEvents(
  api: GearApi,
  programId: HexString,
  blockHash: HexString,
  registry: TypeRegistry,
): Promise<BufferedEvent[]> {
  const apiAt = await api.at(blockHash);
  const records = (await apiAt.query.system.events()) as unknown as SubstrateEventRecord[];

  const out: BufferedEvent[] = [];
  let userSends: UserSend[] | null = null;
  let bountyEventIdx = 0;

  for (const { event } of records) {
    if (event.section !== 'gear' || event.method !== 'UserMessageSent') continue;
    const message = event.data.message;
    if (!message.source.eq(programId) || !message.destination.eq(ZERO_ADDRESS)) continue;

    const payloadHex = message.payload.toHex();
    if (getServiceNamePrefix(payloadHex) !== 'BountyService') continue;
    const fnName = getFnNamePrefix(payloadHex);
    if (!(fnName in PAYLOAD_TYPE)) continue;
    const evName = fnName as EventName;

    // Bug #12 fix: pair this broadcast event with the corresponding signed
    // user extrinsic in the same block (FIFO order). Lazy-fetch the
    // signedBlock only when we actually have an event to attribute.
    let txHash: HexString = '0x' as HexString;
    let callPayloadHex: HexString | null = null;
    if (userSends === null) {
      const signedBlock = (await rpcWithRetry(
        () => api.rpc.chain.getBlock(blockHash),
        `getBlock(${blockHash})`,
      )) as unknown as SignedBlockShape;
      userSends = collectUserSends(signedBlock, programId);
    }
    if (bountyEventIdx < userSends.length) {
      txHash = userSends[bountyEventIdx]!.txHash;
      callPayloadHex = userSends[bountyEventIdx]!.callPayloadHex;
    }
    bountyEventIdx++;

    const decoded = registry.createType(PAYLOAD_TYPE[evName], payloadHex);
    const raw = (decoded as unknown as { toJSON: () => unknown[] }).toJSON()[2] as Record<
      string,
      unknown
    >;

    // P6 envelope fix: the BountySubmitted EVENT carries only result_hash, not
    // the payload. The payload lives in the originating Submit CALL — decode it
    // from the paired sendMessage extrinsic. Conditional on event type because
    // other calls (Post/Claim/Accept/…) have different arg tuples that would
    // mis-decode against the Submit type string.
    const resultPayload =
      evName === 'BountySubmitted' && callPayloadHex !== null
        ? decodeSubmitResultPayload(registry, callPayloadHex)
        : null;

    out.push(normalizeDecodedEvent(evName, raw, blockHash, txHash, resultPayload));
  }

  return out;
}

function normalizeDecodedEvent(
  eventName: EventName,
  raw: Record<string, unknown>,
  blockHash: HexString,
  txHash: HexString,
  resultPayload: string | null = null,
): BufferedEvent {
  switch (eventName) {
    case 'BountyPosted':
      return {
        eventName: 'BountyPosted',
        id: BigInt(raw.id as string | number),
        poster: raw.poster as HexString,
        reward: BigInt(raw.reward as string | number),
        track: raw.track as 'Services' | 'Social' | 'Economy' | 'Open',
        postedAt: raw.posted_at as number,
        title: raw.title as string,
        description: raw.description as string,
        acceptance: raw.acceptance as string,
        deadline: raw.deadline as number | null,
        blockHash,
        txHash,
      };
    case 'BountyClaimed':
      return {
        eventName: 'BountyClaimed',
        id: BigInt(raw.id as string | number),
        worker: raw.worker as HexString,
        claimedAt: raw.claimed_at as number,
        blockHash,
        txHash,
      };
    case 'BountySubmitted':
      return {
        eventName: 'BountySubmitted',
        id: BigInt(raw.id as string | number),
        worker: raw.worker as HexString,
        resultHash: raw.result_hash as HexString,
        submittedAt: raw.submitted_at as number,
        resultPayload,
        blockHash,
        txHash,
      };
    case 'BountyAccepted':
      return {
        eventName: 'BountyAccepted',
        id: BigInt(raw.id as string | number),
        poster: raw.poster as HexString,
        worker: raw.worker as HexString,
        reward: BigInt(raw.reward as string | number),
        settledAt: raw.settled_at as number,
        blockHash,
        txHash,
      };
    case 'BountyWithdrawn':
      return {
        eventName: 'BountyWithdrawn',
        id: BigInt(raw.id as string | number),
        worker: raw.worker as HexString,
        amount: BigInt(raw.amount as string | number),
        withdrawnAt: raw.withdrawn_at as number,
        blockHash,
        txHash,
      };
    case 'BountyCancelled':
      return {
        eventName: 'BountyCancelled',
        id: BigInt(raw.id as string | number),
        by: raw.by as HexString,
        refunded: BigInt(raw.refunded as string | number),
        cancelledAt: raw.cancelled_at as number,
        blockHash,
        txHash,
      };
    case 'BountyRejected':
      return {
        eventName: 'BountyRejected',
        id: BigInt(raw.id as string | number),
        by: raw.by as HexString,
        worker: raw.worker as HexString,
        reason: (raw.reason as string | null) ?? null,
        rejectedAt: raw.rejected_at as number,
        blockHash,
        txHash,
      };
    case 'BountyTimedOut':
      return {
        eventName: 'BountyTimedOut',
        id: BigInt(raw.id as string | number),
        lastState: raw.last_state as number,
        calledBy: raw.called_by as HexString,
        refundedTo: raw.refunded_to as HexString,
        timedOutAt: raw.timed_out_at as number,
        blockHash,
        txHash,
      };
    case 'BountyRevoked':
      return {
        eventName: 'BountyRevoked',
        id: BigInt(raw.id as string | number),
        by: raw.by as HexString,
        refundedTo: raw.refunded_to as HexString,
        revokedAt: raw.revoked_at as number,
        blockHash,
        txHash,
      };
  }
}
