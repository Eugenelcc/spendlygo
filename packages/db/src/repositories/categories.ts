/**
 * Category reads.
 *
 * A user sees system defaults (`user_id IS NULL`) plus their own overrides.
 * Archived categories are hidden from pickers but still resolve for history
 * (PRD F10.3).
 */

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '../client.js';
import { categories, type Category } from '../schema.js';

export async function listForUser(
  db: Database,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<Category[]> {
  const ownership = or(isNull(categories.userId), eq(categories.userId, userId));
  const where = options.includeArchived ? ownership : and(ownership, isNull(categories.archivedAt));

  return db.select().from(categories).where(where).orderBy(asc(categories.sortOrder));
}

export async function findBySlug(
  db: Database,
  userId: string,
  slug: string,
): Promise<Category | null> {
  const rows = await db
    .select()
    .from(categories)
    .where(
      and(eq(categories.slug, slug), or(isNull(categories.userId), eq(categories.userId, userId))),
    )
    // A user's own override outranks the system default of the same slug.
    .orderBy(asc(categories.userId))
    .limit(1);
  return rows[0] ?? null;
}
