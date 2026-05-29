import { spawn, type ChildProcess } from 'node:child_process';
// Node 22+ ships a global WebSocket implementation; we use it for the readiness probe
// to avoid pulling in the `ws` package as a direct dep.

/**
 * Local Vara dev-node harness.
 *
 * Detects an already-running node on ws://127.0.0.1:9944 and reuses it
 * (so an operator-launched `gear --dev` is honored). Otherwise spawns
 * `gear --dev --tmp` as a child process and waits for the WS port to
 * accept connections.
 *
 * --tmp ensures ephemeral storage — no pollution of ~/.local/share/gear
 * between test runs.
 *
 * stop() is a no-op if we reused an existing node; we never kill a node
 * we didn't start.
 */

const WS_URL = 'ws://127.0.0.1:9944';
const PROBE_TIMEOUT_MS = 2_000;
const SPAWN_READY_TIMEOUT_MS = 30_000;

export interface LocalNodeHandle {
  reused: boolean;
  stop: () => Promise<void>;
}

export async function isNodeReachable(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };

    let ws: WebSocket;
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      settle(false);
      return;
    }

    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      settle(false);
    }, timeoutMs);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      settle(true);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      settle(false);
    });
  });
}

export async function startLocalNode(): Promise<LocalNodeHandle> {
  if (await isNodeReachable()) {
    console.log('[harness] reusing existing local node at ' + WS_URL);
    return { reused: true, stop: async () => {} };
  }

  console.log('[harness] spawning `gear --dev --tmp`…');
  const child: ChildProcess = spawn('gear', ['--dev', '--tmp'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  child.on('error', (err) => {
    console.error('[harness] failed to spawn gear:', err.message);
  });

  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`gear node exited before WS came up (code ${child.exitCode})`);
    }
    if (await isNodeReachable(500)) {
      console.log('[harness] local node ready at ' + WS_URL);
      return {
        reused: false,
        stop: async () => {
          if (child.exitCode === null) {
            child.kill('SIGTERM');
            await new Promise<void>((resolve) => {
              const t = setTimeout(() => {
                child.kill('SIGKILL');
                resolve();
              }, 5_000);
              child.once('exit', () => {
                clearTimeout(t);
                resolve();
              });
            });
          }
        },
      };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  child.kill('SIGTERM');
  throw new Error(`gear node did not open WS on ${WS_URL} within ${SPAWN_READY_TIMEOUT_MS}ms`);
}

export { WS_URL };
