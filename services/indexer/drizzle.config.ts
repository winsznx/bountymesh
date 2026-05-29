import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://bountymesh:bountymesh@localhost:5432/bountymesh',
  },
  verbose: true,
  strict: true,
} satisfies Config;
