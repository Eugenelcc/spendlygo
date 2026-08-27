/**
 * Apply pending migrations.
 *
 * GUARDRAILS.md section 3: migrations are generated (`pnpm db:generate`),
 * committed, reviewed, and applied by this script. They are never hand-written
 * against a live database.
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

// A single connection: migrations run serially and must not race.
const client = postgres(url, { max: 1, prepare: false });

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
