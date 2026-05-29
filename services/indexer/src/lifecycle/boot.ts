/**
 * 7-stage boot sequence + lifecycle controller (Step 5f, D4-locked).
 *
 * Stage execution (sequential, awaited):
 *   1. writerPool + migrations + post-migration GRANT
 *   2. indexer_state read + assertBootBlockAvailable + (first-boot) row INSERT
 *   3. chain api + program registry; wire onDisconnect / onReconnect handlers
 *   4. Stage-4 backfill (last_finalized_block, currentFinalizedHead@Stage4Start]
 *   5. openSubscriptions (SDK 5 onBountyX + finalized-heads canonical verify)
 *   5.5. Small catch-up backfill (Step 5b decision Option b)
 *   6. readerPool + HTTP server (PostGraphile + /health)
 *
 * Reconnect handling:
 *   onDisconnect → setChainStatus('reconnecting'); buffer.clear()
 *   onReconnect  → setChainStatus('connected'); close stale subs; small
 *                  catch-up backfill; reopen subs
 *
 * Boot failure (any stage throws): rollback in reverse construction order
 * before re-throwing. Boot is all-or-nothing — no partial state leaks.
 *
 * mode flag (Step 4 D3):
 *   'all'        — every stage runs (default; tests use this)
 *   'processor'  — skip Stage 6 (no HTTP server)
 *   'serve'      — skip Stages 4-5.5 (no chain ingestion; assumes another
 *                  process advances the watermark)
 */

import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type pg from 'pg';
import type { GearApi } from '@gear-js/api';
import type { HexString } from '@gear-js/api/types';
import type { TypeRegistry } from '@polkadot/types';
import type { Logger } from 'pino';
import { assertBootBlockAvailable, type IndexerConfig } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { createReaderPool, createWriterPool } from '../db/pool.js';
import { createChainApi, type ChainApiHandle } from '../chain/api.js';
import { createProgramRegistry } from '../chain/decode.js';
import { backfill } from '../chain/backfill.js';
import { PendingBuffer } from '../chain/buffer.js';
import {
  openSubscriptions,
  type CanonicalEventsHandler,
  type SubscriptionsHandle,
} from '../chain/subscriptions.js';
import { dispatchBlockEvents } from '../ingest/dispatch.js';
import { startHttpServer, type ServerHandle } from '../graphql/server.js';
import { indexerState } from '../schema.js';
import { HealthState, type IndexerMode as HealthMode } from './health.js';

export interface IndexerController {
  healthState: HealthState;
  shutdown(): Promise<void>;
  runUntilShutdown(): Promise<void>;
  awaitMode(mode: HealthMode, timeoutMs?: number): Promise<void>;
}

interface FinalizedHeader {
  number: { toNumber: () => number };
  hash: { toHex: () => HexString };
}

async function getFinalizedBlockNumber(api: GearApi): Promise<number> {
  const hash = await api.rpc.chain.getFinalizedHead();
  const header = await api.rpc.chain.getHeader(hash);
  return header.number.toNumber();
}

async function getHeadBlockNumber(api: GearApi): Promise<number> {
  const header = await api.rpc.chain.getHeader();
  return header.number.toNumber();
}

async function readWatermark(db: NodePgDatabase): Promise<number | null> {
  const rows = await db
    .select({ lastFinalizedBlock: indexerState.lastFinalizedBlock })
    .from(indexerState)
    .where(eq(indexerState.id, 1));
  return rows[0]?.lastFinalizedBlock ?? null;
}

