/**
 * The daily digest (PRD F9).
 *
 * One message: spent today, tomorrow's safe-to-spend, pace, anything a
 * recurring rule materialised, and a nudge if nothing was logged. Never a
 * thread (F9.3), and the nudge is separately disableable (F9.4).
 */

import { addDays, formatCents, type AmountCents, type IsoDate } from '@spendlygo/core';
import { recurringRepo, type User } from '@spendlygo/db';
import { computeSafeToSpend } from '../api/service.js';
import { escapeMarkdown } from '../bot/markdown.js';
import type { AppContext } from '../context.js';

const PACE_LABEL: Record<string, string> = {
  ahead: '🟢 ahead of pace',
  on_track: '🔵 on track',
  behind: '🟠 behind pace',
  over_budget: '🔴 over budget',
};

export interface DigestContent {
  text: string;
  /** False when there is nothing worth interrupting the user for. */
  worthSending: boolean;
}

export async function buildDigest(
  ctx: AppContext,
  user: User,
  today: IsoDate,
): Promise<DigestContent> {
  const money = (cents: number) =>
    escapeMarkdown(
      formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }),
    );

  const [todayResult, tomorrowResult, runs, loggedToday] = await Promise.all([
    computeSafeToSpend(ctx, user, today),
    computeSafeToSpend(ctx, user, addDays(today, 1)),
    recurringRepo.runsOn(ctx.db, user.id, today),
    recurringRepo.hasAnyTransactionOn(ctx.db, user.id, today),
  ]);

  const lines: string[] = [`*Today* — ${money(todayResult.spentTodayCents)} spent`];

  if (todayResult.hasBudget) {
    lines.push(PACE_LABEL[todayResult.pace] ?? '');
  }

  if (runs.length > 0) {
    lines.push('', '*Logged automatically*');
    for (const run of runs) {
      const sign = run.direction === 'in' ? '+' : '−';
      lines.push(
        `${sign}${money(run.amountCents)}${run.note ? ` · ${escapeMarkdown(run.note)}` : ''}`,
      );
    }
  }

  if (tomorrowResult.hasBudget) {
    lines.push(
      '',
      tomorrowResult.overspentCents > 0
        ? `⚠️ Tomorrow starts *${money(tomorrowResult.overspentCents)}* over budget`
        : `*${money(tomorrowResult.safeTodayCents)}* safe to spend tomorrow`,
    );
  }

  const nudgeWorthy = user.nudgeEnabled && !loggedToday && runs.length === 0;
  if (nudgeWorthy) {
    lines.push('', "_You haven't logged anything today._");
  }

  // A digest that says nothing but "you spent $0" and has no budget, no
  // automatic entries, and nothing to nudge about isn't worth a notification.
  const worthSending = todayResult.hasBudget || runs.length > 0 || nudgeWorthy;

  return { text: lines.join('\n'), worthSending };
}
