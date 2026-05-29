/**
 * Environment validation + fail-fast guarantees.
 *
 * Boot Stage 0 (D4). Concern A: BOUNTYMESH_START_BLOCK is REQUIRED on first-ever boot
 * (when indexer_state is empty). Warm restart with state present can skip it — state
 * takes priority.
 */

export type IndexerMode = 'processor' | 'serve' | 'all';

export interface IndexerConfig {
  databaseUrl: string;
  databaseUrlReader: string;
  vararRpcUrl: string;
  programId: `0x${string}`;
  startBlock: number | null;
  apiPort: number;
  apiCorsOrigin: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';
  mode: IndexerMode;
  backfillBatchSize: number;
  finalityCheckIntervalMs: number;
}

class ConfigError extends Error {
  constructor(message: string) {
    super(`[config] ${message}`);
    this.name = 'ConfigError';
  }
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new ConfigError(`required env var missing or empty: ${name}`);
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name]?.trim() || fallback;
}

function asNumber(name: string, value: string, min = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new ConfigError(`${name} must be an integer >= ${min}, got: ${value}`);
  }
  return n;
}

function asHexProgramId(name: string, value: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ConfigError(`${name} must be a 0x-prefixed 32-byte hex string`);
  }
  return value as `0x${string}`;
}

function asMode(value: string): IndexerMode {
  if (value === 'processor' || value === 'serve' || value === 'all') return value;
  throw new ConfigError(`INDEXER_MODE must be one of processor|serve|all, got: ${value}`);
}

/**
 * Load + validate. Does NOT touch the database — Stage 2 in boot.ts cross-checks
 * the optional `startBlock` against indexer_state and fails there if both are absent.
 */
export function loadConfig(): IndexerConfig {
  const startBlockRaw = process.env.BOUNTYMESH_START_BLOCK?.trim();
  const startBlock =
    startBlockRaw && startBlockRaw !== ''
      ? asNumber('BOUNTYMESH_START_BLOCK', startBlockRaw, 0)
      : null;

  return {
    databaseUrl: optional(
      'DATABASE_URL',
      'postgres://bountymesh:bountymesh@localhost:5432/bountymesh',
    ),
    databaseUrlReader: optional(
      'DATABASE_URL_READER',
      'postgres://bountymesh_readonly:readonly@localhost:5432/bountymesh',
    ),
    vararRpcUrl: optional('VARA_RPC_URL', 'ws://localhost:9944'),
    programId: asHexProgramId('BOUNTYMESH_PROGRAM_ID', required('BOUNTYMESH_PROGRAM_ID')),
    startBlock,
    apiPort: asNumber('API_PORT', optional('API_PORT', '4350'), 1),
    apiCorsOrigin: optional('API_CORS_ORIGIN', '*'),
    logLevel: optional('LOG_LEVEL', 'info') as IndexerConfig['logLevel'],
    mode: asMode(optional('INDEXER_MODE', 'all')),
    backfillBatchSize: asNumber('BACKFILL_BATCH_SIZE', optional('BACKFILL_BATCH_SIZE', '50'), 1),
    finalityCheckIntervalMs: asNumber(
      'FINALITY_CHECK_INTERVAL_MS',
      optional('FINALITY_CHECK_INTERVAL_MS', '6000'),
      100,
    ),
  };
}

/**
 * Cross-check resolved at Stage 2 — startBlock must be present in config OR
 * last_finalized_block must already exist in indexer_state. Concern A.
 */
export function assertBootBlockAvailable(
  config: IndexerConfig,
  stateRow: { lastFinalizedBlock: number } | null,
): void {
  if (stateRow === null && config.startBlock === null) {
    throw new ConfigError(
      'first-ever boot requires BOUNTYMESH_START_BLOCK env var (program deploy block). ' +
        'No indexer_state row found; cannot resume from watermark.',
    );
  }
}
