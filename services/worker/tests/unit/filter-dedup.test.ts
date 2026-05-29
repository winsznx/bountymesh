import { strict as assert } from 'node:assert';
import { describe, before, after, beforeEach, it } from 'node:test';
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import {
  WorkHistoryDedup,
  WorkHistoryNotLoadedError,
} from '../../src/filter/dedup.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

describe('WorkHistoryDedup', () => {
  let tmpDir: string;
  let historyPath: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  beforeEach(() => {
    // Fresh path per test so dedups don't leak state across cases.
    historyPath = join(tmpDir, `history-${Date.now()}-${Math.random()}.jsonl`);
  });

  it('load() on a nonexistent file succeeds with empty seen-set', () => {
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    assert.equal(dedup.has(1n), false);
    assert.equal(dedup.has(999n), false);
  });

  it('load() reads minimal-id lines into seen-set', () => {
    writeFileSync(
      historyPath,
      [
        JSON.stringify({ id: '1' }),
        JSON.stringify({ id: '42' }),
        JSON.stringify({ id: '999' }),
      ].join('\n') + '\n',
    );
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    assert.equal(dedup.has(1n), true);
    assert.equal(dedup.has(42n), true);
    assert.equal(dedup.has(999n), true);
    assert.equal(dedup.has(2n), false);
  });

  it('load() reads full-shape lines (only .id field is consumed)', () => {
    const fullLine = JSON.stringify({
      id: '17',
      status: 'done',
      completed_at: '2026-05-19T12:00:00Z',
      tx_hashes: {
        claim: `0x${'aa'.repeat(32)}`,
        submit: `0x${'bb'.repeat(32)}`,
        withdraw: `0x${'cc'.repeat(32)}`,
      },
      envelope_sha256: `0x${'dd'.repeat(32)}`,
    });
    writeFileSync(historyPath, fullLine + '\n');
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    assert.equal(dedup.has(17n), true);
  });

  it('load() tolerates malformed lines (skips, continues)', () => {
    writeFileSync(
      historyPath,
      [
        JSON.stringify({ id: '1' }),
        '{not valid json',
        '',
        JSON.stringify({ id: '2' }),
        JSON.stringify({ no_id_field: true }),
        JSON.stringify({ id: '3' }),
      ].join('\n') + '\n',
    );
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    assert.equal(dedup.has(1n), true);
    assert.equal(dedup.has(2n), true);
    assert.equal(dedup.has(3n), true);
  });

  it('add() appends a minimal-id line; in-memory has() updates immediately', () => {
    const dedup = new WorkHistoryDedup(historyPath);
    dedup.load();
    assert.equal(dedup.has(99n), false);

    dedup.add(99n);
    assert.equal(dedup.has(99n), true);
    assert.ok(existsSync(historyPath));

    const fileContent = readFileSync(historyPath, 'utf-8');
    assert.equal(fileContent, '{"id":"99"}\n');
  });

  it('reboot persistence: a fresh dedup against same path sees prior add()', () => {
    const dedup1 = new WorkHistoryDedup(historyPath);
    dedup1.load();
    dedup1.add(7n);
    dedup1.add(8n);

    const dedup2 = new WorkHistoryDedup(historyPath);
    dedup2.load();
    assert.equal(dedup2.has(7n), true);
    assert.equal(dedup2.has(8n), true);
  });

  it('has() before load() throws WorkHistoryNotLoadedError', () => {
    const dedup = new WorkHistoryDedup(historyPath);
    assert.throws(
      () => dedup.has(1n),
      (err: unknown) => {
        assert.ok(err instanceof WorkHistoryNotLoadedError);
        return true;
      },
    );
  });

  it('add() before load() throws WorkHistoryNotLoadedError', () => {
    const dedup = new WorkHistoryDedup(historyPath);
    assert.throws(
      () => dedup.add(1n),
      (err: unknown) => {
        assert.ok(err instanceof WorkHistoryNotLoadedError);
        return true;
      },
    );
  });
});
