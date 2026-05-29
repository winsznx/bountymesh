/**
 * Phase 3 indexer entry point.
 *
 * Boot sequence per D4:
 *   Stage 0: load config, validate env, install signal handlers
 *   Stage 1: connect Postgres (writer pool), run migrations, GRANT to pg_readonly
 *   Stage 2: read indexer_state singleton, assert boot-block availability
 *   Stage 3: connect chain (GearApi), wait for api.isReady, wire reconnect handler
 *   Stage 4: backfill (start_block | last_finalized_block + 1, currentFinalizedHead]
 *   Stage 5: open SDK subscriptions + finalized-heads listener
 *   Stage 6: connect Postgres (reader pool), start PostGraphile + /health HTTP server
 *
 * All stages awaited in order. PostGraphile boots LAST so it never introspects
 * a half-migrated schema. mode flag (D3) gates which stages 5/6 run.
 */

import { loadConfig } from './config.js';
import { createLogger } from './log/pino.js';
import { boot } from './lifecycle/boot.js';
import { installShutdownHandlers } from './lifecycle/shutdown.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info({ op: 'boot', mode: config.mode, programId: config.programId }, 'indexer starting');

  const controller = await boot(config, logger);
  installShutdownHandlers(controller, logger);

  await controller.runUntilShutdown();

  logger.info({ op: 'shutdown' }, 'indexer exited cleanly');
}

main().catch((err: unknown) => {
  const stack = err instanceof Error ? err.stack : undefined;
  // eslint-disable-next-line no-console -- logger may not be initialized yet
  console.error(
    JSON.stringify({ level: 'fatal', op: 'boot', err: String(err), stack }),
  );
  process.exit(1);
});
