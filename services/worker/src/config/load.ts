/**
 * loadConfig — single env-reading orchestrator.
 *
 * Aggregates ALL validation errors before throwing — operator sees the full
 * list at boot, not one-at-a-time across restarts. Defaults are applied for
 * optional vars BEFORE validator runs (so the default value is itself
 * validated; catches dev-time typos in the default constants).
 */

import { resolve } from 'node:path';
import {
  ALLOWED_ADAPTERS,
  ALLOWED_LOG_LEVELS,
  ALLOWED_TRACKS,
  ConfigError,
  type WorkerConfig,
} from './schema.js';
import {
  validateBigInt,
  validateEnum,
  validateHex,
  validateNumber,
  validateUrl,
  type ConfigVarError,
  type ValidatorResult,
} from './validators.js';

const DEFAULT_INDEXER_MAX_LAG_BLOCKS = 100;
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_RESUME_TTL_MS = 6 * 60 * 60 * 1000; // 6h
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_ADAPTER = 'groq';

function take<T>(result: ValidatorResult<T>, errors: ConfigVarError[]): T | undefined {
  if (result.ok) return result.value;
  errors.push(result.error);
  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const errors: ConfigVarError[] = [];

  // ----- Required (no defaults) -----
  const varaRpcUrl = take(
    validateUrl('VARA_RPC_URL', env.VARA_RPC_URL, ['ws:', 'wss:']),
    errors,
  );
  const bountymeshProgramId = take(
    validateHex('BOUNTYMESH_PROGRAM_ID', env.BOUNTYMESH_PROGRAM_ID, 32),
    errors,
  );
  const indexerBaseUrl = take(
    validateUrl('INDEXER_BASE_URL', env.INDEXER_BASE_URL, ['http:', 'https:']),
    errors,
  );
  const workerTrack = take(
    validateEnum('WORKER_TRACK', env.WORKER_TRACK, ALLOWED_TRACKS),
    errors,
  );
  const workerMinReward = take(
    validateBigInt('WORKER_MIN_REWARD_ATOMIC', env.WORKER_MIN_REWARD_ATOMIC, { min: 0n }),
    errors,
  );

  // ----- Optional with defaults (default also validated) -----
  const indexerHealthMaxLagBlocks = take(
    validateNumber(
      'INDEXER_MAX_LAG_BLOCKS',
      env.INDEXER_MAX_LAG_BLOCKS ?? String(DEFAULT_INDEXER_MAX_LAG_BLOCKS),
      { min: 1 },
    ),
    errors,
  );
  const adapter = take(
    validateEnum('WORKER_ADAPTER', env.WORKER_ADAPTER ?? DEFAULT_ADAPTER, ALLOWED_ADAPTERS),
    errors,
  );
  const logLevel = take(
    validateEnum('LOG_LEVEL', env.LOG_LEVEL ?? DEFAULT_LOG_LEVEL, ALLOWED_LOG_LEVELS),
    errors,
  );
  const workerResumeTtlMs = take(
    validateNumber(
      'WORKER_RESUME_TTL_MS',
      env.WORKER_RESUME_TTL_MS ?? String(DEFAULT_RESUME_TTL_MS),
      { min: 1000 },
    ),
    errors,
  );

  // ----- Pass-through (presence-only; no syntactic validation) -----
  const groqModel = env.GROQ_MODEL ?? DEFAULT_GROQ_MODEL;
  const keystorePath = env.WORKER_KEYSTORE_PATH ?? null;
  const workerStatePath = env.WORKER_STATE_PATH ?? resolve(process.cwd(), 'worker.state.json');
  const workerHistoryPath =
    env.WORKER_HISTORY_PATH ?? resolve(process.cwd(), 'worker.history.jsonl');

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  // Invariant: errors.length === 0 above means every take() returned ok.
  // TS can't narrow this dependency, hence the non-null assertions.
  return {
    varaRpcUrl: varaRpcUrl!,
    bountymeshProgramId: bountymeshProgramId!,
    indexerBaseUrl: indexerBaseUrl!,
    indexerHealthMaxLagBlocks: indexerHealthMaxLagBlocks!,
    keystorePath,
    adapter: adapter!,
    groqModel,
    workerTrack: workerTrack!,
    workerMinReward: workerMinReward!,
    workerStatePath,
    workerHistoryPath,
    workerResumeTtlMs: workerResumeTtlMs!,
    logLevel: logLevel!,
  };
}
