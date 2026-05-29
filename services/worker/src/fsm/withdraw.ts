/**
 * processWithdraw — Pending-Accept Monitor's per-entry consumer (P3.8b).
 *
 * Critical section ordering inside signerMutex.runExclusive (discipline A):
 *   1. Re-read pending entries; if entry no longer present → return 'Done' (no-op).
 *   2. await client.withdraw(id) (the only chain call).
 *   3a. On Ok or AlreadyWithdrawn → appendHistoryRecord(status='done') FIRST,
 *       then workerState.clearPendingAccept(id) SECOND.
 *   3b. On Err (other) → appendHistoryRecord(status='abandoned') FIRST,
 *       then clearPendingAccept SECOND.
 *   4. On throw before chain call (or any throw before history write) →
 *      re-throw without state mutations; entry remains pending for retry.
 *
 * Race protection: option-b re-read inside the mutex collapses the
 * Monitor-fires-twice race window to zero. Concurrent processWithdraw
 * calls for the same entry: first one wins (writes history + clears);
 * second one re-reads, sees no entry, returns 'Done' immediately.
 */

import type { Logger } from 'pino';
import type { BountyMeshClient } from '@bountymesh/sdk';
import type { WorkHistoryDedup } from '../filter/dedup.js';
import { appendHistoryRecord } from '../state/history-writer.js';
import type { PendingAcceptEntry } from '../state/types.js';
import type { WorkerStateFile } from '../state/worker-state.js';
import type { SignerMutex } from './signer-mutex.js';

export interface ProcessWithdrawDeps {
  client: BountyMeshClient;
  workerState: WorkerStateFile;
  dedup: WorkHistoryDedup;
  historyPath: string;
  signerMutex: SignerMutex;
  logger: Logger;
}

export async function processWithdraw(
  entry: PendingAcceptEntry,
  deps: ProcessWithdrawDeps,
): Promise<'Done' | 'Abandoned'> {
  const log = deps.logger;
  const id = BigInt(entry.id);
  const baseFields = { op: 'withdraw', candidateId: entry.id };

  return deps.signerMutex.runExclusive(async () => {
    // (1) Race protection: re-read pending entries.
    const stillPending = deps.workerState
      .getPendingAccepts()
      .some((e) => e.id === entry.id);
    if (!stillPending) {
      log.info({ ...baseFields, decision: 'noop-already-cleared' });
      return 'Done';
    }

    // (2) Chain call. If this throws, we exit the critical section via the
    // mutex's try/finally — no state mutations occurred.
    const result = await deps.client.withdraw(id);

    if (result.ok || result.error === 'AlreadyWithdrawn') {
      // (3a) Success path (or idempotent recovery from a prior crashed-mid-Withdraw).
      // AlreadyWithdrawn means the chain says we already settled — treat as Done
      // because our prior Withdraw must have included our envelope (no other actor
      // could have legitimately withdrawn for us).
      appendHistoryRecord(deps.historyPath, deps.dedup, {
        id,
        status: 'done',
        completed_at: new Date().toISOString(),
        tx_hashes: {
          submit: entry.submit_tx_hash,
          // claim/post/accept hashes aren't carried on the pending entry
          // (P3.7b's Main FSM doesn't persist them). Post-MVP enrichment
          // can add them to PendingAcceptEntry if richer history matters.
          withdraw: result.txHash,
        },
        envelope_sha256: entry.envelope_sha256,
      });
      await deps.workerState.clearPendingAccept(id);
      log.info({
        ...baseFields,
        decision: result.ok ? 'done' : 'done-idempotent',
        withdrawTxHash: result.txHash,
      });
      return 'Done';
    }

    // (3b) Chain error other than AlreadyWithdrawn → Abandoned.
    const errorReason = result.error;
    log.warn({
      ...baseFields,
      decision: 'abandoned',
      reason: `withdraw-err:${errorReason}`,
    });
    appendHistoryRecord(deps.historyPath, deps.dedup, {
      id,
      status: 'abandoned',
      completed_at: new Date().toISOString(),
      tx_hashes: {
        submit: entry.submit_tx_hash,
      },
      envelope_sha256: entry.envelope_sha256,
    });
    await deps.workerState.clearPendingAccept(id);
    return 'Abandoned';
  });
}
