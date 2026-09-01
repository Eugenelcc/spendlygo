/**
 * CSV export (PRD F8) — turning transaction rows into RFC 4180 text.
 *
 * Pure and I/O-free, like the rest of `core`: the caller fetches rows
 * (packages/db) and delivers the resulting string (a Telegram document or an
 * HTTP response) — this module only knows how to shape text.
 */

import { centsToDecimalString, type AmountCents } from './money.js';

export interface ExportTransactionRow {
  occurredOn: string;
  direction: 'in' | 'out';
  amountCents: number;
  categoryName: string | null;
  note: string | null;
  source: string;
  hasPhoto: boolean;
  createdAt: Date;
}

const COLUMNS = [
  'date',
  'direction',
  'amount_sgd',
  'category',
  'note',
  'source',
  'has_photo',
  'created_at',
] as const;

/** Quote a field only if it needs it — a comma, quote, or newline inside it. */
function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * `\r\n` line endings and a UTF-8 BOM: both are what make Excel (and by
 * extension Google Sheets' CSV import) render this correctly rather than as
 * one run-on line or with mangled non-ASCII notes — not needed by more
 * permissive tools, but never wrong for them either.
 */
const BOM = '﻿';

export function buildTransactionsCsv(rows: readonly ExportTransactionRow[]): string {
  const lines = [COLUMNS.join(',')];

  for (const row of rows) {
    const fields = [
      row.occurredOn,
      row.direction,
      centsToDecimalString(row.amountCents as AmountCents),
      row.categoryName ?? '',
      row.note ?? '',
      row.source,
      String(row.hasPhoto),
      row.createdAt.toISOString(),
    ];
    lines.push(fields.map(csvField).join(','));
  }

  return BOM + lines.join('\r\n') + '\r\n';
}
