/**
 * Batched history walker (Boot Stage 4 + Stage 5.5 catch-up).
 *
 * Walks (fromBlock, toBlock] in batches of `config.backfillBatchSize`
 * (default 50). One driver, two callers:
 *
 *   Stage 4 (cold start): boot.ts calls backfill(last_finalized_block,
 *     headFinalized@stage4start). Stage 5.5 then opens subscriptions.
 *   Stage 5.5 (gap-close): boot.ts calls backfill again, this time from the
 *     just-advanced watermark to currentFinalizedHead. ~1-3 blocks worst case
 *     on hackathon scale. Walking via the same code path means the gap is
 *     covered by the same idempotent insert + projection logic.
 *
 * Decoder: chain/decode.ts (local re-implementation; Phase 7 polish item #5).
 *
 * Per-batch atomicity (D1): each batch of N blocks commits as ONE transaction.
 *   - N `ingestSingleBlock(tx, ...)` calls (zero-cost when block is empty)
 *   - ONE watermark UPDATE at end-of-batch
 *   - COMMIT
 * Crash mid-batch → ROLLBACK loses ≤(batchSize-1) blocks of progress; on
 * restart, idempotent inserts collapse the re-walk to no-ops (event_uid
 * ON CONFLICT, lastEventBlock guard).
 *
 * Empty blocks: `decodeBlockEvents` returns []. `ingestSingleBlock` not
 * called for those (cheap fast path). Batch-end watermark UPDATE still fires,
 * so the watermark advances through empty regions.
 *
 * Read cost per block: 1× getBlockHash + 1× api.at + 1× system.events
 *   + 0 or 1× getBlock (only iff at least one BountyService event is decoded).
 *   2 RPCs on empty blocks, 3 on populated.
 *   At 50-block batches on dev: ~100-150 RPCs/batch + ~6-12s/batch typical.
 */

import { and, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type { Logger } from 'pino';
import { indexerState } from '../schema.js';
import { decodeBlockEvents } from './decode.js';
import { ingestSingleBlock } from '../ingest/dispatch.js';

export interface BackfillDeps {
  db: NodePgDatabase;
  api: GearApi;
  programId: HexString;
  registry: TypeRegistry;
  logger: Logger;
  /** Default 50. Pass via config.backfillBatchSize from caller. */
  batchSize?: number;
}

export interface BackfillResult {
  blocksWalked: number;
  eventsIngested: number;
  parseErrors: number;
  batches: number;
  durationMs: number;
}

/**
 * Walk (exclusiveFrom, inclusiveTo] in batches.
 *
 * @param exclusiveFrom watermark to start AFTER (caller passes last_finalized_block)
 * @param inclusiveTo highest block to ingest (typically current finalized head)
 */
export async function backfill(
  deps: BackfillDeps,
  exclusiveFrom: number,
  inclusiveTo: number,
): Promise<BackfillResult> {
  const { db, api, programId, registry, logger, batchSize = 50 } = deps;
  const overallStart = Date.now();
  let blocksWalked = 0;
  let eventsIngested = 0;
  let parseErrors = 0;
  let batches = 0;

  if (inclusiveTo <= exclusiveFrom) {
    logger.info(
      { op: 'backfill_batch', fromBlock: exclusiveFrom, toBlock: inclusiveTo, skipped: true },
      'backfill range empty; nothing to do',
    );
    return { blocksWalked: 0, eventsIngested: 0, parseErrors: 0, batches: 0, durationMs: 0 };
  }

  for (let batchStart = exclusiveFrom + 1; batchStart <= inclusiveTo; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize - 1, inclusiveTo);
    const batchStartedAt = Date.now();
    let batchEventsCommitted = 0;
    let batchParseErrors = 0;

    await db.transaction(async (tx) => {
      for (let blockNumber = batchStart; blockNumber <= batchEnd; blockNumber += 1) {
        const blockHashCodec = (await api.rpc.chain.getBlockHash(
          blockNumber,
        )) as unknown as { toHex: () => HexString };
        const blockHash = blockHashCodec.toHex();

        const events = await decodeBlockEvents(api, programId, blockHash, registry);
        if (events.length === 0) continue;

        const result = await ingestSingleBlock(tx, logger, blockHash, blockNumber, events);
        batchEventsCommitted += result.committedCount;
        batchParseErrors += result.parseErrorCount;
      }

      // End-of-batch watermark advance. Advance-only via the lt() guard.
      await tx
        .update(indexerState)
        .set({ lastFinalizedBlock: batchEnd, updatedAt: new Date() })
        .where(and(eq(indexerState.id, 1), lt(indexerState.lastFinalizedBlock, batchEnd)));
    });

    batches += 1;
    blocksWalked += batchEnd - batchStart + 1;
    eventsIngested += batchEventsCommitted;
    parseErrors += batchParseErrors;

    logger.info(
      {
        op: 'backfill_batch',
        fromBlock: batchStart,
        toBlock: batchEnd,
        eventsIngested: batchEventsCommitted,
        parseErrors: batchParseErrors,
        durationMs: Date.now() - batchStartedAt,
      },
      'batch committed',
    );
  }

  return {
    blocksWalked,
    eventsIngested,
    parseErrors,
    batches,
    durationMs: Date.now() - overallStart,
  };
}
