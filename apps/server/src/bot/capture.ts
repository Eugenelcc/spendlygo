/**
 * Quick-text capture in chat (PRD F1) — the three-second path.
 *
 * Every capture answers with a confirmation card showing what was understood
 * and the recalculated safe-to-spend, plus an Undo button. GUARDRAILS: an
 * ambiguous parse is never saved silently; the card is how the user catches a
 * misread amount before it distorts the month.
 */

import { InlineKeyboard } from 'grammy';
import {
  formatCents,
  inferCategorySlug,
  parseCapture,
  type AmountCents,
  type IsoDate,
} from '@spendlygo/core';
import { categoriesRepo, transactionsRepo } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { computeSafeToSpend, todayFor } from '../api/service.js';
import { logger } from '../logger.js';
import type { BotContext } from './middleware.js';
import { escapeMarkdown } from './markdown.js';

/** PRD F11.1 — Undo stays available for five minutes. */
export const UNDO_WINDOW_MS = 5 * 60 * 1000;

export const UNDO_PREFIX = 'undo:';

function formatDay(occurredOn: IsoDate, today: IsoDate): string | null {
  if (occurredOn === today) return null;
  return occurredOn;
}

/**
 * The confirmation card (PRD F1.5).
 *
 * Deliberately compact: amount, what it was, and the consequence. The
 * consequence is the part that changes behaviour.
 */
export function buildConfirmation(options: {
  direction: 'in' | 'out';
  amountCents: AmountCents;
  categoryEmoji: string | null;
  categoryName: string | null;
  note: string | null;
  occurredOn: IsoDate;
  today: IsoDate;
  currency: string;
  locale: string;
  safeTodayCents: AmountCents;
  leftForTodayCents: AmountCents;
  hasBudget: boolean;
  overspentCents: AmountCents;
}): string {
  const money = (cents: AmountCents) =>
    formatCents(cents, { currency: options.currency, locale: options.locale });

  const sign = options.direction === 'in' ? '+' : '−';
  const headline = `${sign}${money(options.amountCents)}`;

  const bits: string[] = [];
  if (options.categoryEmoji && options.categoryName) {
    bits.push(`${options.categoryEmoji} ${options.categoryName}`);
  }
  if (options.note) bits.push(escapeMarkdown(options.note));

  const day = formatDay(options.occurredOn, options.today);
  if (day) bits.push(`on ${day}`);

  const lines = [`*${escapeMarkdown(headline)}*${bits.length ? `  ·  ${bits.join('  ·  ')}` : ''}`];

  if (options.direction === 'out') {
    if (!options.hasBudget) {
      lines.push('', '_Set a monthly budget with /budget to see what is safe to spend._');
    } else if (options.overspentCents > 0) {
      lines.push('', `⚠️ ${escapeMarkdown(money(options.overspentCents))} over budget this month`);
    } else {
      lines.push('', `${escapeMarkdown(money(options.leftForTodayCents))} left to spend today`);
    }
  }

  return lines.join('\n');
}

export function undoKeyboard(transactionId: string): InlineKeyboard {
  return new InlineKeyboard().text('↩️ Undo', `${UNDO_PREFIX}${transactionId}`);
}

/**
 * Handle a plain text message that might be a transaction.
 *
 * Returns false when the message was not a capture, so the caller can decide
 * what to say instead — silence would be worse than a hint.
 */
