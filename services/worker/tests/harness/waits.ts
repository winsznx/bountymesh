/**
 * Polling helpers for integration tests.
 *
 * Each helper has an explicit, generous timeout. Throws a descriptive error
 * containing the last observation when timeout hits — speeds debugging if
 * any layer (chain, indexer, worker, file system) is slower than expected.
 */

import { existsSync, readFileSync } from 'node:fs';

async function poll<T>(
  predicate: () => Promise<T | null>,
  timeoutMs: number,
  pollMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result !== null) return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${
      lastError ? `; last error: ${lastError}` : ''
    }`,
  );
}

export async function waitForBountyProjected(
  bountyId: bigint,
  indexerBaseUrl: string,
  timeoutMs = 15_000,
): Promise<void> {
  await poll(
    async () => {
      const res = await fetch(`${indexerBaseUrl.replace(/\/$/, '')}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `query Q($id: BigInt!) { bountyById(id: $id) { id } }`,
          variables: { id: bountyId.toString() },
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { bountyById?: { id: string } | null };
      };
      return body.data?.bountyById ? body.data.bountyById : null;
    },
    timeoutMs,
    250,
    `bounty id=${bountyId} not projected by indexer`,
  );
}

export async function waitForChainStatus(
  bountyId: bigint,
  expectedStatus: string,
  indexerBaseUrl: string,
  timeoutMs = 15_000,
): Promise<void> {
  await poll(
    async () => {
      const res = await fetch(`${indexerBaseUrl.replace(/\/$/, '')}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: `query Q($id: BigInt!) { bountyById(id: $id) { status } }`,
          variables: { id: bountyId.toString() },
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as {
        data?: { bountyById?: { status: string } | null };
      };
      const s = body.data?.bountyById?.status;
      return s === expectedStatus ? s : null;
    },
    timeoutMs,
    500,
    `bounty id=${bountyId} did not reach status=${expectedStatus} in indexer`,
  );
}

export async function waitForPendingAccept(
  statePath: string,
  bountyId: bigint,
  timeoutMs = 30_000,
): Promise<void> {
  await poll(
    async () => {
      if (!existsSync(statePath)) return null;
      const raw = readFileSync(statePath, 'utf-8');
      try {
        const state = JSON.parse(raw) as {
          pending_accept?: Array<{ id?: string }>;
        };
        const pending = state.pending_accept ?? [];
        return pending.some((e) => e.id === bountyId.toString()) ? true : null;
      } catch {
        return null;
      }
    },
    timeoutMs,
    500,
    `pending_accept entry for id=${bountyId} not written to ${statePath}`,
  );
}

export async function waitForDoneRecord(
  historyPath: string,
  bountyId: bigint,
  timeoutMs = 30_000,
): Promise<void> {
  await poll(
    async () => {
      if (!existsSync(historyPath)) return null;
      const raw = readFileSync(historyPath, 'utf-8');
      const lines = raw
        .trim()
        .split('\n')
        .filter((l) => l.length > 0);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as { id?: string; status?: string };
          if (rec.id === bountyId.toString() && rec.status === 'done') return true;
        } catch {
          /* skip malformed line */
        }
      }
      return null;
    },
    timeoutMs,
    500,
    `'done' record for id=${bountyId} not in ${historyPath}`,
  );
}
