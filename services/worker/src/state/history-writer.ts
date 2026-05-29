/**
 * Full-record writer for worker.history.jsonl.
 *
 * Extends WorkHistoryDedup (read+minimal-append) with the production write
 * path. Semantics:
 *   - status='abandoned' written by the Main FSM on abandonment paths
 *     (partial tx_hashes populated, envelope_sha256 may be null)
 *   - status='done' written by the Pending-Accept Monitor on Withdraw-confirmed
 *     (full tx_hashes populated, envelope_sha256 always set)
 *
 * Atomic-append discipline: line MUST be ≤ MAX_LINE_BYTES (4000) so POSIX
 * O_APPEND remains atomic. The locked field shape produces ~400-500B lines;
 * the guard fires only if a future field bloats past safe.
 */

import { appendFileSync } from 'node:fs';
import {
  WorkHistoryDedup,
  WorkHistoryLineTooLargeError,
  WorkHistoryNotLoadedError,
} from '../filter/dedup.js';

// Mirrors the constant in src/filter/dedup.ts. Kept here so a future
// raise of one MUST be intentionally mirrored in the other (lockstep).
const MAX_LINE_BYTES = 4000;

export interface FullHistoryRecord {
  id: bigint;
  status: 'done' | 'abandoned';
  completed_at: string;
  tx_hashes: {
    /** BountyPosted txHash from the Candidate (catchup-sourced may be absent). */
    post?: `0x${string}`;
    claim?: `0x${string}`;
    submit?: `0x${string}`;
    accept?: `0x${string}`;
    withdraw?: `0x${string}`;
  };
  envelope_sha256: `0x${string}` | null;
  reward?: string;
}

/**
 * Append a full-record line to worker.history.jsonl and mark the bountyId
 * in the dedup's in-memory seen-set so subsequent has() reflects it.
 *
 * dedup MUST have been load()'d before this is called — otherwise markSeen
 * throws WorkHistoryNotLoadedError.
 */
export function appendHistoryRecord(
  historyPath: string,
  dedup: WorkHistoryDedup,
  record: FullHistoryRecord,
): void {
  const serialized = {
    id: record.id.toString(),
    status: record.status,
    completed_at: record.completed_at,
    tx_hashes: record.tx_hashes,
    envelope_sha256: record.envelope_sha256,
    reward: record.reward ?? null,
  };
  const line = `${JSON.stringify(serialized)}\n`;
  const bytes = Buffer.byteLength(line, 'utf-8');
  if (bytes > MAX_LINE_BYTES) {
    throw new WorkHistoryLineTooLargeError(bytes);
  }
  // markSeen throws WorkHistoryNotLoadedError if dedup wasn't load()'d.
  // Call it FIRST so we don't append to file when the dedup isn't usable.
  dedup.markSeen(record.id);
  try {
    appendFileSync(historyPath, line, 'utf-8');
  } catch (err) {
    // If the append fails after we've marked seen, the in-memory state
    // diverges from disk (we think id is in history but it's not on disk).
    // On next boot, load() re-reads disk → divergence resolved.
    // Re-throw so the caller (P3.7b FSM) can react.
    throw err;
  }
}

export { WorkHistoryLineTooLargeError, WorkHistoryNotLoadedError };
