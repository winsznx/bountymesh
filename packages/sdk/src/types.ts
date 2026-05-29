import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { IKeyringPair } from '@polkadot/types/types';
import type { BountyMeshError, Track } from './errors.generated.js';

/**
 * Browser-injection signer shape. Compatible with @polkadot/extension-dapp's
 * `InjectedAccountWithMeta` plus the matching `Signer` from `web3FromAddress`.
 * Inlined rather than imported from @polkadot/extension-dapp because that
 * package is browser-only — forcing it as a peer dep would block Node consumers.
 */
export interface InjectedSignerWithAddress {
  address: string;
  signer: unknown;
}

export interface BountyMeshClientOptions {
  api: GearApi;
  programId: HexString;
  signer: IKeyringPair | InjectedSignerWithAddress;
}

export interface PostArgs {
  title: string;
  description: string;
  acceptance: string;
  reward: bigint;
  deadline?: number;
  track: Track;
}

/**
 * Discriminant order of the on-chain `BountyStatus` enum. Used by
 * `BountyTimedOutEvent.lastState` (decoded as u8 to avoid registry metadata).
 */
export const BOUNTY_STATUS_BY_DISCRIMINANT = [
  'Open',
  'Claimed',
  'Submitted',
  'Accepted',
  'Rejected',
  'Cancelled',
  'TimedOut',
  'Revoked',
] as const;
export type BountyStatusName = (typeof BOUNTY_STATUS_BY_DISCRIMINANT)[number];

export interface TxOk<T> {
  ok: true;
  value: T;
  txHash: HexString;
  blockHash: HexString;
}

export interface TxErr {
  ok: false;
  error: BountyMeshError;
  txHash: HexString;
  blockHash: HexString;
}

export type TxResult<T> = TxOk<T> | TxErr;

export type Unsubscribe = () => void;

export interface BountyPostedEvent {
  id: bigint;
  poster: HexString;
  reward: bigint;
  track: Track;
  postedAt: number;
  title: string;
  description: string;
  acceptance: string;
  deadline: number | null;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyClaimedEvent {
  id: bigint;
  worker: HexString;
  claimedAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountySubmittedEvent {
  id: bigint;
  worker: HexString;
  resultHash: HexString;
  submittedAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyAcceptedEvent {
  id: bigint;
  poster: HexString;
  worker: HexString;
  reward: bigint;
  settledAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyWithdrawnEvent {
  id: bigint;
  worker: HexString;
  amount: bigint;
  withdrawnAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyPostedFilter {
  track?: Track;
  minReward?: bigint;
  poster?: HexString;
}

export interface BountyClaimedFilter {
  worker?: HexString;
}

export interface BountySubmittedFilter {
  worker?: HexString;
}

export interface BountyAcceptedFilter {
  poster?: HexString;
  worker?: HexString;
}

export interface BountyWithdrawnFilter {
  worker?: HexString;
}

// === v1.1 — v2 transition event types ===

export interface BountyCancelledEvent {
  id: bigint;
  by: HexString;
  refunded: bigint;
  cancelledAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyRejectedEvent {
  id: bigint;
  by: HexString;
  worker: HexString;
  reason: string | null;
  rejectedAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyTimedOutEvent {
  id: bigint;
  /** Decoded BountyStatus name at the time of timeout — see BOUNTY_STATUS_BY_DISCRIMINANT. */
  lastState: BountyStatusName;
  calledBy: HexString;
  refundedTo: HexString;
  timedOutAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyRevokedEvent {
  id: bigint;
  by: HexString;
  refundedTo: HexString;
  revokedAt: number;
  blockHash: HexString;
  txHash: HexString;
}

export interface BountyCancelledFilter {
  by?: HexString;
}

export interface BountyRejectedFilter {
  by?: HexString;
  worker?: HexString;
}

export interface BountyTimedOutFilter {
  refundedTo?: HexString;
}

export interface BountyRevokedFilter {
  by?: HexString;
  refundedTo?: HexString;
}
