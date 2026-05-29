/**
 * Worker-as-subprocess harness for failure-mode integration tests (P3.10b).
 *
 * Spawns `node dist/main.js` with the given env, parses stdout pino-JSON
 * (one entry per newline; non-JSON lines silently skipped to tolerate any
 * pino-pretty leak), exposes:
 *   - .stdoutLog: in-order entries seen so far
 *   - .waitForLog(predicate, timeoutMs): retroactive + prospective match
 *   - .kill(signal): SIGKILL (abrupt crash) or SIGTERM (graceful) — resolves
 *                    when the process actually exits
 *
 * The worker process is independent: tests don't share node_modules state
 * with it. State files on disk are the only shared resource.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKER_ENTRY = resolve(WORKER_DIR, 'dist', 'main.js');

export interface PinoLogEntry {
  level?: number;
  time?: number;
  op?: string;
  [key: string]: unknown;
}

export interface WorkerSubprocess {
  readonly pid: number | undefined;
  readonly stdoutLog: readonly PinoLogEntry[];
  waitForLog(
    predicate: (entry: PinoLogEntry) => boolean,
    timeoutMs: number,
    label?: string,
  ): Promise<PinoLogEntry>;
  kill(signal: 'SIGKILL' | 'SIGTERM'): Promise<void>;
}

interface Waiter {
  predicate: (e: PinoLogEntry) => boolean;
  resolve: (e: PinoLogEntry) => void;
  reject: (err: Error) => void;
}

export function spawnWorker(env: Record<string, string>): WorkerSubprocess {
  try {
    statSync(WORKER_ENTRY);
  } catch {
    throw new Error(
      `worker dist not found at ${WORKER_ENTRY} — run 'make worker-build' before failure-mode tests`,
    );
  }

  const child: ChildProcess = spawn('node', [WORKER_ENTRY], {
    cwd: WORKER_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  const stdoutLog: PinoLogEntry[] = [];
  const waiters: Waiter[] = [];
  let stdoutBuffer = '';

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8');
    let nlIdx: number;
    while ((nlIdx = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, nlIdx);
      stdoutBuffer = stdoutBuffer.slice(nlIdx + 1);
      if (line.trim().length === 0) continue;
      try {
        const entry = JSON.parse(line) as PinoLogEntry;
        stdoutLog.push(entry);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].predicate(entry)) {
            waiters[i].resolve(entry);
            waiters.splice(i, 1);
          }
        }
      } catch {
        /* non-JSON line (pino-pretty / debug output / etc.) — skip */
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[worker:stderr] ${chunk}`);
  });

  child.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[workerSubprocess] spawn error:', err.message);
  });

  return {
    get pid(): number | undefined {
      return child.pid;
    },
    get stdoutLog(): readonly PinoLogEntry[] {
      return stdoutLog;
    },
    waitForLog: async (predicate, timeoutMs, label) => {
      // Retroactive match: scan existing entries first.
      for (const entry of stdoutLog) {
        if (predicate(entry)) return entry;
      }
      return new Promise<PinoLogEntry>((resolveFn, rejectFn) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.predicate === predicate);
          if (idx >= 0) waiters.splice(idx, 1);
          rejectFn(
            new Error(
              `workerSubprocess.waitForLog(${label ?? 'unlabeled'}) timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (e) => {
            clearTimeout(timer);
            resolveFn(e);
          },
          reject: (err) => {
            clearTimeout(timer);
            rejectFn(err);
          },
        });
      });
    },
    kill: async (signal) => {
      if (child.exitCode !== null) return;
      child.kill(signal);
      await new Promise<void>((resolveExit) => {
        const t = setTimeout(() => {
          // Force-kill if still alive after 10s.
          if (child.exitCode === null) child.kill('SIGKILL');
          resolveExit();
        }, 10_000);
        child.once('exit', () => {
          clearTimeout(t);
          resolveExit();
        });
      });
    },
  };
}
