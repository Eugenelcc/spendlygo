import { Hono } from 'hono';
import {
  addDays,
  addMonths,
  daysInMonth,
  inferCategorySlug,
  isoDateOf,
  monthRange,
  parseIsoDate,
  toIsoDate,
  ValidationError,
  yearRange,
  type IsoDate,
} from '@spendlygo/core';
import {
  categoriesRepo,
  recurringRepo,
  transactionsRepo,
  usersRepo,
  type RecurringRule as DbRecurringRule,
} from '@spendlygo/db';
import {
  createRecurringRuleSchema,
  createTransactionSchema,
  statsPeriodSchema,
  updateSettingsSchema,
  updateTransactionSchema,
  type CategoriesResponse,
  type MeResponse,
  type RecurringRulesResponse,
  type SafeToSpend,
  type StatsResponse,
  type TodayResponse,
  type TransactionsResponse,
} from '@spendlygo/shared';
import { NotFoundError } from '@spendlygo/core';
import type { AppContext } from '../context.js';
import { requireInitData, type ApiEnv } from '../middleware/auth.js';
import { computeSafeToSpend, recentDailySpend, toApiTransaction, todayFor } from './service.js';

/** Zod result -> ValidationError, so the error handler maps it to a 400. */
async function parseBody<T>(
  c: { req: { json: () => Promise<unknown> } },
  schema: { safeParse: (value: unknown) => { success: boolean; data?: T; error?: unknown } },
): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ValidationError('Request body must be JSON');
  }

  const result = schema.safeParse(raw);
  if (!result.success || result.data === undefined) {
    const issues = (result.error as { issues?: Array<{ path: unknown[]; message: string }> })
      ?.issues;
    const detail = issues?.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new ValidationError(detail ?? 'Invalid request body');
  }
  return result.data;
}

