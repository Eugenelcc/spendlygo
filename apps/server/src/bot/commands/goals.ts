/**
 * /goals — savings goals, tracked separately from safe-to-spend
 * (PRD-adjacent). See packages/core/src/savings.ts for the progress maths and
 * packages/db/src/schema.ts for why a goal is personal, not household-shared.
 *
 *   /goals                          list, with progress
 *   /goals add 3000 vacation by 2026-12-31
 *   /goals put 50 vacation          tag a transfer to fund it
 */

import {
  calculateGoalProgress,
  centsOf,
  formatCents,
  isIsoDate,
  parseAmountToCents,
  type AmountCents,
  type IsoDate,
} from '@spendlygo/core';
import { categoriesRepo, savingsRepo, transactionsRepo } from '@spendlygo/db';
import type { AppContext } from '../../context.js';
import { activeHouseholdId, todayFor } from '../../api/service.js';
import { openAppKeyboard } from '../keyboards.js';
import { escapeMarkdown as escape } from '../markdown.js';
import type { BotContext } from '../middleware.js';

const ADD_PATTERN = /^add\s+(\S+)\s+(.+?)(?:\s+by\s+(\S+))?$/i;
const PUT_PATTERN = /^put\s+(\S+)\s+(.+)$/i;

export async function handleGoals(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';

  const addMatch = ADD_PATTERN.exec(argument);
  if (addMatch) {
    await handleAdd(ctx, botCtx, addMatch);
    return;
  }

  const putMatch = PUT_PATTERN.exec(argument);
  if (putMatch) {
    await handlePut(ctx, botCtx, putMatch);
    return;
  }

  if (argument !== '' && argument.toLowerCase() !== 'list') {
    await botCtx.reply(
      [
        "Couldn't read that. Try:",
        '',
        '`/goals add 3000 vacation by 2026-12-31`',
        '`/goals put 50 vacation`',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const today = todayFor(ctx, user);
  const goals = await savingsRepo.listForUser(ctx.db, user.id);

  if (goals.length === 0) {
    await botCtx.reply(
      ['No savings goals yet.', '', '`/goals add 3000 vacation by 2026-12-31`'].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const money = (cents: number) =>
    escape(formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }));

  const lines = goals.map((goal) => {
    const progress = calculateGoalProgress({
      targetCents: centsOf(goal.targetCents),
      netContributedCents: goal.netContributedCents,
      today,
      targetDate: goal.targetDate as IsoDate | null,
    });
    const bar = progressBar(progress.progressRatio);
    const status = progress.achieved
      ? ' 🎉'
      : progress.overdue
        ? ' · overdue'
        : progress.suggestedMonthlyCents !== null
          ? ` · ${money(progress.suggestedMonthlyCents)}/mo to hit it`
          : '';

    return [
      `*${escape(goal.name)}*`,
      `${bar}  ${money(progress.contributedCents)} of ${money(progress.targetCents)}${status}`,
    ].join('\n');
  });

  await botCtx.reply(['*Savings goals*', '', ...lines].join('\n\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config, '✏️ Manage in Spendlygo'),
  });
}

function progressBar(ratio: number, width = 10): string {
  const filled = Math.round(ratio * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled);
}

async function handleAdd(
  ctx: AppContext,
  botCtx: BotContext,
  match: RegExpExecArray,
): Promise<void> {
  const user = botCtx.appUser;
  const [, amountToken, name, dateToken] = match;

  const amountCents = amountToken ? parseAmountToCents(amountToken) : null;
  if (amountCents === null || !name) {
    await botCtx.reply('Usage: `/goals add 3000 vacation by 2026-12-31`', {
      parse_mode: 'Markdown',
    });
    return;
  }

  if (dateToken && !isIsoDate(dateToken)) {
    await botCtx.reply('The date should look like `2026-12-31`.', { parse_mode: 'Markdown' });
    return;
  }

  await savingsRepo.create(ctx.db, {
    userId: user.id,
    name: name.trim(),
    targetCents: amountCents,
    targetDate: dateToken ?? null,
  });

  const money = escape(formatCents(amountCents, { currency: user.currency, locale: user.locale }));
  await botCtx.reply(
    `Goal set: *${escape(name.trim())}* — ${money}${dateToken ? ` by ${escape(dateToken)}` : ''}.\n\nFund it with \`/goals put 50 ${escape(name.trim())}\`.`,
    { parse_mode: 'Markdown', reply_markup: openAppKeyboard(ctx.config) },
  );
}

async function handlePut(
  ctx: AppContext,
  botCtx: BotContext,
  match: RegExpExecArray,
): Promise<void> {
  const user = botCtx.appUser;
  const [, amountToken, namePart] = match;

  const amountCents = amountToken ? parseAmountToCents(amountToken) : null;
  if (amountCents === null || !namePart) {
    await botCtx.reply('Usage: `/goals put 50 vacation`', { parse_mode: 'Markdown' });
    return;
  }

  const goals = await savingsRepo.listForUser(ctx.db, user.id);
  const query = namePart.trim().toLowerCase();
  const matches = goals.filter((goal) => goal.name.toLowerCase().includes(query));

  if (matches.length === 0) {
    await botCtx.reply(
      `No goal matching "${escape(namePart.trim())}". Check \`/goals\` for the names you have set up.`,
      { parse_mode: 'Markdown' },
    );
    return;
  }
  if (matches.length > 1) {
    const names = matches.map((goal) => escape(goal.name)).join(', ');
    await botCtx.reply(`That matches more than one goal: ${names}. Be more specific.`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  const goal = matches[0];
  if (!goal) return;

  const today = todayFor(ctx, user);
  const transferCategory = await categoriesRepo.findBySlug(ctx.db, user.id, 'transfers');

  await transactionsRepo.create(ctx.db, {
    userId: user.id,
    householdId: activeHouseholdId(user),
    direction: 'out',
    amountCents,
    categoryId: transferCategory?.id ?? null,
    note: `Savings: ${goal.name}`,
    occurredOn: today,
    source: 'chat',
    savingsGoalId: goal.id,
  });

  const refreshed = await savingsRepo.findById(ctx.db, user.id, goal.id);
  const progress = refreshed
    ? calculateGoalProgress({
        targetCents: centsOf(refreshed.targetCents),
        netContributedCents: refreshed.netContributedCents,
        today,
        targetDate: refreshed.targetDate as IsoDate | null,
      })
    : null;

  const money = (cents: number) =>
    escape(formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }));

  const summary = progress
    ? `${money(progress.contributedCents)} of ${money(progress.targetCents)}${progress.achieved ? ' — reached! 🎉' : ''}`
    : '';

  await botCtx.reply(`Added ${money(amountCents)} to *${escape(goal.name)}*.\n\n${summary}`, {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config),
  });
}
