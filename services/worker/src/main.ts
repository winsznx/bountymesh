/**
 * Worker entry point.
 *
 * Boots every subsystem via the 7-stage orchestrator, installs SIGTERM/SIGINT
 * handlers (idempotent — second signal during shutdown is logged + ignored),
 * keepAlive interval, explicit process.exit(0) after shutdown completes (don't
 * trust event-loop drain — pino transports may keep handles open).
 */

import pino from 'pino';
import { boot } from './lifecycle/index.js';

async function main(): Promise<void> {
  const logger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  });

  logger.info({ op: 'boot', stage: 'pre-boot', msg: 'worker starting' });

  let handle: Awaited<ReturnType<typeof boot>>;
  try {
    handle = await boot({ logger });
  } catch (err) {
    logger.fatal(
      { op: 'boot', err: err instanceof Error ? err.message : String(err) },
      'boot failed; exiting',
    );
    process.exit(1);
  }

  // Keep-alive. Defensive across subsystem WS handles — setInterval guarantees
  // the loop stays alive between events.
  const keepAlive = setInterval(() => {
    /* heartbeat noop */
  }, 1 << 30);

  let shuttingDown = false;
  const onSignal = async (signal: 'SIGTERM' | 'SIGINT'): Promise<void> => {
    if (shuttingDown) {
      logger.info({
        op: 'shutdown',
        signal,
        msg: 'second signal received during shutdown; ignored',
      });
      return;
    }
    shuttingDown = true;
    logger.info({ op: 'shutdown', signal, msg: 'worker shutting down' });
    try {
      await handle.shutdown();
    } catch (err) {
      logger.error(
        { op: 'shutdown', err: err instanceof Error ? err.message : String(err) },
        'shutdown threw',
      );
    }
    clearInterval(keepAlive);
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void onSignal('SIGTERM');
  });
  process.on('SIGINT', () => {
    void onSignal('SIGINT');
  });
}

main().catch((err) => {
  // Unhandled error in main() — fall back to stderr since pino may not be wired.
  // eslint-disable-next-line no-console -- pre-boot fallback
  console.error('unhandled error in main:', err);
  process.exit(1);
});
