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
 */

import pg from 'pg';
import type { IndexerConfig } from '../config.js';

export function createWriterPool(config: IndexerConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrl,
    max: 2,
  });
}

export function createReaderPool(config: IndexerConfig): pg.Pool {
  return new pg.Pool({
    connectionString: config.databaseUrlReader,
    max: 10,
  });
}
