/**
 * work_history.jsonl dedup.
 *
 * Atomic-append discipline (P2 §B): POSIX O_APPEND writes of ≤PIPE_BUF
 * (4096B) bytes are atomic. The locked full-record line shape is ~400-500B,
 * well under safe. The MAX_LINE_BYTES guard fires defensively if a future
 * field addition bloats the line past 4000B — caller would lose
 * atomicity guarantees.
 *
 * P3.5 implements only the read-many + minimal-append surface required
 * for dedup. The full-record writer (with tx_hashes, envelope_sha256,
 * timestamps, etc.) lands in P3.x state machine when the FSM completes
 * a bounty.
 */

import { existsSync, readFileSync, appendFileSync } from 'node:fs';

const MAX_LINE_BYTES = 4000;

export class WorkHistoryLineTooLargeError extends Error {
  readonly bytes: number;
  constructor(bytes: number) {
    super(
      `worker.history.jsonl line is ${bytes} bytes — exceeds 4000B PIPE_BUF safety limit. ` +
        `Atomic-append discipline (P2 §B) requires lines ≤ PIPE_BUF (4096B). Trim fields.`,
    );
    this.name = 'WorkHistoryLineTooLargeError';
    this.bytes = bytes;
  }
}

export class WorkHistoryNotLoadedError extends Error {
  constructor(method: string) {
    super(`WorkHistoryDedup.load() must be called before ${method}()`);
    this.name = 'WorkHistoryNotLoadedError';
  }
}

export class WorkHistoryDedup {
  private readonly historyPath: string;
  private readonly seen = new Set<string>();
  private loaded = false;

  constructor(historyPath: string) {
    this.historyPath = historyPath;
  }

  /**
   * Read all lines, parse JSON, populate the in-memory Set of bountyId strings.
   * Tolerates both minimal `{"id":"<id>"}` and full-shape lines — only the
   * `.id` field is read. Malformed lines are skipped defensively.
   */
  load(): void {
    if (this.loaded) return;
    if (!existsSync(this.historyPath)) {
      this.loaded = true;
      return;
    }
    const raw = readFileSync(this.historyPath, 'utf-8');
    const lines = raw.split('\n');
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      try {
        const obj = JSON.parse(line) as { id?: string | number };
        if (typeof obj.id === 'string' && obj.id.length > 0) {
          this.seen.add(obj.id);
        } else if (typeof obj.id === 'number') {
          this.seen.add(String(obj.id));
        }
        // Lines without `.id` are skipped — defensive against partial writes
        // or unrelated future-format entries.
      } catch {
        // Malformed line: skip. Atomic-append ensures lines are whole, but
        // defensive parse-skip lets the worker boot past historical corruption.
      }
    }
    this.loaded = true;
  }

  has(id: bigint): boolean {
    if (!this.loaded) throw new WorkHistoryNotLoadedError('has');
    return this.seen.has(id.toString());
  }

  /**
   * Update the in-memory seen-set without writing a line. Used by
   * src/state/history-writer.ts after appending a full-record line to
   * worker.history.jsonl — the line write happens there; dedup just needs
   * to reflect the new id so subsequent has() returns true immediately.
   */
  markSeen(id: bigint): void {
    if (!this.loaded) throw new WorkHistoryNotLoadedError('markSeen');
    this.seen.add(id.toString());
  }

  /**
   * Append a minimal `{"id":"<id>"}` line and mark the id seen in memory.
   *
   * Production-grade writer (full record with tx_hashes, envelope, timestamps)
   * lands in P3.x state machine. This minimal-append exists for the dedup
   * test surface — keeps dedup's responsibility tight.
   */
  add(id: bigint): void {
    if (!this.loaded) throw new WorkHistoryNotLoadedError('add');
    const idStr = id.toString();
    const line = `${JSON.stringify({ id: idStr })}\n`;
    const bytes = Buffer.byteLength(line, 'utf-8');
    if (bytes > MAX_LINE_BYTES) {
      throw new WorkHistoryLineTooLargeError(bytes);
    }
    appendFileSync(this.historyPath, line, 'utf-8');
    this.seen.add(idStr);
  }
}
