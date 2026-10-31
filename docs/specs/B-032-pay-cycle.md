# B-032 — Pay cycle: the budget month starts on a chosen day

**Feature:** F17 (new: pay cycle) · **Branch:** `feat/B-032-pay-cycle` · **Status:** awaiting owner approval
<!-- After each approval, Claude adds a line:
     Requirements approved by owner, YYYY-MM-DD
     Build plan approved by owner, YYYY-MM-DD -->

Process: [`WORKFLOW.md`](../../WORKFLOW.md). Copy this file to
`docs/specs/B-###-<slug>.md`. **This one file is the handoff between agents:**
each writes only its own section.

| Section | Written by | Stage |
|---|---|---|
| Grilling recap | main session, confirmed by the owner | before 1 |
| Requirements, Build plan | `spec-planner` (Opus) | 1–2 |
| Second opinion | `challenger` (Opus), risky items only | 1–2 |
| Test report | `test-writer` (Sonnet) creates it; `builder` (Sonnet) fills in the results | 3–4 |
| Build notes | `builder` (Sonnet) | 4 |
| Review | `reviewer` (Opus) | 5 |

Keep it lean: summaries and tables, never raw logs.

---

## Grilling recap (confirmed by owner, 2026-10-31)

- **What we're building:** each **space** gets a *cycle start day* (1–31).
  The budget "month" runs from that day to the day before it in the next month.
  The owner is paid on the **20th**, so their cycle is **20 Oct – 19 Nov**.
  The default is the **1st**, so nothing changes for anyone who doesn't set it.
  A day that doesn't exist in a short month uses the month's last day (31 → 28/29 Feb),
  the same clamping rule recurring rules already use.
- **Decisions made:**
  1. **Scope: everything month-based follows the cycle.** Safe-to-spend, the Today
     "This month" card, the Stats month view, the 80/100% budget alerts (once per
     cycle), the monthly digest (on the last day of the cycle), `/recap`, export,
     and daily-budget mode (amount ÷ days in the cycle). *Why: one consistent
     "month" everywhere, no mismatch.*
  2. **Start rule: a fixed day, clamped in short months.** *Why: simple and predictable.*
     "Last working day" and public holidays are out of scope.
  3. **Per space, like the budget.** Any member can change it, and everyone in the
     space sees the same number. *Why: consistent with how budgets already work (F12.5).*
  4. **Changing it takes effect immediately.** The current cycle is whichever
     cycle today falls in under the new rule. No special "bridge" period.
     *Owner's example:* today is 31 Oct; set the day to 20 → current cycle
     20 Oct – 19 Nov; "this cycle" counts spending from 20 Oct, and 1–19 Oct
     falls in the previous cycle (20 Sep – 19 Oct).
  5. **History is re-grouped by the current rule.** Past periods in Stats, History and
     export use the current start day. Nothing stored changes or is lost.
     *Why: like-for-like comparisons; simplest.*
  6. **Set from both** the Mini App budget card (next to the budget amount) **and** the
     bot's `/settings`.
  7. **Labels:** cycles are shown as a date range, e.g. **"20 Oct – 19 Nov"**. When the
     start day is 1, the plain month name ("October") stays.
  8. **Export: "say what you mean", designed for every user, not just the owner:**
     - `/export` → **this cycle**
     - `/export last cycle` → the previous cycle
     - `/export 2026-10` → **calendar** 1–31 Oct, always (a date reads as a calendar
       month to everyone, and matches bank statements and tax); `/export 2026` → calendar year
     - Mini App export picker: **This cycle · Last cycle · Pick a month · Custom dates**
     - The CSV file name always spells out the exact range, e.g.
       `spendlygo_2026-10-20_to_2026-11-19.csv`
  9. **Priority: next, ahead of B-001–B-003.** B-003 `/month` is built afterwards, on top
     of the cycle.
- **Out of scope / parked:** "last working day" paydays and public holidays;
  per-person cycles; and B-033 (reserve upcoming bills), B-034 (custom alert
  thresholds), B-035 (per-category limits) and B-036 (weekend/weekday allowance),
  each to be grilled separately later.
- **Open risks:**
  - It changes **safe-to-spend** and **date boundaries**, two of the dangerous five.
    `challenger` second opinion is required.
  - `budget_alerts` is keyed by `(user_id, year, month)`, so it probably needs a key per
    cycle, meaning a migration that must be backward-compatible with the running server.
  - The relationship to the unused `budget_periods` table (B-005) needs a decision or a
    deliberate non-decision.
  - There may be a lot to build. The plan should split it into PRs (e.g. core cycle maths +
    safe-to-spend first, then stats/digest/alerts, then export/UI).

---

## Requirements — *what* (Stage 1)

### Problem

PRD F6 defines safe-to-spend over the **calendar month** (`daysInMonth − dayOfMonth + 1`),
and F7, F8.4, F9.5, F13.3 and F16.1 inherit that month. Someone paid on the 20th
(the owner) gets a budget that "resets" on the 1st, eleven days after the money
arrives and eleven days before it runs out. The daily number is then wrong in
exactly the stretch where it matters. This item adds **F17 — Pay cycle**: each
space has a cycle start day (1–31, clamped in short months), and every
month-based figure follows that cycle (recap decisions 1–9). Default 1 means no
change for anyone who doesn't set it.

### Terms used below

- **Start day:** the space's `cycle_start_day`, 1–31. Default 1.
- **Cycle:** start = the start day in calendar month M, clamped to M's last day.
  End = the day before the next cycle's start. Example: day 20 → 20 Oct – 19 Nov.
  Day 31 → 31 Jan – 27 Feb, then 28 Feb – 30 Mar (2026).
- **Current cycle:** the cycle containing *today in the user's timezone*.
- **Range label:** `"20 Oct – 19 Nov"` (en dash, spaces, three-letter month, no
  year). Decision 7: used when start day ≠ 1. With start day 1, every surface
  keeps the wording it has today ("This month", "October", "October 2026",
  "2026-10").

### User stories

- As someone paid on the 20th, I want my budget month to run 20th to 19th, so
  safe-to-spend starts fresh when my salary lands.
- As a member of a shared space, I want the cycle to be part of the space like
  the budget, so my partner and I see the same number (F12.5).
- As someone who changes the start day mid-cycle, I want it to take effect at
  once, so I don't wait a month for the number to be right (decision 4).
- As anyone exporting, I want `/export` to give me this cycle, a typed month
  to give me that calendar month, and the file name to spell out the dates
  (decision 8).
- As a user who never sets a start day, I want nothing to change.

### Acceptance criteria

The ACs are grouped by PR part (see *PR split*). Each has one test, named in
the Plan › Tests table. The fixed scenario **"Owner's October"** is used
throughout: timezone `Asia/Singapore`, clock `2026-10-31T04:00:00Z` (noon on
Sat 31 Oct), active space budget S$1,500 (150 000 cents), and two expenses in
that space: S$100 on 2026-10-05 and S$50 on 2026-10-25.

#### Part 1 — cycle maths, data model, safe-to-spend, Today

