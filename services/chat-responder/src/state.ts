/**
 * SQLite-backed dedup + counter store.
 *
 * Railway's filesystem is ephemeral by default — without a Volume mount,
 * state.db resets on every redeploy. The main loop compensates by also
 * querying the chat indexer for prior replies authored by any of our 3
 * Applications with replyTo == msgId (cross-deploy dedup). SQLite still
 * keeps in-deploy dedup cheap and is the source of truth for the
 * last_processed_at cursor.
 */

import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface ProcessedRow {
  message_id: string;
  our_reply_id: string;
  processed_at: string;
  our_app: string;
}

export class ResponderState {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        our_reply_id TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        our_app TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_messages(processed_at);

      CREATE TABLE IF NOT EXISTS counters (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  wasProcessed(messageId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM processed_messages WHERE message_id = ?').get(messageId);
    return row !== undefined;
  }

  markProcessed(messageId: string, ourReplyId: string, ourApp: string): void {
    this.db
      .prepare(
        'INSERT OR REPLACE INTO processed_messages (message_id, our_reply_id, processed_at, our_app) VALUES (?, ?, ?, ?)',
      )
      .run(messageId, ourReplyId, new Date().toISOString(), ourApp);
  }

  getLastProcessedAt(): Date | null {
    const row = this.db
      .prepare('SELECT value FROM counters WHERE key = ?')
      .get('last_processed_at') as { value: string } | undefined;
    if (!row) return null;
    const t = new Date(row.value);
    return isNaN(t.getTime()) ? null : t;
  }

  setLastProcessedAt(t: Date): void {
    this.db
      .prepare('INSERT OR REPLACE INTO counters (key, value) VALUES (?, ?)')
      .run('last_processed_at', t.toISOString());
  }

  countRepliesToday(): number {
    const sinceMidnightUtc = new Date();
    sinceMidnightUtc.setUTCHours(0, 0, 0, 0);
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM processed_messages WHERE processed_at >= ?')
      .get(sinceMidnightUtc.toISOString()) as { n: number };
    return row.n;
  }

  close(): void {
    this.db.close();
  }
}
