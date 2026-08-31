/**
 * Guessing a receipt's total from OCR'd text (PRD F4.6, ADR 0005).
 *
 * Pure text parsing — no I/O, matches the rest of `core`. The actual OCR
 * call lives in apps/server/src/telegram/ocr.ts; this is the part that
 * decides which number in a page of shaky, OCR'd receipt text is the total,
 * which is the genuinely fuzzy part of this feature. GUARDRAILS.md's spirit
 * applies even to a "guess": never invent a number with more confidence than
 * it deserves, and never let a bad read silently become the truth — the
 * caller always treats this as a pre-fill the user confirms, never a save.
 *
 * Strategy, in order:
 *  1. A line naming what's actually owed ("amount due", "balance due",
 *     "grand total", then plain "total" — deliberately NOT "subtotal",
 *     which a plain \btotal\b already excludes by word boundary) wins, using
 *     the last money-shaped number on that line (a line can read
 *     "Total  12.50" with other digits, like a quantity, earlier on it).
 *  2. No such line: the largest money-shaped number anywhere in the text.
 *     Receipts are mostly line items smaller than their own total, so this
 *     is a reasonable last resort — never anything stronger than that.
 *  3. Nothing money-shaped at all: null. A missing guess is honest; a wrong
 *     one that looks confident is worse than asking the user to type it.
 */

import { positiveCentsOf, type AmountCents } from './money.js';

const KEYWORD_PATTERNS = [
  /\bamount\s*due\b/i,
  /\bbalance\s*due\b/i,
  /\bgrand\s*total\b/i,
  /\btotal\b/i,
];

/** `12.50`, `1,234.56` — always two decimals, since anything else is not a price. */
const MONEY_PATTERN = /\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2}/g;

function parseMoneyToken(token: string): AmountCents | null {
  const cents = Math.round(Number(token.replace(/,/g, '')) * 100);
  try {
    return positiveCentsOf(cents);
  } catch {
    return null;
  }
}

function moneyTokensOn(line: string): AmountCents[] {
  const amounts: AmountCents[] = [];
  for (const match of line.matchAll(MONEY_PATTERN)) {
    const amount = parseMoneyToken(match[0]);
    if (amount !== null) amounts.push(amount);
  }
  return amounts;
}

export function extractReceiptTotalCents(ocrText: string): AmountCents | null {
  const lines = ocrText.split(/\r?\n/);

  for (const keyword of KEYWORD_PATTERNS) {
    for (const line of lines) {
      if (!keyword.test(line)) continue;
      const amounts = moneyTokensOn(line);
      if (amounts.length > 0) return amounts[amounts.length - 1] as AmountCents;
    }
  }

  const allAmounts = lines.flatMap(moneyTokensOn);
  if (allAmounts.length === 0) return null;
  return allAmounts.reduce((max, amount) => (amount > max ? amount : max));
}