| # | Given | When | Then |
|---|---|---|---|
| P1-AC1 | Start day 1 | `cycleContaining(d, 1)` for every date d from 2024-01-01 to 2028-12-31 | The result equals `monthRange(year, month)` of d, with `days` = days in that month (**regression guard**) |
| P1-AC2 | Start day 20 | cycleContaining for 2026-10-31, 2026-10-20 (first day), 2026-11-19 (last day), 2026-10-19 | 20 Oct – 19 Nov (31 days) for the first three; 20 Sep – 19 Oct (30 days) for 19 Oct |
| P1-AC3 | Start days 29, 30, 31 in non-leap Feb 2026 | cycleContaining for 2026-02-27 and 2026-02-28 | Day 29: 29 Jan – 27 Feb (30) and 28 Feb – 28 Mar (29). Day 30: 30 Jan – 27 Feb (29) and 28 Feb – 29 Mar (30). Day 31: 31 Jan – 27 Feb (28) and 28 Feb – 30 Mar (31) |
| P1-AC4 | Start days 29, 30, 31 in leap Feb 2028 | cycleContaining for 2028-02-28 and 2028-02-29 | Day 29: 29 Jan – 28 Feb (31) and 29 Feb – 28 Mar (29). Day 30: 30 Jan – 28 Feb (30) and 29 Feb – 29 Mar (30). Day 31: 31 Jan – 28 Feb (29) and 29 Feb – 30 Mar (31). Day 20 on 2028-02-20: 20 Feb – 19 Mar (29) |
| P1-AC5 | Start day 31 | cycleContaining for 2026-04-30, 2026-06-30, 2026-09-30, 2026-11-30 | Each cycle starts on the 30th (the clamped last day) and ends on the 30th of the next month: 30 Apr – 30 May, 30 Jun – 30 Jul, 30 Sep – 30 Oct, 30 Nov – 30 Dec. And 2026-04-29 is in 31 Mar – 29 Apr |
| P1-AC6 | Start day 20 | cycleContaining for 2026-12-25 and 2027-01-05 | Both are in 20 Dec 2026 – 19 Jan 2027 (31 days) |
| P1-AC7 | Any start day 1–31 | Walking from the cycle containing 2024-01-01 with `nextCycle` until past 2028-12-31 | Each cycle's start is the day after the previous end (no gaps, no overlaps), `days` = end − start + 1, and `previousCycle(nextCycle(c))` equals c |
| P1-AC8 | A start day of 0, 32, 1.5 or NaN | cycleContaining is called | It throws `ValidationError` |
| P1-AC9 | Cycles 20 Oct – 19 Nov 2026 and 20 Dec 2026 – 19 Jan 2027 | `formatCycleRange` | `"20 Oct – 19 Nov"` and `"20 Dec – 19 Jan"` |
| P1-AC10 | The instant 2026-10-19T16:30:00Z (00:30 on 20 Oct in Singapore), start day 20 | `cycleContaining(isoDateOf(instant, 'Asia/Singapore'), 20)` | 20 Oct – 19 Nov, not 20 Sep – 19 Oct |
| P1-AC11 | Budget S$1,500, cycle 20 Oct – 19 Nov 2026, nothing spent | `calculateSafeToSpend` with today = 2026-10-20 (first day) | `daysRemaining` 31, `daysInMonth` 31, `dayOfMonth` 1, `safeTodayCents` 4838 |
| P1-AC12 | Same cycle, S$1,400 spent | today = 2026-11-19 (last day) | `daysRemaining` 1, `safeTodayCents` 10000 (the whole remainder) |
| P1-AC13 | Any input that already passes today | `calculateSafeToSpend` called with `cycle` = the calendar month of today vs with no `cycle` | Identical results, field for field, for every day of Feb 2026, Feb 2024, Apr 2026 and Aug 2026 (**regression guard**) |
| P1-AC14 | Budgets {S$100, S$999.99, S$1,500, S$0.07, S$12,345.67}, start days {1, 15, 20, 28, 29, 30, 31}, cycles containing 2026-02-15, 2028-02-15, 2026-04-15, 2026-12-25 | Every day of the cycle, spend all of that day's allowance | Σ `safeTodayCents` ≤ budget (**GUARDRAILS §2 property**) |
| P1-AC15 | Cycle 20 Oct – 19 Nov, today 2026-11-01 | Budget 0 with nothing spent; or S$1,600 spent against S$1,500 | Budget 0 → `safeTodayCents` 0 and `budgetUsedRatio` 1; overspent → `safeTodayCents` 0, `overspentCents` 10000, `pace` `over_budget` (F6.3) |
| P1-AC16 | Cycle 20 Oct – 19 Nov | today = 2026-10-19 (outside it) | `calculateSafeToSpend` throws `ValidationError` |
| P1-AC17 | The migration is applied | A household is created without a start day; then an update sets 0 or 32 | It defaults to 1; 0 and 32 are rejected by the CHECK constraint |
| P1-AC18 | Owner's October, start day 20 | `GET /api/today` | `safeToSpend.spentMonthToDateCents` 5000, `dayOfMonth` 12, `daysInMonth` 31, `daysRemaining` 20, `safeTodayCents` 7250, `monthOut` 5000; `cycle` = {startDay 20, start 2026-10-20, end 2026-11-19, days 31, label "20 Oct – 19 Nov"} |
| P1-AC19 | Owner's October, start day 1 (default) | `GET /api/today` | `spentMonthToDateCents` 15000, `dayOfMonth` 31, `daysInMonth` 31, `daysRemaining` 1, `safeTodayCents` 135000, `monthOut` 15000; `cycle` = {startDay 1, start 2026-10-01, end 2026-10-31, days 31, label "October"} |
| P1-AC20 | Start day 20, clock 2026-10-19T16:30:00Z (00:30 on 20 Oct, Singapore), budget S$1,500, an expense of S$40 dated 2026-10-19 | The user logs S$12 via `POST /api/transactions` without a date, then `GET /api/today` | `today` 2026-10-20, `cycle.start` 2026-10-20, `spentMonthToDateCents` 1200, `daysRemaining` 31 |
| P1-AC21 | A shared space with start day 20; the partner's personal space at day 1 | Both members call `GET /api/today` while the shared space is active; then the partner switches to their personal space and calls it again | Both see `cycle.startDay` 20 and the same `safeTodayCents`; after switching, the partner sees `cycle.startDay` 1 |
| P1-AC22 | User A's space has start day 20; stranger B's space is untouched | B calls `GET /api/today` | B's `cycle.startDay` is 1 (cross-user isolation); an unauthenticated call is rejected with 401 |
| P1-AC23 | Owner's October | `GET /api/me` with start day 20 | `cycle` = {startDay 20, start 2026-10-20, end 2026-11-19, days 31, label "20 Oct – 19 Nov"} |
| P1-AC24 | Start day 20 and a budget, owner's October | The bot builds the `/today` reply | It says `20 Oct – 19 Nov: S$50.00 of S$1,500.00` where today it says `This month: …`; with start day 1 the reply is unchanged, byte for byte |
| P1-AC25 | Start day 20, over budget | The capture confirmation is built | It says `over budget this cycle`; with start day 1 it still says `over budget this month` |
| P1-AC26 | Start day 20 | The Mini App Today screen renders | The budget card heading reads `20 Oct – 19 Nov` and the income line reads `received this cycle`; with start day 1 it reads `This month` / `received this month` (screenshot check, light and dark, 375px) |

#### Part 2 — Stats, History, recap, digests, alerts

| # | Given | When | Then |
|---|---|---|---|
| P2-AC1 | Owner's October, start day 20 | `GET /api/stats?period=month` | `from` 2026-10-20, `to` 2026-11-19, `label` "20 Oct – 19 Nov", `outCents` 5000, `previousOutCents` 10000 (20 Sep – 19 Oct), `series` has 31 entries from key 2026-10-20 (label "20") to key 2026-11-19 (label "19") |
| P2-AC2 | Owner's October, start day 1 | `GET /api/stats?period=month` | Unchanged from today: 1–31 Oct, label "October 2026", `outCents` 15000, 31 series entries labelled "1"…"31" |
| P2-AC3 | Owner's October, start day 20 | `GET /api/stats?period=month&anchor=2026-10-05` | The past cycle 20 Sep – 19 Oct, `outCents` 10000 (history re-grouped by the current rule, decision 5) |
| P2-AC4 | Owner's October, start day 20 | `buildRecap(ctx, user, 'month', '2026-10-31', '2026-10-31')` | `from` 2026-10-20, `to` 2026-10-31 (never past today), `label` "20 Oct – 19 Nov", out 5000, `previousOutCents` 10000 |
| P2-AC5 | Start day 20 | `isMonthlyDigestDay(date, 20)` | True on 2026-11-19 and 2027-01-19; false on 2026-10-31 and 2026-11-30 |
| P2-AC6 | Start day 31 | `isMonthlyDigestDay(date, 31)` | True on 2026-02-27 and 2028-02-28; false on 2026-02-28 and 2028-02-29 |
| P2-AC7 | Start day 1 | `isMonthlyDigestDay(date)` (no start day) and `isMonthlyDigestDay(date, 1)` | Same as today: true only on the calendar month's last day (existing tests keep passing) |
| P2-AC8 | Start day 20, expenses S$100 on 2026-10-05 and S$50 on 2026-10-25, today 2026-11-19 | `buildMonthlyDigest` | Heading `*20 Oct – 19 Nov*`, total S$50.00, compared against 20 Sep – 19 Oct |
| P2-AC9 | Start day 20, digest at 21:00, budget set | `sendDueDigests` at 2026-10-31T13:00:00Z, then at 2026-11-19T13:00:00Z | 31 Oct: one message (daily only, no monthly). 19 Nov: two messages (daily and monthly) |
| P2-AC10 | Owner's October with budget S$1,000, start day 20, S$900 spent on 2026-10-05, S$500 on 2026-10-25 | `checkBudgetAlerts` | No alert (50% of this cycle; 1–19 Oct don't count) |
| P2-AC11 | As P2-AC10 plus S$350 on 2026-10-31 (85%) | `checkBudgetAlerts` runs twice (a double-fired tick) | Exactly one 80% message is sent |
| P2-AC12 | As P2-AC11, the 80% alert already sent | The clock moves to 2026-11-20 (the next cycle) and S$850 is spent on 2026-11-20 | A new 80% alert is sent for 20 Nov – 19 Dec |
| P2-AC13 | Start day 20, spend ≥ 100% of this cycle | The 100% alert text is built | It says `over for 20 Oct – 19 Nov`; with start day 1 it still says `over for 2026-10` |
| P2-AC14 | Start day 1, a `budget_alerts` row (user, 2026, 10, 80) written by the server running before this change | `checkBudgetAlerts` on 2026-10-31 at 85% | No new 80% alert (old rows still count: backward compatible) |
| P2-AC15 | *(Depends on Q2.)* Start day 1, 80% alert already sent for October; the owner switches to day 20 on 31 Oct; this cycle later reaches 85% | `checkBudgetAlerts` | The 80% alert for 20 Oct – 19 Nov is sent |
| P2-AC16 | *(Depends on Q3.)* Start day 20 | `GET /api/cycle?anchor=2026-10-05` | `{ cycle: { startDay 20, start 2026-09-20, end 2026-10-19, days 30, label "20 Sep – 19 Oct" } }`; unauthenticated → 401; an invalid anchor → 400 |
| P2-AC17 | *(Depends on Q3.)* Start day 20 | The Mini App History "Month" chip is used | It reads "Cycle", shows `20 Oct – 19 Nov`, and the arrows step one cycle back or forward, never past the current cycle; with start day 1 it is the existing month picker, unchanged (screenshot check) |
| P2-AC18 | Start day 20 | The Mini App Stats month tab and the recap card render | The Stats card heading shows `20 Oct – 19 Nov`, and the recap card's first tab reads "This cycle"; with start day 1 they read "October 2026" and "This month" (screenshot check) |

#### Part 3 — Export

