/**
 * Per-test temporary directory harness. P3.2 uses this for keystore
 * fixtures; reused by P3.3+ state-file tests.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'bountymesh-worker-test-'));
}

export function cleanupTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

export function writeFixture(dir: string, filename: string, content: string): string {
  const path = join(dir, filename);
  writeFileSync(path, content);
  return path;
}
