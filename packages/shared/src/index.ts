/**
 * The contract between the server and the Mini App.
 *
 * Both sides import these schemas, so a change to a response shape is a
 * typecheck failure rather than a runtime surprise. Amounts always cross the
 * wire as integer cents (GUARDRAILS.md section 2).
 */

import { z } from 'zod';

// --- primitives -------------------------------------------------------------

export const directionSchema = z.enum(['in', 'out']);
export type Direction = z.infer<typeof directionSchema>;

export const transactionSourceSchema = z.enum(['chat', 'miniapp', 'recurring']);
export type TransactionSource = z.infer<typeof transactionSourceSchema>;

export const categoryKindSchema = z.enum(['expense', 'income']);
export type CategoryKind = z.infer<typeof categoryKindSchema>;

export const cadenceSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
export type Cadence = z.infer<typeof cadenceSchema>;

export const paceSchema = z.enum(['ahead', 'on_track', 'behind', 'over_budget']);
export type Pace = z.infer<typeof paceSchema>;

/** Integer minor units. Never a decimal — see GUARDRAILS.md section 2. */
export const amountCentsSchema = z
  .number()
  .int('Amounts must be whole cents')
  .positive('Amount must be greater than zero')
  .max(1_000_000_000, 'Amount is implausibly large');

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

// --- errors -----------------------------------------------------------------

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    /** Present only for validation failures. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// --- GET /healthz -----------------------------------------------------------

/**
 * `bot` and `webhook` are in-memory flags, not live checks — `/healthz` must
 * stay dependency-free (GUARDRAILS.md section 7). They exist so the state that
 * usually requires reading deploy logs can be read from a browser instead.
 * Deliberately free of URLs, tokens and counts, since this endpoint is public.
 */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number(),
  bot: z.enum(['starting', 'ready']),
  webhook: z.enum(['pending', 'registered', 'rejected', 'skipped']),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

// --- households ---------------------------------------------------------

export const householdMemberSchema = z.object({
  userId: z.string().uuid(),
  firstName: z.string().nullable(),
  isSelf: z.boolean(),
});

export const householdSchema = z.object({
  id: z.string().uuid(),
  members: z.array(householdMemberSchema),
});
export type Household = z.infer<typeof householdSchema>;

export const householdResponseSchema = z.object({
  household: householdSchema.nullable(),
});
export type HouseholdResponse = z.infer<typeof householdResponseSchema>;

export const householdInviteResponseSchema = z.object({
  code: z.string(),
  expiresAt: z.string().datetime(),
});
export type HouseholdInviteResponse = z.infer<typeof householdInviteResponseSchema>;

// --- spaces (PRD F12): every space a user belongs to, for the switcher -----

export const spaceSchema = z.object({
  id: z.string().uuid(),
  isPersonal: z.boolean(),
  isActive: z.boolean(),
  members: z.array(householdMemberSchema),
});
export type Space = z.infer<typeof spaceSchema>;

export const spacesResponseSchema = z.object({
  spaces: z.array(spaceSchema),
});
export type SpacesResponse = z.infer<typeof spacesResponseSchema>;

export const switchSpaceBodySchema = z.object({
  householdId: z.string().uuid(),
});
export type SwitchSpaceBody = z.infer<typeof switchSpaceBodySchema>;

// --- GET /api/me ------------------------------------------------------------

export const meResponseSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    telegramId: z.string(),
    firstName: z.string().nullable(),
    username: z.string().nullable(),
    timezone: z.string(),
    currency: z.string(),
    locale: z.string(),
    /**
     * The budget governing this user RIGHT NOW — the household's once they're
     * in one, never their own dormant personal figure. See
     * apps/server/src/api/service.ts#effectiveBudgetCents.
     */
    monthlyBudgetCents: z.number().int().nonnegative().nullable(),
    digestHour: z.number().int().min(0).max(23),
    digestEnabled: z.boolean(),
    nudgeEnabled: z.boolean(),
    alertsEnabled: z.boolean(),
    onboardedAt: z.string().datetime().nullable(),
  }),
  household: householdSchema.nullable(),
  /** Today's date in the user's timezone — the client must not compute this. */
  today: isoDateSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// --- GET /api/categories ----------------------------------------------------

