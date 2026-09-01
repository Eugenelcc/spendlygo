/**
 * The only place cents become text (DESIGN.md section 8).
 *
 * Everything upstream works in integer cents; nothing else in the app builds a
 * currency string by hand.
 */

export interface MoneyOptions {
  currency?: string;
  locale?: string;
  /** Render 150000 as "$1,500" rather than "$1,500.00". */
  hideZeroCents?: boolean;
  signed?: boolean;
}

export function formatMoney(cents: number, options: MoneyOptions = {}): string {
  const { currency = 'SGD', locale = 'en-SG', hideZeroCents = false, signed = false } = options;
  const showCents = !(hideZeroCents && cents % 100 === 0);

  const formatted = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  }).format(Math.abs(cents) / 100);

  if (cents < 0) return `-${formatted}`;
  if (signed && cents > 0) return `+${formatted}`;
  return formatted;
}

/** Just the digits, for the hero number that renders its own currency mark. */
export function formatAmount(cents: number, locale = 'en-SG'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(cents) / 100);
}

export function currencySymbol(currency = 'SGD', locale = 'en-SG'): string {
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(0);
  return parts.find((part) => part.type === 'currency')?.value ?? '$';
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Parse `YYYY-MM-DD` without letting the local timezone shift the day. */
function parts(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1, day: day ?? 1 };
}

/** Days in the calendar month `isoDate` falls in — for converting a daily
 * figure to a monthly one and back (Settings' budget input). */
export function daysInMonth(isoDate: string): number {
  const { year, month } = parts(isoDate);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function formatLongDate(isoDate: string): string {
  const { year, month, day } = parts(isoDate);
  const weekday = DAY_NAMES[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  return `${weekday}, ${day} ${MONTH_NAMES[month - 1]}`;
}

export function formatShortDate(isoDate: string): string {
  const { month, day } = parts(isoDate);
  return `${day} ${MONTH_NAMES[month - 1]?.slice(0, 3)}`;
}

/** "Today" and "Yesterday" beat a date the reader has to decode. */
export function formatRelativeDate(isoDate: string, today: string): string {
  if (isoDate === today) return 'Today';

  const t = parts(today);
  const yesterday = new Date(Date.UTC(t.year, t.month - 1, t.day - 1));
  const yesterdayIso = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, '0')}-${String(yesterday.getUTCDate()).padStart(2, '0')}`;
  if (isoDate === yesterdayIso) return 'Yesterday';

  return formatShortDate(isoDate);
}

export const PACE_COPY: Record<string, { label: string; token: string }> = {
  ahead: { label: 'Ahead of pace', token: 'ahead' },
  on_track: { label: 'On track', token: 'ontrack' },
  behind: { label: 'Behind pace', token: 'behind' },
  over_budget: { label: 'Over budget', token: 'over' },
};
