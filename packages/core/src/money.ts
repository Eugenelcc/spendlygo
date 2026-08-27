/**
 * Money arithmetic.
 *
 * GUARDRAILS.md section 2: money is integer cents, everywhere — database, API,
 * UI state. Floats are never used for currency. `AmountCents` is branded so a
 * plain number (dollars, a count, an index) cannot be passed where cents are
 * expected.
 *
 * Direction (`in` / `out`) carries the sign of a transaction; stored amounts
 * are always positive. Signed values here exist only for computed results such
 * as a net total or a remaining balance.
 */

import { ValidationError } from './errors.js';

declare const amountCentsBrand: unique symbol;

/** An integer number of minor currency units (cents). */
export type AmountCents = number & { readonly [amountCentsBrand]: true };

export const ZERO_CENTS = 0 as AmountCents;

/** Largest amount we accept: S$10,000,000.00 — a typo guard, not a real limit. */
export const MAX_AMOUNT_CENTS = 1_000_000_000;

/** Wrap a raw integer as cents. Throws if it is not a safe integer. */
export function centsOf(value: number): AmountCents {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError(`Amount must be a whole number of cents, received ${value}`);
  }
  return value as AmountCents;
}

/** Wrap a raw integer as cents, requiring it to be strictly positive. */
export function positiveCentsOf(value: number): AmountCents {
  const cents = centsOf(value);
  if (cents <= 0) {
    throw new ValidationError('Amount must be greater than zero');
  }
  if (cents > MAX_AMOUNT_CENTS) {
    throw new ValidationError('Amount is implausibly large');
  }
  return cents;
}

export function addCents(a: AmountCents, b: AmountCents): AmountCents {
  return centsOf(a + b);
}

export function subtractCents(a: AmountCents, b: AmountCents): AmountCents {
  return centsOf(a - b);
}

export function sumCents(values: readonly AmountCents[]): AmountCents {
  let total = 0;
  for (const value of values) total += value;
  return centsOf(total);
}

export function negateCents(value: AmountCents): AmountCents {
  return centsOf(-value);
}

export function absCents(value: AmountCents): AmountCents {
  return centsOf(Math.abs(value));
}

/**
 * Divide cents into `parts`, rounding DOWN.
 *
 * GUARDRAILS.md section 2: always round down. The daily safe-to-spend figure is
 * this function, and `Σ dailyAllowance` must never exceed the monthly budget.
 */
export function divideCentsFloor(value: AmountCents, parts: number): AmountCents {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new ValidationError(`Cannot divide into ${parts} parts`);
  }
  return centsOf(Math.floor(value / parts));
}

/** Multiply by a ratio (e.g. a pace projection), rounding DOWN. */
export function scaleCentsFloor(value: AmountCents, ratio: number): AmountCents {
  if (!Number.isFinite(ratio)) {
    throw new ValidationError(`Cannot scale by ${ratio}`);
  }
  return centsOf(Math.floor(value * ratio));
}

/** Clamp to zero. Used wherever a negative remainder must read as "nothing left". */
export function clampNonNegative(value: AmountCents): AmountCents {
  return value < 0 ? ZERO_CENTS : value;
}

export interface FormatMoneyOptions {
  /** ISO 4217 code. Defaults to SGD. */
  currency?: string;
  locale?: string;
  /** Render 1234.00 as "1,234" instead of "1,234.00". */
  hideZeroCents?: boolean;
  /** Prefix positive values with "+". Used for income rows. */
  signed?: boolean;
}

/**
 * The single place cents become human-readable text.
 *
 * Everything upstream of the render layer works in cents; nothing else in the
 * codebase should build a currency string by hand.
 */
export function formatCents(value: AmountCents, options: FormatMoneyOptions = {}): string {
  const { currency = 'SGD', locale = 'en-SG', hideZeroCents = false, signed = false } = options;

  const showCents = !(hideZeroCents && value % 100 === 0);
  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(Math.abs(value) / 100);

  if (value < 0) return `-${formatted}`;
  if (signed && value > 0) return `+${formatted}`;
  return formatted;
}

/** Cents as a bare decimal string, for CSV export. `1234` -> `"12.34"`. */
export function centsToDecimalString(value: AmountCents): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const AMOUNT_PATTERN = /^(\d{1,3}(?:,\d{3})*|\d+)?(?:\.(\d{1,2}))?(k)?$/i;

/**
 * Parse a user-typed amount into cents.
 *
 * Accepts: `12`, `12.5`, `12.50`, `1,234.56`, `S$12.50`, `$12.50`, `12.5k`.
 * Returns `null` when the input is not an amount — callers decide what that
 * means, because "not an amount" is a normal outcome for ordinary chat messages.
 */
export function parseAmountToCents(input: string): AmountCents | null {
  const cleaned = input
    .trim()
    .replace(/^(s\$|sgd|rm|usd|\$)\s*/i, '')
    .replace(/\s+/g, '');

  if (cleaned === '') return null;

  const match = AMOUNT_PATTERN.exec(cleaned);
  if (!match) return null;

  const [, whole, fraction, thousands] = match;
  if (whole === undefined && fraction === undefined) return null;

  const wholeDigits = (whole ?? '0').replace(/,/g, '');
  const fractionDigits = (fraction ?? '').padEnd(2, '0');

  let cents = Number(wholeDigits) * 100 + Number(fractionDigits || '0');

  if (thousands) {
    // "12.5k" means 12,500 — the fractional part scales too.
    cents *= 1000;
  }

  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) return null;

  return cents as AmountCents;
}
