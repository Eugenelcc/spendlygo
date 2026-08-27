/**
 * Database connection.
 *
 * GUARDRAILS.md section 7:
 *  - `prepare: false` — Supabase's transaction pooler rejects prepared statements.
 *  - a small pool — the free tier has a modest connection cap, and a service
 *    waking from sleep with 20 connections in flight simply fails.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseHandle {
  db: Database;
  /** Cheap round-trip, used by the hourly tick to keep Supabase from pausing. */
  ping(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateDatabaseOptions {
  /** Keep this low. See GUARDRAILS.md section 7. */
  maxConnections?: number;
}

export function createDatabase(url: string, options: CreateDatabaseOptions = {}): DatabaseHandle {
  const client = postgres(url, {
    prepare: false,
    max: options.maxConnections ?? 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });

  const db = drizzle(client, { schema });

  return {
    db,
    async ping() {
      await db.execute(sql`select 1`);
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}
