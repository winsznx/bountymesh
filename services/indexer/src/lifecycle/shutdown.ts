/**
 * Signal handlers (SIGTERM, SIGINT) — Step 5f.
 *
 * On first signal: trigger controller.shutdown(); after it resolves, process.exit(0).
 * On second signal during shutdown: process.exit(1) (force kill).
 *
 * controller.shutdown() owns the actual teardown sequence (see lifecycle/boot.ts).
 * This module is the thin wrapper that translates OS signals into shutdown calls.
 */

import type { Logger } from 'pino';
import type { IndexerController } from './boot.js';

const SIGNALS = ['SIGTERM', 'SIGINT'] as const;

export function installShutdownHandlers(controller: IndexerController, logger: Logger): void {
  let shutdownStarted = false;

  for (const sig of SIGNALS) {
    process.on(sig, () => {
      if (shutdownStarted) {
        logger.warn({ op: 'shutdown', signal: sig }, 'second signal received; force exit');
        process.exit(1);
      }
      shutdownStarted = true;
      logger.info({ op: 'shutdown', signal: sig }, 'received signal; beginning graceful shutdown');
      controller
        .shutdown()
        .then(() => {
          logger.info({ op: 'shutdown' }, 'graceful shutdown complete');
          process.exit(0);
        })
        .catch((err: unknown) => {
          logger.error({ op: 'shutdown', err: String(err) }, 'shutdown failed');
          process.exit(1);
        });
    });
  }
}
