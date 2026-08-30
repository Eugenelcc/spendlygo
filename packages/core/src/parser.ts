/**
 * Quick-text capture (PRD F1).
 *
 * The grammar people actually type, not one they have to learn:
 *
 *     [+|-]<amount> [note words…] [#category] [@date]
 *
 * Modifiers are order-independent and all optional. The amount is the only
 * required part, and its absence is a normal outcome — most chat messages are
 * not transactions — so this returns a typed "not a transaction" result rather
 * than throwing.
 *
 * GUARDRAILS.md section 1: category inference is a deterministic keyword map.
 * No model call, no API, no cost.
 */

import { parseAmountToCents, type AmountCents } from './money.js';
import { addDays, isIsoDate, parseIsoDate, toIsoDate, type IsoDate } from './time.js';
import { INCOME_KEYWORDS, type CategoryKind } from './categories.js';

export type Direction = 'in' | 'out';

export interface ParsedCapture {
  ok: true;
  direction: Direction;
  amountCents: AmountCents;
  note: string | null;
  /** Slug the user named explicitly with `#`, if any. */
  categorySlug: string | null;
  occurredOn: IsoDate;
  /** True when the date came from an `@` token rather than defaulting to today. */
  hasExplicitDate: boolean;
}

export type ParseFailureReason = 'empty' | 'no_amount' | 'bad_date';

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  /** The offending token, for a message that points at what went wrong. */
  token?: string;
}

export type ParseResult = ParsedCapture | ParseFailure;

export interface ParseOptions {
  /** Today in the user's timezone. Never derived here — see GUARDRAILS section 9. */
  today: IsoDate;
}

const CATEGORY_TOKEN = /^#([\p{L}\p{N}_-]+)$/u;
const DATE_TOKEN = /^@(.+)$/u;
const DAY_MONTH = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/;

/** Words that mean "today" or "yesterday" without spelling it out. */
const TODAY_WORDS = new Set(['today', 'tdy', 'tod']);
const YESTERDAY_WORDS = new Set(['yesterday', 'ytd', 'yest', 'yda']);

/**
 * Resolve an `@` token to a calendar date in the user's timezone.
 *
 * Day-before-month, matching how dates are written in Singapore, and a
 * day/month pair with no year resolves to the most recent such date rather than
 * one in the future — typing `@31/12` on 2 January means last month, not eleven
 * months away.
 */
export function parseDateToken(raw: string, today: IsoDate): IsoDate | null {
  const value = raw.trim().toLowerCase();
  if (value === '') return null;

  if (TODAY_WORDS.has(value)) return today;
  if (YESTERDAY_WORDS.has(value)) return addDays(today, -1);

  if (isIsoDate(value)) return value as IsoDate;

  const match = DAY_MONTH.exec(value);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearPart = match[3];
  const { year: currentYear } = parseIsoDate(today);

  let year: number;
  if (yearPart === undefined) {
    year = currentYear;
  } else if (yearPart.length === 2) {
    year = 2000 + Number(yearPart);
  } else {
    year = Number(yearPart);
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let candidate: IsoDate;
  try {
    candidate = toIsoDate({ year, month, day });
    parseIsoDate(candidate); // rejects 31 February and friends
  } catch {
    return null;
  }

  // A bare day/month in the future almost always means the year just gone.
  if (yearPart === undefined && candidate > today) {
    try {
      const lastYear = toIsoDate({ year: year - 1, month, day });
      parseIsoDate(lastYear);
      return lastYear;
    } catch {
      return null;
    }
  }

  return candidate;
}

function looksLikeIncome(note: string | null, categorySlug: string | null): boolean {
  const haystack = `${note ?? ''} ${categorySlug ?? ''}`.toLowerCase();
  return INCOME_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/**
 * Parse a chat message into a transaction.
 *
 * Returns a failure rather than throwing, because "this message has no amount"
 * is the common case for ordinary conversation and not an error.
 */
export function parseCapture(input: string, options: ParseOptions): ParseResult {
  const trimmed = input.trim();
  if (trimmed === '') return { ok: false, reason: 'empty' };

  const tokens = trimmed.split(/\s+/);

  let categorySlug: string | null = null;
  let occurredOn: IsoDate | null = null;
  let hasExplicitDate = false;
  let amountCents: AmountCents | null = null;
  let explicitDirection: Direction | null = null;
  const noteWords: string[] = [];

  for (const token of tokens) {
    const categoryMatch = CATEGORY_TOKEN.exec(token);
    if (categoryMatch?.[1] && categorySlug === null) {
      categorySlug = categoryMatch[1].toLowerCase();
      continue;
    }

    const dateMatch = DATE_TOKEN.exec(token);
    if (dateMatch?.[1] && occurredOn === null) {
      const parsed = parseDateToken(dateMatch[1], options.today);
      if (parsed === null) return { ok: false, reason: 'bad_date', token };
      occurredOn = parsed;
      hasExplicitDate = true;
      continue;
    }

    // The first token that reads as an amount is the amount; later numbers are
    // part of the note ("2 coffees 8.40" -> note "2 coffees", amount 8.40 only
    // if the 2 failed to parse, which it doesn't — so amount 2. Documented
    // behaviour: put the amount first).
    if (amountCents === null) {
      const sign = token.startsWith('+') ? 'in' : token.startsWith('-') ? 'out' : null;
      const unsigned = sign === null ? token : token.slice(1);
      const parsed = parseAmountToCents(unsigned);
      if (parsed !== null) {
        amountCents = parsed;
        explicitDirection = sign;
        continue;
      }
    }

    noteWords.push(token);
  }

  if (amountCents === null) return { ok: false, reason: 'no_amount' };

  const note = noteWords.length > 0 ? noteWords.join(' ') : null;

  // PRD F1.2: expense is the default. Income needs a `+`, an income category,
  // or an income word — anything else is money going out.
  const direction: Direction =
    explicitDirection ?? (looksLikeIncome(note, categorySlug) ? 'in' : 'out');

  return {
    ok: true,
    direction,
    amountCents,
    note,
    categorySlug,
    occurredOn: occurredOn ?? options.today,
    hasExplicitDate,
  };
}

export interface InferenceCategory {
  slug: string;
  kind: CategoryKind;
  keywords: readonly string[];
}

/**
 * Pick a category from the note (PRD F10.4).
 *
 * Longest keyword wins, so "bubble tea" beats "tea" and a specific merchant
 * beats a generic word. Ties break on the earlier match, which keeps the result
 * stable regardless of how the category list happens to be ordered.
 */
export function inferCategorySlug(
  note: string | null,
  categories: readonly InferenceCategory[],
  kind: CategoryKind,
): string | null {
  if (!note) return null;
  const haystack = ` ${note.toLowerCase()} `;

  let bestSlug: string | null = null;
  let bestLength = 0;
  let bestIndex = Number.MAX_SAFE_INTEGER;

  for (const category of categories) {
    if (category.kind !== kind) continue;

    for (const keyword of category.keywords) {
      const needle = keyword.toLowerCase();
      // Padded so "tea" does not match inside "steak".
      const index = haystack.indexOf(` ${needle} `);
      const found =
        index !== -1
          ? index
          : // Also allow a keyword that is a whole word followed by punctuation.
            haystack.search(new RegExp(`\\s${escapeRegExp(needle)}\\b`));

      if (found === -1) continue;

      if (needle.length > bestLength || (needle.length === bestLength && found < bestIndex)) {
        bestSlug = category.slug;
        bestLength = needle.length;
        bestIndex = found;
      }
    }
  }

  return bestSlug;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
