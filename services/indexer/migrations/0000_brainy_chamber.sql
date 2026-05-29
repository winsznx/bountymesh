CREATE TABLE IF NOT EXISTS "bounties" (
	"id" bigint PRIMARY KEY NOT NULL,
	"poster" text NOT NULL,
	"worker" text,
	"reward" numeric(39, 0) NOT NULL,
	"track" text NOT NULL,
	"status" text NOT NULL,
	"posted_at" bigint NOT NULL,
	"claimed_at" bigint,
	"submitted_at" bigint,
	"accepted_at" bigint,
	"withdrawn_at" bigint,
	"withdrawn" boolean DEFAULT false NOT NULL,
	"result_hash" text,
	"post_tx_hash" text,
	"claim_tx_hash" text,
	"submit_tx_hash" text,
	"accept_tx_hash" text,
	"withdraw_tx_hash" text,
	"last_event_block" bigint NOT NULL,
	"title" text,
	"description" text,
	"acceptance" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bounty_events" (
	"event_uid" text PRIMARY KEY NOT NULL,
	"bounty_id" bigint NOT NULL,
	"event_name" text NOT NULL,
	"block_number" bigint NOT NULL,
	"block_hash" text NOT NULL,
	"tx_hash" text,
	"payload" jsonb NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "indexer_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"program_id" text NOT NULL,
	"start_block" bigint NOT NULL,
	"last_finalized_block" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexer_state_singleton" CHECK ("indexer_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "parse_errors" (
	"event_uid" text PRIMARY KEY NOT NULL,
	"block_number" bigint NOT NULL,
	"raw_payload_hex" text NOT NULL,
	"error_message" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bounties_status" ON "bounties" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bounties_poster" ON "bounties" USING btree ("poster");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bounties_worker" ON "bounties" USING btree ("worker");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bounties_track" ON "bounties" USING btree ("track");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_bounty" ON "bounty_events" USING btree ("bounty_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_block" ON "bounty_events" USING btree ("block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_events_name_block" ON "bounty_events" USING btree ("event_name","block_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_parse_errors_occurred" ON "parse_errors" USING btree ("occurred_at");