export async function handleCapture(ctx: AppContext, botCtx: BotContext): Promise<boolean> {
  const text = botCtx.message?.text;
  if (!text) return false;

  const user = botCtx.appUser;
  const today = todayFor(ctx, user);
  const parsed = parseCapture(text, { today });

  if (!parsed.ok) {
    if (parsed.reason === 'bad_date') {
      await botCtx.reply(
        `I couldn't read the date in \`${parsed.token ?? ''}\`.\n` +
          'Try `@today`, `@yesterday`, or `@12/03`.',
        { parse_mode: 'Markdown' },
      );
      return true;
    }
    return false;
  }

  const kind = parsed.direction === 'in' ? 'income' : 'expense';
  const all = await categoriesRepo.listForUser(ctx.db, user.id);

  // An explicit #tag wins; otherwise infer from the note (PRD F10.4).
  const slug =
    parsed.categorySlug ??
    inferCategorySlug(
      parsed.note,
      all.map((c) => ({ slug: c.slug, kind: c.kind, keywords: c.keywords })),
      kind,
    );

  const category =
    (slug ? all.find((c) => c.slug === slug && c.kind === kind) : undefined) ??
    (slug ? all.find((c) => c.slug === slug) : undefined) ??
    null;

  // A #tag that matches nothing is worth saying out loud, rather than silently
  // filing the spend under nothing.
  const unknownTag = parsed.categorySlug !== null && category === null;

  const created = await transactionsRepo.create(ctx.db, {
    userId: user.id,
    householdId: user.householdId,
    direction: parsed.direction,
    amountCents: parsed.amountCents,
    categoryId: category?.id ?? null,
    note: parsed.note,
    occurredOn: parsed.occurredOn,
    source: 'chat',
  });

  const safeToSpend = await computeSafeToSpend(ctx, user, today);

  let message = buildConfirmation({
    direction: parsed.direction,
    amountCents: parsed.amountCents,
    categoryEmoji: category?.emoji ?? null,
    categoryName: category?.name ?? null,
    note: parsed.note,
    occurredOn: parsed.occurredOn,
    today,
    currency: user.currency,
    locale: user.locale,
    safeTodayCents: safeToSpend.safeTodayCents,
    leftForTodayCents: safeToSpend.leftForTodayCents,
    hasBudget: safeToSpend.hasBudget,
    overspentCents: safeToSpend.overspentCents,
  });

  if (unknownTag) {
    message += `\n\n_No category called #${escapeMarkdown(parsed.categorySlug ?? '')} — saved without one._`;
  }

  // GUARDRAILS section 6: log that a capture happened, never what it was.
  logger.info('capture.saved', {
    userId: user.id,
    source: 'chat',
    direction: parsed.direction,
    categorised: category !== null,
  });

  await botCtx.reply(message, {
    parse_mode: 'Markdown',
    reply_markup: undoKeyboard(created.id),
  });

  return true;
}

/**
 * Undo a capture (PRD F11.1).
 *
 * GUARDRAILS section 10: the callback query is always answered, including on
 * the error path, or the client spins forever.
 */
export async function handleUndo(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const data = botCtx.callbackQuery?.data;
  const user = botCtx.appUser;

  if (!data?.startsWith(UNDO_PREFIX)) {
    await botCtx.answerCallbackQuery();
    return;
  }

  const id = data.slice(UNDO_PREFIX.length);
  const existing = await transactionsRepo.findById(ctx.db, user.id, id);

  if (!existing) {
    await botCtx.answerCallbackQuery({ text: 'Already undone.' });
    await botCtx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    return;
  }

  const age = ctx.clock.now().getTime() - existing.createdAt.getTime();
  if (age > UNDO_WINDOW_MS) {
    await botCtx.answerCallbackQuery({
      text: 'That is older than five minutes — edit it in the app instead.',
      show_alert: true,
    });
    return;
  }

  await transactionsRepo.softDelete(ctx.db, user.id, id);
  await botCtx.answerCallbackQuery({ text: 'Undone' });

  const money = formatCents(existing.amountCents as AmountCents, {
    currency: user.currency,
    locale: user.locale,
  });

  await botCtx
    .editMessageText(`~${escapeMarkdown(money)}~ · undone`, {
      parse_mode: 'Markdown',
      reply_markup: undefined,
    })
    .catch(() => {
      /* The message may be too old to edit; the undo itself still happened. */
    });

  logger.info('capture.undone', { userId: user.id });
}
