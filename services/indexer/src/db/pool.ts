/**
 * pg pool factories (D2 — two-pool defense-in-depth).
 *
 * writerPool — max 2. Owned by ingestion + migrations + watermark UPDATEs.
 *   Uses DATABASE_URL (bountymesh role, full read/write).
 * readerPool — max 10. Passed to PostGraphile only. Uses DATABASE_URL_READER
 *   (bountymesh_readonly role, SELECT only).
 *
 * Lifecycle:
 *   - createWriterPool: Boot Stage 1 (before migrations).
 *   - createReaderPool: Boot Stage 3.5 (right before HTTP server binds).
 *   - end(): orchestrated by lifecycle/shutdown.ts in the locked teardown
 *     order — readerPool ends BEFORE chainApi.disconnect; writerPool ends
 *     LAST so in-flight dispatch txns can drain.
 *
 * Hardening (P7 Phase 1):
 *   - statement_timeout=30s: caps any single GraphQL query from eating the
 *     connection pool. Applied via pool.on('connect') with SET because
 *     Railway's PG proxy strips the pg `options` connection parameter.
 *   - SSL: required against Railway's managed Postgres in production.
 *     `rejectUnauthorized: false` because Railway terminates TLS at its
 *     proxy with their own cert chain.
 */

import pg from 'pg';
import type { IndexerConfig } from '../config.js';

const STATEMENT_TIMEOUT_MS = 30_000;

function poolSsl(connectionString: string): pg.PoolConfig['ssl'] {
  // Localhost / dev pools don't need TLS — keeps integration tests against
  // gear --dev + local docker postgres simple.
  if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
    return undefined;
  }
  return { rejectUnauthorized: false };
}

function installStatementTimeout(pool: pg.Pool): void {
  pool.on('connect', (client) => {
    // Fire-and-forget SET. If it fails (rare), the connection still works —
    // it just doesn't carry the 30s cap. Logged on error so a recurring
    // failure surfaces in the indexer logs.
    void client
      .query(`SET statement_timeout = ${STATEMENT_TIMEOUT_MS}`)
      .catch((err: unknown) => {
        console.error('[pool] SET statement_timeout failed:', err);
      });
  });
}

export function createWriterPool(config: IndexerConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
    ssl: poolSsl(config.databaseUrl),
  });
  installStatementTimeout(pool);
  return pool;
}

export function createReaderPool(config: IndexerConfig): pg.Pool {
  const pool = new pg.Pool({
    connectionString: config.databaseUrlReader,
    max: 10,
    ssl: poolSsl(config.databaseUrlReader),
  });
  installStatementTimeout(pool);
  return pool;
}
