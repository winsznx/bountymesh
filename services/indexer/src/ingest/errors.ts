/**
 * Parse-error sink (D3 — liveness over purity).
 *
 * Bad event payload at projection time → record here, do NOT abort the outer
 * transaction or halt the indexer. Sibling events from the same block still
 * commit; watermark still advances. /health surfaces the 1-hour count so the
 * operator can detect "stuck-but-quiet" drift.
 *
 * INSERT is ON CONFLICT DO NOTHING — re-ingestion of a previously-seen bad
 * event is a no-op (same event_uid PK as the bounty_events table).
 */

import { count, gt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { parseErrors } from '../schema.js';

// Accepts both NodePgDatabase and PgTransaction — both are PgDatabase
// structurally. Used by dispatch.ts to record errors inside the outer txn
// AFTER a per-event savepoint rolled back.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle txn types are deeply generic
type AnyTx = PgDatabase<PgQueryResultHKT, any, any> | NodePgDatabase;

export interface ParseErrorRecord {
  eventUid: string;
  blockNumber: number;
  /** SCALE hex of the original payload, or '' if not available at this layer. */
  rawPayloadHex: string;
  errorMessage: string;
}

export async function recordParseError(tx: AnyTx, record: ParseErrorRecord): Promise<void> {
  await tx
    .insert(parseErrors)
    .values({
      eventUid: record.eventUid,
      blockNumber: record.blockNumber,
      rawPayloadHex: record.rawPayloadHex,
      errorMessage: record.errorMessage,
    })
    .onConflictDoNothing();
}

/**
 * Count of parse errors recorded in the last 1 hour. Used by /health to
 * surface "stuck-but-quiet" drift. Queries fresh on each call — at this
 * scale, no caching needed.
 */
export async function getParseErrorCount1h(db: NodePgDatabase): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(parseErrors)
    .where(gt(parseErrors.occurredAt, sql`NOW() - INTERVAL '1 hour'`));
  return rows[0]?.value ?? 0;
}
