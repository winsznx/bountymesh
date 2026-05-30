/**
 * One-off backfill: populate bounties.result_payload for historical Submitted
 * bounties whose payload predates the P6 envelope-capture indexer code.
 *
 * The BountySubmitted *event* carries only result_hash; the payload lives in
 * the originating Submit *call*. For each Submitted bounty with a NULL
 * result_payload, we locate its submit extrinsic via the bounty_events row
 * (which stores block_hash + tx_hash for the BountySubmitted event),
 * re-decode the call args (same registry-symmetric path as decode.ts), and
 * write result_payload.
 *
 * Block lookup is O(1) per bounty — we JOIN to bounty_events for the stored
 * block_hash rather than scanning the chain.
 *
 * Idempotent: the WHERE clause selects only NULL-payload rows, so re-runs after
 * a successful pass find 0 rows. Per-bounty try/catch — one failure leaves that
 * row NULL (retryable next run) and never aborts the batch.
 *
 * Throwaway: delete after P3.10 close along with other one-off scripts.
 *
 * Usage (prod): DATABASE_URL=<public-proxy-url> VARA_RPC_URL=wss://rpc.vara.network \
 *               BOUNTYMESH_PROGRAM_ID=0x… tsx scripts/backfill-result-payloads.ts
 */

import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import { createProgramRegistry } from '../src/chain/decode.js';
import { bounties, bountyEvents } from '../src/schema.js';

const DATABASE_URL = process.env.DATABASE_URL;
const VARA_RPC_URL = process.env.VARA_RPC_URL ?? 'wss://rpc.vara.network';
const PROGRAM_ID = process.env.BOUNTYMESH_PROGRAM_ID as HexString | undefined;

interface SignedBlockShape {
  block: {
    extrinsics: Array<{
      hash: { toHex: () => HexString };
      method: { args: Array<{ toHex: () => HexString }> };
    }>;
  };
}

/**
 * Decode result_payload out of a Submit call payload — byte-symmetric with the
 * SDK encode side and decode.ts. Returns null on any failure.
 */
function decodeSubmitResultPayload(
  registry: ReturnType<typeof createProgramRegistry>,
  callPayloadHex: HexString,
): string | null {
  try {
    const decoded = registry.createType(
      '(String, String, (u64, String, H256))',
      callPayloadHex,
    ) as unknown as { toJSON: () => unknown[] };
    const args = decoded.toJSON()[2] as [unknown, string, unknown];
    return typeof args[1] === 'string' ? args[1] : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!DATABASE_URL) throw new Error('DATABASE_URL required');
  if (!PROGRAM_ID) throw new Error('BOUNTYMESH_PROGRAM_ID required');

  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('.proxy.rlwy.net') ? { rejectUnauthorized: false } : undefined,
  });
  const db = drizzle(pool);

  // Targets: bounties with NULL result_payload that have a projected
  // BountySubmitted event row (the JOIN). A Submitted bounty whose event hasn't
  // projected yet (indexer mid-projection) has no bounty_events row → excluded
  // by the inner join → naturally skipped, retried next run (sanity point #3).
  const targets = await db
    .select({
      id: bounties.id,
      blockHash: bountyEvents.blockHash,
      txHash: bountyEvents.txHash,
    })
    .from(bounties)
    .innerJoin(
      bountyEvents,
      and(
        eq(bountyEvents.bountyId, bounties.id),
        eq(bountyEvents.eventName, 'BountySubmitted'),
      ),
    )
    .where(isNull(bounties.resultPayload));

  // Sanity point #2: 0-row case is explicit green, not a silent skip.
  if (targets.length === 0) {
    console.log(
      '[backfill] Found 0 submitted bounties with NULL result_payload. Nothing to backfill.',
    );
    await pool.end();
    return;
  }

  console.log(`[backfill] Found ${targets.length} submitted bounties to backfill.`);

  const api = await GearApi.create({ providerAddress: VARA_RPC_URL });
  const registry = createProgramRegistry(api, PROGRAM_ID);

  let ok = 0;
  let skipped = 0;
  for (const t of targets) {
    try {
      if (!t.txHash) {
        console.warn(`[backfill] bounty #${t.id}: event has null tx_hash; skip (retry next run)`);
        skipped += 1;
        continue;
      }
      const signed = (await api.rpc.chain.getBlock(t.blockHash as HexString)) as unknown as SignedBlockShape;
      const ext = signed.block.extrinsics.find((e) => e.hash.toHex() === t.txHash);
      if (!ext) {
        console.warn(`[backfill] bounty #${t.id}: extrinsic ${t.txHash} not in block ${t.blockHash}; skip`);
        skipped += 1;
        continue;
      }
      const callPayloadHex = ext.method.args[1]?.toHex?.() ?? null;
      if (!callPayloadHex) {
        console.warn(`[backfill] bounty #${t.id}: no call payload in extrinsic; skip`);
        skipped += 1;
        continue;
      }
      const resultPayload = decodeSubmitResultPayload(registry, callPayloadHex);
      if (resultPayload === null) {
        console.warn(`[backfill] bounty #${t.id}: decode returned null; skip (retry next run)`);
        skipped += 1;
        continue;
      }
      await db.update(bounties).set({ resultPayload }).where(eq(bounties.id, t.id));
      console.log(`[backfill] bounty #${t.id}: backfilled (${resultPayload.length} bytes)`);
      ok += 1;
    } catch (e) {
      console.warn(
        `[backfill] bounty #${t.id}: ${e instanceof Error ? e.message : String(e)}; skip (retry next run)`,
      );
      skipped += 1;
    }
  }

  console.log(`[backfill] Done. backfilled=${ok} skipped=${skipped} total=${targets.length}`);
  await api.disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('[backfill] FATAL', e);
  process.exit(1);
});
