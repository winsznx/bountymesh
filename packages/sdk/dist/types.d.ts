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
//# sourceMappingURL=types.d.ts.map