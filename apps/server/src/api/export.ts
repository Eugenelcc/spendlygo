/**
 * CSV export (PRD F8) — one shared builder behind both surfaces (F8.1): the
 * bot's `/export` and the Mini App's Settings button. Generated in-process
 * and handed to the caller as a string; never written to disk (F8.2, and
 * there is no persistent disk to write to on this runtime anyway).
 */

import {
  buildTransactionsCsv,
  cycleContaining,
  formatDateRangeWithYears,
  monthName,
  monthRange,
  parseIsoDate,
  previousCycle,
  yearRange,
  type BudgetCycle,
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
  /** Download name: `spendlygo_<from>_to_<to>.csv`, or `spendlygo-all-time.csv`. */
  filename: string;
}

export async function buildExportCsv(
  ctx: AppContext,
  user: User,
  range: ExportRange = { label: 'all-time', filename: 'spendlygo-all-time.csv' },
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

export interface ExportRangeContext {
  /** Today in the user's timezone. */
  today: IsoDate;
  /** The active space's cycle start day (F17). */
  cycleStartDay: number;
}

function bounded(from: IsoDate, to: IsoDate, label: string): ExportRange {
  return { from, to, label, filename: `spendlygo_${from}_to_${to}.csv` };
}

/** Day 1 keeps month names ("October 2026"); any other start day names the range. */
function cycleExportLabel(cycle: BudgetCycle): string {
  if (cycle.startDay !== 1) return formatDateRangeWithYears(cycle);
  const { year, month } = parseIsoDate(cycle.start);
  return `${monthName(month)} ${year}`;
}

/**
 * PRD F8.4: `''` (everything), `cycle`, `last cycle` (any case/spacing, or
 * `last-cycle`), `YYYY`, `YYYY-MM` (always the calendar month), `YYYY-MM-DD`,
 * or a custom `YYYY-MM-DD..YYYY-MM-DD`. Null for anything else, so the caller
 * can show a usage hint.
 */
export function parseExportRange(
  argument: string,
  context: ExportRangeContext,
): ExportRange | null {
  const normalised = argument.trim().toLowerCase().replace(/\s+/g, '-');
  if (normalised === '') return { label: 'all-time', filename: 'spendlygo-all-time.csv' };

  if (normalised === 'cycle' || normalised === 'last-cycle') {
    let cycle: BudgetCycle;
    try {
      cycle = cycleContaining(context.today, context.cycleStartDay);
      if (normalised === 'last-cycle') cycle = previousCycle(cycle);
    } catch {
      return null;
    }
    return bounded(cycle.start, cycle.end, cycleExportLabel(cycle));
  }

  const yearMonth = /^(\d{4})-(\d{2})$/.exec(normalised);
  if (yearMonth) {
    const year = Number(yearMonth[1]);
    const month = Number(yearMonth[2]);
    if (month < 1 || month > 12) return null;
    try {
      const range = monthRange(year, month);
      return bounded(range.start, range.end, normalised);
    } catch {
      return null;
    }
  }

  const yearOnly = /^(\d{4})$/.exec(normalised);
  if (yearOnly) {
    const range = yearRange(Number(yearOnly[1]));
    return bounded(range.start, range.end, normalised);
  }

  const custom = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(normalised);
  if (custom) {
    try {
      parseIsoDate(custom[1] as string);
      parseIsoDate(custom[2] as string);
    } catch {
      return null;
    }
    const from = custom[1] as IsoDate;
    const to = custom[2] as IsoDate;
    if (from > to) return null;
    return bounded(from, to, formatDateRangeWithYears({ start: from, end: to }));
  }

  // Also accept a full date, for symmetry with how ranges are shown elsewhere.
  try {
    parseIsoDate(normalised);
    return bounded(normalised as IsoDate, normalised as IsoDate, normalised);
  } catch {
    return null;
  }
}
