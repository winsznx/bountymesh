/**
 * WorkerConfig — the typed config surface, plus ConfigError.
 *
 * Secrets that consumers read directly (NOT in WorkerConfig, to keep them
 * out of any logged config object):
 *   - BOUNTYMESH_WORKER_SEED   → src/signer/env.ts
 *   - GROQ_API_KEY             → adapter at construction time
 */

import type { ConfigVarError } from './validators.js';

export const ALLOWED_TRACKS = ['Services', 'Social', 'Economy', 'Open'] as const;
export type Track = (typeof ALLOWED_TRACKS)[number];

export const ALLOWED_ADAPTERS = ['groq'] as const;
export type Adapter = (typeof ALLOWED_ADAPTERS)[number];

export const ALLOWED_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof ALLOWED_LOG_LEVELS)[number];

export interface WorkerConfig {
  // chain
  varaRpcUrl: string;
  bountymeshProgramId: `0x${string}`;

  // indexer — single base URL; consumers derive /graphql and /health internally
  indexerBaseUrl: string;
  indexerHealthMaxLagBlocks: number;

  // signer paths (loadSigner reads the actual secret directly at boot)
  keystorePath: string | null;

  // adapter
  adapter: Adapter;
  groqModel: string;

  // runtime
  workerTrack: Track;
  workerMinReward: bigint;
  workerStatePath: string;
  workerHistoryPath: string;
  workerResumeTtlMs: number;

  // observability
  logLevel: LogLevel;
}

export class ConfigError extends Error {
  readonly errors: ConfigVarError[];

  constructor(errors: ConfigVarError[]) {
    const summary = errors.map((e) => `  - ${e.varName}[${e.code}]: ${e.detail}`).join('\n');
    super(`config load failed with ${errors.length} error(s):\n${summary}`);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}
