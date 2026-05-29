import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { WorkHistoryDedup } from '../../src/filter/dedup.js';
import {
  appendHistoryRecord,
  WorkHistoryLineTooLargeError,
  WorkHistoryNotLoadedError,
  type FullHistoryRecord,
} from '../../src/state/history-writer.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

describe('appendHistoryRecord', () => {
  let tmpDir: string;
  let historyPath: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  beforeEach(() => {
    historyPath = join(tmpDir, `history-${Date.now()}-${Math.random()}.jsonl`);
  });

  function freshDedup(): WorkHistoryDedup {
    const d = new WorkHistoryDedup(historyPath);
    d.load();
    return d;
  }

  it('done record: writes full line, dedup.has() reflects immediately', () => {
    const dedup = freshDedup();
    const record: FullHistoryRecord = {
      id: 7n,
      status: 'done',
      completed_at: '2026-05-19T12:00:00.000Z',
      tx_hashes: {
        claim: `0x${'aa'.repeat(32)}`,
        submit: `0x${'bb'.repeat(32)}`,
        accept: `0x${'cc'.repeat(32)}`,
        withdraw: `0x${'dd'.repeat(32)}`,
      },
      envelope_sha256: `0x${'ee'.repeat(32)}`,
      reward: '2000000000000',
    };
    appendHistoryRecord(historyPath, dedup, record);
    assert.equal(dedup.has(7n), true);

    const fileContent = readFileSync(historyPath, 'utf-8');
    const line = fileContent.trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.id, '7');
    assert.equal(parsed.status, 'done');
    assert.equal(parsed.envelope_sha256, `0x${'ee'.repeat(32)}`);
    assert.equal(parsed.reward, '2000000000000');
  });

  it('abandoned record: writes line with partial tx_hashes; envelope_sha256 may be null', () => {
    const dedup = freshDedup();
    const record: FullHistoryRecord = {
      id: 11n,
      status: 'abandoned',
      completed_at: '2026-05-19T13:00:00.000Z',
      tx_hashes: {
        claim: `0x${'aa'.repeat(32)}`,
      },
      envelope_sha256: null,
    };
    appendHistoryRecord(historyPath, dedup, record);
    assert.equal(dedup.has(11n), true);

    const line = readFileSync(historyPath, 'utf-8').trim();
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed.status, 'abandoned');
    assert.equal(parsed.envelope_sha256, null);
    const txs = parsed.tx_hashes as Record<string, string>;
    assert.equal(txs.claim, `0x${'aa'.repeat(32)}`);
    assert.equal(txs.submit, undefined);
  });

  it('multiple records: dedup.has() updates per write; subsequent loads see all ids', () => {
    const dedup = freshDedup();
    appendHistoryRecord(historyPath, dedup, {
      id: 1n,
      status: 'done',
      completed_at: '2026-05-19T12:00:00.000Z',
      tx_hashes: { claim: `0x${'aa'.repeat(32)}` },
      envelope_sha256: `0x${'bb'.repeat(32)}`,
    });
    appendHistoryRecord(historyPath, dedup, {
      id: 2n,
      status: 'abandoned',
      completed_at: '2026-05-19T12:01:00.000Z',
      tx_hashes: { claim: `0x${'cc'.repeat(32)}` },
      envelope_sha256: null,
    });
    assert.equal(dedup.has(1n), true);
    assert.equal(dedup.has(2n), true);

    const fresh = new WorkHistoryDedup(historyPath);
    fresh.load();
    assert.equal(fresh.has(1n), true);
    assert.equal(fresh.has(2n), true);
  });

  it('throws WorkHistoryNotLoadedError when dedup has not been loaded', () => {
    const dedup = new WorkHistoryDedup(historyPath); // NOT loaded
    assert.throws(
      () =>
        appendHistoryRecord(historyPath, dedup, {
          id: 1n,
          status: 'done',
          completed_at: '2026-05-19T12:00:00.000Z',
          tx_hashes: { claim: `0x${'aa'.repeat(32)}` },
          envelope_sha256: `0x${'bb'.repeat(32)}`,
        }),
      (err: unknown) => {
        assert.ok(err instanceof WorkHistoryNotLoadedError);
        return true;
      },
    );
  });

  it('throws WorkHistoryLineTooLargeError when the serialized line exceeds 4000B', () => {
    const dedup = freshDedup();
    // Force overflow via a contrived oversized tx hash (real hashes are 66B;
    // we synthesize a 6000-char value to push the line past the 4000B guard).
    const oversized: FullHistoryRecord = {
      id: 1n,
      status: 'done',
      completed_at: '2026-05-19T12:00:00.000Z',
      tx_hashes: {
        claim: ('0x' + 'a'.repeat(6000)) as `0x${string}`,
      },
      envelope_sha256: `0x${'bb'.repeat(32)}`,
    };
    assert.throws(
      () => appendHistoryRecord(historyPath, dedup, oversized),
      (err: unknown) => {
        assert.ok(err instanceof WorkHistoryLineTooLargeError);
        assert.ok(err.bytes > 4000);
        return true;
      },
    );
  });
});
