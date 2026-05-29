/**
 * Postgres lifecycle for worker integration tests — minimal.
 *
 * Just `docker compose up/down` against the indexer's compose file. The
 * indexer subprocess (spawned next by indexerSubprocess.ts) handles its
 * own migrations + indexer_state seeding at boot Stage 1, so this harness
 * deliberately does NOT depend on Drizzle or the indexer's schema.
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEXER_DIR = resolve(WORKER_DIR, '..', 'indexer');

export const DEFAULT_WRITER_URL = 'postgres://bountymesh:bountymesh@localhost:5432/bountymesh';

const PG_READY_TIMEOUT_MS = 30_000;

function runCompose(args: string): void {
  execSync(`docker compose ${args}`, {
    cwd: INDEXER_DIR,
    stdio: 'inherit',
  });
}

async function waitForPgPort(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolveFn) => {
      const sock = createConnection({ host: '127.0.0.1', port: 5432 }, () => {
        sock.end();
        resolveFn(true);
      });
      sock.on('error', () => resolveFn(false));
      sock.setTimeout(1000, () => {
        sock.destroy();
        resolveFn(false);
      });
    });
    if (ok) {
      // pg may accept TCP before it's ready for queries; small grace.
      await new Promise((r) => setTimeout(r, 1500));
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Postgres TCP did not open on :5432 within ${timeoutMs}ms`);
}

export interface PostgresHandle {
  writerUrl: string;
  stop: () => Promise<void>;
}

export async function startPostgres(): Promise<PostgresHandle> {
  console.log('[worker/harness/postgres] tearing down any previous state…');
  try {
    runCompose('down -v');
  } catch {
    /* may not be running yet */
  }
  console.log('[worker/harness/postgres] starting postgres container…');
  runCompose('up -d postgres');
  console.log('[worker/harness/postgres] waiting for pg port…');
  await waitForPgPort(PG_READY_TIMEOUT_MS);
  console.log('[worker/harness/postgres] ready');
  return {
    writerUrl: DEFAULT_WRITER_URL,
    stop: async () => {
      runCompose('down -v');
    },
  };
}
