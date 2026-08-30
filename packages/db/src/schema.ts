/**
 * Database schema — the logical model in PRD.md section 9.
 *
 * Invariants enforced here rather than in application code, because the
 * database is the only layer that cannot be bypassed:
 *
 *  - `amount_cents` is a positive integer; `direction` carries the sign
 *    (GUARDRAILS.md section 2).
 *  - every user-owned row carries `user_id` (GUARDRAILS.md section 4).
 *  - `recurring_runs` is uniquely keyed on (rule_id, occurrence_date), so a
 *    double-fired cron cannot double-charge (GUARDRAILS.md section 3).
 *  - transactions are soft-deleted; aggregates filter `deleted_at IS NULL`.
 */

import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// --- enums ------------------------------------------------------------------

export const directionEnum = pgEnum('direction', ['in', 'out']);
export const categoryKindEnum = pgEnum('category_kind', ['expense', 'income']);
export const transactionSourceEnum = pgEnum('transaction_source', ['chat', 'miniapp', 'recurring']);
export const cadenceEnum = pgEnum('cadence', ['daily', 'weekly', 'monthly', 'yearly']);
export const ocrStatusEnum = pgEnum('ocr_status', ['none', 'pending', 'done', 'failed']);

// --- users ------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Telegram's numeric user id. Stored as bigint; exposed to clients as a string. */
    telegramId: bigint('telegram_id', { mode: 'bigint' }).notNull(),
    firstName: text('first_name'),
    username: text('username'),
    timezone: text('timezone').notNull().default('Asia/Singapore'),
    currency: varchar('currency', { length: 3 }).notNull().default('SGD'),
    locale: text('locale').notNull().default('en-SG'),
    /** Null until the user sets one. PRD F6.6: never fabricate a budget. */
    monthlyBudgetCents: integer('monthly_budget_cents'),
    digestHour: smallint('digest_hour').notNull().default(21),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    nudgeEnabled: boolean('nudge_enabled').notNull().default(true),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_telegram_id_uq').on(t.telegramId),
    check('users_digest_hour_ck', sql`${t.digestHour} BETWEEN 0 AND 23`),
    check(
      'users_monthly_budget_ck',
      sql`${t.monthlyBudgetCents} IS NULL OR ${t.monthlyBudgetCents} >= 0`,
    ),
  ],
);

// --- categories -------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null marks a system default, shared by every user until they customise it. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    emoji: text('emoji').notNull(),
    /** A DESIGN.md palette token, never a hex value. */
    colorToken: text('color_token').notNull(),
    kind: categoryKindEnum('kind').notNull(),
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    excludeFromBudget: boolean('exclude_from_budget').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    /** PRD F10.3: archive, never delete — history must keep its category. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('categories_user_slug_uq').on(t.userId, t.slug),
    // Postgres treats NULLs as distinct in a unique index, so the index above
    // does NOT constrain system defaults (user_id IS NULL) — without this
    // partial index the seed would insert a fresh copy of every default
    // category on each run. It is also the conflict target the seed upserts on.
    uniqueIndex('categories_system_slug_uq')
      .on(t.slug)
      .where(sql`${t.userId} IS NULL`),
    index('categories_user_idx').on(t.userId),
  ],
);

// --- transactions -----------------------------------------------------------

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: directionEnum('direction').notNull(),
    /** Always positive. Direction carries the sign. */
    amountCents: integer('amount_cents').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    note: text('note'),
    /** The calendar date in the USER's timezone. All statistics group by this. */
    occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
    /** The instant, for ordering and audit only. Never group by this. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    source: transactionSourceEnum('source').notNull().default('chat'),
    recurringRuleId: uuid('recurring_rule_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The shape every statistics query uses: one user, one date range, live rows.
    index('transactions_user_date_idx')
      .on(t.userId, t.occurredOn)
      .where(sql`${t.deletedAt} IS NULL`),
    index('transactions_user_created_idx').on(t.userId, t.createdAt),
    index('transactions_category_idx').on(t.categoryId),
    check('transactions_amount_positive_ck', sql`${t.amountCents} > 0`),
  ],
);

// --- attachments ------------------------------------------------------------

export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * PRD F4.1: photos are never copied off Telegram. We keep the file_id and
     * proxy on demand, which makes photo storage free and unlimited.
     * GUARDRAILS.md section 4: never exposed to the client.
     */
    tgFileId: text('tg_file_id').notNull(),
    tgFileUniqueId: text('tg_file_unique_id').notNull(),
    width: integer('width'),
    height: integer('height'),
    fileSize: integer('file_size'),
    /** PRD F4.6: reserved for the v2 OCR spike so it needs no migration. */
    ocrStatus: ocrStatusEnum('ocr_status').notNull().default('none'),
    ocrPayload: jsonb('ocr_payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('attachments_transaction_idx').on(t.transactionId),
    index('attachments_user_idx').on(t.userId),
  ],
);

// --- recurring rules --------------------------------------------------------

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    direction: directionEnum('direction').notNull(),
    amountCents: integer('amount_cents').notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
    note: text('note'),
    cadence: cadenceEnum('cadence').notNull(),
    anchorDate: date('anchor_date', { mode: 'string' }).notNull(),
    /** For monthly rules: 1-31, clamped to the month's length at run time. */
    dayOfMonth: smallint('day_of_month'),
    endDate: date('end_date', { mode: 'string' }),
    /** Watermark for backfill — PRD F5.4: missed days are never skipped. */
    lastRunOn: date('last_run_on', { mode: 'string' }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recurring_rules_user_active_idx').on(t.userId, t.active),
    check('recurring_rules_amount_positive_ck', sql`${t.amountCents} > 0`),
    check(
      'recurring_rules_day_of_month_ck',
      sql`${t.dayOfMonth} IS NULL OR ${t.dayOfMonth} BETWEEN 1 AND 31`,
    ),
  ],
);

/**
 * The idempotency ledger for recurring materialisation.
 *
 * GUARDRAILS.md section 3: the cron WILL double-fire. The unique constraint
 * below is what makes that harmless, and it is the reason your rent cannot be
 * charged twice.
 */
export const recurringRuns = pgTable(
  'recurring_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ruleId: uuid('rule_id')
      .notNull()
      .references(() => recurringRules.id, { onDelete: 'cascade' }),
    occurrenceDate: date('occurrence_date', { mode: 'string' }).notNull(),
    transactionId: uuid('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('recurring_runs_rule_date_uq').on(t.ruleId, t.occurrenceDate)],
);

// --- budget history ---------------------------------------------------------

/**
 * Per-month budgets, so changing this month's budget does not retroactively
 * rewrite what "on track" meant in a past month.
 */
export const budgetPeriods = pgTable(
  'budget_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    budgetCents: integer('budget_cents').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('budget_periods_user_period_uq').on(t.userId, t.year, t.month),
    check('budget_periods_month_ck', sql`${t.month} BETWEEN 1 AND 12`),
    check('budget_periods_budget_ck', sql`${t.budgetCents} >= 0`),
  ],
);

// --- audit ------------------------------------------------------------------

/** Append-only audit log. Also what powers Undo (PRD F11.1). */
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('events_user_created_idx').on(t.userId, t.createdAt)],
);

// --- inferred types ---------------------------------------------------------

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type RecurringRule = typeof recurringRules.$inferSelect;
export type NewRecurringRule = typeof recurringRules.$inferInsert;
export type BudgetPeriod = typeof budgetPeriods.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type RecurringRun = typeof recurringRuns.$inferSelect;
