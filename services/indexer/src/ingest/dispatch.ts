/**
 * Canonical-finalized commit handler + shared per-block ingestion primitive.
 *
 * Exposes TWO entry points:
 *
 *   1. dispatchBlockEvents(deps, blockHash, blockNumber, events)
 *      — Live-path entry. Opens its own transaction, ingests one block's
 *        events, advances watermark, commits. Wired into chain/subscriptions.ts
 *        as `onCanonicalEvents`.
 *
 *   2. ingestSingleBlock(tx, logger, blockHash, blockNumber, events)
 *      — Shared primitive. Takes an EXISTING drizzle transaction; runs the
 *        SAVEPOINT-per-event ingestion loop. Does NOT advance the watermark
 *        and does NOT open/commit a transaction. Caller owns those.
 *      — Live caller: dispatchBlockEvents wraps a per-block tx around this.
 *      — Backfill caller: chain/backfill.ts wraps a per-BATCH tx around N
 *        calls to this, then advances watermark once at end-of-batch (D1).
 *
 * SAVEPOINT-per-event (D3 — liveness over purity):
 *   BEGIN savepoint
 *     INSERT bounty_events (event_uid) ON CONFLICT DO NOTHING
 *     projectEvent(tx, event)
 *   RELEASE / ROLLBACK TO SAVEPOINT (on JS throw)
 *   if rolled back: INSERT parse_errors (in OUTER tx; savepoint is gone)
 *
 * Watermark advancement uses `last_finalized_block < N` guard → advance-only
 * across backfill+live races. Backfill catches up; live continues; both
 * converge through this guard.
 */

import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { HexString } from '@gear-js/api/types';
import type { Logger } from 'pino';
import { bountyEvents, indexerState } from '../schema.js';
import { eventBountyId, type BufferedEvent, type EventName } from '../chain/buffer.js';
import { projectEvent } from './project.js';
import { recordParseError } from './errors.js';

// Accepts both NodePgDatabase and PgTransaction — both are PgDatabase
// structurally. Same pattern as project.ts / errors.ts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle txn types are deeply generic
type AnyTx = PgDatabase<PgQueryResultHKT, any, any> | NodePgDatabase;

export interface DispatchDeps {
  db: NodePgDatabase;
  logger: Logger;
}

export interface IngestResult {
  committedCount: number;
  parseErrorCount: number;
}

export function makeEventUid(
  blockHash: HexString,
  eventName: EventName | string,
  bountyId: bigint,
): string {
  return `${blockHash}-${eventName}-${bountyId.toString()}`;
}

/**
 * Build the JSONB payload stored in bounty_events.payload.
 * BigInts → strings (JSON-safe), block heights stay numeric.
 */
