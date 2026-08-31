/**
 * /recap — an on-demand, shareable summary (PRD-adjacent), distinct in tone
 * from the periodic digest even though both draw on the same numbers
 * (apps/server/src/api/service.ts#computePeriodStats). The digest is a quiet
 * nudge on a schedule; `/recap` is something you ask for and might screenshot.
 */

import { formatCents, type AmountCents } from '@spendlygo/core';
import type { AppContext } from '../../context.js';
import { buildRecap, type RecapPeriod } from '../../api/recap.js';
import { todayFor } from '../../api/service.js';
import { openAppKeyboard } from '../keyboards.js';
import { escapeMarkdown as escape } from '../markdown.js';
import type { BotContext } from '../middleware.js';

function formatDayLabel(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${day} ${names[(month ?? 1) - 1]}`;
}

export async function handleRecap(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim().toLowerCase() ?? '';
  const period: RecapPeriod = argument === 'year' ? 'year' : 'month';

  const today = todayFor(ctx, user);
  const recap = await buildRecap(ctx, user, period, today, today);

  const money = (cents: number) =>
    escape(formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }));

  if (recap.stats.totals.count === 0) {
    await botCtx.reply(`Nothing logged for ${escape(recap.label)} yet.`);
    return;
  }

  const lines = [
    `🎉 *${escape(recap.label)} recap*`,
    '',
    `${money(recap.stats.totals.outCents)} spent`,
  ];

  if (recap.stats.deltaPct !== null) {
    lines.push(
      recap.stats.deltaPct === 0
        ? 'Same as the period before'
        : `${Math.abs(recap.stats.deltaPct)}% ${recap.stats.deltaPct > 0 ? 'more' : 'less'} than the period before`,
    );
  }

  if (recap.stats.totals.inCents > 0) {
    lines.push(`${money(recap.stats.totals.inCents)} received`);
  }

  const topCategory = recap.stats.byCategory[0];
  if (topCategory) {
    lines.push(
      '',
      `Top category: ${topCategory.emoji ?? '•'} ${escape(topCategory.name ?? 'Uncategorised')} — ${money(topCategory.outCents)}`,
    );
  }

  if (recap.stats.bestDay && recap.stats.worstDay) {
    lines.push(
      `Lightest day: ${formatDayLabel(recap.stats.bestDay.day)} · Heaviest: ${formatDayLabel(recap.stats.worstDay.day)} (${money(recap.stats.worstDay.outCents)})`,
    );
  }

  if (recap.streak.longest >= 2) {
    lines.push('', `🔥 Longest streak: ${recap.streak.longest} days`);
  }

  lines.push(
    '',
    period === 'year' ? '`/recap` for this month instead' : '`/recap year` for the whole year',
  );

  await botCtx.reply(lines.join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config, '📊 See the full recap'),
  });
}
