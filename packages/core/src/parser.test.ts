import { describe, expect, it } from 'vitest';
import { inferCategorySlug, parseCapture, parseDateToken } from './parser.js';
import { DEFAULT_CATEGORIES } from './categories.js';
import type { IsoDate } from './time.js';

const TODAY = '2026-08-27' as IsoDate; // a Thursday
const opts = { today: TODAY };

function parsed(input: string) {
  const result = parseCapture(input, opts);
  if (!result.ok) throw new Error(`Expected "${input}" to parse, got ${result.reason}`);
  return result;
}

describe('parseCapture — the golden set (PRD F1)', () => {
  it.each([
    // input                      amount  direction  note              category  date
    ['12.50 lunch', 1250, 'out', 'lunch', null, TODAY],
    ['12.50 lunch #food', 1250, 'out', 'lunch', 'food', TODAY],
    ['+3000 salary', 300_000, 'in', 'salary', null, TODAY],
    ['-8.20 grab', 820, 'out', 'grab', null, TODAY],
    ['s$12.50 kopi', 1250, 'out', 'kopi', null, TODAY],
    ['S$12.50 kopi', 1250, 'out', 'kopi', null, TODAY],
    ['12.5k rent', 1_250_000, 'out', 'rent', null, TODAY],
    ['45 dinner @yesterday', 4500, 'out', 'dinner', null, '2026-08-26'],
    ['45 dinner @12/03', 4500, 'out', 'dinner', null, '2026-03-12'],
    ['3.20', 320, 'out', null, null, TODAY],
    ['15 movie night #entertainment', 1500, 'out', 'movie night', 'entertainment', TODAY],
    ['1,234.56 laptop', 123_456, 'out', 'laptop', null, TODAY],
    ['9.90 bubble tea @today', 990, 'out', 'bubble tea', null, TODAY],
    ['+250 refund from shopee', 25_000, 'in', 'refund from shopee', null, TODAY],
    ['2500 rent #bills @1/8', 250_000, 'out', 'rent', 'bills', '2026-08-01'],
    ['0.50 sweet', 50, 'out', 'sweet', null, TODAY],
    ['88 #gifts', 8800, 'out', null, 'gifts', TODAY],
    ['12.50 lunch @2026-08-20', 1250, 'out', 'lunch', null, '2026-08-20'],
    ['5 kopi @ytd', 500, 'out', 'kopi', null, '2026-08-26'],
    ['+1.5k bonus', 150_000, 'in', 'bonus', null, TODAY],
  ])('%j', (input, amount, direction, note, category, date) => {
    const result = parsed(input as string);
    expect(result.amountCents).toBe(amount);
    expect(result.direction).toBe(direction);
    expect(result.note).toBe(note);
    expect(result.categorySlug).toBe(category);
    expect(result.occurredOn).toBe(date);
  });
});

describe('parseCapture — direction', () => {
  it('defaults to expense (PRD F1.2)', () => {
    expect(parsed('20 something').direction).toBe('out');
  });

  it('treats a leading + as income', () => {
    expect(parsed('+20 something').direction).toBe('in');
  });

  it('infers income from a keyword in the note', () => {
    expect(parsed('3000 monthly salary').direction).toBe('in');
    expect(parsed('45 got a refund').direction).toBe('in');
  });

  it('lets an explicit minus win over an income-sounding word', () => {
    // "I spent 12 on a salary book" — the sign is the user being explicit.
    expect(parsed('-12 salary book').direction).toBe('out');
  });
});

describe('parseCapture — modifier order is free', () => {
  it.each([
    '12.50 #food lunch @yesterday',
    '12.50 lunch @yesterday #food',
    '12.50 @yesterday #food lunch',
  ])('%j parses the same', (input) => {
    const result = parsed(input);
    expect(result.amountCents).toBe(1250);
    expect(result.categorySlug).toBe('food');
    expect(result.note).toBe('lunch');
    expect(result.occurredOn).toBe('2026-08-26');
  });
});

describe('parseCapture — failures are ordinary, not errors', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['hello there', 'no_amount'],
    ['how much did i spend', 'no_amount'],
    ['lunch #food', 'no_amount'],
  ])('%j -> %s', (input, reason) => {
    const result = parseCapture(input, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  });

  it('names the offending token on a bad date', () => {
    const result = parseCapture('12.50 lunch @notaday', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('bad_date');
      expect(result.token).toBe('@notaday');
    }
  });

  it('rejects an impossible date rather than silently shifting it', () => {
    const result = parseCapture('12.50 lunch @31/02', opts);
    expect(result.ok).toBe(false);
  });
});

describe('parseDateToken', () => {
  it('handles the words people actually type', () => {
    expect(parseDateToken('today', TODAY)).toBe(TODAY);
    expect(parseDateToken('TODAY', TODAY)).toBe(TODAY);
    expect(parseDateToken('yesterday', TODAY)).toBe('2026-08-26');
    expect(parseDateToken('ytd', TODAY)).toBe('2026-08-26');
  });

  it('reads day before month, as Singapore writes them', () => {
    expect(parseDateToken('12/03', TODAY)).toBe('2026-03-12');
    expect(parseDateToken('1/8', TODAY)).toBe('2026-08-01');
    expect(parseDateToken('12-03', TODAY)).toBe('2026-03-12');
  });

  it('accepts explicit years, two-digit or four', () => {
    expect(parseDateToken('12/03/2025', TODAY)).toBe('2025-03-12');
    expect(parseDateToken('12/03/25', TODAY)).toBe('2025-03-12');
  });

  it('reads a future-looking day/month as the year just gone', () => {
    // Typing @31/12 in August means last December, not four months from now.
    expect(parseDateToken('31/12', TODAY)).toBe('2025-12-31');
  });

  it('crosses a year boundary correctly', () => {
    expect(parseDateToken('yesterday', '2026-01-01' as IsoDate)).toBe('2025-12-31');
  });

  it('rejects nonsense', () => {
    expect(parseDateToken('notaday', TODAY)).toBeNull();
    expect(parseDateToken('13/13', TODAY)).toBeNull();
    expect(parseDateToken('', TODAY)).toBeNull();
  });
});

describe('inferCategorySlug (PRD F10.4)', () => {
  const categories = DEFAULT_CATEGORIES;

  it.each([
    ['lunch at the hawker', 'food'],
    ['kopi', 'food'],
    ['grab to office', 'transport'],
    ['mrt', 'transport'],
    ['ntuc groceries', 'groceries'],
    ['netflix', 'bills'],
    ['guardian pharmacy', 'health'],
    ['movie with friends', 'entertainment'],
  ])('%j -> %s', (note, slug) => {
    expect(inferCategorySlug(note, categories, 'expense')).toBe(slug);
  });

  it('prefers the longer, more specific keyword', () => {
    // "bubble tea" is Food; nothing should match on a fragment instead.
    expect(inferCategorySlug('bubble tea', categories, 'expense')).toBe('food');
  });

  it('does not match a keyword hiding inside another word', () => {
    // "gv" is a cinema, but must not fire inside "gvhouse".
    expect(inferCategorySlug('gvhouse thing', categories, 'expense')).toBeNull();
  });

  it('returns null when nothing matches, rather than guessing', () => {
    expect(inferCategorySlug('zzzzz qqqqq', categories, 'expense')).toBeNull();
    expect(inferCategorySlug(null, categories, 'expense')).toBeNull();
  });

  it('only considers categories of the requested kind', () => {
    expect(inferCategorySlug('salary', categories, 'income')).toBe('salary');
    expect(inferCategorySlug('salary', categories, 'expense')).toBeNull();
  });
});
