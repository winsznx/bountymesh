-- Phase 3 Step 5e — hide indexer-internal tables from the GraphQL surface.
--
-- PostGraphile 4.x reads `@omit` smart comments from pg COMMENT ON TABLE
-- and excludes the matching table from the generated GraphQL schema.
-- bountymesh_readonly still has SELECT — psql access is unchanged. The
-- omission is GraphQL-only.
--
-- These tables are operational state, not domain data:
--   - indexer_state: singleton watermark for backfill/live resume
--   - parse_errors: liveness telemetry sink (D3)
-- Exposing them via GraphQL would leak indexer implementation details to
-- consumers without adding value. Consumers query bounties + bounty_events.

COMMENT ON TABLE "indexer_state" IS E'@omit';
COMMENT ON TABLE "parse_errors" IS E'@omit';
