/**
 * Main FSM types.
 *
 * State union: Idle / Claiming / Working / Submitting / Submitted / Abandoned.
 *
 * 'Submitted' is the terminal-cycle state for the Main FSM closure — held
 * for ~0ms in normal flow but exists for type-system clarity + observability
 * if anyone instruments transitions. The Pending-Accept Monitor picks up from
 * here, driven by the pending_accept[] entry the FSM persisted. 'Done'
 * (Withdraw-confirmed) belongs to the Pending-Accept Monitor and does NOT
 * collide.
 */

import type { Logger } from 'pino';
import type { GearApi } from '@gear-js/api';
import type { BountyMeshClient, BountyMeshError } from '@bountymesh/sdk';
import type { WorkAdapter } from '../adapter/index.js';
import type { WorkHistoryDedup } from '../filter/dedup.js';
import type { InflightSerializer } from '../filter/serializer.js';
import type { WorkerStateFile } from '../state/worker-state.js';
import type { SignerMutex } from './signer-mutex.js';

export type MainFsmState =
  | 'Idle'
  | 'Claiming'
  | 'Working'
  | 'Submitting'
  | 'Submitted'
  | 'Abandoned';

export type ClaimErrorReason = BountyMeshError | 'TransportError';
export type SubmitErrorReason = BountyMeshError | 'TransportError';

export type ClaimResult =
  | { ok: true; txHash: `0x${string}`; blockHash: `0x${string}` }
  | { ok: false; error: ClaimErrorReason; txHash: `0x${string}` | null };

export type SubmitResult =
  | { ok: true; txHash: `0x${string}`; blockHash: `0x${string}` }
  | { ok: false; error: SubmitErrorReason; txHash: `0x${string}` | null };

export interface MainFsmDeps {
  client: BountyMeshClient;
  /**
   * Raw GearApi handle. Threaded through because the P13.2 orchestrator
   * route executor needs to mount its own Sails clients against the same
   * provider connection (one per discovered external program) for read-only
   * query calls before the worker submits.
   */
  api: GearApi;
  adapter: WorkAdapter;
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  historyPath: string;
  serializer: InflightSerializer;
  /**
   * Per-signer nonce mutex (P2 §A). Serializes sign-and-send across Main
   * FSM + Pending-Accept Monitor; symmetric retrofit applied at P3.8a.
   */
  signerMutex: SignerMutex;
  workerAddress: `0x${string}`;
  /** Used both for envelope.produced_at and for submit_block_number approximation. */
  getCurrentBlock: () => Promise<number>;
  logger: Logger;
}
