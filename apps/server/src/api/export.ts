/**
 * CSV export (PRD F8) — one shared builder behind both surfaces (F8.1): the
 * bot's `/export` and the Mini App's Settings button. Generated in-process
 * and handed to the caller as a string; never written to disk (F8.2, and
 * there is no persistent disk to write to on this runtime anyway).
 */

import {
  buildTransactionsCsv,
  monthRange,
  parseIsoDate,
  yearRange,
  type IsoDate,
} from '@spendlygo/core';
import { transactionsRepo, type User } from '@spendlygo/db';
import type { AppContext } from '../context.js';
import { activeHouseholdId } from './service.js';

export interface ExportRange {
  from?: IsoDate;
  to?: IsoDate;
  /** For the filename and a human-readable confirmation. */
  label: string;
}

export async function buildExportCsv(
  ctx: AppContext,
  user: User,
  range: ExportRange = { label: 'all-time' },
): Promise<string> {
  const rows = await transactionsRepo.listForExport(ctx.db, activeHouseholdId(user), {
    from: range.from,
    to: range.to,
  });

  return buildTransactionsCsv(
    rows.map((row) => ({
      occurredOn: row.occurredOn,
      direction: row.direction,
      amountCents: row.amountCents,
      categoryName: row.categoryName,
      note: row.note,
      source: row.source,
      hasPhoto: row.hasPhoto,
      createdAt: row.createdAt,
    })),
  );
}

export function exportFilename(range: ExportRange): string {
  return `spendlygo-${range.label}.csv`;
}

/**
 * PRD F8.4: `/export` (everything), `/export 2026`, or `/export 2026-08`.
 * Null for anything else, so the caller can show a usage hint.
 */
export function parseExportRange(argument: string): ExportRange | null {
  const trimmed = argument.trim();
  if (trimmed === '') return { label: 'all-time' };

  const yearMonth = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return null;
    try {
      const range = monthRange(year, month);
      return { from: range.start, to: range.end, label: trimmed };
    } catch {
      return null;
    }
  }

  const yearOnly = /^(\d{4})$/.exec(trimmed);
  if (yearOnly) {
    const year = Number(yearOnly[1]);
    const range = yearRange(year);
    return { from: range.start, to: range.end, label: trimmed };
  }

  // Also accept a full date, for symmetry with how ranges are shown elsewhere.
  try {
    parseIsoDate(trimmed);
    return { from: trimmed as IsoDate, to: trimmed as IsoDate, label: trimmed };
  } catch {
    return null;
  }
}
