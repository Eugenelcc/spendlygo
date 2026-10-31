# packages/core — local rules

Pure domain logic. This is where the "dangerous five" live: money maths, the
text parser, safe-to-spend, recurrence dates, and timezone boundaries. The root
`CLAUDE.md` and `GUARDRAILS.md` apply. This file only adds what's specific
to this folder.

## Map

| File | Responsibility | PRD |
|---|---|---|
| `money.ts` | `AmountCents` branded type, arithmetic, formatting | GUARDRAILS §2 |
| `parser.ts` | Quick-text grammar | F1 |
| `safe-to-spend.ts` | Daily allowance, pace, projection, budget suggestion | F6 |
| `recurrence.ts` | Occurrence dates, month-end clamping | F5 |
| `cycle.ts` | Budget cycle boundaries, start day 1–31 clamped in short months | F17 |
| `time.ts` | `IsoDate`, user-timezone period boundaries | GUARDRAILS §9 |
| `categories.ts` | Keyword inference | F10 |
| `savings.ts` | Savings goal progress | F14 |
| `streaks.ts` | Logging streaks | F15 |
| `receipt-text.ts` | Guessing a total from OCR text | F4.6 |
| `csv-export.ts` | CSV rows | F8 |
| `clock.ts` | `Clock` interface. `systemClock` is used only at the edges |
| `errors.ts` | Typed `DomainError` classes |

## Rules

- **No I/O.** No database, network, filesystem or `process.env`. `core`
  depends on nothing in this repo.
- **No ambient time.** No `new Date()` or `Date.now()` in domain logic. Take a
  `Clock` or an explicit `IsoDate` from the caller.
- **Money is `AmountCents`.** Integers only. Never negative; direction carries
  the sign.
- **Rounding.** Division rounds **down** (safe-to-spend must never let daily
  allowances add up to more than the budget). The single documented exception
  is `savings.ts`, which rounds **up** so the target isn't undershot. Don't
  add another exception without an ADR.
- **Dates.** Every "day", "month" or "year" is a calendar date in the user's
  timezone (`IsoDate`), never UTC and never server-local time.
- **Pure and total.** Same input, same output. Invalid input throws a typed
  `DomainError`, never a bare `Error`.

## Tests (non-negotiable)

- Every change here ships with tests in the matching `*.test.ts`.
- CI enforces coverage on `packages/core`: 90% lines, functions and
  statements; 85% branches (`vitest.config.ts`).
- **Money and safe-to-spend fixtures** must include: 0 budget, budget
  exceeded, last day of the month, February, leap February, and a mid-month
  budget change. The property "Σ daily allowance ≤ budget" must keep holding.
- **Recurrence** must cover 28-, 29-, 30- and 31-day months, and anchors on
  days 29–31.
- **Parser:** new behaviour adds a golden fixture.
- **Cycles:** fixtures for start day 1 (must equal the calendar month), days 29–31 clamping, leap February and year end.
- **Time:** cover late-night entries (a 00:30 spend belongs to that calendar
  day in the user's timezone).

## Gotchas

| Gotcha | Handling |
|---|---|
| Month-end recurrence (29–31) | Clamp to the last day of shorter months; explicitly tested |
| Float money errors | Integer cents everywhere; `AmountCents` branded type prevents mix-ups |
