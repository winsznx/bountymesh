import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Indexer schema — 4 tables.
 *
 * Bigint mapping (over-the-wire contract):
 *   - block heights / timestamps → bigint mode:'number' (safe under 2^53 forever at 6s blocks)
 *   - reward (u128) → numeric(39,0) returned as string by pg driver;
 *     coerced to BigInt at the project.ts boundary, NEVER stored as 'number'
 *
 * PostGraphile auto-derives GraphQL from these tables; readerPool role
 * (bountymesh_readonly) gets SELECT only via docker/init.sql.
 */

// 1. Append-only event log. Source of truth for the projection.
export const bountyEvents = pgTable(
  'bounty_events',
  {
    eventUid: text('event_uid').primaryKey(),
    bountyId: bigint('bounty_id', { mode: 'number' }).notNull(),
    eventName: text('event_name').notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    blockHash: text('block_hash').notNull(),
    txHash: text('tx_hash'),
    payload: jsonb('payload').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bountyIdx: index('idx_events_bounty').on(t.bountyId),
    blockIdx: index('idx_events_block').on(t.blockNumber),
    nameBlockIdx: index('idx_events_name_block').on(t.eventName, t.blockNumber),
  }),
);

// 2. Current-state projection. Updated transactionally with each event insert.
//    title/description/acceptance are nullable; populated by the BountyPosted
//    event extension and backfilled by a future DiscoveryService.
export const bounties = pgTable(
  'bounties',
  {
    id: bigint('id', { mode: 'number' }).primaryKey(),
    poster: text('poster').notNull(),
    worker: text('worker'),
    reward: numeric('reward', { precision: 39, scale: 0 }).notNull(),
    track: text('track').notNull(),
    status: text('status').notNull(),
    postedAt: bigint('posted_at', { mode: 'number' }).notNull(),
    claimedAt: bigint('claimed_at', { mode: 'number' }),
    submittedAt: bigint('submitted_at', { mode: 'number' }),
    acceptedAt: bigint('accepted_at', { mode: 'number' }),
    withdrawnAt: bigint('withdrawn_at', { mode: 'number' }),
    withdrawn: boolean('withdrawn').notNull().default(false),
    resultHash: text('result_hash'),
    postTxHash: text('post_tx_hash'),
    claimTxHash: text('claim_tx_hash'),
    submitTxHash: text('submit_tx_hash'),
    acceptTxHash: text('accept_tx_hash'),
    withdrawTxHash: text('withdraw_tx_hash'),
    lastEventBlock: bigint('last_event_block', { mode: 'number' }).notNull(),
    title: text('title'),
    description: text('description'),
    acceptance: text('acceptance'),
    deadline: bigint('deadline', { mode: 'number' }),
  },
  (t) => ({
    statusIdx: index('idx_bounties_status').on(t.status),
    posterIdx: index('idx_bounties_poster').on(t.poster),
    workerIdx: index('idx_bounties_worker').on(t.worker),
    trackIdx: index('idx_bounties_track').on(t.track),
  }),
);

// 3. Indexer singleton state. CHECK enforces single row.
export const indexerState = pgTable(
  'indexer_state',
  {
    id: integer('id').primaryKey().default(1),
    programId: text('program_id').notNull(),
    startBlock: bigint('start_block', { mode: 'number' }).notNull(),
    lastFinalizedBlock: bigint('last_finalized_block', { mode: 'number' }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    singletonCheck: check('indexer_state_singleton', sql`${t.id} = 1`),
  }),
);

// 4. Parse-error sink. Liveness over purity: bad payload → row here, watermark advances.
export const parseErrors = pgTable(
  'parse_errors',
  {
    eventUid: text('event_uid').primaryKey(),
    blockNumber: bigint('block_number', { mode: 'number' }).notNull(),
    rawPayloadHex: text('raw_payload_hex').notNull(),
    errorMessage: text('error_message').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    occurredIdx: index('idx_parse_errors_occurred').on(t.occurredAt),
  }),
);
