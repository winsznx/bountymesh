/**
 * PostGraphile 4.x options bundle + middleware factory (Step 5e).
 *
 * Library mode (not CLI subprocess) — composes with our node:http server
 * alongside /health.
 *
 * Reads via readerPool (bountymesh_readonly role; SELECT-only). Mutations
 * are disabled at the API layer (disableDefaultMutations) AND at the DB
 * permission layer (no INSERT/UPDATE/DELETE grants). Defense-in-depth.
 *
 * Internal tables (indexer_state, parse_errors) are hidden via the `@omit`
 * smart comments applied in migration 0001 — PostGraphile reads pg COMMENT
 * statements and excludes those tables from introspection.
 */

import type { Pool } from 'pg';
import { postgraphile, type PostGraphileOptions } from 'postgraphile';
import ConnectionFilterPlugin from 'postgraphile-plugin-connection-filter';
import type { IndexerConfig } from '../config.js';

export type PostgraphileMiddleware = ReturnType<typeof postgraphile>;

export function buildPostgraphileMiddleware(
  readerPool: Pool,
  config: IndexerConfig,
): PostgraphileMiddleware {
  const isDev = process.env.NODE_ENV !== 'production';
  const isDebug = config.logLevel === 'debug' || config.logLevel === 'trace';

  const options: PostGraphileOptions = {
    // Read-only API — no auto-mutations from any table grant we might
    // accidentally hand out. Defense in depth alongside the reader role.
    disableDefaultMutations: true,

    // Both Relay-style connections (allBounties) AND simple-collection
    // accessors (bountiesList) exposed.
    simpleCollections: 'both',

    // Better postgres typing accuracy.
    setofFunctionsContainNulls: false,

    // GraphiQL only in dev; production exposes /graphql alone.
    graphiql: isDev,
    enhanceGraphiql: isDev,

    // Schema source-of-truth: only watch in dev (production reloads on restart).
    watchPg: false,

    // Verbose error fields only in debug; production strips to errcode only.
    extendedErrors: isDebug ? ['hint', 'detail', 'errcode'] : ['errcode'],

    // If Postgres is still warming during boot, retry rather than crash.
    retryOnInitFail: true,

    // PostGraphile handles its own CORS for /graphql routes; we also handle
    // outer CORS in server.ts for /health. Enable here to cover the GraphQL
    // routes uniformly.
    enableCors: true,

    // connection-filter plugin enables PostGraphile filter argument:
    //   allBounties(filter: { status: { equalTo: "Open" } }) { ... }
    appendPlugins: [ConnectionFilterPlugin],

    graphileBuildOptions: {
      connectionFilterRelations: true,
    },
  };

  // Schema export for Phase 5 frontend codegen. Optional via env.
  const schemaOutPath = process.env.GRAPHQL_SCHEMA_OUT?.trim();
  if (schemaOutPath) {
    options.exportGqlSchemaPath = schemaOutPath;
  }

  return postgraphile(readerPool, 'public', options);
}
