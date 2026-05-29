/**
 * pino logger factory.
 *
 * Controlled `op` vocabulary (concern #6):
 *   'boot' | 'migrate' | 'backfill_batch' | 'ingest_event' | 'commit_batch' |
 *   'parse_error' | 'ws_disconnect' | 'ws_reconnect' | 'project_skip' |
 *   'health_check' | 'shutdown'
 *
 * JSON output by default. transport: pino-pretty only when LOG_PRETTY=1
 * (dev convenience; production stays JSON for log aggregator ingestion).
 *
 * Step 5a scope: minimal signature so main.ts compiles. Full factory lands 5f.
 */

import pino, { type Logger } from 'pino';
import type { IndexerConfig } from '../config.js';

export function createLogger(level: IndexerConfig['logLevel']): Logger {
  return pino({ level });
}
