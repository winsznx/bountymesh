/**
 * Spawn the indexer as a subprocess for worker integration tests.
 *
 * Assumes `make indexer-build` has already produced services/indexer/dist/.
 * The indexer's own boot orchestrator handles migrations + indexer_state
 * seeding at Stage 1, so this harness only manages process lifecycle +
 * /health readiness.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEXER_DIR = resolve(WORKER_DIR, '..', 'indexer');
const INDEXER_ENTRY = resolve(INDEXER_DIR, 'dist', 'main.js');

const HEALTH_READY_TIMEOUT_MS = 60_000;

export interface IndexerSubprocessOptions {
  programId: `0x${string}`;
  varaRpcUrl: string;
  databaseUrl: string;
  startBlock: number;
  apiPort?: number;
}

export interface IndexerSubprocessHandle {
  baseUrl: string;
  apiPort: number;
  stop: () => Promise<void>;
}

async function fetchHealth(baseUrl: string): Promise<{ ok: boolean; body?: Record<string, unknown> }> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as Record<string, unknown>;
    return { ok: true, body };
  } catch {
    return { ok: false };
  }
}

async function waitForIndexerLive(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastBody: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const { ok, body } = await fetchHealth(baseUrl);
    if (ok && body) {
      lastBody = body;
      if (body.status === 'ok' && body.mode === 'live') {
        return;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `Indexer /health did not reach status=ok mode=live within ${timeoutMs}ms; last body: ${JSON.stringify(lastBody)}`,
  );
}

export async function startIndexerSubprocess(
  opts: IndexerSubprocessOptions,
): Promise<IndexerSubprocessHandle> {
  try {
    statSync(INDEXER_ENTRY);
  } catch {
    throw new Error(
      `indexer dist not found at ${INDEXER_ENTRY} — run 'make indexer-build' before worker integration tests`,
    );
  }

  const apiPort = opts.apiPort ?? 4351;
  const baseUrl = `http://127.0.0.1:${apiPort}`;

  console.log(`[worker/harness/indexer] spawning indexer subprocess on ${baseUrl}…`);
  const child: ChildProcess = spawn('node', [INDEXER_ENTRY], {
    cwd: INDEXER_DIR,
    env: {
      ...process.env,
      BOUNTYMESH_PROGRAM_ID: opts.programId,
      VARA_RPC_URL: opts.varaRpcUrl,
      DATABASE_URL: opts.databaseUrl,
      BOUNTYMESH_START_BLOCK: String(opts.startBlock),
      API_PORT: String(apiPort),
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Stream indexer logs to stderr (prefixed) for diagnostics on failure.
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[indexer:stdout] ${chunk}`);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[indexer:stderr] ${chunk}`);
  });

  child.on('error', (err) => {
    console.error('[worker/harness/indexer] subprocess spawn error:', err.message);
  });

  try {
    await waitForIndexerLive(baseUrl, HEALTH_READY_TIMEOUT_MS);
  } catch (err) {
    // Failed to come up — tear down the child before re-throwing.
    if (child.exitCode === null) child.kill('SIGTERM');
    throw err;
  }

  console.log(`[worker/harness/indexer] ready at ${baseUrl}`);

  return {
    baseUrl,
    apiPort,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await new Promise<void>((resolveFn) => {
          const t = setTimeout(() => {
            child.kill('SIGKILL');
            resolveFn();
          }, 5_000);
          child.once('exit', () => {
            clearTimeout(t);
            resolveFn();
          });
        });
      }
    },
  };
}
