import { Hono } from 'hono';
import {
  addDays,
  addMonths,
  daysInMonth,
  inferCategorySlug,
  isoDateOf,
  monthName,
  monthRange,
  netBalances,
  parseIsoDate,
  ServiceUnavailableError,
  simplifyBalances,
  toIsoDate,
  ValidationError,
  yearRange,
  type IsoDate,
} from '@spendlygo/core';
import {
  attachmentsRepo,
  categoriesRepo,
  householdsRepo,
  JoinHouseholdError,
  recurringRepo,
  savingsRepo,
  transactionsRepo,
  usersRepo,
  type RecurringRule as DbRecurringRule,
  type User,
} from '@spendlygo/db';
import {
  contributeToGoalSchema,
  createRecurringRuleSchema,
  createSavingsGoalSchema,
  createTransactionSchema,
  recapPeriodSchema,
  statsPeriodSchema,
  switchSpaceBodySchema,
  updateSavingsGoalSchema,
  updateSettingsSchema,
  updateTransactionSchema,
  type CategoriesResponse,
  type FxRateResponse,
  type GoalProgressResponse,
  type HeatmapResponse,
  type Household as ApiHousehold,
  type HouseholdBalancesResponse,
  type HouseholdInviteResponse,
  type HouseholdResponse,
  type MeResponse,
  type PhotosResponse,
  type RecapResponse,
  type RecurringRulesResponse,
  type SafeToSpend,
  type SavingsGoalResponse,
  type SavingsGoalsResponse,
  type Space as ApiSpace,
  type SpacesResponse,
  type StatsResponse,
  type TodayResponse,
  type TransactionsResponse,
  type TransactionSplitsResponse,
} from '@spendlygo/shared';
import { NotFoundError } from '@spendlygo/core';
import type { SpendlygoBot } from '../bot/index.js';
import type { AppContext } from '../context.js';
import { fetchFxRate } from '../fx.js';
import { requireInitData, type ApiEnv } from '../middleware/auth.js';
import { resolveFileUrl } from '../telegram/photos.js';
import { buildExportCsv, exportFilename, parseExportRange } from './export.js';
import { buildRecap } from './recap.js';
import {
  activeHouseholdId,
  computeSafeToSpend,
  computeStreak,
  effectiveBudgetCents,
  recentDailySpend,
  toApiSavingsGoal,
  toApiTransaction,
  todayFor,
} from './service.js';

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