function serialiseSafeToSpend(result: Awaited<ReturnType<typeof computeSafeToSpend>>): SafeToSpend {
  return {
    hasBudget: result.hasBudget,
    budgetCents: result.budgetCents,
    spentMonthToDateCents: result.spentMonthToDateCents,
    spentTodayCents: result.spentTodayCents,
    remainingCents: result.remainingCents,
    safeTodayCents: result.safeTodayCents,
    leftForTodayCents: result.leftForTodayCents,
    overspentCents: result.overspentCents,
    daysRemaining: result.daysRemaining,
    dayOfMonth: result.dayOfMonth,
    daysInMonth: result.daysInMonth,
    expectedSpendCents: result.expectedSpendCents,
    projectedSpendCents: result.projectedSpendCents,
    pace: result.pace,
    budgetUsedRatio: result.budgetUsedRatio,
  };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function createApiRouter(ctx: AppContext): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();

  api.use('*', requireInitData(ctx));

  // --- account --------------------------------------------------------------

  api.get('/me', (c) => {
    const user = c.get('user');
    const body: MeResponse = {
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        username: user.username,
        timezone: user.timezone,
        currency: user.currency,
        locale: user.locale,
        monthlyBudgetCents: user.monthlyBudgetCents,
        digestHour: user.digestHour,
        digestEnabled: user.digestEnabled,
        nudgeEnabled: user.nudgeEnabled,
        onboardedAt: user.onboardedAt?.toISOString() ?? null,
      },
      // PRD F7.2: the client must never derive a period boundary from the
      // device clock — it is resolved here, in the user's timezone.
      today: isoDateOf(ctx.clock.now(), user.timezone),
    };
    return c.json(body);
  });

  api.patch('/settings', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, updateSettingsSchema);
    const updated = await usersRepo.updateSettings(ctx.db, user.id, input);

    return c.json({
      user: {
        monthlyBudgetCents: updated.monthlyBudgetCents,
        timezone: updated.timezone,
        digestHour: updated.digestHour,
        digestEnabled: updated.digestEnabled,
        nudgeEnabled: updated.nudgeEnabled,
      },
    });
  });

  api.get('/categories', async (c) => {
    const user = c.get('user');
    const rows = await categoriesRepo.listForUser(ctx.db, user.id);

    const body: CategoriesResponse = {
      categories: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        emoji: row.emoji,
        colorToken: row.colorToken,
        kind: row.kind,
        excludeFromBudget: row.excludeFromBudget,
        sortOrder: row.sortOrder,
      })),
    };
    return c.json(body);
  });

  // --- the home screen ------------------------------------------------------

  api.get('/today', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const month = monthRange(parseIsoDate(today).year, parseIsoDate(today).month);

    const [safeToSpend, monthTotals, todayTransactions, recentDays] = await Promise.all([
      computeSafeToSpend(ctx, user, today),
      transactionsRepo.totalsForPeriod(ctx.db, user.id, month.start, month.end),
      transactionsRepo.list(ctx.db, user.id, { from: today, to: today, limit: 100 }),
      recentDailySpend(ctx, user, today),
    ]);

    const body: TodayResponse = {
      today,
      currency: user.currency,
      locale: user.locale,
      safeToSpend: serialiseSafeToSpend(safeToSpend),
      monthIn: monthTotals.inCents,
      monthOut: monthTotals.outCents,
      transactions: todayTransactions.map(toApiTransaction),
      recentDays,
    };
    return c.json(body);
  });

  // --- transactions ---------------------------------------------------------

  api.get('/transactions', async (c) => {
    const user = c.get('user');
    const { from, to, limit, offset } = c.req.query();

    const rows = await transactionsRepo.list(ctx.db, user.id, {
      from,
      to,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });

    const body: TransactionsResponse = { transactions: rows.map(toApiTransaction) };
    return c.json(body);
  });

  api.post('/transactions', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, createTransactionSchema);
    const today = todayFor(ctx, user);

    // An uncategorised entry still gets a best guess from its note, so the
    // Mini App and the chat behave identically (PRD F10.4).
    const categoryId = input.categoryId ?? (await guessCategoryId(ctx, user.id, input));

    const created = await transactionsRepo.create(ctx.db, {
      userId: user.id,
      direction: input.direction,
      amountCents: input.amountCents,
      categoryId,
      note: input.note ?? null,
      occurredOn: input.occurredOn ?? today,
      source: 'miniapp',
    });

    const [view, safeToSpend] = await Promise.all([
      transactionsRepo.findById(ctx.db, user.id, created.id),
      computeSafeToSpend(ctx, user, today),
    ]);

    if (!view) throw new NotFoundError('Transaction vanished after being created');

    return c.json(
      {
        transaction: toApiTransaction(view),
        // Returned so the ring can animate straight to its new value without a
        // second round trip (DESIGN.md section 5.2).
        safeToSpend: serialiseSafeToSpend(safeToSpend),
      },
      201,
    );
  });

  api.patch('/transactions/:id', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, updateTransactionSchema);

    const updated = await transactionsRepo.update(ctx.db, user.id, c.req.param('id'), {
      ...(input.direction !== undefined && { direction: input.direction }),
      ...(input.amountCents !== undefined && { amountCents: input.amountCents }),
      ...(input.categoryId !== undefined && { categoryId: input.categoryId }),
      ...(input.note !== undefined && { note: input.note }),
      ...(input.occurredOn !== undefined && { occurredOn: input.occurredOn }),
    });

    if (!updated) throw new NotFoundError('No such transaction');

    const safeToSpend = await computeSafeToSpend(ctx, user);
    return c.json({
      transaction: toApiTransaction(updated),
      safeToSpend: serialiseSafeToSpend(safeToSpend),
    });
  });

  api.delete('/transactions/:id', async (c) => {
    const user = c.get('user');
    const deleted = await transactionsRepo.softDelete(ctx.db, user.id, c.req.param('id'));
    if (!deleted) throw new NotFoundError('No such transaction');

    const safeToSpend = await computeSafeToSpend(ctx, user);
    return c.json({ ok: true, safeToSpend: serialiseSafeToSpend(safeToSpend) });
  });

  // --- statistics -----------------------------------------------------------

  api.get('/stats', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const period = statsPeriodSchema.parse(c.req.query('period') ?? 'month');
    const anchor = (c.req.query('anchor') as IsoDate | undefined) ?? today;

    const body = await buildStats(ctx, user.id, period, anchor);
    return c.json(body);
  });

  // --- recurring rules (F5) --------------------------------------------------

  api.get('/recurring', async (c) => {
    const user = c.get('user');
    const [rules, categories] = await Promise.all([
      recurringRepo.listActiveForUser(ctx.db, user.id),
      categoriesRepo.listForUser(ctx.db, user.id, { includeArchived: true }),
    ]);
    const categoryById = new Map(categories.map((cat) => [cat.id, cat]));

    const body: RecurringRulesResponse = {
      rules: rules.map((rule) => toApiRule(rule, categoryById)),
    };
    return c.json(body);
  });

  api.post('/recurring', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, createRecurringRuleSchema);

    const created = await recurringRepo.create(ctx.db, {
      userId: user.id,
      direction: input.direction,
      amountCents: input.amountCents,
      categoryId: input.categoryId ?? null,
      note: input.note ?? null,
      cadence: input.cadence,
      anchorDate: input.anchorDate,
      dayOfMonth: input.dayOfMonth ?? null,
      endDate: input.endDate ?? null,
    });

    const categories = await categoriesRepo.listForUser(ctx.db, user.id, { includeArchived: true });
    const categoryById = new Map(categories.map((cat) => [cat.id, cat]));

    return c.json({ rule: toApiRule(created, categoryById) }, 201);
  });

  api.delete('/recurring/:id', async (c) => {
    const user = c.get('user');
    const deleted = await recurringRepo.deactivate(ctx.db, user.id, c.req.param('id'));
    if (!deleted) throw new NotFoundError('No such recurring rule');
    return c.json({ ok: true });
  });

  return api;
}

