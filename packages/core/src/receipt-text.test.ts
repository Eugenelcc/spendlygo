import { describe, expect, it } from 'vitest';
import { extractReceiptTotalCents } from './receipt-text.js';
import { centsOf } from './money.js';

describe('extractReceiptTotalCents', () => {
  it('returns null for empty text', () => {
    expect(extractReceiptTotalCents('')).toBeNull();
  });

  it('returns null when nothing money-shaped is found', () => {
    expect(extractReceiptTotalCents('Thank you for your visit!\nNo receipt data here.')).toBeNull();
  });

  it('finds a plain TOTAL line, a typical simple receipt', () => {
    const text = [
      'COFFEE SHOP',
      'Latte           4.50',
      'Croissant       3.20',
      'TOTAL      7.70',
    ].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(770));
  });

  it('does not confuse Subtotal with Total — the word boundary matters', () => {
    const text = [
      'Item A          10.00',
      'Item B           5.00',
      'Subtotal        15.00',
      'Tax              1.50',
      'Total           16.50',
    ].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(1650));
  });

  it('prefers "amount due" over a plain total when both are present', () => {
    const text = ['Total           50.00', 'Paid            20.00', 'Amount Due      30.00'].join(
      '\n',
    );
    expect(extractReceiptTotalCents(text)).toBe(centsOf(3000));
  });

  it('prefers "balance due" over "grand total"', () => {
    const text = ['Grand Total    99.99', 'Balance Due    49.99'].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(4999));
  });

  it('is case-insensitive', () => {
    expect(extractReceiptTotalCents('grand total: 12.34')).toBe(centsOf(1234));
    expect(extractReceiptTotalCents('GRAND TOTAL: 12.34')).toBe(centsOf(1234));
  });

  it('takes the LAST money-shaped number on the matching line, not the first', () => {
    // A quantity or a per-unit price can appear before the actual total.
    const text = 'Total for 2 items: 12.50';
    expect(extractReceiptTotalCents(text)).toBe(centsOf(1250));
  });

  it('handles thousands separators', () => {
    expect(extractReceiptTotalCents('TOTAL   1,234.56')).toBe(centsOf(123_456));
  });

  it('falls back to the largest money-shaped number with no keyword line', () => {
    const text = ['Latte           4.50', 'Croissant       3.20', 'Service        0.80'].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(450));
  });

  it('ignores numbers that are not money-shaped (no two decimals)', () => {
    // "2" (a quantity) and "2026" (a year) must not be mistaken for amounts.
    const text = ['Qty: 2', 'Date: 2026', 'Total   8.00'].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(800));
  });

  it('ignores a zero or negative-looking amount', () => {
    expect(extractReceiptTotalCents('Total   0.00')).toBeNull();
  });

  it('handles a messy, real-world-shaped OCR read with noise', () => {
    const text = [
      'WAREHOUSE MART #042',
      '1234 Any St, Singapore',
      '',
      'MILK 1L           x1    3.60',
      'BREAD WHOLEMEAL   x2    5.80',
      'EGGS DOZEN        x1    4.20',
      '------------------------',
      'SUBTOTAL              13.60',
      'GST 9%                 1.22',
      'TOTAL                 14.82',
      '',
      'CASH                   20.00',
      'CHANGE                  5.18',
    ].join('\n');
    expect(extractReceiptTotalCents(text)).toBe(centsOf(1482));
  });
});
