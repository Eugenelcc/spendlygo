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

## Alert keys (Part 2)

`budget_alerts` stays keyed `(user_id, year, month, threshold_pct)` with **no
migration**; `year`/`month` are the calendar month the cycle *ends* in
(`cycleAlertKey`). For a fixed start day every cycle has its own key; for start
day 1 the key equals the calendar month, so rows written before F17 still
suppress repeats. The cost, accepted by the owner: after the start day moves
earlier (or later before the new day arrives) the new cycle can share a key
with the old one, so one threshold may be skipped once. It can never be sent
twice for the same key. A per-cycle table would fix it exactly but needs a
migration; revisit if the skip is ever reported. Alerts are keyed by user, not space
(PRD F13.3).

## History reuses `/api/stats` (Part 2)

`GET /api/stats?period=month&anchor=<date>` returns `from`, `to` and `label` of
the cycle containing any date, so History's "Cycle" chip steps with the day
before `from` / after `to` and needs no new endpoint. The cost is a heavier
response than the chip needs, fetched only when the chip is used.

## Later parts

`budget_periods` (Part 5) is added to this ADR when it lands.
