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
  type AnyPgColumn,
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
    digestHour: smallint('digest_hour').notNull().default(21),
    digestEnabled: boolean('digest_enabled').notNull().default(true),
    nudgeEnabled: boolean('nudge_enabled').notNull().default(true),
    /** PRD-adjacent: proactive budget-threshold warnings, independent of the digest. */
    alertsEnabled: boolean('alerts_enabled').notNull().default(true),
    /**
     * Which space (household) this user is currently acting in — not which
     * ones they belong to. Membership is `household_members`, many-to-many;
     * every user is always a member of at least their own personal space
     * (created alongside them in `usersRepo.upsertByTelegramId`) and may also
     * belong to any number of shared ones, switching between them with
     * `/switch`. Nullable only for the same circular-reference reason as
     * `households` below (`AnyPgColumn` breaks the type cycle, it does not
     * widen the column) — in practice the application never leaves this null
     * once a user has been created.
     */
    activeHouseholdId: uuid('active_household_id').references((): AnyPgColumn => households.id, {
      onDelete: 'set null',
    }),
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_telegram_id_uq').on(t.telegramId),
    check('users_digest_hour_ck', sql`${t.digestHour} BETWEEN 0 AND 23`),
  ],
);

/**
 * A budget pool: either one user's personal space (`isPersonal`, created
 * automatically for every user and never invited into, left, or shared) or a
 * space shared with others via an invite code. Deliberately the same shape
 * either way — a budget and a member list — so personal and shared spaces
 * work identically everywhere else in the app; only `isPersonal` gates the
 * few things that must never happen to your own space (an invite, `/leave`).
 */
export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isPersonal: boolean('is_personal').notNull().default(false),
    monthlyBudgetCents: integer('monthly_budget_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'households_budget_ck',
      sql`${t.monthlyBudgetCents} IS NULL OR ${t.monthlyBudgetCents} >= 0`,
    ),
  ],
);

/**
 * Membership — many-to-many. A user stays a member of every space they've
 * ever joined (including their own personal one) until they explicitly
 * `/leave` a shared one; `active_household_id` on `users` is just which of
 * their memberships is currently in effect for capture and every screen.
 */
export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('household_members_household_user_uq').on(t.householdId, t.userId),
    index('household_members_user_idx').on(t.userId),
  ],
);

/**
 * One-time codes for joining a household.
 *
 * `code` is globally unique (not per-household), so `/join CODE` needs no
 * other context to resolve it. `usedBy`/`usedAt` double as the idempotency
 * guard: a code can be consumed exactly once, checked by the repository
 * before granting membership, not relied on as a database constraint alone,
 * since "already used" is a state a legitimate second attempt should be told
 * about, not a silent no-op.
 */
export const householdInvites = pgTable(
  'household_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('household_invites_code_uq').on(t.code)],
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
    /**
     * The space (household — personal or shared, see `households` above)
     * this was logged into: a permanent snapshot of the author's ACTIVE space
     * at that moment, not a live lookup. Switching spaces later, or a partner
     * joining a shared one later, never moves or exposes an entry logged
     * before that point — every screen and every aggregate simply filters by
     * this column, with no other visibility rule layered on top.
     */
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'restrict' }),
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
    /**
     * Set only on a transfer tagged to a savings goal (PRD-adjacent). Funding
     * a goal never touches the monthly budget — F6.7 already excludes
     * transfers, and this column is how the goal's own progress is computed
     * (out-tagged minus in-tagged, net contribution). `set null` on goal
     * deletion, matching `categoryId`: the transaction itself is history and
     * outlives the goal.
     */
    savingsGoalId: uuid('savings_goal_id').references((): AnyPgColumn => savingsGoals.id, {
      onDelete: 'set null',
    }),
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
    // Mirrors the user-scoped index above — the shape every space-scoped
    // safe-to-spend and stats query uses (apps/server/src/api/service.ts).
    index('transactions_household_date_idx')
      .on(t.householdId, t.occurredOn)
      .where(sql`${t.deletedAt} IS NULL`),
    // Powers the goal-progress aggregate: sum by goal, live rows only.
    index('transactions_savings_goal_idx')
      .on(t.savingsGoalId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.savingsGoalId} IS NOT NULL`),
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

/**
 * One row per (user, month, threshold) crossed, so a threshold is announced
 * once per month no matter how many times the hourly tick re-checks it —
 * the same idempotency shape as recurring_runs (GUARDRAILS.md section 3).
 */
export const budgetAlerts = pgTable(
  'budget_alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    /** 80 or 100 — percent of the monthly budget crossed. */
    thresholdPct: smallint('threshold_pct').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('budget_alerts_user_period_threshold_uq').on(
      t.userId,
      t.year,
      t.month,
      t.thresholdPct,
    ),
  ],
);

// --- savings goals ------------------------------------------------------------

/**
 * A savings goal (PRD-adjacent), tracked separately from safe-to-spend.
 *
 * Personal, not household-shared — unlike the budget, a savings goal has one
 * owner even inside a shared household. It is funded by tagging a transfer
 * transaction to it (`transactions.savingsGoalId`); progress is the net of
 * those tagged transactions, computed in `packages/core/src/savings.ts`, not
 * stored here. See that file's header for the round-up-vs-round-down
 * asymmetry with safe-to-spend.
 */
export const savingsGoals = pgTable(
  'savings_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    targetCents: integer('target_cents').notNull(),
    targetDate: date('target_date', { mode: 'string' }),
    /** Archive, never delete — matches categories.archivedAt (PRD F10.3). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('savings_goals_user_idx')
      .on(t.userId)
      .where(sql`${t.archivedAt} IS NULL`),
    check('savings_goals_target_positive_ck', sql`${t.targetCents} > 0`),
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
export type BudgetAlert = typeof budgetAlerts.$inferSelect;
export type Household = typeof households.$inferSelect;
export type HouseholdMember = typeof householdMembers.$inferSelect;
export type HouseholdInvite = typeof householdInvites.$inferSelect;
export type SavingsGoal = typeof savingsGoals.$inferSelect;
export type NewSavingsGoal = typeof savingsGoals.$inferInsert;
