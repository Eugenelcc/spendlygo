/**
 * The reporting and settings commands.
 *
 * Everything here answers from the same service the Mini App uses, so chat and
 * app can never disagree about a number.
 */

import { formatCents, parseAmountToCents, type AmountCents } from '@spendlygo/core';
import { householdsRepo, transactionsRepo, usersRepo } from '@spendlygo/db';
import type { AppContext } from '../../context.js';
import { computeSafeToSpend, effectiveBudgetCents, todayFor } from '../../api/service.js';
import { openAppKeyboard } from '../keyboards.js';
import type { BotContext } from '../middleware.js';
import { undoKeyboard, UNDO_WINDOW_MS } from '../capture.js';
import { escapeMarkdown as escape } from '../markdown.js';
const PACE_LABEL = {
  ahead: '🟢 Ahead of pace',
  on_track: '🔵 On track',
  behind: '🟠 Behind pace',
  over_budget: '🔴 Over budget',
} as const;

export async function handleToday(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const today = todayFor(ctx, user);
  const result = await computeSafeToSpend(ctx, user, today);
  const money = (cents: AmountCents) =>
    escape(formatCents(cents, { currency: user.currency, locale: user.locale }));

  if (!result.hasBudget) {
    await botCtx.reply(
      [
        `*Today*  ·  ${escape(today)}`,
        '',
        `Spent today: ${money(result.spentTodayCents)}`,
        `Spent this month: ${money(result.spentMonthToDateCents)}`,
        '',
        'Set a monthly budget to see what is safe to spend:',
        '`/budget 1500`',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: openAppKeyboard(ctx.config) },
    );
    return;
  }

  const lines = [
    `*${money(result.leftForTodayCents)} left to spend today*`,
    '',
    `${PACE_LABEL[result.pace]}`,
    `Spent today: ${money(result.spentTodayCents)} of ${money(result.safeTodayCents)}`,
    `This month: ${money(result.spentMonthToDateCents)} of ${money(result.budgetCents ?? (0 as AmountCents))}`,
    `${result.daysRemaining} ${result.daysRemaining === 1 ? 'day' : 'days'} left`,
  ];

  if (result.overspentCents > 0) {
    lines.splice(1, 0, '', `Over budget by ${money(result.overspentCents)}`);
  }

  await botCtx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });
}

export async function handleBudget(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';
  const shared = user.householdId !== null;

  if (argument === '') {
    const current = await effectiveBudgetCents(ctx, user);
    const suffix = shared ? ' (shared)' : '';
    await botCtx.reply(
      current === null
        ? `No monthly budget set yet${suffix}.\nSet one with \`/budget 1500\`.`
        : `${shared ? 'Your shared' : 'Your'} monthly budget is *${escape(formatCents(current, { currency: user.currency, locale: user.locale }))}*${suffix}.\n\nChange it with \`/budget 2000\`.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const cents = parseAmountToCents(argument);
  if (cents === null) {
    await botCtx.reply("That doesn't look like an amount. Try `/budget 1500`.", {
      parse_mode: 'Markdown',
    });
    return;
  }

  // A shared budget is written once, to the household — see the identical
  // rule in apps/server/src/api/index.ts's PATCH /settings.
  if (user.householdId !== null) {
    await householdsRepo.updateBudget(ctx.db, user.householdId, cents);
  } else {
    await usersRepo.updateSettings(ctx.db, user.id, { monthlyBudgetCents: cents });
  }

  // Re-read so the solo path picks up the write above — effectiveBudgetCents
  // reads user.monthlyBudgetCents straight from this object when there's no
  // household, and the in-memory `user` is stale the moment we wrote to it.
  const updated = (await usersRepo.findById(ctx.db, user.id)) ?? user;
  const result = await computeSafeToSpend(ctx, updated);
  const money = (value: AmountCents) =>
    escape(formatCents(value, { currency: user.currency, locale: user.locale }));

  await botCtx.reply(
    [
      `${shared ? 'Shared m' : 'M'}onthly budget set to *${money(cents)}*.`,
      '',
      `That is ${money(result.safeTodayCents)} a day for the ${result.daysRemaining} ${
        result.daysRemaining === 1 ? 'day' : 'days'
      } left this month.`,
    ].join('\n'),
    { parse_mode: 'Markdown', reply_markup: openAppKeyboard(ctx.config) },
  );
}

export async function handleRecent(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const rows = await transactionsRepo.list(ctx.db, user.id, user.householdId, { limit: 10 });

  if (rows.length === 0) {
    await botCtx.reply(
      'Nothing logged yet.\n\nTry `12.50 lunch` — amount first, then what it was for.',
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const money = (cents: number) =>
    escape(formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }));

  const lines = rows.map((row) => {
    const sign = row.direction === 'in' ? '+' : '−';
    const label = row.note ?? row.categoryName ?? 'Uncategorised';
    return `${row.categoryEmoji ?? '•'} ${escape(label)}  ·  ${sign}${money(row.amountCents)}  ·  ${escape(row.occurredOn)}`;
  });

  await botCtx.reply([`*Last ${rows.length}*`, '', ...lines].join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config, '✏️ Edit in Spendlygo'),
  });
}

export async function handleUndoCommand(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const [latest] = await transactionsRepo.list(ctx.db, user.id, user.householdId, { limit: 1 });

  if (!latest) {
    await botCtx.reply('Nothing to undo.');
    return;
  }

  const age = ctx.clock.now().getTime() - latest.createdAt.getTime();
  if (age > UNDO_WINDOW_MS) {
    await botCtx.reply(
      'The last entry is older than five minutes. Open the app to edit or delete it.',
      { reply_markup: openAppKeyboard(ctx.config) },
    );
    return;
  }

  const money = escape(
    formatCents(latest.amountCents as AmountCents, {
      currency: user.currency,
      locale: user.locale,
    }),
  );

  await botCtx.reply(`Undo *${money}* — ${escape(latest.note ?? 'no note')}?`, {
    parse_mode: 'Markdown',
    reply_markup: undoKeyboard(latest.id),
  });
}
