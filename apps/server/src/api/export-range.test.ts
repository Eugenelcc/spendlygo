/**
 * Pure tests for parseExportRange (B-032 Part 3, F17, P3-AC1 to AC8).
 * Written before the feature exists: the new signature and `filename` are not built yet.
 */

import { describe, expect, it } from 'vitest';
import type { IsoDate } from '@spendlygo/core';
import { parseExportRange } from './export.js';

const d = (value: string) => value as IsoDate;
const OCT_31 = d('2026-10-31');
const JAN_5 = d('2027-01-05');

const at = (argument: string, cycleStartDay: number, today: IsoDate = OCT_31) =>
  parseExportRange(argument, { today, cycleStartDay });

describe('parseExportRange', () => {
  it('no argument is still everything, named spendlygo-all-time.csv', () => {
    for (const startDay of [20, 1]) {
      const range = at('', startDay);
      expect(range).toEqual({ label: 'all-time', filename: 'spendlygo-all-time.csv' });
      expect(range?.from).toBeUndefined();
      expect(range?.to).toBeUndefined();
    }
  });

  it('"cycle" is this cycle, named with exact dates', () => {
    expect(at('cycle', 20)).toEqual({
      from: '2026-10-20',
      to: '2026-11-19',
      label: '20 Oct – 19 Nov',
      filename: 'spendlygo_2026-10-20_to_2026-11-19.csv',
    });
  });

  it('"last cycle" in any spacing or case is the previous cycle', () => {
    for (const argument of ['last cycle', 'last-cycle', 'Last  Cycle']) {
      expect(at(argument, 20)).toEqual({
        from: '2026-09-20',
        to: '2026-10-19',
        label: '20 Sep – 19 Oct',
        filename: 'spendlygo_2026-09-20_to_2026-10-19.csv',
      });
    }
  });

  it('day 1: this and last cycle are labelled with month names', () => {
    expect(at('cycle', 1)).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      label: 'October 2026',
      filename: 'spendlygo_2026-10-01_to_2026-10-31.csv',
    });
    expect(at('last cycle', 1)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
      label: 'September 2026',
      filename: 'spendlygo_2026-09-01_to_2026-09-30.csv',
    });
  });

  it('YYYY-MM is always the calendar month, whatever the start day', () => {
    for (const startDay of [20, 1]) {
      expect(at('2026-10', startDay)).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
        label: '2026-10',
        filename: 'spendlygo_2026-10-01_to_2026-10-31.csv',
      });
    }
    expect(at('2026-13', 20)).toBeNull();
  });

  it('YYYY is the calendar year and YYYY-MM-DD a single day, named with exact dates', () => {
    for (const startDay of [20, 1]) {
      expect(at('2026', startDay)).toEqual({
        from: '2026-01-01',
        to: '2026-12-31',
        label: '2026',
        filename: 'spendlygo_2026-01-01_to_2026-12-31.csv',
      });
      expect(at('2026-10-05', startDay)).toEqual({
        from: '2026-10-05',
        to: '2026-10-05',
        label: '2026-10-05',
        filename: 'spendlygo_2026-10-05_to_2026-10-05.csv',
      });
    }
  });

  it('a custom from..to range is inclusive; reversed or malformed is null', () => {
    for (const startDay of [20, 1]) {
      expect(at('2026-10-05..2026-10-24', startDay)).toEqual({
        from: '2026-10-05',
        to: '2026-10-24',
        label: '5 Oct – 24 Oct',
        filename: 'spendlygo_2026-10-05_to_2026-10-24.csv',
      });
      expect(at('2026-10-24..2026-10-05', startDay)).toBeNull();
      expect(at('2026-10-05..garbage', startDay)).toBeNull();
      expect(at('2026-02-30..2026-03-01', startDay)).toBeNull();
    }
  });

  it('ranges spanning New Year carry both years in the label', () => {
    expect(at('cycle', 20, JAN_5)).toEqual({
      from: '2026-12-20',
      to: '2027-01-19',
      label: '20 Dec 2026 – 19 Jan 2027',
      filename: 'spendlygo_2026-12-20_to_2027-01-19.csv',
    });
    expect(at('last cycle', 20, JAN_5)?.label).toBe('20 Nov – 19 Dec');
    expect(at('2025-01-05..2026-03-10', 20, JAN_5)).toMatchObject({
      from: '2025-01-05',
      to: '2026-03-10',
      label: '5 Jan 2025 – 10 Mar 2026',
    });
  });

  it('anything else is null', () => {
    expect(at('lastcycle2', 20)).toBeNull();
  });
});
