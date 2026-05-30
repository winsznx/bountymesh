/**
 * pg pool factories (D2 — two-pool defense-in-depth).
 *
 * writerPool — max 2. Owned by ingestion + migrations + watermark UPDATEs.
 *   Uses DATABASE_URL (bountymesh role, full read/write).
 * readerPool — max 10. Passed to PostGraphile only. Uses DATABASE_URL_READER
 *   (bountymesh_readonly role, SELECT only). The role is created by
 *   docker/init.sql at first postgres boot.
 *
 * Lifecycle:
 *   - createWriterPool: Boot Stage 1 (before migrations).
 *   - createReaderPool: Boot Stage 6 (right before PostGraphile starts).
 *   - end(): orchestrated by lifecycle/shutdown.ts in the locked teardown
 *     order — readerPool ends BEFORE chainApi.disconnect; writerPool ends
 *     LAST so in-flight dispatch txns can drain.
 *
 * Hardening (P7 Phase 1):
 *   - statement_timeout=30s: caps any single GraphQL query from eating the
 *     connection pool. Set via `options` connection parameter — applied
 *     per-connection at handshake so it survives pool recycling.
 *   - SSL: required against Railway's managed Postgres in production.
 *     `rejectUnauthorized: false` because Railway proxies through their
 *     own cert chain; the proxy itself terminates TLS to upstream PG.
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

export function createWriterPool(config: IndexerConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
    ssl: poolSsl(config.databaseUrl),
    options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  });
}

export function createReaderPool(config: IndexerConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrlReader,
    max: 10,
    ssl: poolSsl(config.databaseUrlReader),
    options: `-c statement_timeout=${STATEMENT_TIMEOUT_MS}`,
  });
}
