/**
 * /recurring — list and add recurring rules from chat (PRD F5, bot surface).
 *
 * Adding one reuses the F1 grammar plus a cadence word, so the syntax a user
 * already knows for a one-off spend extends naturally:
 *
 *   /recurring add 1500 rent monthly
 *   /recurring add 3000 salary monthly #salary
 *   /recurring add 15 netflix monthly @1
 */

import {
  formatCents,
  inferCategorySlug,
  parseAmountToCents,
  validateRecurrenceRule,
  ValidationError,
  type AmountCents,
  type Cadence,
} from '@spendlygo/core';
import { categoriesRepo, recurringRepo } from '@spendlygo/db';
import type { AppContext } from '../../context.js';
import { todayFor } from '../../api/service.js';
import { openAppKeyboard } from '../keyboards.js';
import { escapeMarkdown as escape } from '../markdown.js';
import type { BotContext } from '../middleware.js';

const CADENCE_WORDS: Record<string, Cadence> = {
  daily: 'daily',
  weekly: 'weekly',
  monthly: 'monthly',
  yearly: 'yearly',
  annually: 'yearly',
};

function parseAddArgs(raw: string): {
  amountCents: AmountCents;
  cadence: Cadence;
  note: string | null;
  categorySlug: string | null;
  dayOfMonth: number | null;
} | null {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  const amountToken = tokens.shift();
  const amountCents = amountToken ? parseAmountToCents(amountToken) : null;
  if (amountCents === null) return null;

  let cadence: Cadence | null = null;
  let categorySlug: string | null = null;
  let dayOfMonth: number | null = null;
  const noteWords: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower in CADENCE_WORDS && cadence === null) {
      cadence = CADENCE_WORDS[lower] ?? null;
      continue;
    }
    const categoryMatch = /^#([\p{L}\p{N}_-]+)$/u.exec(token);
    if (categoryMatch?.[1] && categorySlug === null) {
      categorySlug = categoryMatch[1].toLowerCase();
      continue;
    }
    const dayMatch = /^@(\d{1,2})$/.exec(token);
    if (dayMatch?.[1] && dayOfMonth === null) {
      const day = Number(dayMatch[1]);
      if (day >= 1 && day <= 31) dayOfMonth = day;
      continue;
    }
    noteWords.push(token);
  }

  if (cadence === null) return null;

  return {
    amountCents,
    cadence,
    note: noteWords.length > 0 ? noteWords.join(' ') : null,
    categorySlug,
    dayOfMonth,
  };
}

export async function handleRecurring(ctx: AppContext, botCtx: BotContext): Promise<void> {
  const user = botCtx.appUser;
  const argument = botCtx.match?.toString().trim() ?? '';
  const [subcommand, ...rest] = argument.split(/\s+/);

  if (subcommand === 'add') {
    const parsed = parseAddArgs(rest.join(' '));
    if (!parsed) {
      await botCtx.reply(
        [
          "Couldn't read that. Try:",
          '',
          '`/recurring add 1500 rent monthly`',
          '`/recurring add 15 netflix monthly #bills`',
          '',
          '_daily · weekly · monthly · yearly_',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const today = todayFor(ctx, user);
    const all = await categoriesRepo.listForUser(ctx.db, user.id);
    const kind = 'expense';
    const slug =
      parsed.categorySlug ??
      inferCategorySlug(
        parsed.note,
        all.map((c) => ({ slug: c.slug, kind: c.kind, keywords: c.keywords })),
        kind,
      );
    const category = slug ? all.find((c) => c.slug === slug) : undefined;

    try {
      validateRecurrenceRule({
        cadence: parsed.cadence,
        anchorDate: today,
        dayOfMonth: parsed.dayOfMonth,
        endDate: null,
      });
    } catch (error) {
      if (error instanceof ValidationError) {
        await botCtx.reply(error.message);
        return;
      }
      throw error;
    }

    const needsDay = parsed.cadence === 'monthly' || parsed.cadence === 'yearly';
    const dayOfMonth = needsDay ? (parsed.dayOfMonth ?? Number(today.slice(-2))) : null;

    await recurringRepo.create(ctx.db, {
      userId: user.id,
      direction: 'out',
      amountCents: parsed.amountCents,
      categoryId: category?.id ?? null,
      note: parsed.note,
      cadence: parsed.cadence,
      anchorDate: today,
      dayOfMonth,
      endDate: null,
    });

    const money = escape(
      formatCents(parsed.amountCents, { currency: user.currency, locale: user.locale }),
    );
    await botCtx.reply(
      `Set: *${money}* ${parsed.cadence}${parsed.note ? ` · ${escape(parsed.note)}` : ''}${
        needsDay ? ` · day ${dayOfMonth}` : ''
      }`,
      { parse_mode: 'Markdown', reply_markup: openAppKeyboard(ctx.config) },
    );
    return;
  }

  // No subcommand, or anything else: list.
  const rules = await recurringRepo.listActiveForUser(ctx.db, user.id);
  if (rules.length === 0) {
    await botCtx.reply(
      ['No recurring transactions yet.', '', '`/recurring add 1500 rent monthly`'].join('\n'),
      { parse_mode: 'Markdown' },
    );
    return;
  }

  const money = (cents: number) =>
    escape(formatCents(cents as AmountCents, { currency: user.currency, locale: user.locale }));

  const lines = rules.map(
    (rule) =>
      `${money(rule.amountCents)} · ${rule.cadence}${rule.note ? ` · ${escape(rule.note)}` : ''}`,
  );

  await botCtx.reply(['*Recurring*', '', ...lines].join('\n'), {
    parse_mode: 'Markdown',
    reply_markup: openAppKeyboard(ctx.config, '✏️ Manage in Spendlygo'),
  });
}