| # | Given | When | Then |
|---|---|---|---|
| P3-AC1 | Owner's October, start day 20 | `/export` with no argument (bot) | A CSV of 20 Oct – 19 Nov (1 row: the S$50) named `spendlygo_2026-10-20_to_2026-11-19.csv`, caption `1 entry · 20 Oct – 19 Nov` |
| P3-AC2 | Owner's October, start day 20 | `/export last cycle` | A CSV of 20 Sep – 19 Oct (the S$100), named `spendlygo_2026-09-20_to_2026-10-19.csv` |
| P3-AC3 | Owner's October, start day 20 | `/export 2026-10` | A CSV of calendar 1–31 Oct (both rows), named `spendlygo_2026-10-01_to_2026-10-31.csv` |
| P3-AC4 | Any start day | `/export 2026` | Calendar year, named `spendlygo_2026-01-01_to_2026-12-31.csv` |
| P3-AC5 | Owner's October, start day 1 | `/export` with no argument | Calendar 1–31 Oct, named `spendlygo_2026-10-01_to_2026-10-31.csv` (deliberate change for every user, decision 8) |
| P3-AC6 | Start day 20 | `GET /api/export?range=this-cycle`, `range=last-cycle`, and no `range` | The same ranges and file names as P3-AC1/AC2; no `range` = this cycle |
| P3-AC7 | Any start day | `GET /api/export?range=2026-10-05..2026-10-24` | Rows dated 5–24 Oct inclusive, named `spendlygo_2026-10-05_to_2026-10-24.csv`. `2026-10-24..2026-10-05` (reversed) or `2026-10-05..garbage` → 400 |
| P3-AC8 | *(Depends on Q1.)* Any start day | All-time export (`/export all`, `range=all`) | Every row in the space, named `spendlygo_all-time.csv` |
| P3-AC9 | An unknown argument, e.g. `/export lastcycle2` | `/export` | The usage hint lists `/export`, `/export last cycle`, `/export 2026-10`, `/export 2026` (and `/export all` if Q1 = yes) |
| P3-AC10 | Start day 20, nothing logged in 20 Sep – 19 Oct | `/export last cycle` | `Nothing logged for 20 Sep – 19 Oct.` |
| P3-AC11 | Existing guarantees | `GET /api/export` unauthenticated, or by a stranger | 401; the stranger's CSV never contains the owner's rows (existing tests kept) |
| P3-AC12 | Start day 20 | `GET /api/me` | Also returns `previousCycle` = 20 Sep – 19 Oct (label "20 Sep – 19 Oct"), for the picker's captions |
| P3-AC13 | Start day 20 | Settings › Export CSV in the Mini App | A sheet offers This cycle (caption `20 Oct – 19 Nov`) · Last cycle (`20 Sep – 19 Oct`) · Pick a month (month input, defaults to this calendar month) · Custom dates (from/to, Download disabled until from ≤ to); Download saves the file with the server's name (screenshot check) |

#### Part 4 — Setting the start day

| # | Given | When | Then |
|---|---|---|---|
| P4-AC1 | Owner's October, start day 1 | `PATCH /api/settings {"cycleStartDay": 20}` | 200; response `user.cycleStartDay` 20; then `GET /api/today` matches P1-AC18 (owner's example, decision 4) |
| P4-AC2 | Any | `PATCH /api/settings` with `cycleStartDay` 0, 32, 1.5 or `"20"` | 400, and the stored day is unchanged |
| P4-AC3 | A shared space | The **partner** (not the creator) sets day 20 | Both members' `GET /api/me` show `cycle.startDay` 20 (decision 3) |
| P4-AC4 | A user active in a shared space | They set day 20, then switch to their personal space | The personal space's `cycle.startDay` is still 1 |
| P4-AC5 | User A, and stranger B in another space | B sends `PATCH /api/settings {"cycleStartDay": 20, "householdId": "<A's space id>"}`; and an unauthenticated PATCH | A's space stays at 1 (only B's active space changes); the unauthenticated call gets 401 |
| P4-AC6 | Start day 20 / start day 1 | `/settings` text is built | Day 20: `Budget cycle: starts on the 20th (20 Oct – 19 Nov)`. Day 1: `Budget cycle: calendar month (starts on the 1st)` |
| P4-AC7 | `/settings` | The "Change cycle start day" button (`set:cp`) is tapped | The keyboard shows days 1–31 in order, 7 per row, the current day marked `• `, and a `← Back` button (`set:back`); every callback_data ≤ 64 bytes |
| P4-AC8 | `/settings` day picker | `set:c:20` is tapped, then the same button again (redelivery) | The active space's start day is 20, the callback is answered both times, and the second tap changes nothing |
| P4-AC9 | Malformed data `set:c:0`, `set:c:32`, `set:c:x` | parseSettingsCallback | Returns null, so the handler answers with the "out of date" text and writes nothing |
| P4-AC10 | Mini App Settings › Budget, start day 20 | The card renders | A "Budget month starts on" select (1st … 31st) sits under the amount, with the caption `This cycle: 20 Oct – 19 Nov`; for 29–31 a hint says short months start on their last day; in a shared space, a hint says it changes for everyone in the space (screenshot check) |
| P4-AC11 | Start day 20, Daily mode, S$50/day typed | The daily → monthly preview renders | `= S$1,550/month (31 days this cycle)`, using `me.cycle.days`; with start day 1 it still says `days this month` (screenshot check) |
| P4-AC12 | Mini App | The user picks day 20 in the select | `PATCH /api/settings {cycleStartDay: 20}` is sent once; Today, Stats, History, Me and Recap refetch; the haptic and "Saved" toast fire as for the digest hour (screenshot + manual dev-bot check) |

### Edge cases

| Area | Case | Expected |
|---|---|---|
| Money | Budget 0 | `safeTodayCents` 0 every day of the cycle (P1-AC15) |
| Money | Over budget mid-cycle | Allowance 0, overage shown, never negative (P1-AC15) |
| Money | Last day of a cycle | Gets the whole remainder (P1-AC12) |
| Money | Σ allowance over a cycle | ≤ budget for every start day, including 28–31-day cycles (P1-AC14) |
| Money | Mid-cycle budget change | Unchanged rule: the new budget applies to the whole current cycle (same as a mid-month change today; `budget_periods` stays unused, Q6) |
| Dates | Feb, leap Feb, 30-day months, day 29–31 clamping | P1-AC3, P1-AC4, P1-AC5 |
| Dates | Cycle across the new year | P1-AC6; label `20 Dec – 19 Jan` (P1-AC9) |
| Dates | Cycle length varies from 28 to 31 days | `daysInMonth` in the API means *days in this cycle*; pace and projection use it |
| Time | 00:30 on the start day, user's timezone | Belongs to the new cycle (P1-AC10, P1-AC20) |
| Time | Start day changed mid-cycle | Applies at once; 1–19 Oct falls into the previous cycle (P4-AC1, P2-AC3) |
| Time | Start day changed on a cycle's last day after the digest hour | That day's monthly digest has already gone (or not); the next one follows the new rule. No catch-up message |
| Spaces | Personal vs shared | Per space; switching spaces switches cycles (P1-AC21, P4-AC4) |
| Spaces | Alerts and digests in a shared space | Each member's alerts and digests use their *active* space's start day, exactly as they use its budget today |
| Telegram | Redelivered `set:c:20` callback | Absolute value, so idempotent (P4-AC8) |
| Telegram | Double-fired tick | One alert per threshold per cycle (P2-AC11) |
| Deploy | New Mini App talking to the old server for a few minutes | `cycle` missing in `/api/today` and `/api/me` → the Mini App treats it as start day 1 |
| Deploy | Old server running while the migration is applied | The new column has a default and the old server never reads it (see Data) |

### Out of scope

- "Last working day" paydays, public holidays, per-person cycles (recap).
- B-033, B-034, B-035, B-036 (recap).
- `budget_periods` / B-005: not read or written (Q6).
- The heatmap: stays a rolling 371 days (no month concept, `api/index.ts` `HEATMAP_DAYS`).
- Savings goals' "months left" (F14.4): stays calendar months.
- Recurring rules (F5): unchanged.
- Year views (Stats Year, `/recap year`): pending Q4. The plan assumes they stay calendar years.
- A custom date range in the bot's `/export` usage hint (the shared parser accepts it, but only the Mini App advertises it).
- `/month` (B-003): built later on top of this.
- Changing `B-007` digest idempotency.

---

## Owner decisions on open questions and second opinion (2026-10-31)

Answers from the owner, in the session. These supersede the planner's open
questions and the challenger's options where they differ.

| # | Decision |
|---|---|
| Q1 + F1 (export) | **`/export` with nothing typed keeps exporting EVERYTHING, as today.** This overrides recap decision 8's "`/export` = this cycle", which was made without knowing the current behaviour. Add `/export cycle` (this cycle) and `/export last cycle`. `/export 2026-10` = calendar month and `/export 2026` = calendar year, unchanged; `/export 2026-10-05` keeps working. Mini App picker: **Everything · This cycle · Last cycle · Pick a month (calendar) · Custom dates**. File names always state the exact range. The Settings footnote "export everything" stays true |
| Q2 + F2 (alerts) | **Option A**, keyed by the calendar month the cycle ends in, with no migration. Document the limitation honestly: after moving the start day *earlier* (or later, before the new day arrives), one threshold in that cycle may be skipped once. It never double-sends. Add an AC proving that |
| Q3 (History) | **Option A:** the chip becomes "Cycle" when the start day isn't 1. Per F5, reuse `/api/stats` rather than adding a new endpoint, if that works cleanly |
| Q4 (year views) | **Option A:** Stats Year and `/recap year` stay calendar years |
| Q5 (wording) | No year in on-screen ranges. Use "cycle" wording only when the start day isn't 1; day 1 keeps month wording. Export file names always include full dates |
| Q7 (digest) | The monthly digest fires on the cycle's last day, at the digest hour, titled with the range and compared with the previous cycle. Day 1 is unchanged |
| Q8 (UI tests) | **Option A:** screenshots for the Mini App ACs until B-016. A "sent once" behaviour must be proven by a server test, not a screenshot (F5) |
| F3 | Settings day-picker callbacks carry the space id. An old message can't change a different space's cycle |
| F4 + F5 (release) | Rollback note in the Build plan, so a reverted release can't strand a space on a non-1 day. During the Part 4 deploy the old server must not silently accept and drop `cycleStartDay` (make the settings schema `.strict()` in an earlier part, or an equivalent) |
| F5 (partner) | When a member changes a shared space's start day, the other members get one short message |
| F5 (tidy-ups) | Include the year in export ranges that span New Year; add the `/recap` footer (`commands/recap.ts:89`) to the Part 2 files; place the History chip per the target Mini App layout (`apps/miniapp/CLAUDE.md`), not in `App.tsx`; fix the day-1 "last cycle" caption against the copy rule |
| Q6 (`budget_periods`) | **Still open:** to be asked at final approval |

