/**
 * RPC retry-with-backoff helper.
 *
 * Vara mainnet WS RPC drops + transient archive-RPC stalls are real — a
 * single failed `api.rpc.chain.*` call on a 50-block batch rolls back the
 * entire transaction and stalls backfill. Wrap each RPC in three attempts
 * (100ms / 500ms / 2000ms exponential backoff) before propagating.
 *
 * Per the post-recovery audit (2026-05-30 incident): backfill.ts holds one
 * Postgres tx open across ~150 sequential RPC calls per batch, so any RPC
 * blip mid-batch costs the entire batch even though the per-call failure
 * was likely transient. This helper isolates that risk to the RPC layer.
 */

import type { Logger } from 'pino';

const RPC_RETRY_DELAYS_MS = [100, 500, 2000] as const;

export async function rpcWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
  logger?: Logger,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RPC_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === RPC_RETRY_DELAYS_MS.length) break;
      const delayMs = RPC_RETRY_DELAYS_MS[attempt];
      logger?.warn(
        { op: 'rpc_retry', label, attempt: attempt + 1, delayMs, err: String(err) },
        'rpc transient failure; backing off',
      );
      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}
