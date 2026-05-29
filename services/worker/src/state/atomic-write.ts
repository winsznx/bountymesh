/**
 * Atomic JSON write: tmp + fsync + rename (P2 §B).
 *
 * Sequence:
 *   1. Open a tmp file in the same directory as the target (so rename is
 *      atomic — same filesystem).
 *   2. Write the JSON body to the tmp fd.
 *   3. fsync the fd to flush data bytes to disk before the rename
 *      (required for durability across power loss; without it the rename
 *      might be visible before the bytes are flushed).
 *   4. Close the fd.
 *   5. Rename tmp → target. POSIX rename is atomic; if the target exists
 *      it is REPLACED atomically (per discipline F — update-not-just-create
 *      is the common case for state files).
 *
 * Process kill between any two steps is safe:
 *   - Killed 1–4: tmp file is incomplete or orphaned; target unchanged.
 *   - Killed during 5: rename either completed (new file at target) or
 *     didn't (old file at target). POSIX guarantee — no half-rename.
 *
 * On any error before rename, the tmp file is unlinked to avoid orphan
 * accumulation across many failed writes.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export function atomicWriteJson(path: string, value: unknown): void {
  const dir = dirname(path);
  const tmpPath = join(
    dir,
    `.${basename(path)}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
  );
  const body = JSON.stringify(value, null, 2);

  let fd: number;
  fd = openSync(tmpPath, 'w');

  let wroteAndFsynced = false;
  try {
    writeSync(fd, body);
    fsyncSync(fd);
    wroteAndFsynced = true;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore close-failure; the open + write succeeded */
    }
    if (!wroteAndFsynced && existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* best-effort cleanup */
      }
    }
  }

  try {
    renameSync(tmpPath, path);
  } catch (err) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}