---

## Build plan — *how* (Stage 2)

### Core design (shared by every part)

**New file `packages/core/src/cycle.ts`** (exported from `packages/core/src/index.ts`):

```ts
export interface BudgetCycle extends DateRange {   // DateRange from time.ts: start, end (inclusive)
  startDay: number;  // 1–31, the space's setting
  days: number;      // end − start + 1
}
export const DEFAULT_CYCLE_START_DAY = 1;
export function assertCycleStartDay(day: number): void;           // ValidationError unless an integer in 1..31
export function cycleStartIn(year: number, month: number, startDay: number): IsoDate;
                                                                  // toIsoDate({year, month, day: clampDayOfMonth(year, month, startDay)})
export function cycleContaining(date: IsoDate, startDay: number): BudgetCycle;
export function previousCycle(cycle: BudgetCycle): BudgetCycle;   // cycleContaining(addDays(cycle.start, -1), cycle.startDay)
export function nextCycle(cycle: BudgetCycle): BudgetCycle;       // cycleContaining(addDays(cycle.end, 1), cycle.startDay)
export function isLastDayOfCycle(date: IsoDate, startDay: number): boolean;
export function formatCycleRange(range: DateRange): string;       // "20 Oct – 19 Nov": `${d} ${monthName(m).slice(0,3)}`, joined by " – " (U+2013); also used for custom export ranges
export function cycleAlertKey(cycle: BudgetCycle): { year: number; month: number }; // Part 2, see Q2
```

`cycleContaining` algorithm (pure, no `Date.now()`): parse `date`; `s = cycleStartIn(y, m, startDay)`;
if `date >= s` the start is `s`, otherwise it is `cycleStartIn` of the previous
calendar month. End = `addDays(cycleStartIn(month after the start's month), -1)`.
`days = daysBetween(start, end) + 1`. Call `assertCycleStartDay` first. Use only
the helpers already in `time.ts` (`parseIsoDate`, `toIsoDate`, `clampDayOfMonth`,
`addDays`, `addMonths`, `daysBetween`, `monthName`). This is the same clamping
rule `recurrence.ts` uses (PRD F5.2).

**`packages/core/src/safe-to-spend.ts`:** add an optional `cycle?: DateRange` to
`SafeToSpendInput`. When absent, use `monthRange(year, month)` of `today` (so every
existing test still runs the old path unchanged). Then:
`totalDays = daysBetween(cycle.start, cycle.end) + 1`, `dayIndex = daysBetween(cycle.start, today) + 1`,
`daysRemaining = totalDays − dayIndex + 1`. Throw `ValidationError` if `today` is
outside the cycle. Keep the result field names `dayOfMonth` (= dayIndex) and
`daysInMonth` (= totalDays) for wire compatibility, with doc comments saying
"day of the budget cycle" / "days in the budget cycle". **No new result fields**
(so P1-AC13 can compare results field for field). All rounding stays as it is
(`divideCentsFloor`, `scaleCentsFloor`).

**Server helper (`apps/server/src/api/service.ts`):**

```ts
export interface ActiveSpaceSettings { budgetCents: AmountCents | null; cycleStartDay: number }
export async function activeSpaceSettings(ctx: AppContext, user: User): Promise<ActiveSpaceSettings>;
   // one householdsRepo.findById; cycleStartDay = household?.cycleStartDay ?? DEFAULT_CYCLE_START_DAY
export async function currentCycle(ctx, user, date: IsoDate = todayFor(ctx, user)): Promise<BudgetCycle>;
   // cycleContaining(date, (await activeSpaceSettings(ctx, user)).cycleStartDay)
export function toApiCycle(cycle: BudgetCycle): ApiCycle;
   // label = cycle.startDay === 1 ? monthName(month of cycle.start) : formatCycleRange(cycle)
```

`effectiveBudgetCents` stays (it delegates to `activeSpaceSettings`) so its other callers don't change.
`computeSafeToSpend` now returns `SafeToSpendWithCycle = SafeToSpendResult & { cycle: BudgetCycle }`
(exported type), so callers (`/today`, `/today` bot, capture, alerts, digests) get the cycle
and its `startDay` without a second lookup. `serialiseSafeToSpend` in `api/index.ts` copies
named fields, so `cycle` never leaks into the `safeToSpend` wire object.

**Wire shape (`packages/shared/src/index.ts`):**

```ts
export const cycleSchema = z.object({
  startDay: z.number().int().min(1).max(31),
  start: isoDateSchema, end: isoDateSchema,
  days: z.number().int().positive(),
  /** "October" when startDay is 1, else "20 Oct – 19 Nov" (recap decision 7). */
  label: z.string(),
});
export type Cycle = z.infer<typeof cycleSchema>;
```

`cycle` is added as `.optional()` on `todayResponseSchema` and `meResponseSchema`,
with the comment *"optional only so a new Mini App survives the old server during a
deploy; the server always sends it"*. The Mini App reads it as
`data.cycle?.startDay ?? 1`.

**Copy rule (every surface):** start day 1 → wording exactly as today. Start day ≠ 1 →
a heading that says "This month" / a month name shows the range label; prose that
says "this month" says "this cycle".

### Files

#### Part 1

