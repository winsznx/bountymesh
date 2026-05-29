/**
 * Pure transition helpers for the Main FSM.
 *
 * Each function wraps one SDK call (or adapter call) and normalizes the
 * Ok/Err discrimination + transport-throw handling into a uniform shape.
 *
 * doClaim / doSubmit serialize the actual sign-and-send via SignerMutex
 * (P2 §A / P3.8a). Without this, @polkadot/api can race nonce lookups
 * across the Main FSM + Pending-Accept Monitor and the second tx fails
 * with `1014: priority too low`.
 *
 * Failure modes normalized into ClaimResult / SubmitResult:
 *   - chain returned typed Err (TxErr): preserves error code + txHash
 *     (the tx LANDED, defensively refunded).
 *   - SDK threw (network failure, sign failure): error='TransportError',
 *     no txHash available.
 */

import type { BountyMeshClient } from '@bountymesh/sdk';
import type { WorkAdapter, AdapterOutput } from '../adapter/index.js';
import type { Candidate } from '../discovery/types.js';
import type { SignerMutex } from './signer-mutex.js';
import type { ClaimResult, SubmitResult } from './types.js';

export async function doClaim(
  client: BountyMeshClient,
  id: bigint,
  mutex: SignerMutex,
): Promise<ClaimResult> {
  try {
    const r = await mutex.runExclusive(() => client.claim(id));
    if (r.ok) {
      return { ok: true, txHash: r.txHash, blockHash: r.blockHash };
    }
    return { ok: false, error: r.error, txHash: r.txHash };
  } catch {
    return { ok: false, error: 'TransportError', txHash: null };
  }
}

export async function doSubmit(
  client: BountyMeshClient,
  id: bigint,
  resultPayload: string,
  resultHash: `0x${string}`,
  mutex: SignerMutex,
): Promise<SubmitResult> {
  try {
    const r = await mutex.runExclusive(() =>
      client.submit(id, resultPayload, resultHash),
    );
    if (r.ok) {
      return { ok: true, txHash: r.txHash, blockHash: r.blockHash };
    }
    return { ok: false, error: r.error, txHash: r.txHash };
  } catch {
    return { ok: false, error: 'TransportError', txHash: null };
  }
}

/**
 * Thin wrapper over adapter.execute that keeps the FSM's transition shape
 * symmetric (doClaim / doSubmit / doWork). Adapter failures DO NOT throw —
 * they're modeled inside AdapterOutput.upstream.error per P0 §A1 / P3.6.
 *
 * No mutex: the adapter doesn't sign any chain tx; it calls an external API.
 */
export async function doWork(
  adapter: WorkAdapter,
  candidate: Candidate,
  crashResumed: boolean,
): Promise<AdapterOutput> {
  return adapter.execute(candidate, { crashResumed });
}