export async function boot(config: IndexerConfig, logger: Logger): Promise<IndexerController> {
  const healthState = new HealthState();
  const buffer = new PendingBuffer();

  // Rollback stack for boot failure. unshift adds to FRONT → reverse-construction order.
  const rollback: Array<{ name: string; fn: () => Promise<void> }> = [];

  // Mutable boxes for subs handle (rebuilt on WS reconnect).
  const subsBox: { handle: SubscriptionsHandle | null } = { handle: null };
  let healthFinalizedUnsub: (() => void) | null = null;
  let healthHeadUnsub: (() => void) | null = null;
  let writerPool: pg.Pool | null = null;
  let writerDb: NodePgDatabase | null = null;
  let chainApi: ChainApiHandle | null = null;
  let registry: TypeRegistry | null = null;
  let readerPool: pg.Pool | null = null;
  let server: ServerHandle | null = null;

  /** Open subscriptions wired to ingest path. Called from Stage 5 and onReconnect. */
  const openIngestionSubs = async (): Promise<void> => {
    if (!chainApi || !writerDb) {
      throw new Error('openIngestionSubs called before Stage 3 / Stage 1');
    }
    const dispatchHandler: CanonicalEventsHandler = async (blockHash, blockNumber, events) => {
      await dispatchBlockEvents(
        { db: writerDb!, logger },
        blockHash,
        blockNumber,
        events,
      );
      healthState.setLastFinalizedBlock(blockNumber);
    };
    if (!registry) throw new Error('openIngestionSubs called before registry created');
    subsBox.handle = await openSubscriptions({
      api: chainApi.api,
      programId: config.programId,
      registry,
      buffer,
      onCanonicalEvents: dispatchHandler,
      logger,
    });
  };

  const closeIngestionSubs = async (): Promise<void> => {
    if (subsBox.handle) {
      try {
        await subsBox.handle.close();
      } catch (err) {
        logger.warn({ op: 'shutdown', err: String(err) }, 'subs close failed');
      }
      subsBox.handle = null;
    }
  };

  /** Backfill from current watermark to current finalized head. */
  const catchUpBackfill = async (): Promise<void> => {
    if (!writerDb || !chainApi || !registry) return;
    const watermark = await readWatermark(writerDb);
    if (watermark === null) return;
    const finalizedNum = await getFinalizedBlockNumber(chainApi.api);
    if (finalizedNum <= watermark) return;
    await backfill(
      {
        db: writerDb,
        api: chainApi.api,
        programId: config.programId,
        registry,
        logger,
        batchSize: config.backfillBatchSize,
      },
      watermark,
      finalizedNum,
    );
    healthState.setLastFinalizedBlock(finalizedNum);
  };

  /** WS dropped — clear optimistic state, mark reconnecting. */
  const onDisconnect = (): void => {
    healthState.setChainStatus('reconnecting');
    buffer.clear();
    logger.warn({ op: 'ws_disconnect' }, 'ws dropped; buffer cleared');
  };

  /** WS back — recompose subscriptions and bridge any missed gap. */
  const onReconnect = async (): Promise<void> => {
    healthState.setChainStatus('connected');
    healthState.recordWsReconnect();
    logger.info({ op: 'ws_reconnect' }, 'ws reconnected; closing stale subs + catch-up backfill');
    if (config.mode !== 'serve') {
      await closeIngestionSubs();
      try {
        await catchUpBackfill();
      } catch (err) {
        logger.error({ op: 'ws_reconnect', err: String(err) }, 'catch-up backfill failed');
      }
      try {
        await openIngestionSubs();
      } catch (err) {
        logger.error({ op: 'ws_reconnect', err: String(err) }, 'reopen subs failed');
      }
    }
  };

  try {
    // ─── Stage 1 — writerPool + migrations + GRANT ─────────────────────
    logger.info({ op: 'boot', stage: 1 }, 'writer pool + migrations');
    writerPool = createWriterPool(config);
    rollback.unshift({ name: 'writerPool.end', fn: () => writerPool!.end() });
    await runMigrations({ databaseUrl: config.databaseUrl });
    writerDb = drizzle(writerPool);

    // ─── Stage 2 — read state + assert boot block + first-boot row INSERT ─
    logger.info({ op: 'boot', stage: 2 }, 'indexer_state read');
    const watermarkRow = await readWatermark(writerDb);
    assertBootBlockAvailable(
      config,
      watermarkRow !== null ? { lastFinalizedBlock: watermarkRow } : null,
    );
    if (watermarkRow === null) {
      const startBlock = config.startBlock as number; // guaranteed by assertBootBlockAvailable
      await writerDb
        .insert(indexerState)
        .values({
          id: 1,
          programId: config.programId,
          startBlock,
          lastFinalizedBlock: startBlock,
        })
        .onConflictDoUpdate({
          target: indexerState.id,
          set: {
            programId: config.programId,
            startBlock,
            lastFinalizedBlock: sql`GREATEST(${indexerState.lastFinalizedBlock}, ${startBlock})`,
            updatedAt: new Date(),
          },
        });
      logger.info({ op: 'boot', stage: 2, startBlock }, 'first-boot: indexer_state seeded');
    }
    const resumeFrom = (await readWatermark(writerDb)) as number;
    healthState.setLastFinalizedBlock(resumeFrom);

    // ─── Stage 3 — chain api + program registry ───────────────────────
    logger.info({ op: 'boot', stage: 3 }, 'chain api + registry');
    chainApi = await createChainApi({
      config,
      logger,
      onDisconnect,
      onReconnect,
    });
    rollback.unshift({ name: 'chainApi.disconnect', fn: () => chainApi!.disconnect() });
    healthState.setChainStatus('connected');
    registry = createProgramRegistry(chainApi.api, config.programId);
    const headAtBoot = await getHeadBlockNumber(chainApi.api);
    healthState.setHeadBlock(headAtBoot);

    // ─── Stage 4 — backfill from watermark to current finalized ────────
    if (config.mode !== 'serve') {
      logger.info({ op: 'boot', stage: 4 }, 'backfill stage 4');
      healthState.setMode('backfilling');
      const stage4End = await getFinalizedBlockNumber(chainApi.api);
      if (stage4End > resumeFrom) {
        const r = await backfill(
          {
            db: writerDb,
            api: chainApi.api,
            programId: config.programId,
            registry,
            logger,
            batchSize: config.backfillBatchSize,
          },
          resumeFrom,
          stage4End,
        );
        logger.info(
          {
            op: 'boot',
            stage: 4,
            blocksWalked: r.blocksWalked,
            eventsIngested: r.eventsIngested,
            durationMs: r.durationMs,
          },
          'stage 4 complete',
        );
        healthState.setLastFinalizedBlock(stage4End);
      } else {
        logger.info({ op: 'boot', stage: 4 }, 'stage 4 skipped (watermark already at finalized head)');
      }
    }

    // ─── Stage 5 — open SDK + finalized-heads subscriptions ────────────
    if (config.mode !== 'serve') {
      logger.info({ op: 'boot', stage: 5 }, 'open subscriptions');
      await openIngestionSubs();
      rollback.unshift({ name: 'subs.close', fn: () => closeIngestionSubs() });
      healthState.setMode('catching-up');
    }

    // ─── Stage 5.5 — small catch-up backfill (Step 5b Option b) ────────
    if (config.mode !== 'serve') {
      logger.info({ op: 'boot', stage: 5.5 }, 'stage 5.5 catch-up backfill');
      await catchUpBackfill();
      healthState.setMode('live');
      logger.info({ op: 'boot', stage: 5.5 }, 'mode live');

      // Side subscription: keep healthState.headBlock + lastFinalizedBlock fresh.
      const headerListener = await chainApi.api.rpc.chain.subscribeNewHeads(
        (header: FinalizedHeader) => {
          healthState.setHeadBlock(header.number.toNumber());
        },
      );
      healthHeadUnsub = headerListener as unknown as () => void;
      rollback.unshift({
        name: 'healthHeadUnsub',
        fn: async () => {
          if (healthHeadUnsub) healthHeadUnsub();
        },
      });

      const finalizedListener = await chainApi.api.rpc.chain.subscribeFinalizedHeads(
        (header: FinalizedHeader) => {
          healthState.setLastFinalizedBlock(header.number.toNumber());
        },
      );
      healthFinalizedUnsub = finalizedListener as unknown as () => void;
      rollback.unshift({
        name: 'healthFinalizedUnsub',
        fn: async () => {
          if (healthFinalizedUnsub) healthFinalizedUnsub();
        },
      });
    } else {
      // serve mode: no chain stream, mode never transitions through backfilling/catching-up
      healthState.setMode('live');
    }

    // ─── Stage 6 — reader pool + HTTP server ──────────────────────────
    if (config.mode !== 'processor') {
      logger.info({ op: 'boot', stage: 6 }, 'reader pool + http server');
      readerPool = createReaderPool(config);
      rollback.unshift({ name: 'readerPool.end', fn: () => readerPool!.end() });
      server = startHttpServer({
        config,
        readerPool,
        writerPool: writerPool!,
        writerDb: writerDb!,
        healthState,
        logger,
      });
      rollback.unshift({ name: 'server.close', fn: () => server!.close() });
    }

    logger.info({ op: 'boot', stage: 'complete' }, 'indexer boot complete');
  } catch (err) {
    logger.error({ op: 'boot', err: String(err) }, 'boot failed; rolling back');
    for (const step of rollback) {
      try {
        await step.fn();
      } catch (rbErr) {
        logger.warn(
          { op: 'shutdown', step: step.name, err: String(rbErr) },
          'rollback step failed',
        );
      }
    }
    throw err;
  }

  // ─── Construct controller ─────────────────────────────────────────
  let shutdownStarted = false;
  let shutdownComplete: ((value: void) => void) | null = null;
  const runPromise = new Promise<void>((resolve) => {
    shutdownComplete = resolve;
  });
  let shutdownPromise: Promise<void> | null = null;

  // Shutdown sequence per operator spec (Step 5f §2):
  //   1. server.close (drains in-flight requests)
  //   2. subs.close (SDK + finalized-heads)
  //   3. buffer.clear (already empty mostly; sanity)
  //   4. readerPool.end (no more queries possible)
  //   5. chainApi.disconnect
  //   6. writerPool.end (last — drains in-flight dispatch txns)
  //   7. healthState.setChainStatus('disconnected')
  const shutdownSequence: Array<{ name: string; fn: () => Promise<void> }> = [
    { name: 'server.close', fn: async () => { if (server) await server.close(); } },
    { name: 'subs.close', fn: () => closeIngestionSubs() },
    {
      name: 'healthFinalizedUnsub',
      fn: async () => {
        if (healthFinalizedUnsub) {
          healthFinalizedUnsub();
          healthFinalizedUnsub = null;
        }
      },
    },
    {
      name: 'healthHeadUnsub',
      fn: async () => {
        if (healthHeadUnsub) {
          healthHeadUnsub();
          healthHeadUnsub = null;
        }
      },
    },
    { name: 'buffer.clear', fn: async () => buffer.clear() },
    { name: 'readerPool.end', fn: async () => { if (readerPool) await readerPool.end(); } },
    {
      name: 'chainApi.disconnect',
      fn: async () => {
        if (chainApi) await chainApi.disconnect();
      },
    },
    { name: 'writerPool.end', fn: async () => { if (writerPool) await writerPool.end(); } },
    {
      name: 'healthState.setChainStatus',
      fn: async () => healthState.setChainStatus('disconnected'),
    },
  ];

  const doShutdown = async (): Promise<void> => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    logger.info({ op: 'shutdown' }, 'shutdown sequence starting');
    for (const step of shutdownSequence) {
      try {
        await step.fn();
        logger.debug({ op: 'shutdown', step: step.name }, 'step complete');
      } catch (err: unknown) {
        logger.warn(
          { op: 'shutdown', step: step.name, err: String(err) },
          'shutdown step failed',
        );
      }
    }
    logger.info({ op: 'shutdown' }, 'shutdown sequence done');
    if (shutdownComplete) shutdownComplete();
  };

  const shutdown = (): Promise<void> => {
    if (!shutdownPromise) shutdownPromise = doShutdown();
    return shutdownPromise;
  };

  const awaitMode = (target: HealthMode, timeoutMs = 30_000): Promise<void> => {
    return new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const check = (): void => {
        if (healthState.getMode() === target) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > timeoutMs) {
          reject(
            new Error(
              `awaitMode: '${target}' not reached within ${timeoutMs}ms (current: '${healthState.getMode()}')`,
            ),
          );
          return;
        }
        setTimeout(check, 100);
      };
      check();
    });
  };

  return {
    healthState,
    shutdown,
    runUntilShutdown: () => runPromise,
    awaitMode,
  };
}