| File | Change |
|---|---|
| `packages/core/src/cycle.ts` | **New**, as above (except `cycleAlertKey`, which is Part 2) |
| `packages/core/src/cycle.test.ts` | **New**, tests P1-AC1 to AC10 |
| `packages/core/src/index.ts` | `export * from './cycle.js';` |
| `packages/core/src/safe-to-spend.ts` | Optional `cycle` input; out-of-cycle check; update the header comment's formula to "this cycle" |
| `packages/core/src/safe-to-spend.test.ts` | New `describe('pay cycles (F17)')` with P1-AC11 to AC16. **Existing tests are not edited** |
| `packages/db/src/schema.ts` | `households.cycleStartDay: smallint('cycle_start_day').notNull().default(1)` + `check('households_cycle_start_day_ck', sql\`${t.cycleStartDay} BETWEEN 1 AND 31\`)`. Doc comment: per space, like the budget (F12.5, F17) |
| `packages/db/migrations/0005_*.sql` + `meta/` | **Generated** by `pnpm db:generate`. Never hand-written |
| `packages/db/src/repositories/households.ts` | `updateCycleStartDay(db, householdId, day)`, copy of `updateBudget` (sets `updatedAt`, throws if no row) |
| `packages/db/src/repositories/households.test.ts` | `describe('cycle start day')`: P1-AC17 |
| `packages/shared/src/index.ts` | `cycleSchema`, `Cycle`; optional `cycle` on `todayResponseSchema` and `meResponseSchema`; doc comments on `monthIn`/`monthOut`/`dayOfMonth`/`daysInMonth` saying they now mean the cycle |
| `apps/server/src/api/service.ts` | `activeSpaceSettings`, `currentCycle`, `toApiCycle`, type `SafeToSpendWithCycle`. `computeSafeToSpend`: load settings once (replaces the `effectiveBudgetCents` call), `cycle = cycleContaining(today, cycleStartDay)`, `totalsForPeriod(spaceId, cycle.start, today)`, pass `cycle` to `calculateSafeToSpend`, return `{ ...result, cycle }`. `computePeriodStats` keeps calling `computeSafeToSpend(ctx, user, to)` (it now resolves `to`'s own cycle) |
| `apps/server/src/api/index.ts` | `GET /today`: drop `monthRange(...)`; await `computeSafeToSpend` first, then use `safeToSpend.cycle` for the totals over `cycle.start..cycle.end`; add `cycle: toApiCycle(safeToSpend.cycle)`. `GET /me`: add `cycle: toApiCycle(await currentCycle(ctx, user))`. Drop now-unused imports |
| `apps/server/src/api/pay-cycle.test.ts` | **New**, DB-backed (`describeIfDb`, `fixedClock`, `auth()` helper copied from `household.test.ts`): P1-AC18 to AC23 |
| `apps/server/src/bot/commands/money.ts` | Extract the `/today` text into an exported pure `buildTodayText(input)` (user, today, result, streak, cycle). Day ≠ 1: `This month:` → `${formatCycleRange(cycle)}:`, `Spent this month:` → `Spent this cycle:`. `handleBudget` reply: `left this month` → `left this cycle` when day ≠ 1 |
| `apps/server/src/bot/commands/money.test.ts` | **New**, pure (no DB): P1-AC24 |
| `apps/server/src/bot/capture.ts` | `buildConfirmation` takes an optional `cycleStartDay?: number` (default 1): `over budget this cycle` when ≠ 1. `capture.ts` and `photo-capture.ts` pass `safeToSpend.cycle.startDay` |
| `apps/server/src/bot/capture.test.ts` | Add P1-AC25 |
| `apps/miniapp/src/screens/Today.tsx` | Card heading: `startDay === 1 ? 'This month' : data.cycle.label`; `received this month` / `this cycle`; no-budget card's `this month` likewise. `startDay = data.cycle?.startDay ?? 1` |
| `PRD.md` | Add **F17 — Pay cycle** after F16 (the recap's rules, the clamping rule, per space, default 1). In F6, define `spentMTD`/`daysRemaining` over "the budget cycle (F17), a calendar month by default". §9: add `cycle_start_day` to `households` |
| `packages/core/CLAUDE.md` | Map row for `cycle.ts` (F17). Tests rule: cycle fixtures (day 1 regression, 29–31 clamping, leap Feb, year end) |
| `CLAUDE.md` (root) | Repo layout: add `cycle.ts # F17 budget cycle boundaries` |
| `docs/adr/0007-budget-cycle-per-space.md` | **New** ADR: cycle per space, fixed day clamped, default 1, history re-grouped by the current rule (no stored periods), `budget_periods` left alone |
| `BACKLOG.md` | B-032 status → `in progress (part 1 of 4)` |

#### Part 2

| File | Change |
|---|---|
| `packages/core/src/cycle.ts` | Add `cycleAlertKey(cycle)`: `{ year, month }` of **`cycle.end`** (Q2 option A — see Data). For start day 1 that equals the calendar month, so existing rows still match |
| `packages/core/src/cycle.test.ts` | `cycleAlertKey`: day 1 → (2026, 10) for October; day 20 → (2026, 11) for 20 Oct – 19 Nov; (2027, 1) for 20 Dec – 19 Jan; distinct keys for 36 consecutive cycles of every start day |
| `apps/server/src/api/index.ts` | `buildStats` gets `cycleStartDay` (the route calls `activeSpaceSettings`). `period === 'month'`: `cycle = cycleContaining(anchor, startDay)`, previous = `previousCycle(cycle)`, label = day 1 ? `${monthName(month)} ${year}` : `formatCycleRange(cycle)`. `buildSeries` for month: iterate `cycle.start..cycle.end` with `addDays`, `key` = ISO date, `label` = `String(parseIsoDate(key).day)`. Day and year periods are unchanged |
| `apps/server/src/api/recap.ts` | `rangeFor(period, anchor, cycleStartDay)`: month → the cycle and `previousCycle`, label as in Stats. `buildRecap` gets the start day from `activeSpaceSettings` |
| `apps/server/src/tasks/digest.ts` | `isMonthlyDigestDay(today, startDay = DEFAULT_CYCLE_START_DAY)` → `isLastDayOfCycle`. `buildMonthlyDigest`: `cycle = await currentCycle(ctx, user, today)`, `from: cycle.start`, previous = `previousCycle`, heading = day 1 ? `monthName(month)` : `formatCycleRange(cycle)` |
| `apps/server/src/tasks/send-digests.ts` | Before the monthly gate: `const { cycleStartDay } = await activeSpaceSettings(ctx, user)` inside the per-user try (wrap it in `sendOne`'s error isolation so one user's failure doesn't stop the loop) |
| `apps/server/src/tasks/alerts.ts` | `checkOne`: `cycle = await currentCycle(ctx, user, today)`; `{ year, month } = cycleAlertKey(cycle)`; pass these to `sentThisMonth`/`recordIfNew`. Reserve-then-send and release are unchanged. 100% text: day 1 → `today.slice(0, 7)` (unchanged); else `formatCycleRange(cycle)`. Update the header comment: "once per cycle" |
| `packages/db/src/repositories/alerts.ts` | Doc comments only: `year`/`month` are "the calendar month the budget cycle ends in (F17); for a calendar-month cycle, that month". No signature change |
| `packages/db/src/schema.ts` | Doc comment on `budgetAlerts` only (same wording). **No migration** |
| `apps/server/src/api/index.ts` *(Q3 = cycle)* | `GET /api/cycle?anchor=YYYY-MM-DD` → `{ cycle: toApiCycle(cycleContaining(anchor, startDay)) }`; anchor validated with `isoDateSchema` (400 on failure); defaults to today |
| `packages/shared/src/index.ts` *(Q3 = cycle)* | `cycleResponseSchema = z.object({ cycle: cycleSchema })` |
| `apps/miniapp/src/lib/api.ts` *(Q3 = cycle)* | `cycle: (anchor?: string) => request<CycleResponse>(...)` |
| `apps/miniapp/src/App.tsx` + `screens/History.tsx` *(Q3 = cycle)* | When `me.cycle.startDay !== 1`: the `month` chip is labelled "Cycle"; state holds an anchor date (empty = today); a `useQuery(['cycle', anchor])` gives `from`/`to`/`label`; arrows set the anchor to `addDays(start, -1)` / `addDays(end, 1)`; next is disabled when `end >= today`; `to` is clamped to today as now. Start day 1 keeps the existing month code path untouched |
| `apps/miniapp/src/screens/Stats.tsx` | No logic change (the label comes from the server). `highlightKey` already uses `today` for month |
| `apps/miniapp/src/components/RecapCard.tsx` | New prop `cycleStartDay`; the first tab reads `This cycle` when ≠ 1 |
| `apps/server/src/api/pay-cycle.test.ts` | P2-AC1 to AC3 (and AC16 if Q3 = cycle) |
| `apps/server/src/api/recap.test.ts` | P2-AC4 |
| `apps/server/src/tasks/digest-periods.test.ts` | P2-AC5 to AC7 (existing tests untouched, they cover AC7's no-argument form) |
| `apps/server/src/tasks/digest.test.ts` | P2-AC8, P2-AC9 (`sendDueDigests` with a `vi.fn` `sendMessage`, as in `alerts.test.ts`) |
| `apps/server/src/tasks/alerts.test.ts` | New `describe('pay cycle (F17)')` with its own `ctx`/clock and a distinct `TELEGRAM_ID`: P2-AC10 to AC15 |
| `PRD.md` | F7 Monthly view, F9.5 ("last day of the budget cycle"), F13.2–F13.3 ("once per cycle", the key), F16.1 |
| `apps/server/CLAUDE.md` | Gotcha row: "`budget_alerts.year/month` = the month the cycle ends in, not the calendar month of today" |
| `docs/adr/0007-…` | Add the alert-key section |

#### Part 3

| File | Change |
|---|---|
| `apps/server/src/api/export.ts` | `ExportRange` gets a required `filename`. `parseExportRange(argument, { today, cycleStartDay })`: normalise (`trim`, lower-case, inner whitespace → `-`). `''`/`this-cycle` → current cycle; `last-cycle` → `previousCycle`; `YYYY-MM` → `monthRange` (calendar, always); `YYYY` → `yearRange`; `YYYY-MM-DD` → that day; `YYYY-MM-DD..YYYY-MM-DD` → custom (null when either is invalid or from > to); `all` → all-time *(Q1)*. `label`: the argument as typed for `YYYY`, `YYYY-MM` and `YYYY-MM-DD` (as today); `formatCycleRange(range)` for this/last cycle and custom ranges. `filename` = `spendlygo_${from}_to_${to}.csv` for every bounded range. Delete `exportFilename`; callers use `range.filename` |
| `apps/server/src/api/export-range.test.ts` | **New**, pure, no DB: P3-AC1 to AC5 and AC7 at the parser level (ranges, labels, file names) |
| `apps/server/src/api/index.ts` | `GET /export`: `parseExportRange(c.req.query('range') ?? '', { today, cycleStartDay })`; error message lists the accepted forms; `Content-Disposition` uses `range.filename` |
| `apps/server/src/api/export.test.ts` | Update the two assertions that encode the old behaviour (`spendlygo-all-time.csv` for no range; the month file name) to decision 8, and add P3-AC6, AC7, AC11 cases. This is an owner-decided behaviour change, not a loosened test: note it in the PR body |
| `apps/server/src/bot/commands/export.ts` | Pass `{ today: todayFor(ctx, user), cycleStartDay }`; new usage text (P3-AC9); empty reply `Nothing logged for ${range.label}.` (P3-AC10); `InputFile(..., range.filename)`; caption `${n} entries · ${range.label}` |
| `apps/server/src/bot/commands/export.test.ts` | **New**: P3-AC9, P3-AC10 (copy `fakeBotCtx` from `settings.test.ts`) |
| `apps/server/src/api/index.ts` + `packages/shared/src/index.ts` | `GET /me`: add `previousCycle` (optional in the schema, same reason) — P3-AC12 |
| `apps/server/src/bot/commands/help.ts` | Export lines: `/export` this cycle, `/export last cycle`, `/export 2026-10` |
| `apps/miniapp/src/features/settings/ExportSheet.tsx` + `export-sheet.css` | **New** (target layout). Uses `components/Sheet.tsx`; four radio options; month `<input type="month">` (max = today's month); two `<input type="date">` like History's custom range; Download calls `onExport(range)`. Tokens only, ≤ 250 lines |
| `apps/miniapp/src/screens/Settings.tsx` | "Export CSV" opens the sheet; `onExportCsv(range: string)` |
| `apps/miniapp/src/App.tsx` | `exportCsv` mutation takes the range string; `api.exportCsv(range)` already accepts it |
| `PRD.md` | F8.1, F8.4 rewritten to decision 8; §8 `/export [range]` row |

#### Part 4

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | `updateSettingsSchema`: `cycleStartDay: z.number().int().min(1).max(31).optional()` |
| `packages/db/src/repositories/users.ts` | No change. `UpdateSettingsInput` stays user-only; the route destructures `cycleStartDay` out before calling `usersRepo.updateSettings`, exactly as it does `monthlyBudgetCents` |
| `apps/server/src/api/index.ts` | `PATCH /settings`: destructure `cycleStartDay` beside `monthlyBudgetCents`; if defined → `householdsRepo.updateCycleStartDay(ctx.db, activeHouseholdId(user), cycleStartDay)`. Response adds `cycleStartDay` |
| `apps/server/src/api/pay-cycle.test.ts` | P4-AC1 to AC5 (AC3 copies the `household.test.ts` "either member can change it" pattern) |
| `apps/server/src/bot/commands/settings.ts` | `SettingsAction` adds `{ kind: 'cycle'; day: number }` and view `'days'`. `parseSettingsCallback`: `set:cp` → days view; `/^set:c:(\d{1,2})$/` → cycle action, validated with `updateSettingsSchema.shape.cycleStartDay`. `buildSettingsText(user, config, cycle?)`: adds the line from P4-AC6 when `cycle` is given. `settingsKeyboard`: add `Change cycle start day` → `set:cp`. New `cycleDayPickerKeyboard(currentDay)` (copy `hourPickerKeyboard`, 7 per row). `handleSettings` and the callback compute `cycle` via `currentCycle`. The cycle action calls `householdsRepo.updateCycleStartDay(ctx.db, activeHouseholdId(botCtx.appUser), day)`, then edits the message; `answerCallbackQuery` on every path; log `settings.updated` with `fields: 'cycleStartDay'`. Update the header comment's callback list |
| `apps/server/src/bot/commands/settings.test.ts` | P4-AC6 to AC9 |
| `apps/server/src/bot/commands/help.ts` | One line: `/settings` also sets the day your budget month starts |
| `apps/miniapp/src/features/settings/CycleStartDayField.tsx` + `cycle-start-day.css` | **New**. A `<select>` 1–31 with ordinal labels (`1st (calendar month)`, `2nd`, …), caption `This cycle: {label}` (or `Calendar month` for day 1), hints for 29–31 and for shared spaces (`me.household !== null`). Calls `onChange(day)` with `haptics.select()` |
| `apps/miniapp/src/screens/Settings.tsx` | Render the field under the budget input. Replace `daysInMonth(today)` with `me.cycle?.days ?? daysInMonth(today)`; copy `days this cycle` when start day ≠ 1 |
| `apps/miniapp/src/App.tsx` | `onSetCycleStartDay={(day) => settings.mutate({ cycleStartDay: day })}`; `settings.onSuccess` also invalidates `['recap']` (and `['cycle']` if Q3 = cycle) |
| `PRD.md` | §8 `/settings` row: add the cycle start day |
| `BACKLOG.md` | B-032 → Done after release |

### Data

- **Migration (Part 1 only):** `ALTER TABLE "households" ADD COLUMN "cycle_start_day" smallint DEFAULT 1 NOT NULL;`
  plus `ADD CONSTRAINT "households_cycle_start_day_ck" CHECK (... BETWEEN 1 AND 31)`.
  Generated by `pnpm db:generate` from the `schema.ts` change, committed with its snapshot.
  - **Backward-compatible with the running server:** additive only. Postgres 11+
    adds a column with a constant default without rewriting the table. The old
    server selects named columns, so it never sees it. Its inserts (new users'
    personal spaces, `householdsRepo.create`) get the default, 1. The CHECK
    validates existing rows, which are all 1.
  - **Rollback:** reverting the code leaves a harmless column. No backfill, no
    bulk update, no drop.
- **`budget_alerts`: no migration (recommended, Q2 option A).** Key =
  `(user_id, year, month of the cycle's END date, threshold_pct)`. For a fixed
  start day, every cycle ends in a different calendar month, so the key is unique
  per cycle. For start day 1, the end month *is* the calendar month, so rows
  written by the old server are read identically (P2-AC14). If the owner picks
  Q2 option C instead, Part 2 gains an additive migration (a new table), and that
  needs a fresh Plan approval.
- **`budget_periods`:** not touched (Q6).
- Nothing stored changes on a start-day change. History is re-grouped at read
  time (decision 5).

### Tests

The DB-backed tests use `describeIfDb` on `TEST_DATABASE_URL` and a pinned
`fixedClock`, like `alerts.test.ts`. Every new or changed route has an
unauthenticated test and a cross-user test.

| AC | Test file › test name |
|---|---|
| P1-AC1 | `packages/core/src/cycle.test.ts` › `start day 1 is exactly the calendar month for every date 2024–2028` |
| P1-AC2 | `cycle.test.ts` › `day 20: 31 Oct, first day and last day are in 20 Oct – 19 Nov; 19 Oct is in the previous cycle` |
| P1-AC3 | `cycle.test.ts` › `days 29–31 clamp to 28 Feb in a common year` |
| P1-AC4 | `cycle.test.ts` › `days 29–31 and 20 in leap February 2028` |
| P1-AC5 | `cycle.test.ts` › `day 31 starts on the 30th in 30-day months` |
| P1-AC6 | `cycle.test.ts` › `a day-20 cycle spans the new year` |
| P1-AC7 | `cycle.test.ts` › `cycles tile with no gaps or overlaps for every start day 1–31` |
| P1-AC8 | `cycle.test.ts` › `rejects a start day outside 1–31 or not an integer` |
| P1-AC9 | `cycle.test.ts` › `formats a cycle as "20 Oct – 19 Nov"` |
| P1-AC10 | `cycle.test.ts` › `GUARDRAILS §9: 00:30 on the start day belongs to the new cycle` |
| P1-AC11 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › first day of a cycle splits the budget across the whole cycle` |
| P1-AC12 | `safe-to-spend.test.ts` › `pay cycles (F17) › last day of a cycle gets the whole remainder` |
| P1-AC13 | `safe-to-spend.test.ts` › `pay cycles (F17) › a calendar-month cycle gives exactly the old result` |
| P1-AC14 | `safe-to-spend.test.ts` › `pay cycles (F17) › Σ daily allowance ≤ budget over every cycle shape` |
| P1-AC15 | `safe-to-spend.test.ts` › `pay cycles (F17) › zero budget and overspend inside a cycle` |
| P1-AC16 | `safe-to-spend.test.ts` › `pay cycles (F17) › rejects a today outside the cycle` |
| P1-AC17 | `packages/db/src/repositories/households.test.ts` › `cycle start day › defaults to 1 and the CHECK rejects 0 and 32` |
| P1-AC18 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › owner's example: day 20 counts from 20 Oct` |
| P1-AC19 | `pay-cycle.test.ts` › `GET /api/today › day 1 is the calendar month, unchanged` |
| P1-AC20 | `pay-cycle.test.ts` › `GET /api/today › a 00:30 entry on the start day is in the new cycle` |
| P1-AC21 | `pay-cycle.test.ts` › `GET /api/today › a shared space's members share its cycle; switching spaces switches cycle` |
| P1-AC22 | `pay-cycle.test.ts` › `GET /api/today › rejects unauthenticated, and a stranger never gets another space's cycle` |
| P1-AC23 | `pay-cycle.test.ts` › `GET /api/me › returns the current cycle` |
| P1-AC24 | `apps/server/src/bot/commands/money.test.ts` › `/today names the cycle range for day 20 and is unchanged for day 1` |
| P1-AC25 | `apps/server/src/bot/capture.test.ts` › `says "this cycle" when over budget with a non-calendar cycle` |
| P1-AC26 | Screenshot check (no Mini App test harness until B-016, see Q8): Today, day 20 and day 1, light + dark, 375px |
| P2-AC1 | `pay-cycle.test.ts` › `GET /api/stats › month view is the day-20 cycle with 31 day buckets` |
| P2-AC2 | `pay-cycle.test.ts` › `GET /api/stats › day 1 month view is unchanged` |
| P2-AC3 | `pay-cycle.test.ts` › `GET /api/stats › a past anchor is re-grouped by the current start day` |
| P2-AC4 | `apps/server/src/api/recap.test.ts` › `buildRecap › a month recap follows the cycle and stops at today` |
| P2-AC5 | `apps/server/src/tasks/digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 20 fires on the 19th, including across the new year` |
| P2-AC6 | `digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 31 fires on 27 Feb (common) and 28 Feb (leap)` |
| P2-AC7 | `digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 1 matches the calendar month end` |
| P2-AC8 | `apps/server/src/tasks/digest.test.ts` › `buildMonthlyDigest › names the cycle range and totals only the cycle` |
| P2-AC9 | `digest.test.ts` › `sendDueDigests › sends the monthly digest on the cycle's last day, not the calendar month end` |
| P2-AC10 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › spend before the cycle start does not count` |
| P2-AC11 | `alerts.test.ts` › `pay cycle (F17) › a double-fired tick sends the 80% alert once per cycle` |
| P2-AC12 | `alerts.test.ts` › `pay cycle (F17) › thresholds re-arm in the next cycle` |
| P2-AC13 | `alerts.test.ts` › `pay cycle (F17) › the 100% text names the cycle range` |
| P2-AC14 | `alerts.test.ts` › `pay cycle (F17) › a day-1 row written before B-032 still suppresses the repeat` |
| P2-AC15 | `alerts.test.ts` › `pay cycle (F17) › switching 1 → 20 after an October alert still alerts in the new cycle` |
| P2-AC16 | `pay-cycle.test.ts` › `GET /api/cycle › returns the cycle for an anchor; rejects unauthenticated and a bad anchor` *(Q3)* |
| P2-AC17 | Screenshot check: History Cycle chip, day 20 and day 1 *(Q3)* |
| P2-AC18 | Screenshot check: Stats month tab and recap card, day 20 and day 1 |
| P3-AC1 | `apps/server/src/api/export-range.test.ts` › `no argument is this cycle, named with exact dates` |
| P3-AC2 | `export-range.test.ts` › `"last cycle" is the previous cycle` |
| P3-AC3 | `export-range.test.ts` › `YYYY-MM is always the calendar month, whatever the start day` |
| P3-AC4 | `export-range.test.ts` › `YYYY is the calendar year` |
| P3-AC5 | `export-range.test.ts` › `day 1: no argument is this calendar month` |
| P3-AC6 | `apps/server/src/api/export.test.ts` › `this-cycle, last-cycle and no range follow the cycle and name the file by dates` |
| P3-AC7 | `export.test.ts` › `a custom from..to range is inclusive; reversed or malformed is a 400` |
| P3-AC8 | `export.test.ts` › `"all" exports everything as spendlygo_all-time.csv` *(Q1)* |
| P3-AC9 | `apps/server/src/bot/commands/export.test.ts` › `an unknown argument shows the new usage` |
| P3-AC10 | `export.test.ts` (bot) › `an empty cycle says nothing was logged for its range` |
| P3-AC11 | `apps/server/src/api/export.test.ts` › existing `rejects an unauthenticated request` and `never includes another user's transactions` (kept, must stay green) |
| P3-AC12 | `pay-cycle.test.ts` › `GET /api/me › also returns the previous cycle` |
| P3-AC13 | Screenshot check: the export sheet, day 20 and day 1 |
| P4-AC1 | `pay-cycle.test.ts` › `PATCH /api/settings › owner's example: setting day 20 on 31 Oct moves Today to 20 Oct – 19 Nov` |
| P4-AC2 | `pay-cycle.test.ts` › `PATCH /api/settings › rejects 0, 32, 1.5 and "20" without changing anything` |
| P4-AC3 | `pay-cycle.test.ts` › `PATCH /api/settings › either member of a shared space can change it` |
| P4-AC4 | `pay-cycle.test.ts` › `PATCH /api/settings › changes only the active space` |
| P4-AC5 | `pay-cycle.test.ts` › `PATCH /api/settings › ignores a householdId in the body and rejects unauthenticated` |
| P4-AC6 | `apps/server/src/bot/commands/settings.test.ts` › `shows the cycle start day and range` |
| P4-AC7 | `settings.test.ts` › `day picker lists 1–31, 7 per row, marks the current day, and has Back` |
| P4-AC8 | `settings.test.ts` › `set:c:20 updates the active space and a replay is a no-op` (DB block) |
| P4-AC9 | `settings.test.ts` › `parseSettingsCallback rejects malformed cycle days` |
| P4-AC10 | Screenshot check: Settings budget card, day 20 / day 30 / day 1, personal and shared |
| P4-AC11 | Screenshot check: daily mode preview, day 20 and day 1 |
| P4-AC12 | Screenshot + dev-bot check: picking a day refreshes Today/Stats/History |

### Risks & guardrails

| Guardrail | Risk | Mitigation |
|---|---|---|
| §1 Cost | None. No new service, dependency or Render service | — |
| §2 Money | A cycle-length bug lets allowances exceed the budget | All division stays `divideCentsFloor`; P1-AC14 property over 7 start days × 4 cycle shapes × 5 budgets; P1-AC13 proves the day-1 path is identical |
| §3 Data | Migration on a live DB | Additive column with a default + CHECK; generated; no backfill, drop or rewrite. `budget_alerts` untouched (Q2 A) |
| §3 Idempotency | Double-fired tick, redelivered callback | Alerts keep reserve-then-send behind the unique index (P2-AC11); `set:c:<n>` is an absolute value (P4-AC8) |
| §4 Auth | The start day is written for the wrong space | The space comes only from `activeHouseholdId(user)`, never from the body (P4-AC5); repo function filters by household id; cross-user tests P1-AC22, P4-AC5 |
| §6 Privacy | Logging | Log only `userId` and `fields: 'cycleStartDay'`. Never amounts |
| §7 Runtime | More queries per request | `activeSpaceSettings` is one primary-key lookup, replacing the existing `effectiveBudgetCents` lookup in `computeSafeToSpend`. Aggregation stays in SQL |
| §8 Frontend | Bundle size | Two small components, no dependency; tokens only; transform/opacity only |
| §9 Time | Boundaries in UTC, or an off-by-one at the cycle edge | All cycle maths on `IsoDate` from `todayFor` (user timezone); P1-AC10, P1-AC20 at 00:30 SGT; first/last-day tests |
| §11 Scope | Scope creep (heatmap, goals, year views) | Listed as out of scope; year views wait for Q4 |
| §13 Testing | Mini App has no test harness (B-016) | UI ACs are screenshot checks, and all logic they display is computed and tested server-side (Q8) |
| Deploy order | The static site deploys before or after the server | `cycle`/`previousCycle` are optional in the schema, and the Mini App falls back to day 1. The server never depends on new Mini App fields |
| Behaviour change | `/export` with no argument changes for every user in Part 3 | Owner decision 8. Called out in the Part 3 PR body and in the `/help` text |

### PR split

Four PRs, all **F17**, in order, each cut from the latest `main` after the
previous one merges. Until Part 4 ships, no user can change the start day, so
Parts 1–2 are behaviour-identical for everyone (all spaces are at 1, proved by
P1-AC1, P1-AC13, P1-AC19, P2-AC2, P2-AC7, P2-AC14). Part 3 deliberately changes
`/export` for everyone (decision 8).

| Part | Branch | Contents | ACs | Migration |
|---|---|---|---|---|
| 1 of 4 | `feat/B-032-pay-cycle` | Core `cycle.ts`, safe-to-spend, `households.cycle_start_day`, `/api/today`, `/api/me` cycle, bot `/today`/`/budget`/capture copy, Mini App Today card, PRD F17, ADR 0007 | P1-AC1 to AC26 (26) | **Yes**: one additive column |
| 2 of 4 | `feat/B-032-pay-cycle-periods` | Stats month view, recap, monthly digest, budget alerts, (History cycle chip + `GET /api/cycle` if Q3 = cycle), recap card tab | P2-AC1 to AC18 (18; 15 if Q3 = calendar) | No (Q2 A) |
| 3 of 4 | `feat/B-032-pay-cycle-export` | Export parser, file names, bot `/export`, `/api/me` `previousCycle`, Mini App export sheet | P3-AC1 to AC13 (13; 12 if Q1 = no "all") | No |
| 4 of 4 | `feat/B-032-pay-cycle-settings` | `PATCH /api/settings` `cycleStartDay`, bot `/settings` day picker, Mini App start-day select and daily-mode days | P4-AC1 to AC12 (12) | No |

### Open questions for the owner

**Q1 — How do you export *everything* once `/export` means "this cycle"?**
*Scenario:* today `/export` sends your whole history. After Part 3 it sends only
20 Oct – 19 Nov. Next year you want everything for your accountant: there's no
way to ask for it except Custom dates from your first entry.
*Detail:* GUARDRAILS §6 says to "honour export". The recap's picker has four
options, none of them "everything".
- **A. Add `/export all` and a fifth Mini App option, "Everything"** (file
  `spendlygo_all-time.csv`). *Pro:* full export stays one tap; clear. *Con:* a
  fifth option in the picker.
- **B. `/export all` in the bot only; the Mini App keeps exactly four options.**
  *Pro:* the picker stays as decided. *Con:* the Mini App can't export everything
  without guessing a start date.
- **C. No all-time export; Custom dates covers it.** *Pro:* simplest. *Con:*
  awkward, and arguably weakens §6.
*Recommendation:* A. Two sub-points to confirm: (i) "Pick a month" in the Mini
App means the **calendar** month, like `/export 2026-10`; (ii) `/export 2026-10-05`
(a single day, accepted today) keeps working.

**Q2 — How is "once per cycle" remembered for budget alerts?**
*Scenario:* on 31 Oct you're at day 1 and already got the 80% warning for
October. You switch to day 20. Your new cycle (20 Oct – 19 Nov) is at 30%. On
10 Nov it reaches 80%. Should you get the warning? (We think yes.)
*Detail:* `budget_alerts` is unique on `(user_id, year, month, threshold_pct)`.
- **A. Key by the calendar month the cycle *ends* in (no migration).** Day 1 is
  unchanged (same rows). The scenario above alerts correctly (October vs
  November keys). *Con:* the rare reverse switch (20 → 1 on 31 Oct) means the
  1–30 Nov cycle shares November's key with the old 20 Oct – 19 Nov cycle, so a
  threshold already sent there won't repeat in November.
- **B. Key by the month the cycle *starts* in (no migration).** *Con:* fails
  the scenario above: both cycles start in October, so your first real cycle
  never gets its 80% warning.
- **C. A new table keyed by `(user_id, cycle_start, threshold_pct)` (additive
  migration).** Exact in every case. *Con:* on deploy the new table is empty, so
  everyone already past 80% this month is warned again once, unless we backfill
  it (a bulk data change: GUARDRAILS §3, needs your approval). The old table is
  left to drop later (also needs approval).
*Recommendation:* A.

**Q3 — Does History's "Month" chip become a cycle?**
*Scenario:* with day 20, you open History › Month and see 1–31 Oct, but Today
and Stats talk about 20 Oct – 19 Nov.
*Detail:* decision 5 says History is re-grouped by the current rule, but the
History month picker is a calendar picker today. The Mini App can't do cycle
maths itself (it may only import `@spendlygo/shared`), so a cycle chip needs a
small `GET /api/cycle?anchor=` endpoint.
- **A. Chip becomes "Cycle" when the start day isn't 1** (arrows step a whole
  cycle; day 1 unchanged). *Pro:* consistent with Today and Stats, as decided.
  *Con:* one more endpoint and about 3 more ACs.
- **B. Keep the calendar month picker** (like `/export 2026-10`). *Pro:* less to
  build; matches bank statements. *Con:* History disagrees with Stats.
*Recommendation:* A. The calendar heatmap stays a rolling year either way (it
has no months).

**Q4 — Do year views stay calendar years?**
*Scenario:* with day 20, Stats › Year shows Jan–Dec bars. Should the "October"
bar be 20 Oct – 19 Nov instead, and the year 20 Dec – 19 Dec?
- **A. Year views stay calendar years** (Stats Year, `/recap year`). *Pro:*
  matches `/export 2026` (decision 8) and tax years; no ambiguity about which
  months a "cycle year" contains. *Con:* the October bar won't equal the October
  cycle total.
- **B. Year = 12 cycles, bars per cycle.** *Pro:* every number matches the
  cycles. *Con:* odd labels (a "2026" starting on 20 Dec 2025); more to build
  and test.
*Recommendation:* A.

**Q5 — Labels and wording.**
*Scenario:* with day 20 you see `20 Dec – 19 Jan` with no year, and prose like
"over budget this cycle".
- (i) **Year in the range?** A: never (your example, "20 Oct – 19 Nov"). B: only
  when the two dates are in different years. *Recommendation:* A. The Mini App
  only shows current and adjacent cycles, so the year is obvious.
- (ii) **Prose:** use the word "cycle" ("this cycle", "Last cycle", "This cycle"
  tab) when the start day isn't 1, and keep "month" for day 1. *Recommendation:*
  yes. It matches your export wording.

**Q6 — `budget_periods` (B-005).** It's keyed by user and calendar month, and
no code uses it. *Recommendation:* leave it alone in B-032, and add a note to
B-005 that any future use must be keyed by space and cycle. *Alternative:* fold
B-005's decision into this item (more scope, plus a schema decision now).

**Q7 — Monthly digest on the cycle's last day (confirm).** With day 20 it fires
on the 19th at your digest hour, headed `20 Oct – 19 Nov`, compared with the
previous cycle. With day 1 it is unchanged. *Recommendation:* as described.

**Q8 — Mini App ACs proven by screenshots only.** No Mini App test harness
exists yet (B-016). *Options:* A. Accept screenshot checks for the 6 UI ACs
(all their numbers are tested server-side). B. Do B-016 first, then write
component tests. *Recommendation:* A. B-016 would delay the item you put first.

---

## Second opinion (risky items only, `challenger`)
<!-- Or "n/a: not a risky item". Each finding: scenario, detail, options with pros and cons, blocking? -->

*Reviewed 2026-10-31 against the code on `feat/B-032-pay-cycle`. I recomputed
every numeric AC (P1-AC2 to AC6, AC11, AC12, AC18 to AC20, P2-AC1, AC4 to AC6,
AC9 to AC12) by hand against the proposed algorithm, and all of them are
correct. The cycle algorithm can't produce an empty, overlapping or skipped
cycle for any start day 1–31: a cycle that starts in month M always ends in
M+1, the shortest is 28 days (day 31: 31 Jan – 27 Feb), and P1-AC7 tests the
tiling exhaustively. The claim that start day 1 behaves exactly as today
holds on every surface the plan touches (Today, bot `/today`, capture, Stats
month, recap, monthly digest, alerts key and text), **except export**, which
changes on purpose. The Part 1 migration really is additive and safe for the
running server: drizzle selects named columns, and `check()` is already used
in `schema.ts`. **One finding blocks approval of Part 3. Nothing blocks Part 1
or Part 2.***

**F1 — `/export` with no argument currently exports *everything*. Part 3
quietly takes that away. BLOCKING for Part 3 (not for Parts 1–2).**
- *Scenario:* in March you tap Settings › Export CSV for your accountant,
  like you always have. You get one month. The footnote under the button
  still says "export everything as a CSV, any time".
- *Detail:* today `parseExportRange('')` returns `{ label: 'all-time' }`
  (`api/export.ts`). The bot usage text says "`/export` — everything", and the
  Mini App calls `api.exportCsv()` with no range (`App.tsx:503`).
  `Settings.tsx:402` promises "export everything", and that file isn't in
  Part 3's file list. The recap (decision 8) never says the owner knew
  `/export` currently means all-time. Q1 notices the gap, but leaves option C
  open, and C would remove the only one-tap full export (GUARDRAILS §6 "honour
  export", PRD F8). One more catch: while the deploy is in progress, an
  old-build Mini App calling `/api/export` with no range gets just this cycle
  from the new server, not everything.
- *Options:*
  (a) Answer Q1 = A, add `Settings.tsx`'s footnote to the Part 3 files, and
  have the export sheet always send an explicit `range`. *Pro:* keeps decision
  8 and keeps full export. *Con:* a fifth picker option.
  (b) Keep `/export` (no argument) = everything, and add `/export cycle` and
  `/export last cycle`. *Pro:* no behaviour change for anyone, no Q1, no
  deploy-window surprise, and a smaller Part 3. *Con:* reverses part of
  decision 8, so the owner has to agree.
  (c) Q1 = C. *Con:* arguably a §6 conflict, so it needs the owner's explicit
  sign-off, not a default.

**F2 — Alert key "month the cycle ends in" (Q2 A) misses alerts more often
than "rare". Never a double-send. Not blocking.**
- *Scenario:* you're on day 20 and got the 80% warning for 20 Sep – 19 Oct.
  On 25 Oct you switch back to the 1st. October (key Oct) is already marked
  as warned, so you get no 80% warning for October even if you blow through
  it.
- *Detail:* when you switch from day s1 to day s2 on date d, the new cycle's
  key collides with an old key whenever the new cycle ends in a month the old
  rule already used. That happens on *every* switch to an earlier start day,
  and on any switch to a later day made before the new start day. Examples:
  20→1 any time 20 Oct – 19 Nov; 20→25 on 22 Oct gives 25 Sep – 24 Oct, key
  Oct. The failure is always a suppressed alert, never a duplicate. It's also
  bounded: on any date, the 31 possible start days map to at most 2 keys, so
  flipping the setting can't spam anyone. That's a real plus for A. A related
  issue already exists today: `budget_alerts` is keyed by user, not space, so
  a personal space on day 1 and a shared space on day 20 share keys when you
  switch between them.
- *Options:* (a) Keep A, but rewrite Q2's con honestly as "any switch to an
  earlier day can skip that cycle's alerts", and add an AC for 20→1 on
  25 Oct. *Pro:* no migration. (b) C, keyed by `(user_id, household_id,
  cycle_start)`. *Pro:* exact, and fixes the space collision too. *Con:*
  migration, plus the re-alert or backfill question.

**F3 — A stale `/settings` message can change the *shared* space's cycle.
Not blocking, cheap fix.**
- *Scenario:* you open `/settings` in your personal space, then `/switch` to
  the shared space. Later you tap "20" on the old picker message. Your
  partner's budget month moves to the 20th without warning.
- *Detail:* every existing `set:` callback is personal (it sets a user
  field), so a stale message was harmless. `set:c:<n>` writes to
  `activeHouseholdId(appUser)` *at tap time* (P4-AC8). Callback data has
  room: `set:c:20:` plus a UUID is 45 bytes, under the 64-byte limit.
- *Options:* (a) Put the household id in the callback, and answer "out of
  date" if it doesn't match the active space. *Pro:* closes the hole.
  *Con:* about 1 extra AC. (b) Accept the risk, and make the P4-AC6 text say
  "changes it for everyone in <space>". *Pro:* trivial. *Con:* only partly
  protects.

**F4 — Rolling back Part 4 doesn't roll back behaviour. Not blocking, but
the plan should say so.**
- *Scenario:* Part 4 ships, the owner sets day 20, then Part 4 is reverted
  ("revert first", WORKFLOW §6). Parts 1–3 still read `cycle_start_day = 20`,
  but no UI is left to set it back.
- *Options:* (a) Add a rollback note: revert, then a one-row `UPDATE`, which
  needs approval under GUARDRAILS §3. (b) Ship the bot setter (server-only)
  as the first commit of Part 4, so it's never the part that gets reverted.

**F5 — Smaller gaps to fix in the plan. Not blocking.**
- *Deploy window, Part 4:* `updateSettingsSchema` isn't `.strict()`. A new
  Mini App PATCHing `cycleStartDay` to the *old* server gets a 200 with the
  field silently dropped, and the user sees "Saved". Fix: the Mini App checks
  that the response contains `user.cycleStartDay`.
- *Shared space:* nobody is told when a partner changes the day. The other
  member's safe-to-spend can jump from about S$1,350 to S$72 overnight. This
  matches how budget edits behave today (no notification code exists), but
  it's more surprising here. Park it, or show a line in Today.
- *Labels:* `formatCycleRange` has no year. A custom export from 2025-01-05 to
  2026-03-10 gets the caption "5 Jan – 10 Mar". Also, a day-1 `/export last
  cycle` caption reads "1 Sep – 30 Sep", which breaks the plan's own copy rule
  (day 1 keeps month names). Use the month name for day 1, and add the year
  when the range crosses years.
- *Copy left out:* the bot's `commands/recap.ts:89` ("`/recap` for this month
  instead") isn't in the Part 2 files.
- *Layout:* the Part 2 History cycle chip is planned inside `App.tsx`, but
  `apps/miniapp/CLAUDE.md` says "all new code goes into the target layout".
- *Simpler Q3:* after Part 2, `GET /api/stats?period=month&anchor=` already
  returns `from`, `to` and `label` for a cycle. History could use that instead
  of a new `/api/cycle` endpoint (one route and one auth test fewer, slightly
  heavier query).
- *Testability:* P4-AC12's "PATCH sent once" can't be proven by a screenshot.
  Either downgrade the wording or check it in the dev-bot network log. Every
  other AC maps to a single deterministic test.
- *Digest overlap:* switching 20→25 on 20 Nov, after the 19 Nov digest, makes
  the 24 Nov digest re-cover 25 Oct – 19 Nov. This is accepted by "no
  catch-up", but the Edge cases table only mentions the skip, not the
  overlap.

---

## Test report (Stages 3–4)

| AC | Test file › test name | Before build | After build |
|---|---|---|---|
| AC1 | | ❌ failing (expected) | |

**Checks:** <!-- one line, e.g. typecheck ✓ · lint ✓ · test 312 passed / 154 skipped -->
**Screenshots:** <!-- UI changes: light + dark at 375px, attached to the PR — or "n/a" -->

---

## Build notes (Stage 4)

- **Deviations from plan:** <!-- "none", or what and why (a plan change needs owner re-approval) -->
- **Parked ideas:** <!-- added to BACKLOG → Later, or "none" -->

---

## Review (Stage 5)

**Verdict:** <!-- ready for owner · back to build · back to plan -->

| # | Severity | file:line | Finding | Failure scenario |
|---|---|---|---|---|
| | | | | |

**Guardrail self-check** (WORKFLOW §4)
- [ ] Cost · [ ] Money · [ ] Auth + cross-user test · [ ] Privacy · [ ] Time
