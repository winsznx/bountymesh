/**
 * WorkerState V1 — locked shape per discipline note E.
 *
 * Lives at worker.state.json (path from WorkerConfig.workerStatePath).
 * Atomically written via tmp + fsync + rename (atomic-write.ts).
 *
 * Concurrency: a single WorkerStateFile instance per process serializes
 * writes via an internal chained-promise lock. No two writes interleave;
 * each disk write reflects a consistent post-mutation state.
 */

export const WORKER_STATE_VERSION = 1;

/**
 * Pending-Accept Monitor entry.
 *
 * The Main FSM writes one of these on Submit-confirmed; the Pending-Accept
 * Monitor iterates the array, watches for BountyAccepted events matching each
 * `id`, and triggers Withdraw when observed. On Withdraw-confirmed the Monitor
 * writes status='done' to worker.history.jsonl and clears the entry from here.
 */
export interface PendingAcceptEntry {
  /** bountyId as decimal string (BigInt-boundary discipline). */
  id: string;
  submit_tx_hash: `0x${string}`;
  submit_block_number: number;
  envelope_sha256: `0x${string}`;
  added_at: string;
}

export interface WorkerState {
  version: number;
  /** bountyId as decimal string; null when no Main-FSM cycle is in flight. */
  inflight: string | null;
  last_processed_block: number;
  pending_accept: PendingAcceptEntry[];
}

export const DEFAULT_WORKER_STATE: WorkerState = {
  version: WORKER_STATE_VERSION,
  inflight: null,
  last_processed_block: 0,
  pending_accept: [],
};
