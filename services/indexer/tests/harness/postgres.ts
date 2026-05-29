/**
 * Postgres lifecycle for integration tests (D9 — docker-compose down -v + up).
 *
 * - startPostgres(): clean slate. `docker compose down -v && up -d postgres`,
 *   poll pg_isready until healthy or timeout.
 * - runMigrationsIn(): apply Drizzle migrations against the freshly-booted db.
 * - initIndexerState(): seed the singleton indexer_state row so dispatch.ts's
 *   watermark UPDATE has a row to advance. In production this is Boot Stage 2;
 *   in tests it's a one-shot helper.
 * - stopPostgres(): `docker compose down -v` (volume wiped).
 *
 * Each integration test file owns its postgres lifecycle.
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import { runMigrations } from '../../src/db/migrate.js';
import { indexerState } from '../../src/schema.js';

const INDEXER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DEFAULT_WRITER_URL = 'postgres://bountymesh:bountymesh@localhost:5432/bountymesh';
export const DEFAULT_READER_URL = 'postgres://bountymesh_readonly:readonly@localhost:5432/bountymesh';

const PG_READY_TIMEOUT_MS = 30_000;

function runCompose(args: string): void {
  execSync(`docker compose ${args}`, {
    cwd: INDEXER_DIR,
    stdio: 'inherit',
  });
}

async function waitForPgReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      try {
        await client.end();
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `Postgres did not become ready within ${timeoutMs}ms; last error: ${String(lastError)}`,
  );
}

export interface PostgresHandle {
  writerUrl: string;
  readerUrl: string;
  stop: () => Promise<void>;
}

export async function startPostgres(): Promise<PostgresHandle> {
  console.log('[harness/postgres] tearing down any previous state…');
  try {
    runCompose('down -v');
  } catch {
    /* may not be running yet — ignore */
  }
  console.log('[harness/postgres] starting postgres container…');
  runCompose('up -d postgres');
  console.log('[harness/postgres] waiting for pg_isready…');
  await waitForPgReady(DEFAULT_WRITER_URL, PG_READY_TIMEOUT_MS);
  console.log('[harness/postgres] applying migrations…');
  await runMigrations({ databaseUrl: DEFAULT_WRITER_URL });
  console.log('[harness/postgres] ready');
  return {
    writerUrl: DEFAULT_WRITER_URL,
    readerUrl: DEFAULT_READER_URL,
    stop: async () => {
      runCompose('down -v');
    },
  };
}

export async function initIndexerState(
  writerUrl: string,
  programId: `0x${string}`,
  startBlock: number,
): Promise<void> {
  const pool = new pg.Pool({ connectionString: writerUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await db
      .insert(indexerState)
      .values({
        id: 1,
        programId,
        startBlock,
        lastFinalizedBlock: startBlock,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: indexerState.id,
        set: {
          programId,
          startBlock,
          lastFinalizedBlock: sql`GREATEST(${indexerState.lastFinalizedBlock}, ${startBlock})`,
          updatedAt: new Date(),
        },
      });
  } finally {
    await pool.end();
  }
}

export async function readIndexerStateWatermark(writerUrl: string): Promise<number | null> {
  const pool = new pg.Pool({ connectionString: writerUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const rows = await db
      .select({ lastFinalizedBlock: indexerState.lastFinalizedBlock })
      .from(indexerState)
      .where(eq(indexerState.id, 1));
    return rows[0]?.lastFinalizedBlock ?? null;
  } finally {
    await pool.end();
  }
}
