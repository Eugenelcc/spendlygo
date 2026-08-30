/**
 * Apply pending migrations.
 *
 * GUARDRAILS.md section 3: migrations are generated (`pnpm db:generate`),
 * committed, reviewed, and applied by this script. They are never hand-written
 * against a live database.
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Config comes from a single `.env` at the REPOSITORY ROOT.
 *
 * pnpm runs each workspace script with that package as its working directory,
 * so a plain `dotenv/config` would look for `packages/db/.env` while the server
 * looked for `apps/server/.env`. One file, resolved explicitly, removes a whole
 * category of "it works for migrate but not for the bot" confusion.
 */
loadDotenv({ path: resolve(here, '../../../../.env') });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const migrationsFolder = resolve(here, '../../migrations');

// A single connection: migrations run serially and must not race.
// Notices are suppressed because Postgres emits "already exists, skipping" for
// drizzle's own bookkeeping on every run after the first, and a wall of NOTICE
// objects during a production migration reads like a failure.
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

try {
  console.log(`Applying migrations from ${migrationsFolder} …`);
  await migrate(drizzle(client), { migrationsFolder });
  console.log('✓ Migrations up to date.');
} catch (error) {
  console.error('✗ Migration failed:', error);
  process.exitCode = 1;
} finally {
  await client.end();
}