export const categorySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  emoji: z.string(),
  colorToken: z.string(),
  kind: categoryKindSchema,
  excludeFromBudget: z.boolean(),
  sortOrder: z.number().int(),
});
export type Category = z.infer<typeof categorySchema>;

export const categoriesResponseSchema = z.object({
  categories: z.array(categorySchema),
});
export type CategoriesResponse = z.infer<typeof categoriesResponseSchema>;

// --- transactions -----------------------------------------------------------

export const transactionSchema = z.object({
  id: z.string().uuid(),
  direction: directionSchema,
  amountCents: z.number().int().positive(),
  note: z.string().nullable(),
  occurredOn: isoDateSchema,
  source: transactionSourceSchema,
  createdAt: z.string().datetime(),
  categoryId: z.string().uuid().nullable(),
  categorySlug: z.string().nullable(),
  categoryName: z.string().nullable(),
  categoryEmoji: z.string().nullable(),
  categoryColorToken: z.string().nullable(),
  /**
   * Who logged this. Always present, but the Mini App only needs to render it
   * when viewing a shared household — that's the whole point of a shared
   * budget being transparent rather than merely combined.
   */
  authorUserId: z.string().uuid(),
  authorName: z.string(),
  /** True when this is the viewer's own entry — lets the UI skip the label. */
  isOwn: z.boolean(),
  /** Whether to show the photo badge — avoids a round trip per row to find out. */
  hasPhoto: z.boolean(),
});
export type Transaction = z.infer<typeof transactionSchema>;

export const createTransactionSchema = z.object({
  direction: directionSchema,
  amountCents: amountCentsSchema,
  categoryId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
  /** Defaults to today in the user's timezone when omitted. */
  occurredOn: isoDateSchema.optional(),
});
export type CreateTransactionBody = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = createTransactionSchema.partial();
export type UpdateTransactionBody = z.infer<typeof updateTransactionSchema>;

export const transactionsResponseSchema = z.object({
  transactions: z.array(transactionSchema),
});
export type TransactionsResponse = z.infer<typeof transactionsResponseSchema>;

export const transactionResponseSchema = z.object({
  transaction: transactionSchema,
  /** The recalculated figure, so the client can animate straight to it. */
  safeToSpend: z.lazy(() => safeToSpendSchema),
});

// --- safe to spend (F6) -----------------------------------------------------

export const safeToSpendSchema = z.object({
  hasBudget: z.boolean(),
  budgetCents: z.number().int().nonnegative().nullable(),
  spentMonthToDateCents: z.number().int().nonnegative(),
  spentTodayCents: z.number().int().nonnegative(),
  remainingCents: z.number().int(),
  safeTodayCents: z.number().int().nonnegative(),
  leftForTodayCents: z.number().int().nonnegative(),
  overspentCents: z.number().int().nonnegative(),
  daysRemaining: z.number().int().positive(),
  dayOfMonth: z.number().int().positive(),
  daysInMonth: z.number().int().positive(),
  expectedSpendCents: z.number().int().nonnegative(),
  projectedSpendCents: z.number().int().nonnegative(),
  pace: paceSchema,
  budgetUsedRatio: z.number().min(0).max(1),
});
export type SafeToSpend = z.infer<typeof safeToSpendSchema>;

// --- streaks ------------------------------------------------------------

export const streakSchema = z.object({
  /** Consecutive days ending today or yesterday. 0 once a day has been skipped. */
  current: z.number().int().nonnegative(),
  /** The longest run in the lookback window (packages/core/src/streaks.ts). */
  longest: z.number().int().nonnegative(),
});
export type Streak = z.infer<typeof streakSchema>;

// --- GET /api/today ---------------------------------------------------------