function eventPayloadJson(event: BufferedEvent): Record<string, unknown> {
  switch (event.eventName) {
    case 'BountyPosted':
      return {
        id: event.id.toString(),
        poster: event.poster,
        reward: event.reward.toString(),
        track: event.track,
        postedAt: event.postedAt,
      };
    case 'BountyClaimed':
      return {
        id: event.id.toString(),
        worker: event.worker,
        claimedAt: event.claimedAt,
      };
    case 'BountySubmitted':
      return {
        id: event.id.toString(),
        worker: event.worker,
        resultHash: event.resultHash,
        submittedAt: event.submittedAt,
      };
    case 'BountyAccepted':
      return {
        id: event.id.toString(),
        poster: event.poster,
        worker: event.worker,
        reward: event.reward.toString(),
        settledAt: event.settledAt,
      };
    case 'BountyWithdrawn':
      return {
        id: event.id.toString(),
        worker: event.worker,
        amount: event.amount.toString(),
        withdrawnAt: event.withdrawnAt,
      };
    case 'BountyCancelled':
      return {
        id: event.id.toString(),
        by: event.by,
        refunded: event.refunded.toString(),
        cancelledAt: event.cancelledAt,
      };
    case 'BountyRejected':
      return {
        id: event.id.toString(),
        by: event.by,
        worker: event.worker,
        reason: event.reason,
        rejectedAt: event.rejectedAt,
      };
    case 'BountyTimedOut':
      return {
        id: event.id.toString(),
        lastState: event.lastState,
        calledBy: event.calledBy,
        refundedTo: event.refundedTo,
        timedOutAt: event.timedOutAt,
      };
    case 'BountyRevoked':
      return {
        id: event.id.toString(),
        by: event.by,
        refundedTo: event.refundedTo,
        revokedAt: event.revokedAt,
      };
    default: {
      const _exhaustive: never = event;
      throw new Error(`eventPayloadJson: unhandled event variant ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/**
 * Per-block ingestion loop. Caller owns the transaction + watermark advance.
 *
 * For each event in `events`:
 *   - SAVEPOINT
 *     INSERT bounty_events ... ON CONFLICT (event_uid) DO NOTHING
 *     projectEvent(savepoint, event, blockHash, blockNumber)
 *   - on success → committedCount++
 *   - on throw → ROLLBACK TO SAVEPOINT, recordParseError in outer tx, parseErrorCount++
 *
 * Returns counts for caller logging.
 */
export async function ingestSingleBlock(
  tx: AnyTx,
  logger: Logger,
  blockHash: HexString,
  blockNumber: number,
  events: BufferedEvent[],
): Promise<IngestResult> {
  let committedCount = 0;
  let parseErrorCount = 0;

  for (const event of events) {
    // Synthetic / malformed events may have a non-BigInt id; eventBountyId
    // would throw. Compute uid defensively so we still have something to
    // store in parse_errors.
    let bountyIdStr = 'unknown';
    let uid = `${blockHash}-${event.eventName}-unknown`;
    try {
      const bountyId = eventBountyId(event);
      bountyIdStr = bountyId.toString();
      uid = makeEventUid(blockHash, event.eventName, bountyId);
    } catch {
      // fall through; savepoint try/catch will route to parse_errors
    }

    try {
      await tx.transaction(async (savepoint) => {
        await savepoint
          .insert(bountyEvents)
          .values({
            eventUid: uid,
            bountyId: Number(eventBountyId(event)),
            eventName: event.eventName,
            blockNumber,
            blockHash,
            txHash: event.txHash ?? null,
            payload: eventPayloadJson(event),
          })
          .onConflictDoNothing({ target: bountyEvents.eventUid });
        await projectEvent(savepoint, event, blockHash, blockNumber);
      });
      committedCount += 1;
      logger.debug(
        {
          op: 'ingest_event',
          phase: 'committed',
          eventUid: uid,
          bountyId: bountyIdStr,
          blockNumber,
          eventName: event.eventName,
        },
        'event committed',
      );
    } catch (err: unknown) {
      parseErrorCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(
        {
          op: 'parse_error',
          eventUid: uid,
          bountyId: bountyIdStr,
          blockNumber,
          eventName: event.eventName,
          err: message,
        },
        'event ingestion failed; recording parse_error',
      );
      await recordParseError(tx, {
        eventUid: uid,
        blockNumber,
        rawPayloadHex: '',
        errorMessage: message,
      });
    }
  }

  return { committedCount, parseErrorCount };
}

/**
 * Live-path entry. Opens its own transaction, ingests one block, advances
 * watermark, commits.
 */
export async function dispatchBlockEvents(
  deps: DispatchDeps,
  blockHash: HexString,
  blockNumber: number,
  events: BufferedEvent[],
): Promise<void> {
  const { db, logger } = deps;

  if (events.length === 0) {
    await advanceWatermark(db, blockNumber);
    return;
  }

  await db.transaction(async (tx) => {
    const result = await ingestSingleBlock(tx, logger, blockHash, blockNumber, events);
    await tx
      .update(indexerState)
      .set({ lastFinalizedBlock: blockNumber, updatedAt: new Date() })
      .where(and(eq(indexerState.id, 1), lt(indexerState.lastFinalizedBlock, blockNumber)));
    logger.info(
      {
        op: 'commit_batch',
        blockHash,
        blockNumber,
        committedCount: result.committedCount,
        parseErrorCount: result.parseErrorCount,
      },
      'block committed',
    );
  });
}

/**
 * Standalone watermark advance for empty blocks. Single UPDATE is itself
 * atomic; no enclosing transaction needed.
 */
async function advanceWatermark(db: NodePgDatabase, blockNumber: number): Promise<void> {
  await db
    .update(indexerState)
    .set({ lastFinalizedBlock: blockNumber, updatedAt: new Date() })
    .where(and(eq(indexerState.id, 1), lt(indexerState.lastFinalizedBlock, blockNumber)));
}
