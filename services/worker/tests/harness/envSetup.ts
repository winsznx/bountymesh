/**
 * process.env snapshot + restore for integration tests that need to set
 * worker env vars without leaking into the parent shell / other tests.
 */

export const WORKER_ENV_VARS = [
  'VARA_RPC_URL',
  'BOUNTYMESH_PROGRAM_ID',
  'INDEXER_BASE_URL',
  'WORKER_TRACK',
  'WORKER_MIN_REWARD_ATOMIC',
  'INDEXER_MAX_LAG_BLOCKS',
  'WORKER_KEYSTORE_PATH',
  'WORKER_ADAPTER',
  'GROQ_API_KEY',
  'GROQ_MODEL',
  'GROQ_BASE_URL',
  'WORKER_STATE_PATH',
  'WORKER_HISTORY_PATH',
  'WORKER_RESUME_TTL_MS',
  'LOG_LEVEL',
  'BOUNTYMESH_WORKER_SEED',
] as const;

export type WorkerEnvVar = (typeof WORKER_ENV_VARS)[number];
export type EnvSnapshot = Map<WorkerEnvVar, string | undefined>;

export function snapshotEnv(): EnvSnapshot {
  const m = new Map<WorkerEnvVar, string | undefined>();
  for (const v of WORKER_ENV_VARS) m.set(v, process.env[v]);
  return m;
}

export function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [k, v] of snapshot) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/**
 * Clear all worker env vars, then set the requested subset. Used to make
 * each test's boot env independent of any prior test's state.
 */
export function setBootEnv(vars: Partial<Record<WorkerEnvVar, string>>): void {
  for (const v of WORKER_ENV_VARS) delete process.env[v];
  for (const [k, v] of Object.entries(vars)) {
    if (v !== undefined) process.env[k] = v;
  }
}
