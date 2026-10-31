/**
 * The /recap footer with a pay cycle (B-032 Part 2, P2-AC8). Pure, no DB.
 * Written before the feature exists: `recapFooter` is not exported yet.
 */

import { describe, expect, it } from 'vitest';
import { recapFooter } from './recap.js';

describe('recapFooter', () => {
  it('says "this cycle" only when the start day isn\'t 1', () => {
    // Start day 20: month -> unchanged, year -> "this cycle".
    expect(recapFooter('month', 20)).toBe('`/recap year` for the whole year');
    expect(recapFooter('year', 20)).toBe('`/recap` for this cycle instead');
    // Start day 1: both exactly as before B-032.
    expect(recapFooter('month', 1)).toBe('`/recap year` for the whole year');
    expect(recapFooter('year', 1)).toBe('`/recap` for this month instead');
  });
});