function toApiRule(
  rule: DbRecurringRule,
  categoryById: Map<string, { name: string; emoji: string }>,
): RecurringRulesResponse['rules'][number] {
  const category = rule.categoryId ? categoryById.get(rule.categoryId) : undefined;
  return {
    id: rule.id,
    direction: rule.direction,
    amountCents: rule.amountCents,
    categoryId: rule.categoryId,
    categoryName: category?.name ?? null,
    categoryEmoji: category?.emoji ?? null,
    note: rule.note,
    cadence: rule.cadence,
    anchorDate: rule.anchorDate,
    dayOfMonth: rule.dayOfMonth,
    endDate: rule.endDate,
    lastRunOn: rule.lastRunOn,
    active: rule.active,
  };
}

async function guessCategoryId(
  ctx: AppContext,
  userId: string,
  input: { note?: string | null; direction: 'in' | 'out' },
): Promise<string | null> {
  if (!input.note) return null;

  const all = await categoriesRepo.listForUser(ctx.db, userId);
  const slug = inferCategorySlug(
    input.note,
    all.map((c) => ({ slug: c.slug, kind: c.kind, keywords: c.keywords })),
    input.direction === 'in' ? 'income' : 'expense',
  );
  if (!slug) return null;
  return all.find((c) => c.slug === slug)?.id ?? null;
}

async function buildStats(
  ctx: AppContext,
  userId: string,
  period: 'day' | 'month' | 'year',
  anchor: IsoDate,
): Promise<StatsResponse> {
  const { year, month, day } = parseIsoDate(anchor);

  let from: IsoDate;
  let to: IsoDate;
  let label: string;
  let previousFrom: IsoDate;
  let previousTo: IsoDate;

  if (period === 'day') {
    from = anchor;
    to = anchor;
    label = `${day} ${MONTH_NAMES[month - 1]}`;
    previousFrom = addDays(anchor, -1);
    previousTo = previousFrom;
  } else if (period === 'month') {
    const range = monthRange(year, month);
    from = range.start;
    to = range.end;
    label = `${MONTH_NAMES[month - 1]} ${year}`;
    const previousAnchor = addMonths(range.start, -1);
    const previousRange = monthRange(
      parseIsoDate(previousAnchor).year,
      parseIsoDate(previousAnchor).month,
    );
    previousFrom = previousRange.start;
    previousTo = previousRange.end;
  } else {
    const range = yearRange(year);
    from = range.start;
    to = range.end;
    label = String(year);
    previousFrom = toIsoDate({ year: year - 1, month: 1, day: 1 });
    previousTo = toIsoDate({ year: year - 1, month: 12, day: 31 });
  }

  const [totals, byCategory, previous] = await Promise.all([
    transactionsRepo.totalsForPeriod(ctx.db, userId, from, to),
    transactionsRepo.totalsByCategory(ctx.db, userId, from, to),
    transactionsRepo.totalsForPeriod(ctx.db, userId, previousFrom, previousTo),
  ]);

  const series = await buildSeries(ctx, userId, period, from, to, year, month);

  return {
    period,
    from,
    to,
    label,
    inCents: totals.inCents,
    outCents: totals.outCents,
    netCents: totals.inCents - totals.outCents,
    count: totals.count,
    byCategory: byCategory.map((row) => ({
      categoryId: row.categoryId,
      name: row.name ?? 'Uncategorised',
      emoji: row.emoji ?? '❓',
      colorToken: row.colorToken ?? 'uncategorised',
      outCents: row.outCents,
      count: row.count,
    })),
    series,
    previousOutCents: previous.outCents,
  };
}

/**
 * Bucket the period for charting. Gaps are filled with zero here rather than in
 * SQL, because a bar chart with holes in it reads as missing data.
 */
async function buildSeries(
  ctx: AppContext,
  userId: string,
  period: 'day' | 'month' | 'year',
  from: IsoDate,
  to: IsoDate,
  year: number,
  month: number,
): Promise<StatsResponse['series']> {
  if (period === 'year') {
    const rows = await transactionsRepo.totalsByMonth(ctx.db, userId, from, to);
    const byMonth = new Map(rows.map((row) => [row.month, row]));

    return Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const row = byMonth.get(key);
      return {
        key,
        label: MONTH_NAMES[index]?.slice(0, 3) ?? '',
        outCents: row?.outCents ?? 0,
        inCents: row?.inCents ?? 0,
      };
    });
  }

  const rows = await transactionsRepo.totalsByDay(ctx.db, userId, from, to);
  const byDay = new Map(rows.map((row) => [row.day, row]));

  if (period === 'day') {
    const row = byDay.get(from);
    return [
      {
        key: from,
        label: 'Today',
        outCents: row?.outCents ?? 0,
        inCents: row?.inCents ?? 0,
      },
    ];
  }

  const total = daysInMonth(year, month);
  return Array.from({ length: total }, (_, index) => {
    const key = toIsoDate({ year, month, day: index + 1 });
    const row = byDay.get(key);
    return {
      key,
      label: String(index + 1),
      outCents: row?.outCents ?? 0,
      inCents: row?.inCents ?? 0,
    };
  });
}
