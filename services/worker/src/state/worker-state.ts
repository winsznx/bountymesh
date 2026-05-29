/**
 * WorkerStateFile — durable singleton for the Main-FSM inflight slot,
 * last-processed-block watermark, and Pending-Accept Monitor handoff list.
 *
 * Boot: load() reads worker.state.json (creates default state in memory
 * if file is missing). Mutations write atomically via tmp+fsync+rename.
 *
 * Concurrency: in-process chained-promise write lock serializes mutations.
 * The state file is a singleton per worker process; this lock prevents
 * concurrent FSM transitions from interleaving partial writes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteJson } from './atomic-write.js';
import {
  DEFAULT_WORKER_STATE,
  WORKER_STATE_VERSION,
  type PendingAcceptEntry,
  type WorkerState,
} from './types.js';

export class WorkerStateVersionMismatchError extends Error {
  readonly fileVersion: number;
  readonly expectedVersion: number;
  constructor(fileVersion: number, expectedVersion: number) {
    super(
      `worker.state.json version mismatch: file=${fileVersion}, expected=${expectedVersion}`,
    );
    this.name = 'WorkerStateVersionMismatchError';
    this.fileVersion = fileVersion;
    this.expectedVersion = expectedVersion;
  }
}

export class WorkerStateNotLoadedError extends Error {
  constructor(method: string) {
    super(`WorkerStateFile.load() must be called before ${method}()`);
    this.name = 'WorkerStateNotLoadedError';
  }
}

export class WorkerStateFile {
  private readonly path: string;
  private state: WorkerState | null = null;
  private writeLock: Promise<void> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  load(): WorkerState {
    if (!existsSync(this.path)) {
      this.state = { ...DEFAULT_WORKER_STATE, pending_accept: [] };
      return this.state;
    }
    const raw = readFileSync(this.path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    this.state = validateWorkerState(parsed);
    return this.state;
  }

  current(): WorkerState {
    if (!this.state) throw new WorkerStateNotLoadedError('current');
    return this.state;
  }

  async setInflight(id: bigint): Promise<void> {
    if (!this.state) throw new WorkerStateNotLoadedError('setInflight');
    await this.writeAtomically({ ...this.state, inflight: id.toString() });
  }

  async clearInflight(): Promise<void> {
    if (!this.state) throw new WorkerStateNotLoadedError('clearInflight');
    await this.writeAtomically({ ...this.state, inflight: null });
  }

  async setLastProcessedBlock(block: number): Promise<void> {
    if (!this.state) throw new WorkerStateNotLoadedError('setLastProcessedBlock');
    await this.writeAtomically({ ...this.state, last_processed_block: block });
  }

  async addPendingAccept(entry: PendingAcceptEntry): Promise<void> {
    if (!this.state) throw new WorkerStateNotLoadedError('addPendingAccept');
    await this.writeAtomically({
      ...this.state,
      pending_accept: [...this.state.pending_accept, entry],
    });
  }

  async clearPendingAccept(id: bigint): Promise<void> {
    if (!this.state) throw new WorkerStateNotLoadedError('clearPendingAccept');
    const idStr = id.toString();
    await this.writeAtomically({
      ...this.state,
      pending_accept: this.state.pending_accept.filter((e) => e.id !== idStr),
    });
  }

  getPendingAccepts(): readonly PendingAcceptEntry[] {
    if (!this.state) throw new WorkerStateNotLoadedError('getPendingAccepts');
    return this.state.pending_accept;
  }

  /**
   * Drain the in-flight writeLock chain. Used by ShutdownSequence to ensure
   * any pending atomic-write completes before the process exits.
   */
  async flush(): Promise<void> {
    await this.writeLock;
  }

  private async writeAtomically(next: WorkerState): Promise<void> {
    const prev = this.writeLock;
    let release: () => void = () => undefined;
    this.writeLock = new Promise((r) => {
      release = r;
    });
    try {
      await prev;
      atomicWriteJson(this.path, next);
      this.state = next;
    } finally {
      release();
    }
  }
}

function validatePendingAcceptEntry(x: unknown): PendingAcceptEntry | null {
  if (!x || typeof x !== 'object') return null;
  const e = x as Record<string, unknown>;
  if (typeof e.id !== 'string') return null;
  if (typeof e.submit_tx_hash !== 'string') return null;
  if (typeof e.submit_block_number !== 'number') return null;
  if (typeof e.envelope_sha256 !== 'string') return null;
  if (typeof e.added_at !== 'string') return null;
  return {
    id: e.id,
    submit_tx_hash: e.submit_tx_hash as `0x${string}`,
    submit_block_number: e.submit_block_number,
    envelope_sha256: e.envelope_sha256 as `0x${string}`,
    added_at: e.added_at,
  };
}

function validateWorkerState(obj: unknown): WorkerState {
  if (!obj || typeof obj !== 'object') {
    throw new Error('worker.state.json: not an object');
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.version !== 'number') {
    throw new Error('worker.state.json: missing or invalid version');
  }
  if (o.version !== WORKER_STATE_VERSION) {
    throw new WorkerStateVersionMismatchError(o.version, WORKER_STATE_VERSION);
  }
  // Defensive: malformed pending_accept entries are filtered out rather
  // than causing a hard error — partial corruption shouldn't block boot.
  const pendingRaw = Array.isArray(o.pending_accept) ? (o.pending_accept as unknown[]) : [];
  const pending = pendingRaw
    .map(validatePendingAcceptEntry)
    .filter((e): e is PendingAcceptEntry => e !== null);
  return {
    version: o.version,
    inflight: typeof o.inflight === 'string' ? o.inflight : null,
    last_processed_block:
      typeof o.last_processed_block === 'number' ? o.last_processed_block : 0,
    pending_accept: pending,
  };
}
