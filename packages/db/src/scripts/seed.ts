/**
 * Seed the system default categories (PRD F10.1).
 *
 * System categories have `user_id IS NULL` and are shared by every user until
 * they customise one. Safe to re-run: it upserts on (user_id, slug).
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { DEFAULT_CATEGORIES } from '@spendlygo/core';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../client.js';
import { categories } from '../schema.js';

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

const handle = createDatabase(url, { maxConnections: 1 });

try {
  const rows = DEFAULT_CATEGORIES.map((category) => ({
    userId: null,
    slug: category.slug,
    name: category.name,
    emoji: category.emoji,
    colorToken: category.colorToken,
    kind: category.kind,
    keywords: [...category.keywords],
    excludeFromBudget: category.excludeFromBudget,
    sortOrder: category.sortOrder,
  }));

  await handle.db
    .insert(categories)
    .values(rows)
    .onConflictDoUpdate({
      // Targets the partial unique index on system categories. `set` must read
      // from `excluded` — referencing the table's own columns would assign each
      // column to itself and silently do nothing.
      target: categories.slug,
      targetWhere: sql`user_id IS NULL`,
      set: {
        name: sql`excluded.name`,
        emoji: sql`excluded.emoji`,
        colorToken: sql`excluded.color_token`,
        keywords: sql`excluded.keywords`,
        excludeFromBudget: sql`excluded.exclude_from_budget`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

  console.log(`✓ Seeded ${rows.length} default categories.`);
} catch (error) {
  console.error('✗ Seed failed:', error);
  process.exitCode = 1;
} finally {
  await handle.close();
}