export function createApiRouter(ctx: AppContext, bot: SpendlygoBot): Hono<ApiEnv> {
  const api = new Hono<ApiEnv>();

  api.use('*', requireInitData(ctx));

  // --- account --------------------------------------------------------------

  api.get('/me', async (c) => {
    const user = c.get('user');
    const [budgetCents, household] = await Promise.all([
      effectiveBudgetCents(ctx, user),
      loadHouseholdView(ctx, user),
    ]);

    const body: MeResponse = {
      user: {
        id: user.id,
        telegramId: user.telegramId.toString(),
        firstName: user.firstName,
        username: user.username,
        timezone: user.timezone,
        currency: user.currency,
        locale: user.locale,
        monthlyBudgetCents: budgetCents,
        digestHour: user.digestHour,
        digestEnabled: user.digestEnabled,
        nudgeEnabled: user.nudgeEnabled,
        alertsEnabled: user.alertsEnabled,
        onboardedAt: user.onboardedAt?.toISOString() ?? null,
      },
      household,
      // PRD F7.2: the client must never derive a period boundary from the
      // device clock — it is resolved here, in the user's timezone.
      today: isoDateOf(ctx.clock.now(), user.timezone),
    };
    return c.json(body);
  });

  api.patch('/settings', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, updateSettingsSchema);
    const { monthlyBudgetCents, ...personalInput } = input;

    // The budget always lives on the active space — personal or shared, they
    // work identically (packages/db/src/schema.ts).
    if (monthlyBudgetCents !== undefined) {
      await householdsRepo.updateBudget(ctx.db, activeHouseholdId(user), monthlyBudgetCents);
    }

    const updated = await usersRepo.updateSettings(ctx.db, user.id, personalInput);
    const effectiveCents = await effectiveBudgetCents(ctx, updated);

    return c.json({
      user: {
        monthlyBudgetCents: effectiveCents,
        timezone: updated.timezone,
        digestHour: updated.digestHour,
        digestEnabled: updated.digestEnabled,
        nudgeEnabled: updated.nudgeEnabled,
        alertsEnabled: updated.alertsEnabled,
      },
    });
  });

  // --- household (shared budget) ---------------------------------------------

  api.get('/household', async (c) => {
    const user = c.get('user');
    const body: HouseholdResponse = { household: await loadHouseholdView(ctx, user) };
    return c.json(body);
  });

  // Who-owes-who (PRD-adjacent) — empty arrays for a personal space, never
  // an error, so the Mini App can call this unconditionally.
  api.get('/household/balances', async (c) => {
    const user = c.get('user');
    const householdId = activeHouseholdId(user);
    const household = await householdsRepo.findById(ctx.db, householdId);

    if (!household || household.isPersonal) {
      const body: HouseholdBalancesResponse = { balances: [], settlements: [] };
      return c.json(body);
    }

    const [members, raw] = await Promise.all([
      householdsRepo.membersOf(ctx.db, householdId),
      transactionsRepo.balancesFor(ctx.db, householdId),
    ]);

    const rawByUser = new Map(raw.map((row) => [row.userId, row]));
    const balances = members.map((member) => {
      const totals = rawByUser.get(member.id) ?? { paidCents: 0, owedCents: 0 };
      return { userId: member.id, firstName: member.firstName, ...totals };
    });

    const nets = netBalances(balances);
    const settlements = simplifyBalances(balances);
    const nameOf = (id: string) => members.find((m) => m.id === id)?.firstName ?? null;

    const body: HouseholdBalancesResponse = {
      balances: nets.map((b) => ({
        userId: b.userId,
        firstName: nameOf(b.userId),
        isSelf: b.userId === user.id,
        netCents: b.netCents,
      })),
      settlements: settlements.map((s) => ({
        fromUserId: s.fromUserId,
        fromName: nameOf(s.fromUserId),
        toUserId: s.toUserId,
        toName: nameOf(s.toUserId),
        amountCents: s.amountCents,
      })),
    };
    return c.json(body);
  });

  api.post('/household/invite', async (c) => {
    const user = c.get('user');
    // Invite into whatever's already active if it's a real shared space;
    // otherwise (active is personal) start a new one and switch into it —
    // same rule the bot's `/household invite` uses.
    const active = await householdsRepo.findById(ctx.db, activeHouseholdId(user));
    const householdId =
      active !== null && !active.isPersonal
        ? active.id
        : (await householdsRepo.create(ctx.db, user.id)).id;
    const invite = await householdsRepo.createInvite(ctx.db, householdId, user.id);

    const body: HouseholdInviteResponse = {
      code: invite.code,
      expiresAt: invite.expiresAt.toISOString(),
    };
    return c.json(body);
  });

  api.post('/household/leave', async (c) => {
    const user = c.get('user');
    await householdsRepo.leave(ctx.db, user.id, activeHouseholdId(user));
    return c.json({ ok: true });
  });

  // --- spaces (PRD F12): the switcher --------------------------------------

  api.get('/spaces', async (c) => {
    const user = c.get('user');
    const active = activeHouseholdId(user);
    const mySpaces = await householdsRepo.mySpaces(ctx.db, user.id);

    const spaces: ApiSpace[] = await Promise.all(
      mySpaces.map(async (space) => {
        const members = await householdsRepo.membersOf(ctx.db, space.id);
        return {
          id: space.id,
          isPersonal: space.isPersonal,
          isActive: space.id === active,
          members: members.map((member) => ({
            userId: member.id,
            firstName: member.firstName,
            isSelf: member.id === user.id,
          })),
        };
      }),
    );

    const body: SpacesResponse = { spaces };
    return c.json(body);
  });

  api.post('/spaces/switch', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, switchSpaceBodySchema);

    try {
      await householdsRepo.switchActive(ctx.db, user.id, input.householdId);
    } catch (error) {
      if (error instanceof JoinHouseholdError) {
        throw new ValidationError("That isn't one of your spaces.");
      }
      throw error;
    }

    return c.json({ ok: true });
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

  // ADR 0007: a live preview for the Mini App's foreign-currency capture form
  // — display only. The actual POST /api/transactions always fetches its own
  // rate again at save time, so nothing here is trusted back from the client.
  api.get('/fx-rate', async (c) => {
    const user = c.get('user');
    const from = c.req.query('currency');
    if (!from || !/^[A-Z]{3}$/.test(from)) {
      throw new ValidationError('A 3-letter currency code is required');
    }

    const rate = await fetchFxRate(from, user.currency);
    if (rate === null) {
      throw new ServiceUnavailableError(
        'Could not fetch an exchange rate right now — try again in a moment.',
      );
    }

    const body: FxRateResponse = { from, to: user.currency, rate };
    return c.json(body);
  });

  // --- the home screen ------------------------------------------------------

  api.get('/today', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const month = monthRange(parseIsoDate(today).year, parseIsoDate(today).month);

    const spaceId = activeHouseholdId(user);
    const [safeToSpend, monthTotals, todayTransactions, recentDays, streak] = await Promise.all([
      computeSafeToSpend(ctx, user, today),
      transactionsRepo.totalsForPeriod(ctx.db, spaceId, month.start, month.end),
      transactionsRepo.list(ctx.db, spaceId, {
        from: today,
        to: today,
        limit: 100,
      }),
      recentDailySpend(ctx, user, today),
      computeStreak(ctx, user, today),
    ]);

    const body: TodayResponse = {
      today,
      currency: user.currency,
      locale: user.locale,
      safeToSpend: serialiseSafeToSpend(safeToSpend),
      monthIn: monthTotals.inCents,
      monthOut: monthTotals.outCents,
      transactions: todayTransactions.map((row) => toApiTransaction(row, user.id)),
      recentDays,
      streak,
    };
    return c.json(body);
  });

  // --- transactions ---------------------------------------------------------

  api.get('/transactions', async (c) => {
    const user = c.get('user');
    const { from, to, limit, offset, categoryId } = c.req.query();

    const rows = await transactionsRepo.list(ctx.db, activeHouseholdId(user), {
      from,
      to,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      categoryId,
    });

    const body: TransactionsResponse = {
      transactions: rows.map((row) => toApiTransaction(row, user.id)),
    };
    return c.json(body);
  });

  api.post('/transactions', async (c) => {
    const user = c.get('user');
    const input = await parseBody(c, createTransactionSchema);
    const today = todayFor(ctx, user);

    // An uncategorised entry still gets a best guess from its note, so the
    // Mini App and the chat behave identically (PRD F10.4).
    const categoryId = input.categoryId ?? (await guessCategoryId(ctx, user.id, input));

    // ADR 0007: a foreign-currency capture is converted here, server-side,
    // from a rate fetched fresh for this transaction — never from a
    // client-supplied amountCents, and never from a guess if the fetch fails.
    const fx =
      input.originalCurrency !== undefined && input.originalAmountCents !== undefined
        ? await convertForeignAmount(
            user.currency,
            input.originalCurrency,
            input.originalAmountCents,
          )
        : null;

    const finalAmountCents = fx ? fx.amountCents : (input.amountCents as number);

    const splits = input.splits
      ? await validateSplits(ctx, user, input.direction, finalAmountCents, input.splits)
      : undefined;

    const created = await transactionsRepo.create(ctx.db, {
      userId: user.id,
      householdId: activeHouseholdId(user),
      direction: input.direction,
      amountCents: finalAmountCents,
      categoryId,
      note: input.note ?? null,
      occurredOn: input.occurredOn ?? today,
      source: 'miniapp',
      originalCurrency: fx ? input.originalCurrency : null,
      originalAmountCents: fx ? input.originalAmountCents : null,
      fxRate: fx ? fx.rate : null,
      splits,
    });

    const [view, safeToSpend] = await Promise.all([
      transactionsRepo.findById(ctx.db, user.id, created.id),
      computeSafeToSpend(ctx, user, today),
    ]);

    if (!view) throw new NotFoundError('Transaction vanished after being created');

    return c.json(
      {
        transaction: toApiTransaction(view, user.id),
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
      transaction: toApiTransaction(updated, user.id),
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

  // --- photo attachments (F4) -------------------------------------------------
  // The photo itself never leaves Telegram (ADR 0003) — this proxies bytes on
  // demand rather than storing or redirecting to them. A redirect would leak
  // the resolved URL, which embeds the bot token (GUARDRAILS.md section 5).

  api.get('/transactions/:id/photos', async (c) => {
    const user = c.get('user');
    const rows = await attachmentsRepo.listForTransaction(
      ctx.db,
      activeHouseholdId(user),
      c.req.param('id'),
    );

    const body: PhotosResponse = {
      photos: rows.map((row) => ({ id: row.id, width: row.width, height: row.height })),
    };
    return c.json(body);
  });

  // Who-owes-who, per transaction (PRD-adjacent) — lazy-loaded like photos,
  // only called when `transaction.hasSplit` is true. Visible to the whole
  // space, not just the transaction's author.
  api.get('/transactions/:id/splits', async (c) => {
    const user = c.get('user');
    const rows = await transactionsRepo.splitsFor(
      ctx.db,
      activeHouseholdId(user),
      c.req.param('id'),
    );

    const body: TransactionSplitsResponse = {
      splits: rows.map((row) => ({
        userId: row.userId,
        firstName: row.firstName,
        shareCents: row.shareCents,
      })),
    };
    return c.json(body);
  });

  api.get('/photos/:id', async (c) => {
    const user = c.get('user');
    const attachment = await attachmentsRepo.findViewable(
      ctx.db,
      activeHouseholdId(user),
      c.req.param('id'),
    );
    if (!attachment) throw new NotFoundError('No such photo');

    const url = await resolveFileUrl(bot.api, ctx.config.botToken, attachment.tgFileId);
    if (!url) throw new NotFoundError('Photo is no longer available');

    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) throw new NotFoundError('Photo is no longer available');

    // Telegram photos are always JPEG. Streamed straight through rather than
    // buffered — GUARDRAILS.md section 7 rules out holding a full image in
    // memory when the upstream response is already a stream.
    return c.body(upstream.body, 200, {
      'Content-Type': 'image/jpeg',
      // Private: this is one user's receipt, never a shared CDN-cacheable asset.
      'Cache-Control': 'private, max-age=3000',
    });
  });

  // --- CSV export (F8) --------------------------------------------------------

  api.get('/export', async (c) => {
    const user = c.get('user');
    const range = parseExportRange(c.req.query('range') ?? '');
    if (!range) throw new ValidationError('range must be YYYY, YYYY-MM, YYYY-MM-DD, or omitted');

    const csv = await buildExportCsv(ctx, user, range);
    return c.body(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(range)}"`,
    });
  });

  // --- statistics -----------------------------------------------------------

  api.get('/stats', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const period = statsPeriodSchema.parse(c.req.query('period') ?? 'month');
    const anchor = (c.req.query('anchor') as IsoDate | undefined) ?? today;

    const body = await buildStats(ctx, activeHouseholdId(user), period, anchor);
    return c.json(body);
  });

  // A rolling 53 weeks ending today, for the GitHub-style calendar heatmap —
  // deliberately not calendar-year-aligned, so "long term" always means the
  // last full year of activity rather than resetting on 1 January.
  const HEATMAP_DAYS = 371;

  api.get('/stats/heatmap', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const from = addDays(today, -(HEATMAP_DAYS - 1));

    const rows = await transactionsRepo.totalsByDay(ctx.db, activeHouseholdId(user), from, today);
    const byDay = new Map(rows.map((row) => [row.day, row.outCents]));

    const days: HeatmapResponse['days'] = [];
    for (let offset = HEATMAP_DAYS - 1; offset >= 0; offset -= 1) {
      const day = addDays(today, -offset);
      days.push({ day, outCents: byDay.get(day) ?? 0 });
    }

    const body: HeatmapResponse = { from, to: today, days };
    return c.json(body);
  });

  // --- recap (PRD-adjacent: a shareable month/year wrap-up) ------------------

  api.get('/recap', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const period = recapPeriodSchema.parse(c.req.query('period') ?? 'month');
    const anchor = (c.req.query('anchor') as IsoDate | undefined) ?? today;

    const recap = await buildRecap(ctx, user, period, anchor, today);

    const body: RecapResponse = {
      period: recap.period,
      label: recap.label,
      from: recap.from,
      to: recap.to,
      inCents: recap.stats.totals.inCents,
      outCents: recap.stats.totals.outCents,
      netCents: recap.stats.totals.inCents - recap.stats.totals.outCents,
      previousOutCents: recap.stats.previousOutCents,
      deltaPct: recap.stats.deltaPct,
      topCategories: recap.stats.byCategory.slice(0, 5).map((category) => ({
        categoryId: category.categoryId,
        name: category.name ?? 'Uncategorised',
        emoji: category.emoji ?? '❓',
        colorToken: category.colorToken ?? 'uncategorised',
        outCents: category.outCents,
        count: category.count,
      })),
      bestDay: recap.stats.bestDay,
      worstDay: recap.stats.worstDay,
      streak: recap.streak,
    };
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

  // --- savings goals (PRD-adjacent) ------------------------------------------
  // Personal, not household-shared — see packages/db/src/schema.ts.

  api.get('/goals', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const rows = await savingsRepo.listForUser(ctx.db, user.id);

    const body: SavingsGoalsResponse = {
      goals: rows.map((row) => toApiSavingsGoal(row, today)),
    };
    return c.json(body);
  });

  api.post('/goals', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const input = await parseBody(c, createSavingsGoalSchema);

    const created = await savingsRepo.create(ctx.db, {
      userId: user.id,
      name: input.name,
      targetCents: input.targetCents,
      targetDate: input.targetDate ?? null,
    });

    const body: SavingsGoalResponse = {
      goal: toApiSavingsGoal({ ...created, netContributedCents: 0 }, today),
    };
    return c.json(body, 201);
  });

  api.patch('/goals/:id', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const input = await parseBody(c, updateSavingsGoalSchema);

    const updated = await savingsRepo.update(ctx.db, user.id, c.req.param('id'), {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.targetCents !== undefined && { targetCents: input.targetCents }),
      ...(input.targetDate !== undefined && { targetDate: input.targetDate }),
    });
    if (!updated) throw new NotFoundError('No such savings goal');

    const goal = await savingsRepo.findById(ctx.db, user.id, c.req.param('id'));
    if (!goal) throw new NotFoundError('No such savings goal');

    const body: SavingsGoalResponse = { goal: toApiSavingsGoal(goal, today) };
    return c.json(body);
  });

  api.delete('/goals/:id', async (c) => {
    const user = c.get('user');
    const archived = await savingsRepo.archive(ctx.db, user.id, c.req.param('id'));
    if (!archived) throw new NotFoundError('No such savings goal');
    return c.json({ ok: true });
  });

  api.post('/goals/:id/contribute', async (c) => {
    const user = c.get('user');
    const today = todayFor(ctx, user);
    const input = await parseBody(c, contributeToGoalSchema);
    const goalId = c.req.param('id');

    const goal = await savingsRepo.findById(ctx.db, user.id, goalId);
    if (!goal) throw new NotFoundError('No such savings goal');

    // Funding (or withdrawing from) a goal is a transfer — excluded from the
    // budget by default (PRD F6.7) — so it never moves safe-to-spend.
    const transferCategory = await categoriesRepo.findBySlug(ctx.db, user.id, 'transfers');

    await transactionsRepo.create(ctx.db, {
      userId: user.id,
      householdId: activeHouseholdId(user),
      direction: input.direction,
      amountCents: input.amountCents,
      categoryId: transferCategory?.id ?? null,
      note: input.note ?? null,
      occurredOn: input.occurredOn ?? today,
      source: 'miniapp',
      savingsGoalId: goalId,
    });

    const refreshed = await savingsRepo.findById(ctx.db, user.id, goalId);
    if (!refreshed) throw new NotFoundError('No such savings goal');

    const body: SavingsGoalResponse = { goal: toApiSavingsGoal(refreshed, today) };
    return c.json(body, 201);
  });

  // Daily deltas, oldest first — the Mini App's progress chart turns these
  // into a running total, same split as Stats' `series` (GUARDRAILS.md
  // section 3: aggregated in SQL, never summed client-side for a total).
  api.get('/goals/:id/progress', async (c) => {
    const user = c.get('user');
    const goal = await savingsRepo.findById(ctx.db, user.id, c.req.param('id'));
    if (!goal) throw new NotFoundError('No such savings goal');

    const points = await savingsRepo.progressHistory(ctx.db, goal.id);
    const body: GoalProgressResponse = { points };
    return c.json(body);
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

async function loadHouseholdView(ctx: AppContext, user: User): Promise<ApiHousehold | null> {
  const activeId = activeHouseholdId(user);
  const active = await householdsRepo.findById(ctx.db, activeId);
  if (active === null || active.isPersonal) return null;

  const members = await householdsRepo.membersOf(ctx.db, activeId);
  return {
    id: activeId,
    members: members.map((member) => ({
      userId: member.id,
      firstName: member.firstName,
      isSelf: member.id === user.id,
    })),
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

/**
 * ADR 0007: converts a foreign-currency capture into the user's home
 * currency with a rate fetched fresh for this one transaction. Never
 * degrades to a guess — `fetchFxRate` failing means there is nothing honest
 * to store, so this throws rather than returning a made-up figure.
 */
async function convertForeignAmount(
  homeCurrency: string,
  originalCurrency: string,
  originalAmountCents: number,
): Promise<{ amountCents: number; rate: number }> {
  const rate = await fetchFxRate(originalCurrency, homeCurrency);
  if (rate === null) {
    throw new ServiceUnavailableError(
      'Could not fetch an exchange rate right now — try again in a moment.',
    );
  }

  const amountCents = Math.round(originalAmountCents * rate);
  if (amountCents <= 0) {
    throw new ValidationError('That converts to less than one cent — check the amount.');
  }

  return { amountCents, rate };
}

/**
 * Who-owes-who shares (PRD-adjacent) — only valid for a shared space's own
 * expenses. Throws rather than silently dropping or auto-correcting a bad
 * split: a split that doesn't add up exactly is a bug in the client, not
 * something the server should guess its way around (GUARDRAILS.md section 2).
 */
async function validateSplits(
  ctx: AppContext,
  user: User,
  direction: 'in' | 'out',
  amountCents: number,
  splits: Array<{ userId: string; shareCents: number }>,
): Promise<Array<{ userId: string; shareCents: number }>> {
  if (direction !== 'out') {
    throw new ValidationError('Only an expense (not income) can be split.');
  }

  const householdId = activeHouseholdId(user);
  const household = await householdsRepo.findById(ctx.db, householdId);
  if (!household || household.isPersonal) {
    throw new ValidationError('Splitting needs a shared space — invite someone first.');
  }

  const members = await householdsRepo.membersOf(ctx.db, householdId);
  const memberIds = new Set(members.map((member) => member.id));
  for (const split of splits) {
    if (!memberIds.has(split.userId)) {
      throw new ValidationError('Every split must be a current member of this space.');
    }
  }

  const sum = splits.reduce((total, split) => total + split.shareCents, 0);
  if (sum !== amountCents) {
    throw new ValidationError(
      `The split (${sum} cents) must add up to the full amount (${amountCents} cents).`,
    );
  }

  return splits;
}

async function buildStats(
  ctx: AppContext,
  householdId: string,
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
    label = `${day} ${monthName(month)}`;
    previousFrom = addDays(anchor, -1);
    previousTo = previousFrom;
  } else if (period === 'month') {
    const range = monthRange(year, month);
    from = range.start;
    to = range.end;
    label = `${monthName(month)} ${year}`;
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
    transactionsRepo.totalsForPeriod(ctx.db, householdId, from, to),
    transactionsRepo.totalsByCategory(ctx.db, householdId, from, to),
    transactionsRepo.totalsForPeriod(ctx.db, householdId, previousFrom, previousTo),
  ]);

  const series = await buildSeries(ctx, householdId, period, from, to, year, month);

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
  householdId: string,
  period: 'day' | 'month' | 'year',
  from: IsoDate,
  to: IsoDate,
  year: number,
  month: number,
): Promise<StatsResponse['series']> {
  if (period === 'year') {
    const rows = await transactionsRepo.totalsByMonth(ctx.db, householdId, from, to);
    const byMonth = new Map(rows.map((row) => [row.month, row]));

    return Array.from({ length: 12 }, (_, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const row = byMonth.get(key);
      return {
        key,
        label: monthName(index + 1).slice(0, 3),
        outCents: row?.outCents ?? 0,
        inCents: row?.inCents ?? 0,
      };
    });
  }

  const rows = await transactionsRepo.totalsByDay(ctx.db, householdId, from, to);
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
