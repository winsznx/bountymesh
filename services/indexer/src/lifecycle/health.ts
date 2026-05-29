/**
 * /health response builder + in-memory HealthState.
 *
 * Consumer-facing for monitoring (Railway health probes, manual ops checks).
 * DO NOT reshape without coordinating with whoever depends on this.
 *
 * status derivation:
 *   'ok'        — db=ok AND chain=connected AND parseErrors1h=0 AND lagFromHead<10
 *   'degraded'  — db=ok AND chain=connected but parseErrors1h>0 OR lagFromHead>=10
 *   'error'     — db=err OR chain=disconnected
 *
 * DB ping cache: 5s TTL. Cache miss runs SELECT 1 with 1s timeout. Failure
 * caches 'err' for 5s so we don't hammer a hung Postgres.
 */

import type pg from 'pg';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getParseErrorCount1h } from '../ingest/errors.js';

export type IndexerMode = 'backfilling' | 'catching-up' | 'live';
export type ChainStatus = 'connected' | 'reconnecting' | 'disconnected';
export type DbStatus = 'ok' | 'err';
export type OverallStatus = 'ok' | 'degraded' | 'error';

export interface HealthResponse {
  status: OverallStatus;
  db: DbStatus;
  chain: ChainStatus;
  mode: IndexerMode;
  lastFinalizedBlock: number;
  headBlock: number;
  lagFromHead: number;
  wsReconnects1h: number;
  parseErrors1h: number;
  uptime: string; // HH:MM:SS
}

const DB_PING_CACHE_MS = 5_000;
const DB_PING_TIMEOUT_MS = 1_000;
const RECONNECT_WINDOW_MS = 60 * 60 * 1_000; // 1 hour
const LAG_DEGRADED_THRESHOLD = 10;

export class HealthState {
  private mode: IndexerMode = 'backfilling';
  private chainStatus: ChainStatus = 'disconnected';
  private lastFinalizedBlock = 0;
  private headBlock = 0;
  private wsReconnectTimestamps: number[] = [];
  private startTime: number = Date.now();
  private dbPingCache: { result: DbStatus; expiresAt: number } | null = null;

  setMode(mode: IndexerMode): void {
    this.mode = mode;
  }

  getMode(): IndexerMode {
    return this.mode;
  }

  setChainStatus(status: ChainStatus): void {
    this.chainStatus = status;
  }

  recordWsReconnect(): void {
    this.wsReconnectTimestamps.push(Date.now());
    this.pruneReconnects();
  }

  setLastFinalizedBlock(n: number): void {
    if (n > this.lastFinalizedBlock) this.lastFinalizedBlock = n;
  }

  setHeadBlock(n: number): void {
    if (n > this.headBlock) this.headBlock = n;
  }

  private pruneReconnects(): void {
    const cutoff = Date.now() - RECONNECT_WINDOW_MS;
    this.wsReconnectTimestamps = this.wsReconnectTimestamps.filter((t) => t >= cutoff);
  }

  getWsReconnects1h(): number {
    this.pruneReconnects();
    return this.wsReconnectTimestamps.length;
  }

  getUptimeString(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1_000);
    const hh = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const mm = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const ss = (seconds % 60).toString().padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  async pingDb(writerPool: pg.Pool): Promise<DbStatus> {
    const now = Date.now();
    if (this.dbPingCache && this.dbPingCache.expiresAt > now) {
      return this.dbPingCache.result;
    }
    const result = await pingWithTimeout(writerPool, DB_PING_TIMEOUT_MS);
    this.dbPingCache = { result, expiresAt: now + DB_PING_CACHE_MS };
    return result;
  }

  getChainStatus(): ChainStatus {
    return this.chainStatus;
  }

  getLastFinalizedBlock(): number {
    return this.lastFinalizedBlock;
  }

  getHeadBlock(): number {
    return this.headBlock;
  }
}

async function pingWithTimeout(pool: pg.Pool, timeoutMs: number): Promise<DbStatus> {
  return new Promise<DbStatus>((resolve) => {
    const timer = setTimeout(() => resolve('err'), timeoutMs);
    pool
      .query('SELECT 1')
      .then(() => {
        clearTimeout(timer);
        resolve('ok');
      })
      .catch(() => {
        clearTimeout(timer);
        resolve('err');
      });
  });
}

function deriveStatus(
  db: DbStatus,
  chain: ChainStatus,
  parseErrors1h: number,
  lagFromHead: number,
): OverallStatus {
  if (db === 'err' || chain === 'disconnected') return 'error';
  if (parseErrors1h > 0 || lagFromHead >= LAG_DEGRADED_THRESHOLD) return 'degraded';
  return 'ok';
}

export interface BuildHealthDeps {
  state: HealthState;
  writerPool: pg.Pool;
  /** Drizzle wrapper used to query parse_errors count. Reuse writerPool by passing the same instance via drizzle(writerPool). */
  db: NodePgDatabase;
}

export async function buildHealthResponse(deps: BuildHealthDeps): Promise<HealthResponse> {
  const { state, writerPool, db } = deps;
  const [dbStatus, parseErrors1h] = await Promise.all([
    state.pingDb(writerPool),
    dbStatus_or_zero(db, state),
  ]);
  const lastFinalizedBlock = state.getLastFinalizedBlock();
  const headBlock = Math.max(state.getHeadBlock(), lastFinalizedBlock);
  const lagFromHead = Math.max(0, headBlock - lastFinalizedBlock);
  const status = deriveStatus(dbStatus, state.getChainStatus(), parseErrors1h, lagFromHead);
  return {
    status,
    db: dbStatus,
    chain: state.getChainStatus(),
    mode: state.getMode(),
    lastFinalizedBlock,
    headBlock,
    lagFromHead,
    wsReconnects1h: state.getWsReconnects1h(),
    parseErrors1h,
    uptime: state.getUptimeString(),
  };
}

/** Query parse_errors count; fall back to 0 if the query fails (db is also separately probed). */
async function dbStatus_or_zero(db: NodePgDatabase, _state: HealthState): Promise<number> {
  try {
    return await getParseErrorCount1h(db);
  } catch {
    return 0;
  }
}
