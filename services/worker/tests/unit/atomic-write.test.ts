import { strict as assert } from 'node:assert';
import { describe, before, after, it } from 'node:test';
import { join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { atomicWriteJson } from '../../src/state/atomic-write.js';
import { makeTmpDir, cleanupTmpDir } from '../harness/tmp.js';

describe('atomicWriteJson', () => {
  let tmpDir: string;

  before(() => {
    tmpDir = makeTmpDir();
  });

  after(() => {
    cleanupTmpDir(tmpDir);
  });

  it('writes a new JSON file to a fresh path', () => {
    const target = join(tmpDir, 'create.json');
    const value = { a: 1, b: 'hello' };
    atomicWriteJson(target, value);
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf-8'));
    assert.deepEqual(parsed, value);
  });

  it('REPLACES an existing file atomically (discipline F: update-not-just-create)', () => {
    const target = join(tmpDir, 'replace.json');
    writeFileSync(target, '{"old":true}');
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf-8')), { old: true });

    const newValue = { new: true, n: 42 };
    atomicWriteJson(target, newValue);

    const parsed: unknown = JSON.parse(readFileSync(target, 'utf-8'));
    assert.deepEqual(parsed, newValue);
  });

  it('leaves NO orphan .tmp.* files in the target directory after success', () => {
    const target = join(tmpDir, 'no-orphan.json');
    atomicWriteJson(target, { x: 1 });
    atomicWriteJson(target, { x: 2 }); // replace path
    atomicWriteJson(target, { x: 3 }); // another replace

    const entries = readdirSync(tmpDir);
    const orphans = entries.filter((name) => name.includes('.tmp.'));
    assert.deepEqual(orphans, [], `expected no orphan tmp files; found: ${orphans.join(', ')}`);
  });

  it('preserves JSON roundtrip for nested structures, arrays, bools, nulls', () => {
    const target = join(tmpDir, 'roundtrip.json');
    const value = {
      version: 1,
      inflight: null,
      pending: [
        { id: '7', hash: '0xabc', flag: true },
        { id: '8', hash: '0xdef', flag: false },
      ],
      nested: { deep: { deeper: { value: 'x' } } },
    };
    atomicWriteJson(target, value);
    const parsed: unknown = JSON.parse(readFileSync(target, 'utf-8'));
    assert.deepEqual(parsed, value);
  });
});
