/**
 * Drizzle migration runner (Boot Stage 1).
 *
 * Step 5a scope: minimal implementation — runMigrations + post-migration GRANT.
 * Used as a standalone CLI (npm run db:migrate) AND from lifecycle/boot.ts later.
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', 'migrations');

const POST_MIGRATION_GRANTS = `
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bountymesh_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO bountymesh_readonly;
`;

export interface MigrateOptions {
  databaseUrl: string;
  migrationsFolder?: string;
  applyReadonlyGrants?: boolean;
}

/**
 * Run all pending migrations against the writer connection.
 * After migrations succeed, idempotently re-GRANT SELECT to pg_readonly so
 * any tables that pre-dated the ALTER DEFAULT PRIVILEGES rule are also visible.
 */
export async function runMigrations(opts: MigrateOptions): Promise<void> {
  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: 2,
  });

  try {
    const db = drizzle(pool);
    await migrate(db, {
      migrationsFolder: opts.migrationsFolder ?? MIGRATIONS_DIR,
    });

    if (opts.applyReadonlyGrants ?? true) {
      await pool.query(POST_MIGRATION_GRANTS);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('bountymesh_readonly')) {
      throw new Error(
        `[migrate] bountymesh_readonly role missing; was docker/init.sql executed? ` +
          `Run \`npm run db:reset\` to re-run init scripts. Underlying: ${err.message}`,
      );
    }
    throw err;
  } finally {
    await pool.end();
  }
}

async function cli(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    'postgres://bountymesh:bountymesh@localhost:5432/bountymesh';

  console.log(`[migrate] applying migrations from ${MIGRATIONS_DIR}`);
  console.log(`[migrate] database: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}`);

  await runMigrations({ databaseUrl });

  console.log('[migrate] migrations applied; bountymesh_readonly GRANTs refreshed');
}

const isMain = process.argv[1] === __filename;
if (isMain) {
  cli().catch((err: unknown) => {
    console.error('[migrate] failed:', err);
    process.exit(1);
  });
}
