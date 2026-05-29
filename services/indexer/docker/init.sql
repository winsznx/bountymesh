-- Phase 3 — bountymesh_readonly role for PostGraphile (D2 defense-in-depth).
-- Runs ONCE on first postgres boot via /docker-entrypoint-initdb.d/.
-- Subsequent boots ignore this file. `npm run db:reset` to re-run.
--
-- Role name: `bountymesh_readonly`, NOT `pg_readonly` — Postgres reserves
-- the `pg_` prefix for built-in role names. (Discovered Step 5a; first
-- attempted name was `pg_readonly`, rejected with "role name is reserved".)
--
-- Note on table grants: this script runs BEFORE Drizzle migrations create the
-- tables. ALTER DEFAULT PRIVILEGES below ensures all future tables created BY
-- the bountymesh writer role automatically grant SELECT to bountymesh_readonly.
-- The post-migration GRANT in src/db/migrate.ts catches any tables that existed
-- before the default-privileges rule took effect (defensive belt+suspenders).

-- 1. Read-only role with login.
CREATE ROLE bountymesh_readonly WITH LOGIN PASSWORD 'readonly';

-- 2. Connect to the database.
GRANT CONNECT ON DATABASE bountymesh TO bountymesh_readonly;

-- 3. See the schema.
GRANT USAGE ON SCHEMA public TO bountymesh_readonly;

-- 4. SELECT on tables that ALREADY exist (none yet — runs pre-migration; harmless).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bountymesh_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bountymesh_readonly;

-- 5. SELECT on tables created LATER by the bountymesh writer role.
ALTER DEFAULT PRIVILEGES FOR ROLE bountymesh IN SCHEMA public
  GRANT SELECT ON TABLES TO bountymesh_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE bountymesh IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO bountymesh_readonly;
