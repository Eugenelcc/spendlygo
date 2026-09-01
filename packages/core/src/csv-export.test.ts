import { describe, expect, it } from 'vitest';
import { buildTransactionsCsv, type ExportTransactionRow } from './csv-export.js';
import { centsOf } from './money.js';

function row(overrides: Partial<ExportTransactionRow> = {}): ExportTransactionRow {
  return {
    occurredOn: '2026-08-15',
    direction: 'out',
    amountCents: centsOf(1250),
    categoryName: 'Food',
    note: 'lunch',
    source: 'chat',
    hasPhoto: false,
    createdAt: new Date('2026-08-15T04:30:00Z'),
    ...overrides,
  };
}

describe('buildTransactionsCsv', () => {
  it('has the exact PRD F8.3 header, in order', () => {
    const csv = buildTransactionsCsv([]);
    const header = csv.replace(/^\uFEFF/, '').split('\r\n')[0];
    expect(header).toBe('date,direction,amount_sgd,category,note,source,has_photo,created_at');
  });

  it('starts with a UTF-8 BOM, for Excel/Sheets to read non-ASCII notes correctly', () => {
    const csv = buildTransactionsCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it('uses CRLF line endings throughout', () => {
    const csv = buildTransactionsCsv([row(), row()]);
    expect(csv).toContain('\r\n');
    expect(csv.split('\r\n')).toHaveLength(4); // header + 2 rows + trailing empty
  });

  it('renders cents as a plain decimal, never a rounding artefact', () => {
    const csv = buildTransactionsCsv([row({ amountCents: centsOf(100_000) })]);
    expect(csv).toContain(',1000.00,');
  });

  it('renders an empty category as an empty field, not a made-up label', () => {
    const csv = buildTransactionsCsv([row({ categoryName: null })]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toBe('2026-08-15,out,12.50,,lunch,chat,false,2026-08-15T04:30:00.000Z');
  });

  it('renders a missing note as an empty field', () => {
    const csv = buildTransactionsCsv([row({ note: null })]);
    expect(csv.split('\r\n')[1]).toContain(',Food,,chat,');
  });

  it('quotes a note containing a comma', () => {
    const csv = buildTransactionsCsv([row({ note: 'lunch, with tax' })]);
    expect(csv).toContain('"lunch, with tax"');
  });

  it('quotes and escapes a note containing a double quote', () => {
    const csv = buildTransactionsCsv([row({ note: 'the "good" one' })]);
    expect(csv).toContain('"the ""good"" one"');
  });

  it('quotes a note containing a newline', () => {
    const csv = buildTransactionsCsv([row({ note: 'line one\nline two' })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it('does not quote a field with none of the special characters', () => {
    const csv = buildTransactionsCsv([row({ note: 'plain text' })]);
    expect(csv).toContain(',plain text,');
    expect(csv).not.toContain('"plain text"');
  });

  it('renders direction and has_photo literally', () => {
    const csv = buildTransactionsCsv([row({ direction: 'in', hasPhoto: true })]);
    const dataLine = csv.split('\r\n')[1];
    expect(dataLine).toContain(',in,');
    expect(dataLine).toContain(',true,');
  });

  it('preserves row order — callers control sort, this just renders', () => {
    const csv = buildTransactionsCsv([
      row({ occurredOn: '2026-08-01' }),
      row({ occurredOn: '2026-08-15' }),
      row({ occurredOn: '2026-08-03' }),
    ]);
    const dates = csv
      .split('\r\n')
      .slice(1, 4)
      .map((line) => line.split(',')[0]);
    expect(dates).toEqual(['2026-08-01', '2026-08-15', '2026-08-03']);
  });

  it('produces just the header for no rows', () => {
    const csv = buildTransactionsCsv([]);
    expect(csv.replace(/^\uFEFF/, '').split('\r\n')).toEqual([
      'date,direction,amount_sgd,category,note,source,has_photo,created_at',
      '',
    ]);
  });
});