export const todayResponseSchema = z.object({
  today: isoDateSchema,
  currency: z.string(),
  locale: z.string(),
  safeToSpend: safeToSpendSchema,
  monthIn: z.number().int().nonnegative(),
  monthOut: z.number().int().nonnegative(),
  transactions: z.array(transactionSchema),
  /** Last 7 days including today, oldest first. For the sparkline. */
  recentDays: z.array(z.object({ day: isoDateSchema, outCents: z.number().int().nonnegative() })),
  streak: streakSchema,
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

// --- GET /api/stats ---------------------------------------------------------

export const statsPeriodSchema = z.enum(['day', 'month', 'year']);
export type StatsPeriod = z.infer<typeof statsPeriodSchema>;

export const statsResponseSchema = z.object({
  period: statsPeriodSchema,
  from: isoDateSchema,
  to: isoDateSchema,
  label: z.string(),
  inCents: z.number().int().nonnegative(),
  outCents: z.number().int().nonnegative(),
  netCents: z.number().int(),
  count: z.number().int().nonnegative(),
  byCategory: z.array(
    z.object({
      categoryId: z.string().uuid().nullable(),
      name: z.string(),
      emoji: z.string(),
      colorToken: z.string(),
      outCents: z.number().int().nonnegative(),
      count: z.number().int().nonnegative(),
    }),
  ),
  /** Buckets across the period: hours for a day, days for a month, months for a year. */
  series: z.array(
    z.object({
      label: z.string(),
      key: z.string(),
      outCents: z.number().int().nonnegative(),
      inCents: z.number().int().nonnegative(),
    }),
  ),
  /** The equivalent previous period, for the "vs last month" comparison. */
  previousOutCents: z.number().int().nonnegative(),
});
export type StatsResponse = z.infer<typeof statsResponseSchema>;

// --- GET /api/transactions/:id/photos (PRD F4) -------------------------

export const photosResponseSchema = z.object({
  photos: z.array(
    z.object({
      id: z.string().uuid(),
      width: z.number().int().positive().nullable(),
      height: z.number().int().positive().nullable(),
    }),
  ),
});
export type PhotosResponse = z.infer<typeof photosResponseSchema>;

// --- GET /api/recap -----------------------------------------------------

export const recapPeriodSchema = z.enum(['month', 'year']);
export type RecapPeriod = z.infer<typeof recapPeriodSchema>;

export const recapResponseSchema = z.object({
  period: recapPeriodSchema,
  label: z.string(),
  from: isoDateSchema,
  to: isoDateSchema,
  inCents: z.number().int().nonnegative(),
  outCents: z.number().int().nonnegative(),
  netCents: z.number().int(),
  previousOutCents: z.number().int().nonnegative(),
  /** Percent change vs. the previous period. Null with nothing to compare against. */
  deltaPct: z.number().int().nullable(),
  /** Highest spend first. */
  topCategories: z.array(
    z.object({
      categoryId: z.string().uuid().nullable(),
      name: z.string(),
      emoji: z.string(),
      colorToken: z.string(),
      outCents: z.number().int().nonnegative(),
      count: z.number().int().nonnegative(),
    }),
  ),
  bestDay: z.object({ day: isoDateSchema, outCents: z.number().int().nonnegative() }).nullable(),
  worstDay: z.object({ day: isoDateSchema, outCents: z.number().int().nonnegative() }).nullable(),
  streak: streakSchema,
});
export type RecapResponse = z.infer<typeof recapResponseSchema>;

// --- PATCH /api/settings ----------------------------------------------------

export const updateSettingsSchema = z.object({
  monthlyBudgetCents: z.number().int().nonnegative().nullable().optional(),
  timezone: z.string().min(1).optional(),
  digestHour: z.number().int().min(0).max(23).optional(),
  digestEnabled: z.boolean().optional(),
  nudgeEnabled: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
});
export type UpdateSettingsBody = z.infer<typeof updateSettingsSchema>;

// --- recurring rules (F5) ----------------------------------------------------

export const recurringRuleSchema = z.object({
  id: z.string().uuid(),
  direction: directionSchema,
  amountCents: z.number().int().positive(),
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string().nullable(),
  categoryEmoji: z.string().nullable(),
  note: z.string().nullable(),
  cadence: cadenceSchema,
  anchorDate: isoDateSchema,
  dayOfMonth: z.number().int().min(1).max(31).nullable(),
  endDate: isoDateSchema.nullable(),
  lastRunOn: isoDateSchema.nullable(),
  active: z.boolean(),
});
export type RecurringRule = z.infer<typeof recurringRuleSchema>;

export const createRecurringRuleSchema = z
  .object({
    direction: directionSchema,
    amountCents: amountCentsSchema,
    categoryId: z.string().uuid().nullable().optional(),
    note: z.string().trim().max(280).nullable().optional(),
    cadence: cadenceSchema,
    anchorDate: isoDateSchema,
    dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
    endDate: isoDateSchema.nullable().optional(),
  })
  .refine(
    (value) =>
      value.cadence === 'monthly' || value.cadence === 'yearly'
        ? value.dayOfMonth !== null && value.dayOfMonth !== undefined
        : true,
    { message: 'dayOfMonth is required for monthly and yearly rules', path: ['dayOfMonth'] },
  );
export type CreateRecurringRuleBody = z.infer<typeof createRecurringRuleSchema>;

export const recurringRulesResponseSchema = z.object({
  rules: z.array(recurringRuleSchema),
});
export type RecurringRulesResponse = z.infer<typeof recurringRulesResponseSchema>;

// --- savings goals (PRD-adjacent) --------------------------------------------

/**
 * A goal's progress, computed server-side by
 * `packages/core/src/savings.ts#calculateGoalProgress` — never derived on the
 * client, same reasoning as `safeToSpendSchema`.
 */
export const savingsGoalSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  targetCents: z.number().int().positive(),
  targetDate: isoDateSchema.nullable(),
  contributedCents: z.number().int().nonnegative(),
  remainingCents: z.number().int().nonnegative(),
  achieved: z.boolean(),
  overdue: z.boolean(),
  monthsRemaining: z.number().int().positive().nullable(),
  suggestedMonthlyCents: z.number().int().positive().nullable(),
  progressRatio: z.number().min(0).max(1),
});
export type SavingsGoal = z.infer<typeof savingsGoalSchema>;

