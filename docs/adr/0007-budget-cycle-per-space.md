# 0007 — The budget cycle is a per-space start day

**Status:** accepted · **Date:** 2026-10-31

## Context

Safe-to-spend and every "month" figure used the calendar month. Someone paid
on the 20th gets a budget that resets eleven days before their money arrives
(PRD F17, B-032).

## Decision

- Each space stores `households.cycle_start_day` (1–31, default 1, CHECK
  constraint). Like the budget, it belongs to the space (ADR 0006), so every
  member sees the same cycle.
- The cycle is a **fixed day, clamped** in short months (31 → 28/29 Feb), the
  same rule recurrence uses. Pure maths lives in `packages/core/src/cycle.ts`.
- Default 1 is exactly the calendar month, so existing users see no change.
- Changing the day takes effect at once; **history is re-grouped by the current
  rule**. No periods are stored, so nothing is lost or rewritten.
- `calculateSafeToSpend` takes an optional `cycle`; result field names
  (`dayOfMonth`, `daysInMonth`) are kept for wire compatibility and now mean
  "day of / days in the budget cycle".
- `updateSettingsSchema` is `.strict()` so that, during a deploy, an older
  server rejects `cycleStartDay` with a 400 instead of silently dropping it.
- The migration is additive (new column with a default), so the running server
  is unaffected while it is applied.

## Later parts

Alert keys, History reuse of `/api/stats`, and `budget_periods` (Part 5) are
added to this ADR when those parts land.
