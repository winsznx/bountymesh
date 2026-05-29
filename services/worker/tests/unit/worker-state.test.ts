import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import {
  WORKER_STATE_VERSION,
  type PendingAcceptEntry,
} from '../../src/state/types.js';
import {
  WorkerStateFile,
  WorkerStateVersionMismatchError,
} from '../../src/state/worker-state.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

function mkEntry(id: string, overrides: Partial<PendingAcceptEntry> = {}): PendingAcceptEntry {
  return {
    id,
    submit_tx_hash: `0x${'aa'.repeat(32)}`,
    submit_block_number: 100,
    envelope_sha256: `0x${'bb'.repeat(32)}`,
    added_at: '2026-05-19T12:00:00.000Z',
    ...overrides,
  };
}

describe('WorkerStateFile', () => {
  let tmpDir: string;
  let statePath: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  beforeEach(() => {
    statePath = join(tmpDir, `state-${Date.now()}-${Math.random()}.json`);
  });

  it('load() on missing file returns default state (inflight=null, pending_accept=[])', () => {
    const file = new WorkerStateFile(statePath);
    const s = file.load();
    assert.equal(s.version, WORKER_STATE_VERSION);
    assert.equal(s.inflight, null);
    assert.equal(s.last_processed_block, 0);
    assert.deepEqual(s.pending_accept, []);
  });

  it('setInflight + reload sees value persisted on disk', async () => {
    const a = new WorkerStateFile(statePath);
    a.load();
    await a.setInflight(42n);

    const b = new WorkerStateFile(statePath);
    const loaded = b.load();
    assert.equal(loaded.inflight, '42');
  });

  it('clearInflight + reload sees null', async () => {
    const a = new WorkerStateFile(statePath);
    a.load();
    await a.setInflight(99n);
    await a.clearInflight();

    const b = new WorkerStateFile(statePath);
    assert.equal(b.load().inflight, null);
  });

  it('addPendingAccept appends; clearPendingAccept removes by id; others remain', async () => {
    const file = new WorkerStateFile(statePath);
    file.load();
    await file.addPendingAccept(mkEntry('7'));
    await file.addPendingAccept(mkEntry('8'));
    await file.addPendingAccept(mkEntry('9'));

    const reloaded = new WorkerStateFile(statePath);
    const s1 = reloaded.load();
    assert.equal(s1.pending_accept.length, 3);
    assert.deepEqual(
      s1.pending_accept.map((e) => e.id),
      ['7', '8', '9'],
    );

    await reloaded.clearPendingAccept(8n);
    const s2 = new WorkerStateFile(statePath).load();
    assert.deepEqual(
      s2.pending_accept.map((e) => e.id),
      ['7', '9'],
    );
  });

  it('setLastProcessedBlock persists', async () => {
    const a = new WorkerStateFile(statePath);
    a.load();
    await a.setLastProcessedBlock(12345);

    const b = new WorkerStateFile(statePath);
    assert.equal(b.load().last_processed_block, 12345);
  });

  it('version-mismatch on disk throws WorkerStateVersionMismatchError', () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 999,
        inflight: null,
        last_processed_block: 0,
        pending_accept: [],
      }),
    );
    const file = new WorkerStateFile(statePath);
    assert.throws(
      () => file.load(),
      (err: unknown) => {
        assert.ok(err instanceof WorkerStateVersionMismatchError);
        assert.equal(err.fileVersion, 999);
        assert.equal(err.expectedVersion, WORKER_STATE_VERSION);
        return true;
      },
    );
  });

  it('load() filters malformed pending_accept entries defensively (no throw on partial corruption)', () => {
    writeFileSync(
      statePath,
      JSON.stringify({
        version: WORKER_STATE_VERSION,
        inflight: null,
        last_processed_block: 0,
        pending_accept: [
          mkEntry('1'),
          { id: '2' /* missing fields */ },
          mkEntry('3'),
          'not-an-object',
          null,
        ],
      }),
    );
    const file = new WorkerStateFile(statePath);
    const s = file.load();
    assert.equal(s.pending_accept.length, 2);
    assert.deepEqual(
      s.pending_accept.map((e) => e.id),
      ['1', '3'],
    );
  });
});