export const savingsGoalsResponseSchema = z.object({
  goals: z.array(savingsGoalSchema),
});
export type SavingsGoalsResponse = z.infer<typeof savingsGoalsResponseSchema>;

export const savingsGoalResponseSchema = z.object({
  goal: savingsGoalSchema,
});
export type SavingsGoalResponse = z.infer<typeof savingsGoalResponseSchema>;

export const createSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  targetCents: amountCentsSchema,
  targetDate: isoDateSchema.nullable().optional(),
});
export type CreateSavingsGoalBody = z.infer<typeof createSavingsGoalSchema>;

export const updateSavingsGoalSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  targetCents: amountCentsSchema.optional(),
  targetDate: isoDateSchema.nullable().optional(),
});
export type UpdateSavingsGoalBody = z.infer<typeof updateSavingsGoalSchema>;

/**
 * Funding a goal is a real transaction, tagged to it and auto-categorised as
 * a transfer (PRD F6.7: excluded from budget). `direction: 'out'` moves money
 * into the goal; `'in'` withdraws it — see the core module's file header for
 * why net contribution, not a running total, is the right model.
 */
export const contributeToGoalSchema = z.object({
  amountCents: amountCentsSchema,
  direction: directionSchema.default('out'),
  note: z.string().trim().max(280).nullable().optional(),
  occurredOn: isoDateSchema.optional(),
});
export type ContributeToGoalBody = z.infer<typeof contributeToGoalSchema>;

// --- POST /tasks/tick -------------------------------------------------------

export const tickResponseSchema = z.object({
  ok: z.literal(true),
  ranAt: z.string().datetime(),
  recurringMaterialised: z.number().int().nonnegative(),
  digestsSent: z.number().int().nonnegative(),
  alertsSent: z.number().int().nonnegative(),
});
export type TickResponse = z.infer<typeof tickResponseSchema>;
