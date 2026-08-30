import { describe, expect, it } from 'vitest';
import { centsOf, type AmountCents, type IsoDate } from '@spendlygo/core';
import { buildConfirmation } from './capture.js';

const TODAY = '2026-08-27' as IsoDate;

function card(overrides: Partial<Parameters<typeof buildConfirmation>[0]> = {}): string {
  return buildConfirmation({
    direction: 'out',
    amountCents: centsOf(1250),
    categoryEmoji: '🍜',
    categoryName: 'Food',
    note: 'lunch',
    occurredOn: TODAY,
    today: TODAY,
    currency: 'SGD',
    locale: 'en-SG',
    safeTodayCents: centsOf(5000),
    leftForTodayCents: centsOf(3750),
    hasBudget: true,
    overspentCents: centsOf(0),
    ...overrides,
  });
}

describe('the confirmation card (PRD F1.5)', () => {
  it('leads with the amount and what it was', () => {
    const text = card();
    expect(text).toContain('12.50');
    expect(text).toContain('🍜 Food');
    expect(text).toContain('lunch');
  });

  it('shows the consequence, which is the part that changes behaviour', () => {
    expect(card()).toContain('37.50');
    expect(card()).toContain('left to spend today');
  });

  it('marks income with a plus and expense with a minus', () => {
    expect(card({ direction: 'out' })).toContain('−');
    expect(card({ direction: 'in' })).toContain('+');
  });

  it('says nothing about a daily figure for income', () => {
    // Money coming in does not consume today's allowance.
    expect(card({ direction: 'in' })).not.toContain('left to spend today');
  });

  it('warns when the month is over budget instead of showing an allowance', () => {
    const text = card({ overspentCents: centsOf(4210), leftForTodayCents: centsOf(0) });
    expect(text).toContain('over budget');
    expect(text).toContain('42.10');
    expect(text).not.toContain('left to spend today');
  });

  it('invites a budget rather than showing a fabricated number (PRD F6.6)', () => {
    const text = card({ hasBudget: false });
    expect(text).toContain('/budget');
    expect(text).not.toContain('left to spend today');
  });

  it('names the date only when it is not today', () => {
    expect(card()).not.toContain('on 2026');
    expect(card({ occurredOn: '2026-08-26' as IsoDate })).toContain('on 2026-08-26');
  });

  it('escapes Markdown in a note so a stray underscore cannot break the message', () => {
    const text = card({ note: 'lunch_with *boss*' });
    expect(text).toContain('lunch\\_with \\*boss\\*');
  });

  it('copes with no category and no note', () => {
    const text = card({ categoryEmoji: null, categoryName: null, note: null });
    expect(text).toContain('12.50');
    expect(text).not.toContain('·  ·');
  });

  it('formats large amounts with grouped thousands', () => {
    expect(card({ amountCents: centsOf(1_250_000) as AmountCents })).toContain('12,500.00');
  });
});
