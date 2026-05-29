/**
 * Pure event → bounties row projection.
 *
 * Five rules, all idempotent via the `last_event_block < $newBlockNumber`
 * guard: replay of an already-projected event is a no-op (zero rows affected,
 * no error). Backfill races with live converge through this guard.
 *
 * BigInt boundary (Step 4 §6 judgment call 1; reaffirmed by Step 5b template-
 * literal footgun):
 *   - reward / amount are BigInt in event payloads
 *   - Postgres NUMERIC(39,0) is bound via STRING in Drizzle (`numeric` default
 *     mode) — NEVER as BigInt or number
 *   - Conversion at the boundary: `event.reward.toString()`
 *   - Phase 5 frontend consumers reverse: `BigInt(graphqlResponse.reward)`
 *
 * Block heights stay as `number` (safe under 2^53 forever at 6s blocks).
 *
 * For BountyPosted (the lifecycle's first event): INSERT … ON CONFLICT (id)
 * DO NOTHING. On replay, sibling events may have already advanced status —
 * we must NOT overwrite back to 'Open'. The guarded UPDATEs on later events
 * keep state advancing forward only.
 */

import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { HexString } from '@gear-js/api/types';
import { bounties } from '../schema.js';
import type { BufferedEvent } from '../chain/buffer.js';

// Accepts both NodePgDatabase and PgTransaction — both are PgDatabase
// structurally. dispatch.ts calls this inside a SAVEPOINT (nested txn).
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- drizzle txn types are deeply generic
type AnyTx = PgDatabase<PgQueryResultHKT, any, any> | NodePgDatabase;

export async function projectEvent(
  tx: AnyTx,
  event: BufferedEvent,
  _blockHash: HexString,
  blockNumber: number,
): Promise<void> {
  const id = Number(event.id);

  switch (event.eventName) {
    case 'BountyPosted':
      await tx
        .insert(bounties)
        .values({
          id,
          poster: event.poster,
          worker: null,
          // ↓ BigInt → NUMERIC(39,0) via Drizzle string boundary
          reward: event.reward.toString(),
          track: event.track,
          status: 'Open',
          postedAt: event.postedAt,
          claimedAt: null,
          submittedAt: null,
          acceptedAt: null,
          withdrawnAt: null,
          withdrawn: false,
          resultHash: null,
          postTxHash: event.txHash,
          claimTxHash: null,
          submitTxHash: null,
          acceptTxHash: null,
          withdrawTxHash: null,
          lastEventBlock: blockNumber,
          title: event.title,
          description: event.description,
          acceptance: event.acceptance,
          deadline: event.deadline,
        })
        .onConflictDoNothing({ target: bounties.id });
      return;

    case 'BountyClaimed':
      await tx
        .update(bounties)
        .set({
          status: 'Claimed',
          worker: event.worker,
          claimedAt: event.claimedAt,
          claimTxHash: event.txHash,
          lastEventBlock: blockNumber,
        })
        .where(and(eq(bounties.id, id), lt(bounties.lastEventBlock, blockNumber)));
      return;

    case 'BountySubmitted':
      await tx
        .update(bounties)
        .set({
          status: 'Submitted',
          submittedAt: event.submittedAt,
          resultHash: event.resultHash,
          submitTxHash: event.txHash,
          lastEventBlock: blockNumber,
        })
        .where(and(eq(bounties.id, id), lt(bounties.lastEventBlock, blockNumber)));
      return;

    case 'BountyAccepted':
      await tx
        .update(bounties)
        .set({
          status: 'Accepted',
          acceptedAt: event.settledAt,
          acceptTxHash: event.txHash,
          lastEventBlock: blockNumber,
        })
        .where(and(eq(bounties.id, id), lt(bounties.lastEventBlock, blockNumber)));
      return;

    case 'BountyWithdrawn':
      // status STAYS 'Accepted' — Withdraw is a flag flip, not a status
      // transition (Phase 1 contract; MASTER_PRD §4.1 state machine).
      await tx
        .update(bounties)
        .set({
          withdrawn: true,
          withdrawnAt: event.withdrawnAt,
          withdrawTxHash: event.txHash,
          lastEventBlock: blockNumber,
        })
        .where(and(eq(bounties.id, id), lt(bounties.lastEventBlock, blockNumber)));
      return;

    default: {
      // TypeScript exhaustiveness AND runtime guard.
      // The D3 parse-error test exercises this branch by passing a
      // synthetic event with a non-union `eventName` cast through `as any`.
      const _exhaustive: never = event;
      throw new Error(
        `projectEvent: unknown event shape (eventName='${(_exhaustive as { eventName: string }).eventName}')`,
      );
    }
  }
}
