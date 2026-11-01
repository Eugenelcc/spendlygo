# B-032 — Pay cycle: the budget month starts on a chosen day

**Feature:** F17 (new: pay cycle) · **Branch:** `feat/B-032-pay-cycle` · **Status:** Parts 1–4 merged (PR #19) · Part 5: awaiting owner approval

Spec approved by owner, 2026-10-31
Plan approved by owner, 2026-10-31 (Parts 1–4; Part 5 to be planned and approved separately)
Part 5 decisions (Q1–Q7) approved by owner, 2026-11-01
<!-- Part 5 spec approved by owner, YYYY-MM-DD -->
<!-- Part 5 plan approved by owner, YYYY-MM-DD -->
<!-- Part 5 migration (0006–0009, rebuilds budget_periods) approved by owner, YYYY-MM-DD (backup taken: yes/no) -->
<!-- After each approval, Claude adds a line:
     Spec approved by owner, YYYY-MM-DD
     Plan approved by owner, YYYY-MM-DD -->

Process: [`WORKFLOW.md`](../../WORKFLOW.md). Copy this file to
`docs/specs/B-###-<slug>.md`. **This one file is the handoff between agents:**
each writes only its own section.

| Section | Written by | Stage |
|---|---|---|
| Grilling recap | main session, confirmed by the owner | before 1 |
| Spec, Plan | `spec-planner` (Opus) | 1–2 |
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

## Spec — *what* (Stage 1)

*Revised 2026-10-31 to the owner's decisions below ("Owner decisions on open
questions and second opinion"). Where the recap and those decisions differ,
the decisions win (export, alerts).*

### Problem

PRD F6 defines safe-to-spend over the **calendar month** (`daysInMonth − dayOfMonth + 1`),
and F7, F9.5, F13.3 and F16.1 inherit that month. Someone paid on the 20th
(the owner) gets a budget that "resets" on the 1st, eleven days after the money
arrives and eleven days before it runs out. The daily number is then wrong in
exactly the stretch where it matters. This item adds **F17 — Pay cycle**: each
space has a cycle start day (1–31, clamped in short months), and every
month-based figure follows that cycle (recap decisions 1–7, 9). Export keeps
its current default and gains cycle ranges (owner decision Q1 + F1). Default 1
means no change for anyone who doesn't set it.

### Terms used below

- **Start day:** the space's `cycle_start_day`, 1–31. Default 1.
- **Cycle:** start = the start day in calendar month M, clamped to M's last day.
  End = the day before the next cycle's start. Example: day 20 → 20 Oct – 19 Nov.
  Day 31 → 31 Jan – 27 Feb, then 28 Feb – 30 Mar (2026).
- **Current cycle:** the cycle containing *today in the user's timezone*.
- **Range label (on screen):** `"20 Oct – 19 Nov"` (en dash, spaces, three-letter
  month, **never a year**, Q5). Used only when start day ≠ 1. With start day 1,
  every surface keeps the wording it has today ("This month", "October",
  "October 2026", "2026-10").
- **Export label:** the same, except a range whose two dates fall in different
  years carries both years: `"20 Dec 2026 – 19 Jan 2027"` (F5 tidy-up). For
  start day 1, "this/last cycle" exports are labelled with the month name and
  year (`"October 2026"`), never `"1 Oct – 31 Oct"` (copy rule).
- **Copy rule (every surface):** start day 1 → wording exactly as today. Start
  day ≠ 1 → a heading that says "This month" or a month name shows the range
  label; prose that says "this month" says "this cycle".

### User stories

- As someone paid on the 20th, I want my budget month to run 20th to 19th, so
  safe-to-spend starts fresh when my salary lands.
- As a member of a shared space, I want the cycle to be part of the space like
  the budget, so my partner and I see the same number (F12.5), and I want to be
  told when my partner changes it.
- As someone who changes the start day mid-cycle, I want it to take effect at
  once, so I don't wait a month for the number to be right (decision 4).
- As anyone exporting, I want `/export` to keep giving me everything, plus a
  quick way to get this cycle or the last one, a typed month to mean that
  calendar month, and file names that spell out the dates.
- As a user who never sets a start day, I want nothing to change.

### Acceptance criteria

The ACs are grouped by PR part (see *PR split*). Each has one test, named in
the Plan › Tests table. The fixed scenario **"Owner's October"** is used
throughout: timezone `Asia/Singapore`, clock `2026-10-31T04:00:00Z` (noon on
Sat 31 Oct), active space budget S$1,500 (150 000 cents), and two expenses in
that space: S$100 on 2026-10-05 and S$50 on 2026-10-25.

#### Part 1 — cycle maths, data model, safe-to-spend, Today (28 ACs)

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
| P1-AC9 | Cycles 20 Oct – 19 Nov 2026 and 20 Dec 2026 – 19 Jan 2027 | `formatCycleRange` | `"20 Oct – 19 Nov"` and `"20 Dec – 19 Jan"` (no year on screen, Q5) |
| P1-AC10 | The instant 2026-10-19T16:30:00Z (00:30 on 20 Oct in Singapore), start day 20 | `cycleContaining(isoDateOf(instant, 'Asia/Singapore'), 20)` | 20 Oct – 19 Nov, not 20 Sep – 19 Oct |
| P1-AC11 | Budget S$1,500, cycle 20 Oct – 19 Nov 2026, nothing spent | `calculateSafeToSpend` with today = 2026-10-20 (first day) | `daysRemaining` 31, `daysInMonth` 31, `dayOfMonth` 1, `safeTodayCents` 4838 |
| P1-AC12 | Same cycle, S$1,400 spent | today = 2026-11-19 (last day) | `daysRemaining` 1, `safeTodayCents` 10000 (the whole remainder) |
| P1-AC13 | Any input that already passes today | `calculateSafeToSpend` called with `cycle` = the calendar month of today vs with no `cycle` | Identical results, field for field, for every day of Feb 2026, Feb 2024, Apr 2026 and Aug 2026 (**regression guard**) |
| P1-AC14 | Budgets {S$100, S$999.99, S$1,500, S$0.07, S$12,345.67}, start days {1, 15, 20, 28, 29, 30, 31}, cycles containing 2026-02-15, 2028-02-15, 2026-04-15, 2026-12-25 | Every day of the cycle, spend all of that day's allowance | Σ `safeTodayCents` ≤ budget (**GUARDRAILS §2 property**) |
| P1-AC15 | Cycle 20 Oct – 19 Nov, today 2026-11-01 | Budget 0 with nothing spent; or S$1,600 spent against S$1,500 | Budget 0 → `safeTodayCents` 0 and `budgetUsedRatio` 1; overspent → `safeTodayCents` 0, `overspentCents` 10000, `pace` `over_budget` (F6.3) |
| P1-AC16 | Cycle 20 Oct – 19 Nov | today = 2026-10-19 (outside it) | `calculateSafeToSpend` throws `ValidationError` |
| P1-AC17 | The migration is applied | A household is created without a start day; then a raw update sets 0 or 32 | It defaults to 1; 0 and 32 are rejected by the CHECK constraint |
| P1-AC18 | Owner's October, start day 20 | `GET /api/today` | `safeToSpend.spentMonthToDateCents` 5000, `dayOfMonth` 12, `daysInMonth` 31, `daysRemaining` 20, `safeTodayCents` 7250, `monthOut` 5000; `cycle` = {startDay 20, start 2026-10-20, end 2026-11-19, days 31, label "20 Oct – 19 Nov"} |
| P1-AC19 | Owner's October, start day 1 (default) | `GET /api/today` | `spentMonthToDateCents` 15000, `dayOfMonth` 31, `daysInMonth` 31, `daysRemaining` 1, `safeTodayCents` 135000, `monthOut` 15000; `cycle` = {startDay 1, start 2026-10-01, end 2026-10-31, days 31, label "October"} |
| P1-AC20 | Start day 20, clock 2026-10-19T16:30:00Z (00:30 on 20 Oct, Singapore), budget S$1,500, an expense of S$40 dated 2026-10-19 | The user logs S$12 via `POST /api/transactions` without a date, then `GET /api/today` | `today` 2026-10-20, `cycle.start` 2026-10-20, `spentMonthToDateCents` 1200, `daysRemaining` 31 |
| P1-AC21 | A shared space with start day 20; the partner's personal space at day 1 | Both members call `GET /api/today` while the shared space is active; then the partner switches to their personal space and calls it again | Both see `cycle.startDay` 20 and the same `safeTodayCents`; after switching, the partner sees `cycle.startDay` 1 |
| P1-AC22 | User A's space has start day 20; stranger B's space is untouched | B calls `GET /api/today` | B's `cycle.startDay` is 1 (cross-user isolation); an unauthenticated call is rejected with 401 |
| P1-AC23 | Owner's October | `GET /api/me` with start day 20 | `cycle` = {startDay 20, start 2026-10-20, end 2026-11-19, days 31, label "20 Oct – 19 Nov"} |
| P1-AC24 | Start day 20 and a budget, owner's October | The bot builds the `/today` reply | It says `20 Oct – 19 Nov: S$50.00 of S$1,500.00` where today it says `This month: …`; with start day 1 the reply is unchanged, byte for byte |
| P1-AC25 | Start day 20, over budget | The capture confirmation is built | It says `over budget this cycle`; with start day 1 it still says `over budget this month` |
| P1-AC26 | Start day 20 | The Mini App Today screen renders | The budget card heading reads `20 Oct – 19 Nov` and the income line reads `received this cycle`; with start day 1 it reads `This month` / `received this month` (screenshot check, light and dark, 375px) |
| P1-AC27 | Owner's October, budget S$1,500 | `PATCH /api/settings {"monthlyBudgetCents": 100000, "colour": "blue"}` (an unknown key) | 400, and the budget is still S$1,500. Every existing PATCH test (known keys only) still passes. *Why:* `updateSettingsSchema` becomes `.strict()`, so during the Part 4 deploy the old server rejects `cycleStartDay` instead of silently dropping it (owner decision F4 + F5) |
| P1-AC28 | A household at start day 1 | `householdsRepo.updateCycleStartDay(db, id, 20)`, then the same call again, then with an unknown id | First call returns `true` and stores 20; second returns `false` and doesn't touch `updated_at`; unknown id throws (as `updateBudget` does) |

#### Part 2 — Stats, History, recap, digests, alerts (23 ACs)

| # | Given | When | Then |
|---|---|---|---|
| P2-AC1 | Owner's October, start day 20 | `GET /api/stats?period=month` | `from` 2026-10-20, `to` 2026-11-19, `label` "20 Oct – 19 Nov", `outCents` 5000, `previousOutCents` 10000 (20 Sep – 19 Oct), `series` has 31 entries from key 2026-10-20 (label "20") to key 2026-11-19 (label "19") |
| P2-AC2 | Owner's October, start day 1 | `GET /api/stats?period=month` | Unchanged from today: 1–31 Oct, label "October 2026", `outCents` 15000, 31 series entries labelled "1"…"31" |
| P2-AC3 | Owner's October, start day 20 | `GET /api/stats?period=month&anchor=2026-10-05`, and `anchor=2026-11-20` | 20 Sep – 19 Oct with `outCents` 10000 (history re-grouped by the current rule, decision 5); 20 Nov – 19 Dec with `outCents` 0. (These are the anchors History's arrows send: the day before `from`, the day after `to`) |
| P2-AC4 | A has start day 20 and owner's October data; stranger B is at day 1 | B calls `GET /api/stats?period=month`; A calls it with `anchor=2026-02-30`; and an unauthenticated call | B gets 1–31 Oct of B's own space with none of A's spend; the bad anchor is 400; unauthenticated is 401 |
| P2-AC5 | Owner's October, start day 20 | `GET /api/stats?period=year` | Calendar year (Q4 A): `from` 2026-01-01, `to` 2026-12-31, `label` "2026", 12 monthly series entries, `outCents` 15000 |
| P2-AC6 | Owner's October, start day 20 | `buildRecap(ctx, user, 'month', '2026-10-31', '2026-10-31')` | `from` 2026-10-20, `to` 2026-10-31 (never past today), `label` "20 Oct – 19 Nov", out 5000, `previousOutCents` 10000 |
| P2-AC7 | Owner's October, start day 20 | `buildRecap(ctx, user, 'year', '2026-10-31', '2026-10-31')` | Calendar year (Q4 A): `from` 2026-01-01, `to` 2026-10-31, label "2026", out 15000 |
| P2-AC8 | Start day 20 / start day 1 | The bot `/recap` footer is built (`recapFooter(period, startDay)`) | Day 20: month → `` `/recap year` for the whole year `` (unchanged), year → `` `/recap` for this cycle instead ``. Day 1: both exactly as today (`` `/recap` for this month instead ``) |
| P2-AC9 | Start day 20 | `isMonthlyDigestDay(date, 20)` | True on 2026-11-19 and 2027-01-19; false on 2026-10-31 and 2026-11-30 |
| P2-AC10 | Start day 31 | `isMonthlyDigestDay(date, 31)` | True on 2026-02-27 and 2028-02-28; false on 2026-02-28 and 2028-02-29 |
| P2-AC11 | Start day 1 | `isMonthlyDigestDay(date)` (no start day) and `isMonthlyDigestDay(date, 1)` | Same as today: true only on the calendar month's last day (existing tests keep passing) |
| P2-AC12 | Start day 20, expenses S$100 on 2026-10-05 and S$50 on 2026-10-25, today 2026-11-19 | `buildMonthlyDigest` | Heading `*20 Oct – 19 Nov*`, total S$50.00, compared against 20 Sep – 19 Oct (Q7) |
| P2-AC13 | Start day 20, digest at 21:00, budget set | `sendDueDigests` at 2026-10-31T13:00:00Z, then at 2026-11-19T13:00:00Z | 31 Oct: one message (daily only, no monthly). 19 Nov: two messages (daily and monthly) |
| P2-AC14 | Owner's October with budget S$1,000, start day 20, S$900 spent on 2026-10-05, S$500 on 2026-10-25 | `checkBudgetAlerts` | No alert (50% of this cycle; 1–19 Oct don't count) |
| P2-AC15 | As P2-AC14 plus S$350 on 2026-10-31 (85%) | `checkBudgetAlerts` runs twice (a double-fired tick) | Exactly one 80% message is sent |
| P2-AC16 | As P2-AC15, the 80% alert already sent | The clock moves to 2026-11-20 (the next cycle) and S$850 is spent on 2026-11-20 | A new 80% alert is sent for 20 Nov – 19 Dec |
| P2-AC17 | Start day 20, spend ≥ 100% of this cycle | The 100% alert text is built | It says `over for 20 Oct – 19 Nov`; with start day 1 it still says `over for 2026-10` |
| P2-AC18 | Start day 1, a `budget_alerts` row (user, 2026, 10, 80) written by the server running before this change | `checkBudgetAlerts` on 2026-10-31 at 85% | No new 80% alert (old rows still count: backward compatible) |
| P2-AC19 | Start day 1, 80% alert already sent for October; the space switches to day 20 on 31 Oct; this cycle is at 85% | `checkBudgetAlerts` | The 80% alert for 20 Oct – 19 Nov is sent (key November ≠ October) |
| P2-AC20 | **Documented skip (Q2 A limitation).** Start day 20, budget S$1,000, S$850 spent on 2026-10-15; the 80% alert for 20 Sep – 19 Oct went out on 15 Oct | On 2026-10-25 the space switches to day 1 (cycle 1–31 Oct, 85% used) and `checkBudgetAlerts` runs | **No** 80% message: 1–31 Oct shares the key (2026, 10) with 20 Sep – 19 Oct. The test name says this is the accepted limitation |
| P2-AC21 | **Never double-sends.** Budget S$1,000, S$850 spent on 2026-10-31 (≥ 80%, < 100% of every possible cycle containing that day), clock 2026-10-31 | The start day is set to 20, then 1, then 2, 3 … 31, then 20 again, with `checkBudgetAlerts` after each change (33 runs) | Exactly **2** 80% messages in total (one for key November, sent at day 20; one for key October, sent at day 1), and no 100% message |
| P2-AC22 | Start day 20 | The Mini App History date chips are used | The "Month" chip reads "Cycle", shows `20 Oct – 19 Nov` (the `label` from `/api/stats`), lists 20–31 Oct, and its arrows step one cycle back or forward, never past the current cycle; with start day 1 it is the existing month picker, unchanged (screenshot check) |
| P2-AC23 | Start day 20 | The Mini App Stats month tab and the recap card render | The Stats card heading shows `20 Oct – 19 Nov`, and the recap card's first tab reads "This cycle"; with start day 1 they read "October 2026" and "This month" (screenshot check) |

**Alerts: the honest limitation (owner decision Q2 A).** "Once per cycle" is
remembered by the calendar month the cycle *ends* in. That needs no migration
and can **never send the same threshold twice** for one key (P2-AC15,
P2-AC21). But after the start day moves *earlier*, or *later before the new
day has arrived*, the new cycle can end in a month whose threshold was already
used by the old rule, so **that threshold is skipped once in that cycle**
(P2-AC20). A similar overlap already exists today: alerts are keyed by user,
not space, so switching between a day-1 personal space and a day-20 shared
space can share keys. The next cycle always alerts normally (P2-AC16). This
wording goes into PRD F13 and `apps/server/CLAUDE.md`.

#### Part 3 — Export (17 ACs)

| # | Given | When | Then |
|---|---|---|---|
| P3-AC1 | Owner's October, start day 20 (and start day 1) | `parseExportRange('', { today, cycleStartDay })` | Everything, exactly as today: no `from`/`to`, label `all-time`, filename `spendlygo-all-time.csv` (owner decision Q1 + F1) |
| P3-AC2 | Owner's October, start day 20 | `parseExportRange('cycle', …)` | 2026-10-20 to 2026-11-19, label `20 Oct – 19 Nov`, filename `spendlygo_2026-10-20_to_2026-11-19.csv` |
| P3-AC3 | Owner's October, start day 20 | `parseExportRange` of `last cycle`, `last-cycle` and `Last  Cycle` | All three: 2026-09-20 to 2026-10-19, label `20 Sep – 19 Oct`, filename `spendlygo_2026-09-20_to_2026-10-19.csv` |
| P3-AC4 | Owner's October, start day 1 | `parseExportRange` of `cycle` and `last cycle` | 1–31 Oct labelled `October 2026`, and 1–30 Sep labelled `September 2026` (copy rule: day 1 keeps month names), filenames `spendlygo_2026-10-01_to_2026-10-31.csv` and `spendlygo_2026-09-01_to_2026-09-30.csv` |
| P3-AC5 | Owner's October, start day 20 | `parseExportRange('2026-10', …)` | Calendar 1–31 Oct whatever the start day, label `2026-10` (as today), filename `spendlygo_2026-10-01_to_2026-10-31.csv` |
| P3-AC6 | Any start day | `parseExportRange` of `2026` and `2026-10-05` | Calendar year, label `2026`, filename `spendlygo_2026-01-01_to_2026-12-31.csv`; single day, label `2026-10-05`, filename `spendlygo_2026-10-05_to_2026-10-05.csv` |
| P3-AC7 | Any start day | `parseExportRange` of `2026-10-05..2026-10-24`, `2026-10-24..2026-10-05`, `2026-10-05..garbage`, `2026-02-30..2026-03-01` | First: 5–24 Oct inclusive, label `5 Oct – 24 Oct`, filename `spendlygo_2026-10-05_to_2026-10-24.csv`. The other three: null |
| P3-AC8 | Start day 20, today 2027-01-05 | `parseExportRange` of `cycle`, `last cycle`, and custom `2025-01-05..2026-03-10` | `20 Dec 2026 – 19 Jan 2027` (`spendlygo_2026-12-20_to_2027-01-19.csv`); `20 Nov – 19 Dec` (same year, no year); `5 Jan 2025 – 10 Mar 2026` (F5 tidy-up: year when spanning New Year) |
| P3-AC9 | Owner's October, start day 20 | `GET /api/export` with no `range` | Both rows (everything in the space), `Content-Disposition` filename `spendlygo-all-time.csv`: identical to today |
| P3-AC10 | Owner's October, start day 20 | `GET /api/export?range=cycle` and `range=last-cycle` | The S$50 row named `spendlygo_2026-10-20_to_2026-11-19.csv`; the S$100 row named `spendlygo_2026-09-20_to_2026-10-19.csv` |
| P3-AC11 | Any start day | `GET /api/export?range=2026-10-05..2026-10-24`, then `range=2026-10-24..2026-10-05` | Rows dated 5–24 Oct inclusive, named `spendlygo_2026-10-05_to_2026-10-24.csv`; the reversed range is 400 |
| P3-AC12 | Existing guarantees, plus a stranger B at day 1 | `GET /api/export` unauthenticated; B calls it with no range and with `range=cycle` | 401; B's CSVs never contain the owner's rows (the two existing tests stay, plus a `range=cycle` cross-user case) |
| P3-AC13 | An unknown argument, e.g. `/export lastcycle2` | The bot `/export` | The usage hint lists `` `/export` — everything ``, `` `/export cycle` ``, `` `/export last cycle` ``, `` `/export 2026` ``, `` `/export 2026-08` ``. With start day 20 the two cycle lines say `this cycle (20 Oct – 19 Nov)` / `last cycle (20 Sep – 19 Oct)`; with start day 1 they say `this month` / `last month` |
| P3-AC14 | Start day 20, nothing logged in 20 Sep – 19 Oct | `/export last cycle` | Reply `Nothing logged for 20 Sep – 19 Oct.`, no file |
| P3-AC15 | Owner's October, start day 20 | `/export cycle` | One document named `spendlygo_2026-10-20_to_2026-11-19.csv`, caption `1 entry · 20 Oct – 19 Nov`. (`/export` with no argument still sends everything with caption `… · all-time`, as today) |
| P3-AC16 | Start day 20 | `GET /api/me` | Also returns `previousCycle` = {startDay 20, start 2026-09-20, end 2026-10-19, days 30, label "20 Sep – 19 Oct"} for the picker's captions |
| P3-AC17 | Start day 20 / start day 1 | Settings › Export CSV in the Mini App | A sheet offers **Everything** (selected by default) · **This cycle** (caption `20 Oct – 19 Nov`) · **Last cycle** (`20 Sep – 19 Oct`) · **Pick a month** (calendar month input, defaults to this calendar month) · **Custom dates** (from/to, Download disabled until from ≤ to). With start day 1 the second and third read **This month** (`October`) and **Last month** (`September`). Download saves the file with the server's name; the footnote "export everything as a CSV, any time" is unchanged (screenshot check) |

**File names (owner decision Q1 + F1).** Every *bounded* export is named
`spendlygo_<from>_to_<to>.csv` with full ISO dates, so the year is always in
the file name. **Everything** keeps today's name, `spendlygo-all-time.csv`:
it has no range to state, and the owner's decision is that `/export` with
nothing typed stays exactly as today. *(Planner's reading; flagged in the
hand-off summary for the owner to confirm at approval.)* As a side effect,
`/export 2026-10` and `/export 2026` change file name only
(`spendlygo-2026-10.csv` → `spendlygo_2026-10-01_to_2026-10-31.csv`); their
rows and captions are unchanged.

#### Part 4 — Setting the start day (18 ACs)

| # | Given | When | Then |
|---|---|---|---|
| P4-AC1 | Owner's October, start day 1 | `PATCH /api/settings {"cycleStartDay": 20}` | 200; response `user.cycleStartDay` 20; then `GET /api/today` matches P1-AC18 (owner's example, decision 4) |
| P4-AC2 | Any | `PATCH /api/settings` with `cycleStartDay` 0, 32, 1.5 or `"20"` | 400, and the stored day is unchanged |
| P4-AC3 | A shared space | The **partner** (not the creator) sets day 20 | Both members' `GET /api/me` show `cycle.startDay` 20 (decision 3) |
| P4-AC4 | A user active in a shared space | They set day 20, then switch to their personal space | The personal space's `cycle.startDay` is still 1 |
| P4-AC5 | User A, and stranger B in another space | B sends `PATCH /api/settings {"cycleStartDay": 20, "householdId": "<A's space id>"}`; and an unauthenticated PATCH | B's call is 400 (unknown key, strict schema) and neither space changes; the unauthenticated call is 401 |
| P4-AC6 | Start day 20 / start day 1 | `/settings` text is built | Day 20: `Budget cycle: starts on the 20th (20 Oct – 19 Nov)`. Day 1: `Budget cycle: calendar month (starts on the 1st)` |
| P4-AC7 | `/settings` for a user whose active space id is a real UUID | The main keyboard and the day picker are built | The main keyboard has `Change cycle start day` → `set:cp:<spaceId>`. The picker shows days 1–31 in order, 7 per row, the current day marked `• `, each button `set:c:<day>:<spaceId>`, and `← Back` (`set:back`). Every callback_data is ≤ 64 bytes (UTF-8), the longest being `set:c:31:<uuid>` = 45 (owner decision F3) |
| P4-AC8 | `/settings` day picker, personal space | `set:c:20:<own space id>` is tapped, then the same button again (redelivery) | The space's start day is 20, the callback is answered both times, and the second tap writes nothing |
| P4-AC9 | Malformed data: `set:c:20` (old format, no id), `set:c:0:<uuid>`, `set:c:32:<uuid>`, `set:c:x:<uuid>`, `set:c:20:not-a-uuid`, `set:cp` | `parseSettingsCallback` | Returns null for every one, so the handler answers with the "out of date" text and writes nothing |
| P4-AC10 | A picker message built while the personal space P was active; the user has since switched to shared space S | `set:c:20:<P>` and `set:cp:<P>` are tapped | Both are answered `That button is out of date — send /settings again.`; neither P nor S changes; no message is sent to anyone (owner decision F3) |
| P4-AC11 | Shared space (creator + partner), start day 1, owner's October | The partner sends `PATCH /api/settings {"cycleStartDay": 20}`, then sends it again | The first sends **exactly one** message, to the creator's chat: `<partner first name> set this shared space's budget month to start on the 20th. This cycle: 20 Oct – 19 Nov.` The partner gets none. The second PATCH sends nothing (no change) (owner decision F5) |
| P4-AC12 | A user in their personal space | They set day 20 | No message is sent to anyone |
| P4-AC13 | Shared space, partner's `/settings` picker | `set:c:20:<shared id>` is delivered twice (redelivery) | The creator gets exactly one message |
| P4-AC14 | Shared space; sending to the creator fails with Telegram 403 (bot blocked) | The partner PATCHes day 20 | 200, the day is saved as 20, the failure is logged (`settings.cycle_notify_failed`, user id only), and nothing is retried |
| P4-AC15 | Shared space; the first send to the creator fails with Telegram 429 `retry_after: 1` | The partner PATCHes day 20 | The helper waits 1 s (injected sleep, called with 1000) and sends once more; exactly 2 `sendMessage` calls; 200. A `retry_after` above 3 s is not waited for: logged and dropped (GUARDRAILS §10) |
| P4-AC16 | Mini App Settings › Budget, start day 20 | The card renders | A "Budget month starts on" select (1st … 31st) sits under the amount, with the caption `This cycle: 20 Oct – 19 Nov`; for 29–31 a hint says short months start on their last day; in a shared space, a hint says it changes for everyone in the space and they'll get a message (screenshot check) |
| P4-AC17 | Start day 20, Daily mode, $50/day typed | The daily → monthly preview renders | `= $1,550/month (31 days this cycle)`, using `me.cycle.days`; with start day 1 it still says `days this month` (screenshot check) |
| P4-AC18 | Mini App | The user picks day 20; and separately, the server answers 400 (the old server during a deploy) | Success: the haptic and "Saved" toast fire as for the digest hour, and Today, Stats, History, Me and Recap refetch. 400: the select shows the previous day again, the error haptic fires, and there is no "Saved" toast (screenshot + dev-bot check). *That a repeated PATCH changes and sends nothing is proven server-side by P4-AC11, not by a screenshot (Q8)* |

### Edge cases

| Area | Case | Expected |
|---|---|---|
| Money | Budget 0 | `safeTodayCents` 0 every day of the cycle (P1-AC15) |
| Money | Over budget mid-cycle | Allowance 0, overage shown, never negative (P1-AC15) |
| Money | Last day of a cycle | Gets the whole remainder (P1-AC12) |
| Money | Σ allowance over a cycle | ≤ budget for every start day, including 28–31-day cycles (P1-AC14) |
| Money | Mid-cycle budget change | Unchanged rule: the new budget applies to the whole current cycle (same as a mid-month change today; `budget_periods` stays unused unless Q6 says otherwise) |
| Dates | Feb, leap Feb, 30-day months, day 29–31 clamping | P1-AC3, P1-AC4, P1-AC5 |
| Dates | Cycle across the new year | P1-AC6; on screen `20 Dec – 19 Jan` (P1-AC9); in export `20 Dec 2026 – 19 Jan 2027` (P3-AC8) |
| Dates | Cycle length varies from 28 to 31 days | `daysInMonth` in the API means *days in this cycle*; pace and projection use it |
| Dates | Year views | Stay calendar years (Q4 A; P2-AC5, P2-AC7) |
| Time | 00:30 on the start day, user's timezone | Belongs to the new cycle (P1-AC10, P1-AC20) |
| Time | Start day changed mid-cycle | Applies at once; 1–19 Oct falls into the previous cycle (P4-AC1, P2-AC3) |
| Time | Start day changed on a cycle's last day after the digest hour | That day's monthly digest has already gone (or not); the next one follows the new rule. No catch-up message |
| Time | Start day moved later after a digest (20 → 25 on 20 Nov, after the 19 Nov digest) | The 24 Nov digest covers 25 Oct – 24 Nov, so it re-covers 25 Oct – 19 Nov. Accepted: no catch-up, no de-duplication |
| Alerts | Start day moved earlier (or later before the new day) | One threshold may be skipped once in that cycle; never sent twice (P2-AC20, P2-AC21) |
| Spaces | Personal vs shared | Per space; switching spaces switches cycles (P1-AC21, P4-AC4) |
| Spaces | Alerts and digests in a shared space | Each member's alerts and digests use their *active* space's start day, exactly as they use its budget today |
| Spaces | Partner changes the start day | Other members get one message each; none when nothing changed or the space is personal (P4-AC11 to AC13) |
| Telegram | Redelivered `set:c:20:<id>` callback | Absolute value, so idempotent, and the partner is messaged once (P4-AC8, P4-AC13) |
| Telegram | Stale `/settings` message after `/switch` | Answered "out of date"; nothing written (P4-AC10) |
| Telegram | Double-fired tick | One alert per threshold per key (P2-AC15) |
| Telegram | Partner message fails (blocked, 429, 5xx) | Never fails the change; 429 retried once if `retry_after` ≤ 3 s (P4-AC14, P4-AC15) |
| Deploy | New Mini App talking to the old server for a few minutes | `cycle` missing in `/api/today` and `/api/me` → the Mini App treats it as start day 1. Part 3: a cycle export to the old server is a 400 ("Export is not available"), and Everything still works. Part 4: `cycleStartDay` is a 400 from the old (strict) server, so no false "Saved" (P1-AC27, P4-AC18) |
| Deploy | Old server running while the migration is applied | The new column has a default and the old server never reads it (see Data) |
| Deploy | Part 4 reverted after someone set day 20 | See *Rollback* in the Plan |

### Out of scope

- "Last working day" paydays, public holidays, per-person cycles (recap).
- B-033, B-034, B-035, B-036 (recap).
- `budget_periods` / B-005: not read or written (pending Q6).
- The heatmap: stays a rolling 371 days (no month concept, `api/index.ts` `HEATMAP_DAYS`).
- Savings goals' "months left" (F14.4): stays calendar months.
- Recurring rules (F5): unchanged.
- Year views (Stats Year, `/recap year`): stay calendar years (Q4 A).
- An `/export all` alias, and advertising custom date ranges in the bot's usage
  hint (the shared parser accepts `from..to`, but only the Mini App offers it).
- A Today-screen line about a partner's change (the message covers it).
- Fixing the alert-key limitation exactly (a per-cycle alerts table; owner chose Q2 A).
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
| F4 + F5 (release) | Rollback note in the Plan, so a reverted release can't strand a space on a non-1 day. During the Part 4 deploy the old server must not silently accept and drop `cycleStartDay` (make the settings schema `.strict()` in an earlier part, or an equivalent) |
| F5 (partner) | When a member changes a shared space's start day, the other members get one short message |
| F5 (tidy-ups) | Include the year in export ranges that span New Year; add the `/recap` footer (`commands/recap.ts:89`) to the Part 2 files; place the History chip per the target Mini App layout (`apps/miniapp/CLAUDE.md`), not in `App.tsx`; fix the day-1 "last cycle" caption against the copy rule |
| Q6 (`budget_periods`) | **Still open:** to be asked at final approval |

---

**Final owner answers (2026-10-31, at approval):**
- **Q6 `budget_periods`: re-shape it, as a new Part 5** (owner chose this over "leave it alone").
  Purpose: **past cycles show the budget that applied then**, per space. Example:
  $350 until March, then $500 → the 20 Jan – 19 Feb cycle shows "of $350" and its
  real pace. DB approach: **rebuild the existing table in place** (owner's choice).
  This is destructive, so per GUARDRAILS §3 Part 5's Plan must include an
  explicit backup step, and the owner approves that migration separately. Part 5 gets
  its own grilling → Spec → Plan → `challenger` before any code.
  Parts 1–4 don't depend on it.
- **Export file names:** "Everything" keeps `spendlygo-all-time.csv`; every bounded
  export (including `/export 2026-10` and `/export 2026` for day-1 users) gets a dated
  name `spendlygo_<from>_to_<to>.csv`. Confirmed.

---

## Plan — *how* (Stage 2)

*Revised 2026-10-31 to the owner's decisions. Read `apps/server/CLAUDE.md`,
`apps/miniapp/CLAUDE.md` and `packages/core/CLAUDE.md` before each part.*

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
export function formatCycleRange(range: DateRange): string;       // "20 Oct – 19 Nov": `${d} ${monthName(m).slice(0,3)}`, joined by " – " (U+2013). Never a year (Q5)
export function formatDateRangeWithYears(range: DateRange): string; // Part 3. As formatCycleRange, but when the two years differ: "20 Dec 2026 – 19 Jan 2027"
export function cycleAlertKey(cycle: BudgetCycle): { year: number; month: number }; // Part 2: year/month of cycle.end
export function ordinalDay(day: number): string;                  // Part 4: "1st" "2nd" "3rd" "4th" … "11th" "12th" "13th" … "21st" "22nd" "23rd" … "31st"
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
  /** "October" when startDay is 1, else "20 Oct – 19 Nov" (recap decision 7, Q5: no year). */
  label: z.string(),
});
export type Cycle = z.infer<typeof cycleSchema>;
```

`cycle` is added as `.optional()` on `todayResponseSchema` and `meResponseSchema`
(and `previousCycle` on `meResponseSchema` in Part 3), with the comment
*"optional only so a new Mini App survives the old server during a deploy; the
server always sends it"*. The Mini App reads it as `data.cycle?.startDay ?? 1`.

**`updateSettingsSchema` becomes `.strict()` in Part 1** (owner decision F4 + F5).
Checked against the code: the Mini App only ever sends known keys
(`App.tsx` sends `monthlyBudgetCents`, `digestEnabled`, `digestHour`,
`alertsEnabled`; `api.updateSettings` posts the body as given), the bot's
`parseSettingsCallback` only builds known keys, and every existing PATCH test
sends `monthlyBudgetCents` only. So no current request breaks. With zod 3,
`.strict()` still returns a `ZodObject`, so `updateSettingsSchema.shape.*`
keeps working. Effect: between Part 3 and Part 4 the deployed server answers
`{"cycleStartDay": …}` with 400 instead of a silent 200.

**Copy rule (every surface):** start day 1 → wording exactly as today. Start day ≠ 1 →
a heading that says "This month" / a month name shows the range label; prose that
says "this month" says "this cycle". On-screen ranges never carry a year; export
labels do when the range spans New Year.

### Files

#### Part 1

| File | Change |
|---|---|
| `packages/core/src/cycle.ts` | **New**, as above, except `formatDateRangeWithYears` (Part 3), `cycleAlertKey` (Part 2) and `ordinalDay` (Part 4) |
| `packages/core/src/cycle.test.ts` | **New**, tests P1-AC1 to AC10 |
| `packages/core/src/index.ts` | `export * from './cycle.js';` |
| `packages/core/src/safe-to-spend.ts` | Optional `cycle` input; out-of-cycle check; update the header comment's formula to "this cycle" |
| `packages/core/src/safe-to-spend.test.ts` | New `describe('pay cycles (F17)')` with P1-AC11 to AC16. **Existing tests are not edited** |
| `packages/db/src/schema.ts` | `households.cycleStartDay: smallint('cycle_start_day').notNull().default(1)` + `check('households_cycle_start_day_ck', sql\`${t.cycleStartDay} BETWEEN 1 AND 31\`)`. Doc comment: per space, like the budget (F12.5, F17) |
| `packages/db/migrations/0005_*.sql` + `meta/` | **Generated** by `pnpm db:generate`. Never hand-written |
| `packages/db/src/repositories/households.ts` | `updateCycleStartDay(db, householdId, day): Promise<boolean>`. `UPDATE households SET cycle_start_day = day, updated_at = now() WHERE id = householdId AND cycle_start_day <> day RETURNING id` (drizzle: `and(eq(households.id, …), ne(households.cycleStartDay, day))`). A row back → `true`. No row → `findById`: null → throw exactly what `updateBudget` throws for a missing row; else `false` (already that day). The conditional write is what makes a redelivered or repeated change detectable without a race (P4-AC11, P4-AC13) |
| `packages/db/src/repositories/households.test.ts` | `describe('cycle start day')`: P1-AC17, P1-AC28 |
| `packages/shared/src/index.ts` | `cycleSchema`, `Cycle`; optional `cycle` on `todayResponseSchema` and `meResponseSchema`; doc comments on `monthIn`/`monthOut`/`dayOfMonth`/`daysInMonth` saying they now mean the cycle; **`updateSettingsSchema = z.object({...}).strict()`** with a comment pointing at B-032 F4/F5 |
| `apps/server/src/api/service.ts` | `activeSpaceSettings`, `currentCycle`, `toApiCycle`, type `SafeToSpendWithCycle`. `computeSafeToSpend`: load settings once (replaces the `effectiveBudgetCents` call), `cycle = cycleContaining(today, cycleStartDay)`, `totalsForPeriod(spaceId, cycle.start, today)`, pass `cycle` to `calculateSafeToSpend`, return `{ ...result, cycle }`. `computePeriodStats` keeps calling `computeSafeToSpend(ctx, user, to)` (it now resolves `to`'s own cycle) |
| `apps/server/src/api/index.ts` | `GET /today`: drop `monthRange(...)`; await `computeSafeToSpend` first, then use `safeToSpend.cycle` for the totals over `cycle.start..cycle.end`; add `cycle: toApiCycle(safeToSpend.cycle)`. `GET /me`: add `cycle: toApiCycle(await currentCycle(ctx, user))`. Drop now-unused imports |
| `apps/server/src/api/pay-cycle.test.ts` | **New**, DB-backed (`describeIfDb`, `fixedClock`, `auth()` and the `createApp(ctx, new Bot(BOT_TOKEN, { botInfo: undefined as never }), …)` setup copied from `household.test.ts`): P1-AC18 to AC23, P1-AC27 |
| `apps/server/src/bot/commands/money.ts` | Extract the `/today` text into an exported pure `buildTodayText(input)` (user, today, result, streak, cycle). Day ≠ 1: `This month:` → `${formatCycleRange(cycle)}:`, `Spent this month:` → `Spent this cycle:`. `handleBudget` reply: `left this month` → `left this cycle` when day ≠ 1 |
| `apps/server/src/bot/commands/money.test.ts` | **New**, pure (no DB): P1-AC24 |
| `apps/server/src/bot/capture.ts` | `buildConfirmation` takes an optional `cycleStartDay?: number` (default 1): `over budget this cycle` when ≠ 1. `capture.ts` and `photo-capture.ts` pass `safeToSpend.cycle.startDay` |
| `apps/server/src/bot/capture.test.ts` | Add P1-AC25 |
| `apps/miniapp/src/screens/Today.tsx` | Card heading: `startDay === 1 ? 'This month' : data.cycle.label`; `received this month` / `this cycle`; no-budget card's `this month` likewise. `startDay = data.cycle?.startDay ?? 1`. (Existing file in the current layout: a copy-only edit, no new component) |
| `PRD.md` | Add **F17 — Pay cycle** after F16 (the recap's rules, the clamping rule, per space, default 1). In F6, define `spentMTD`/`daysRemaining` over "the budget cycle (F17), a calendar month by default". §9: add `cycle_start_day` to `households` |
| `packages/core/CLAUDE.md` | Map row for `cycle.ts` (F17). Tests rule: cycle fixtures (day 1 regression, 29–31 clamping, leap Feb, year end) |
| `apps/server/CLAUDE.md` | Gotcha row: "`updateSettingsSchema` is `.strict()` on purpose (B-032): a new field must be added to the schema in the same PR as the route that handles it" |
| `CLAUDE.md` (root) | Repo layout: add `cycle.ts # F17 budget cycle boundaries` |
| `docs/adr/0007-budget-cycle-per-space.md` | **New** ADR: cycle per space, fixed day clamped, default 1, history re-grouped by the current rule (no stored periods), strict settings schema for deploy safety, `budget_periods` per Q6 |
| `BACKLOG.md` | B-032 status → `in progress (part 1 of 4)` |

#### Part 2

| File | Change |
|---|---|
| `packages/core/src/cycle.ts` | Add `cycleAlertKey(cycle)`: `{ year, month }` of **`cycle.end`** (Q2 A). For start day 1 that equals the calendar month, so existing rows still match |
| `packages/core/src/cycle.test.ts` | `cycleAlertKey`: day 1 → (2026, 10) for October; day 20 → (2026, 11) for 20 Oct – 19 Nov; (2027, 1) for 20 Dec – 19 Jan; distinct keys for 36 consecutive cycles of every start day |
| `apps/server/src/api/index.ts` | `GET /stats`: validate `anchor` with `isoDateSchema.safeParse` **and** `parseIsoDate` (throw `ValidationError` → 400, P2-AC4); the route calls `activeSpaceSettings` and passes `cycleStartDay` to `buildStats`. `period === 'month'`: `cycle = cycleContaining(anchor, startDay)`, previous = `previousCycle(cycle)`, label = day 1 ? `${monthName(month)} ${year}` : `formatCycleRange(cycle)`. `buildSeries` for month: iterate `cycle.start..cycle.end` with `addDays`, `key` = ISO date, `label` = `String(parseIsoDate(key).day)`. Day and **year** periods are unchanged (Q4 A) |
| `apps/server/src/api/recap.ts` | `rangeFor(period, anchor, cycleStartDay)`: month → the cycle and `previousCycle`, label as in Stats; year unchanged (Q4 A). `buildRecap` gets the start day from `activeSpaceSettings` |
| `apps/server/src/bot/commands/recap.ts` | Extract the footer (line ~89) into an exported pure `recapFooter(period, cycleStartDay)`: year → `` `/recap` for this cycle instead `` when ≠ 1, else as today; month → unchanged. `handleRecap` gets `cycleStartDay` from `activeSpaceSettings` |
| `apps/server/src/bot/commands/recap.test.ts` | **New**, pure: P2-AC8 |
| `apps/server/src/tasks/digest.ts` | `isMonthlyDigestDay(today, startDay = DEFAULT_CYCLE_START_DAY)` → `isLastDayOfCycle`. `buildMonthlyDigest`: `cycle = await currentCycle(ctx, user, today)`, `from: cycle.start`, previous = `previousCycle`, heading = day 1 ? `monthName(month)` : `formatCycleRange(cycle)` (Q7) |
| `apps/server/src/tasks/send-digests.ts` | Before the monthly gate: `const { cycleStartDay } = await activeSpaceSettings(ctx, user)` inside the per-user try (inside `sendOne`'s error isolation so one user's failure doesn't stop the loop) |
| `apps/server/src/tasks/alerts.ts` | `checkOne`: use `result.cycle` from `computeSafeToSpend`; `{ year, month } = cycleAlertKey(result.cycle)`; pass these to `sentThisMonth`/`recordIfNew`. Reserve-then-send and release are unchanged. 100% text: day 1 → `today.slice(0, 7)` (unchanged); else `formatCycleRange(cycle)`. Header comment: "once per cycle, keyed by the calendar month the cycle ends in; see the limitation in B-032 / PRD F13" |
| `packages/db/src/repositories/alerts.ts` | Doc comments only: `year`/`month` are "the calendar month the budget cycle ends in (F17); for a calendar-month cycle, that month". No signature change |
| `packages/db/src/schema.ts` | Doc comment on `budgetAlerts` only (same wording). **No migration** |
| `apps/miniapp/src/features/history/use-history-cycle.ts` | **New** (target layout). `useHistoryCycle({ enabled, anchor, today })` wraps `useQuery({ queryKey: ['stats', 'month', anchor ?? 'current'], queryFn: () => api.stats('month', anchor), enabled })` and returns `{ label, from, to: min(to, today), canGoNext: to < today, prevAnchor: addDays(from, -1), nextAnchor: addDays(to, 1), isPending, isError }`. The key starts with `'stats'`, so the existing `['stats']` invalidation refreshes it. Comment: *"key moves to lib/query-keys.ts in B-017"* (that file doesn't exist yet and B-017 owns it). Uses `addDays` from `lib/format.ts` |
| `apps/miniapp/src/features/history/CycleStepper.tsx` + `cycle-stepper.css` | **New**, presentational: `‹ label ›` using the same `date-range` / `date-range__step` markup and class names as History's month picker (so it looks identical); aria-labels "Previous cycle" / "Next cycle"; next disabled when `!canGoNext`; skeleton text while pending. Tokens only, ≤ 250 lines |
| `apps/miniapp/src/screens/History.tsx` | New props `cycleStartDay: number` and `cycleStepper: JSX.Element \| null`. When `cycleStartDay !== 1`, the `month` chip's label is "Cycle" and `period === 'month'` renders `cycleStepper` instead of the month input. Day 1: the existing code path, untouched |
| `apps/miniapp/src/App.tsx` | Minimal wiring only (≤ ~15 lines): `historyCycleAnchor` state (`undefined` = current); call `useHistoryCycle({ enabled: tab === 'history' && historyPeriod === 'month' && startDay !== 1, anchor, today: todayIso })`; in `historyRange`'s `'month'` case, when `startDay !== 1` return the hook's `{ from, to }` (or `{}` while pending); pass `cycleStartDay` and the `<CycleStepper>` element to `HistoryScreen`. All logic lives in `features/history/` |
| `apps/miniapp/src/screens/Stats.tsx` | No logic change (the label comes from the server). `highlightKey` already uses `today` for month |
| `apps/miniapp/src/components/RecapCard.tsx` | New prop `cycleStartDay`; the first tab reads `This cycle` when ≠ 1 |
| `apps/server/src/api/pay-cycle.test.ts` | P2-AC1 to AC5 |
| `apps/server/src/api/recap.test.ts` | P2-AC6, P2-AC7 |
| `apps/server/src/tasks/digest-periods.test.ts` | P2-AC9 to AC11 (existing tests untouched, they cover AC11's no-argument form) |
| `apps/server/src/tasks/digest.test.ts` | P2-AC12, P2-AC13 (`sendDueDigests` with a `vi.fn` `sendMessage`, as in `alerts.test.ts`) |
| `apps/server/src/tasks/alerts.test.ts` | New `describe('pay cycle (F17)')` with its own `ctx`/clock and a distinct `TELEGRAM_ID`: P2-AC14 to AC21. Change the start day with `householdsRepo.updateCycleStartDay` (Part 1) and move the clock by building a new `ctx` with another `fixedClock` |
| `PRD.md` | F7 Monthly view (cycle; Year stays calendar), F9.5 ("last day of the budget cycle"), F13.2–F13.3 ("once per cycle", the key, **the limitation paragraph from the Spec**), F16.1 |
| `apps/server/CLAUDE.md` | Gotcha row: "`budget_alerts.year/month` = the month the cycle ends in, not the calendar month of today. Moving the start day can skip one threshold once; never double-sends" |
| `docs/adr/0007-…` | Add the alert-key section with the limitation, and why History reuses `/api/stats` |

**Why History reuses `/api/stats` (owner decision Q3).** After this part,
`GET /api/stats?period=month&anchor=<date>` already returns `from`, `to` and
`label` for the cycle containing any date, with auth and cross-user tests
(P2-AC4). The arrows only need "the cycle containing the day before `from`"
and "the day after `to`" (P2-AC3). So no new endpoint, schema or route test is
needed. The cost is a heavier response than History needs (category totals and
series), fetched only when the Cycle chip is used and cached by TanStack Query.

#### Part 3

| File | Change |
|---|---|
| `packages/core/src/cycle.ts` + `cycle.test.ts` | Add `formatDateRangeWithYears(range)` and its unit test (same years → as `formatCycleRange`; different years → `"20 Dec 2026 – 19 Jan 2027"`) |
| `apps/server/src/api/export.ts` | `ExportRange` gets a required `filename`. `parseExportRange(argument, { today, cycleStartDay })`: normalise (`trim`, lower-case, inner whitespace runs → `-`). `''` → everything: `{ label: 'all-time', filename: 'spendlygo-all-time.csv' }` with no `from`/`to` (**unchanged**). `cycle` → `cycleContaining(today, cycleStartDay)`; `last-cycle` → its `previousCycle`; `YYYY-MM` → `monthRange` (calendar, always); `YYYY` → `yearRange`; `YYYY-MM-DD` → that day; `YYYY-MM-DD..YYYY-MM-DD` → custom (null when either date fails `parseIsoDate` or from > to). Labels: `YYYY`, `YYYY-MM`, `YYYY-MM-DD` → the argument as typed (as today). `cycle`/`last-cycle` with start day 1 → `` `${monthName(month)} ${year}` `` of the cycle start; with day ≠ 1, and custom ranges → `formatDateRangeWithYears(range)`. `filename` = `` `spendlygo_${from}_to_${to}.csv` `` for every bounded range. Delete `exportFilename`; callers use `range.filename` |
| `apps/server/src/api/export-range.test.ts` | **New**, pure, no DB: P3-AC1 to AC8 |
| `apps/server/src/api/index.ts` | `GET /export`: `parseExportRange(c.req.query('range') ?? '', { today: todayFor(ctx, user), cycleStartDay })` (`cycleStartDay` from `activeSpaceSettings`); the 400 message lists `cycle, last-cycle, YYYY, YYYY-MM, YYYY-MM-DD, YYYY-MM-DD..YYYY-MM-DD, or omitted`; `Content-Disposition` uses `range.filename`. `GET /me`: add `previousCycle: toApiCycle(previousCycle(cycle))` (P3-AC16) |
| `packages/shared/src/index.ts` | Optional `previousCycle: cycleSchema` on `meResponseSchema` (same deploy comment) |
| `apps/server/src/api/export.test.ts` | Add P3-AC9 to AC12. **No existing assertion changes**: the no-range test still expects `spendlygo-all-time.csv`, and the month/year tests count rows only |
| `apps/server/src/bot/commands/export.ts` | Pass `{ today: todayFor(ctx, user), cycleStartDay }`. Extract the usage text into an exported pure `exportUsageText(cycle: BudgetCycle)` (P3-AC13: the two cycle lines name the ranges via `formatCycleRange` when day ≠ 1, else "this month"/"last month"). Empty reply stays `Nothing logged for ${label === 'all-time' ? 'any period yet' : label}.` (P3-AC14). `InputFile(..., range.filename)`; caption `${n} entries · ${range.label}` (unchanged shape). Update the header comment's command list |
| `apps/server/src/bot/commands/export.test.ts` | **New**: P3-AC13 (pure), P3-AC14 and P3-AC15 (DB block; copy `fakeBotCtx` from `settings.test.ts` and add `replyWithDocument: vi.fn()`) |
| `apps/server/src/bot/commands/help.ts` | Line 64: `` `/export` for everything, `/export cycle` or `/export last cycle` for a pay cycle, `/export 2026` or `/export 2026-08` for a calendar range. `` |
| `apps/miniapp/src/features/settings/ExportSheet.tsx` + `export-sheet.css` | **New** (target layout). Uses `components/Sheet.tsx`; five radio options in the order Everything · This cycle · Last cycle · Pick a month · Custom dates (day 1: This month · Last month, captions from `me.cycle.label` / `me.previousCycle.label`, hidden if missing on an old server); Everything is preselected and sends **no** `range` (works on old and new servers); Pick a month: `<input type="month">` (max = today's month) → `range=YYYY-MM`; Custom dates: two `<input type="date">` like History's custom range → `range=from..to`, Download disabled until both set and from ≤ to; This/Last → `range=cycle` / `range=last-cycle`. Download calls `onExport(range?: string)`. Tokens only, ≤ 250 lines |
| `apps/miniapp/src/screens/Settings.tsx` | "Export CSV" opens the sheet; `onExportCsv(range?: string)`. The footnote "export everything as a CSV, any time" stays as is |
| `apps/miniapp/src/App.tsx` | `onExportCsv={(range) => exportCsv.mutate(range)}`; `api.exportCsv(range)` already accepts it |
| `PRD.md` | F8.1, F8.4 rewritten: `/export` = everything; `cycle`, `last cycle`; calendar `YYYY`/`YYYY-MM`/`YYYY-MM-DD`; custom ranges in the Mini App; file-name rule. §8 `/export [range]` row |

#### Part 4

Two commits in this order (see *Rollback*): **commit 1, server** (schema,
route, bot picker, notification, tests); **commit 2, Mini App** (field, preview,
wiring).

| File | Change |
|---|---|
| `packages/shared/src/index.ts` | `updateSettingsSchema` (still `.strict()`): `cycleStartDay: z.number().int().min(1).max(31).optional()` |
| `packages/db/src/repositories/users.ts` | No change. `UpdateSettingsInput` stays user-only; the route destructures `cycleStartDay` out before calling `usersRepo.updateSettings`, exactly as it does `monthlyBudgetCents` |
| `packages/core/src/cycle.ts` + `cycle.test.ts` | Add `ordinalDay(day)` and its unit test (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 23rd, 31st) |
| `apps/server/src/telegram/send-with-retry.ts` | **New**. `sendMessageWithRetry(api: Api, chatId: string, text: string, sleep: (ms: number) => Promise<void> = defaultSleep)`: `await api.sendMessage(chatId, text)`; on a `GrammyError` with `error_code === 429` and `parameters.retry_after ≤ 3`, `await sleep(retry_after * 1000)` and send once more; any other error (including a second failure or `retry_after > 3`) is rethrown. Plain text, no `parse_mode` |
| `apps/server/src/telegram/send-with-retry.test.ts` | Unit tests for the helper (429 ≤ 3 retried once; 429 > 3 not retried; 403 not retried) |
| `apps/server/src/api/cycle-change-notice.ts` | **New**. Pure `buildCycleChangeText(actor: User, cycle: BudgetCycle): string`: name = `actor.firstName ?? 'Someone in your shared space'`; day ≠ 1 → `${name} set this shared space's budget month to start on the ${ordinalDay(day)}. This cycle: ${formatCycleRange(cycle)}.`; day 1 → `${name} set this shared space's budget month back to the calendar month. This month: ${monthName(month)}.` No amounts (GUARDRAILS §6). `notifyCycleChange(ctx, api, actor, householdId, day, sleep?)`: `members = householdsRepo.membersOf(ctx.db, householdId)` minus `actor.id`; for each, **sequentially** (one message per chat, so far under 1 msg/s per chat and 30 msg/s overall, GUARDRAILS §10): `cycle = cycleContaining(todayFor(ctx, member), day)` (the recipient's own timezone), `sendMessageWithRetry(api, member.telegramId.toString(), buildCycleChangeText(actor, cycle), sleep)`; catch per member → `logger.warn('settings.cycle_notify_failed', { userId: member.id, ...describeError(error) })` and continue. Never throws. Returns the number sent |
| `apps/server/src/api/index.ts` | `PATCH /settings`: destructure `cycleStartDay` beside `monthlyBudgetCents`; if defined → `changed = await householdsRepo.updateCycleStartDay(ctx.db, activeHouseholdId(user), cycleStartDay)`; if `changed`, `await notifyCycleChange(ctx, bot.api, user, activeHouseholdId(user), cycleStartDay)` after the write (never fails the request). Response adds `cycleStartDay` |
| `apps/server/src/api/pay-cycle.test.ts` | P4-AC1 to AC5, P4-AC11, P4-AC12, P4-AC14, P4-AC15. For the notice tests: `const bot = new Bot(BOT_TOKEN, { botInfo: undefined as never }); bot.api.sendMessage = vi.fn()…` before `createApp(ctx, bot, …)` (as `alerts.test.ts` does). P4-AC14 rejects with `new GrammyError(…, { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' }, …)`; P4-AC15 first rejects with `error_code: 429, parameters: { retry_after: 1 }`. To inject `sleep`, `createApiRouter` reads an optional `sleep` from `CreateAppOptions` (default real timer); tests pass `vi.fn().mockResolvedValue(undefined)` |
| `apps/server/src/app.ts` | `CreateAppOptions` gets an optional `sleep?: (ms: number) => Promise<void>` passed through to `createApiRouter` (test seam only) |
| `apps/server/src/bot/commands/settings.ts` | `SettingsAction` adds `{ kind: 'cycle'; day: number; householdId: string }` and view `{ kind: 'view'; view: 'days'; householdId: string }`. `parseSettingsCallback`: `/^set:cp:([0-9a-f-]{36})$/` → days view; `/^set:c:(\d{1,2}):([0-9a-f-]{36})$/` → cycle action, day validated with `updateSettingsSchema.shape.cycleStartDay` and the id with `z.string().uuid()`; anything else (including the bare `set:c:20` and `set:cp`) → null (P4-AC9). `buildSettingsText(user, config, cycle?)`: adds the line from P4-AC6 when `cycle` is given (`ordinalDay`). `settingsKeyboard(user, config)`: add `Change cycle start day` → `` `set:cp:${activeHouseholdId(user)}` ``. New `cycleDayPickerKeyboard(currentDay, householdId)` (copy `hourPickerKeyboard`, 7 per row, `• ` on the current day, `← Back` → `set:back`). In the callback handler, for both the days view and the cycle action: **if `action.householdId !== activeHouseholdId(botCtx.appUser)` → `answerCallbackQuery({ text: STALE_TEXT })` and return, writing nothing** (P4-AC10; the id is only compared, never used to write, GUARDRAILS §4). Cycle action: `changed = await householdsRepo.updateCycleStartDay(ctx.db, activeHouseholdId(botCtx.appUser), day)`; answer `Saved` (on every path, including errors, as the existing code does); edit the message to the main view with the new cycle line; **then**, if `changed`, `await notifyCycleChange(ctx, botCtx.api, botCtx.appUser, householdId, day)` (after answering, so the spinner never waits on it, GUARDRAILS §10). `handleSettings` computes `cycle` via `currentCycle`. Log `settings.updated` with `fields: 'cycleStartDay'`. Update the header comment's callback list |
| `apps/server/src/bot/commands/settings.test.ts` | P4-AC6, AC7, AC9 (pure); P4-AC8, AC10, AC13 (DB block; `fakeBotCtx` gains `api: { sendMessage: vi.fn() }`). Update the existing `every callback_data is set:-prefixed and within 64 bytes` test only if it enumerates exact data (it must keep passing as is) |
| `apps/server/src/bot/commands/help.ts` | One line: `/settings` also sets the day your budget month starts |
| `apps/miniapp/src/features/settings/CycleStartDayField.tsx` + `cycle-start-day.css` | **New** (commit 2). A `<select>` 1–31 with ordinal labels (`1st (calendar month)`, `2nd`, …), caption `This cycle: {label}` (or `Calendar month` for day 1), hints for 29–31 and, when `me.household !== null`, `Changes it for everyone in this space. They'll get a message.` Calls `onChange(day)` with `haptics.select()`. Holds the chosen value locally and resets it to `me.cycle.startDay` when the mutation fails (P4-AC18) |
| `apps/miniapp/src/screens/Settings.tsx` | Render the field under the budget input. Replace `daysInMonth(today)` with `me.cycle?.days ?? daysInMonth(today)`; copy `days this cycle` when start day ≠ 1 |
| `apps/miniapp/src/App.tsx` | `onSetCycleStartDay={(day) => settings.mutate({ cycleStartDay: day })}`; `settings.onSuccess` also invalidates `['recap']` (History's cycle key already starts with `'stats'`) |
| `PRD.md` | §8 `/settings` row: add the cycle start day; F17: partner notice |
| `docs/adr/0007-…` | Add the rollback note below |
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
  - **Rollback of Part 1:** reverting the code leaves a harmless column. No
    backfill, no bulk update, no drop.
- **`budget_alerts`: no migration (owner decision Q2 A).** Key =
  `(user_id, year, month of the cycle's END date, threshold_pct)`. For a fixed
  start day, every cycle ends in a different calendar month, so the key is unique
  per cycle. For start day 1, the end month *is* the calendar month, so rows
  written by the old server are read identically (P2-AC18). Limitation and
  never-double-send: see the Spec (P2-AC20, P2-AC21).
- **`budget_periods`:** not touched, pending Q6.
- Nothing stored changes on a start-day change. History is re-grouped at read
  time (decision 5).

### Rollback (owner decision F4)

- **Parts 1–3** never let anyone set a day other than 1, so reverting any of
  them is behaviour-neutral (P1-AC1, P1-AC13, P1-AC19, P2-AC2, P2-AC11,
  P2-AC18 prove day 1 = today). Part 3's only day-1 change is the file name of
  bounded exports.
- **Part 4, Mini App problem:** revert **commit 2 only**. The server keeps
  `PATCH cycleStartDay` and the bot's `/settings` picker, so any space can still
  be set back to the 1st from chat. Nothing is stranded.
- **Part 4, server problem:** reverting commit 1 removes every way to change
  the day, but Parts 1–3 still honour the stored day, so the affected spaces
  keep working on their chosen cycle; they are not broken, just frozen. Before
  reverting, run `SELECT id, cycle_start_day FROM households WHERE cycle_start_day <> 1`
  (read-only) and tell the owner. Putting a space back to 1 without the UI is a
  one-row `UPDATE households SET cycle_start_day = 1 WHERE id = $1` per space,
  which **needs the owner's explicit approval** (GUARDRAILS §3, §14). Never a
  bulk update.
- **Reverting Part 1 after Part 4** (unlikely): the old code ignores the
  column, so every space silently goes back to calendar months. Tell the owner
  first; no data is lost and re-deploying restores the cycles.
- **Deploy window:** because `updateSettingsSchema` is `.strict()` from Part 1,
  a new Mini App that reaches a Part 1–3 server gets a 400 for `cycleStartDay`,
  shows the error haptic, and reverts the select (P1-AC27, P4-AC18). It never
  shows a false "Saved".

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
| P1-AC9 | `cycle.test.ts` › `formats a cycle as "20 Oct – 19 Nov", with no year` |
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
| P1-AC26 | Screenshot check (no Mini App test harness until B-016, Q8 A): Today, day 20 and day 1, light + dark, 375px |
| P1-AC27 | `pay-cycle.test.ts` › `PATCH /api/settings › an unknown key is a 400 and changes nothing (strict schema)` |
| P1-AC28 | `households.test.ts` › `cycle start day › updateCycleStartDay reports whether it changed anything` |
| P2-AC1 | `pay-cycle.test.ts` › `GET /api/stats › month view is the day-20 cycle with 31 day buckets` |
| P2-AC2 | `pay-cycle.test.ts` › `GET /api/stats › day 1 month view is unchanged` |
| P2-AC3 | `pay-cycle.test.ts` › `GET /api/stats › anchors either side of a cycle step exactly one cycle, re-grouped by the current start day` |
| P2-AC4 | `pay-cycle.test.ts` › `GET /api/stats › rejects unauthenticated and a bad anchor; a stranger sees only their own month` |
| P2-AC5 | `pay-cycle.test.ts` › `GET /api/stats › the year view stays the calendar year with a day-20 cycle` |
| P2-AC6 | `apps/server/src/api/recap.test.ts` › `buildRecap › a month recap follows the cycle and stops at today` |
| P2-AC7 | `recap.test.ts` › `buildRecap › a year recap stays the calendar year with a day-20 cycle` |
| P2-AC8 | `apps/server/src/bot/commands/recap.test.ts` › `recapFooter says "this cycle" only when the start day isn't 1` |
| P2-AC9 | `apps/server/src/tasks/digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 20 fires on the 19th, including across the new year` |
| P2-AC10 | `digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 31 fires on 27 Feb (common) and 28 Feb (leap)` |
| P2-AC11 | `digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 1 matches the calendar month end` |
| P2-AC12 | `apps/server/src/tasks/digest.test.ts` › `buildMonthlyDigest › names the cycle range and totals only the cycle` |
| P2-AC13 | `digest.test.ts` › `sendDueDigests › sends the monthly digest on the cycle's last day, not the calendar month end` |
| P2-AC14 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › spend before the cycle start does not count` |
| P2-AC15 | `alerts.test.ts` › `pay cycle (F17) › a double-fired tick sends the 80% alert once per cycle` |
| P2-AC16 | `alerts.test.ts` › `pay cycle (F17) › thresholds re-arm in the next cycle` |
| P2-AC17 | `alerts.test.ts` › `pay cycle (F17) › the 100% text names the cycle range` |
| P2-AC18 | `alerts.test.ts` › `pay cycle (F17) › a day-1 row written before B-032 still suppresses the repeat` |
| P2-AC19 | `alerts.test.ts` › `pay cycle (F17) › switching 1 → 20 after an October alert still alerts in the new cycle` |
| P2-AC20 | `alerts.test.ts` › `pay cycle (F17) › documented limitation: switching 20 → 1 on 25 Oct skips October's 80% alert once` |
| P2-AC21 | `alerts.test.ts` › `pay cycle (F17) › flipping through every start day on one date never sends a threshold twice` |
| P2-AC22 | Screenshot check: History Cycle chip and arrows, day 20 and day 1 |
| P2-AC23 | Screenshot check: Stats month tab and recap card, day 20 and day 1 |
| P3-AC1 | `apps/server/src/api/export-range.test.ts` › `no argument is still everything, named spendlygo-all-time.csv` |
| P3-AC2 | `export-range.test.ts` › `"cycle" is this cycle, named with exact dates` |
| P3-AC3 | `export-range.test.ts` › `"last cycle" in any spacing or case is the previous cycle` |
| P3-AC4 | `export-range.test.ts` › `day 1: this and last cycle are labelled with month names` |
| P3-AC5 | `export-range.test.ts` › `YYYY-MM is always the calendar month, whatever the start day` |
| P3-AC6 | `export-range.test.ts` › `YYYY is the calendar year and YYYY-MM-DD a single day, named with exact dates` |
| P3-AC7 | `export-range.test.ts` › `a custom from..to range is inclusive; reversed or malformed is null` |
| P3-AC8 | `export-range.test.ts` › `ranges spanning New Year carry both years in the label` |
| P3-AC9 | `apps/server/src/api/export.test.ts` › `no range still exports everything, whatever the start day` |
| P3-AC10 | `export.test.ts` › `cycle and last-cycle follow the start day and name the file by dates` |
| P3-AC11 | `export.test.ts` › `a custom from..to range is inclusive; reversed is a 400` |
| P3-AC12 | `export.test.ts` › existing `rejects an unauthenticated request` and `never includes another user's transactions` (kept), plus new `range=cycle never includes another user's transactions` |
| P3-AC13 | `apps/server/src/bot/commands/export.test.ts` › `the usage hint lists everything, cycle, last cycle, year and month` |
| P3-AC14 | `export.test.ts` (bot) › `an empty last cycle says nothing was logged for its range` |
| P3-AC15 | `export.test.ts` (bot) › `/export cycle sends one file named by dates with a range caption` |
| P3-AC16 | `pay-cycle.test.ts` › `GET /api/me › also returns the previous cycle` |
| P3-AC17 | Screenshot check: the export sheet, day 20 and day 1 |
| P3-AC17a (defect) | `apps/server/src/app.test.ts` › `CORS › exposes Content-Disposition so the Mini App can read the export file name` — ❌ failing before fix (a97faa9) → ✅ after fa11ffe |
| P4-AC1 | `pay-cycle.test.ts` › `PATCH /api/settings › owner's example: setting day 20 on 31 Oct moves Today to 20 Oct – 19 Nov` |
| P4-AC2 | `pay-cycle.test.ts` › `PATCH /api/settings › rejects 0, 32, 1.5 and "20" without changing anything` |
| P4-AC3 | `pay-cycle.test.ts` › `PATCH /api/settings › either member of a shared space can change it` |
| P4-AC4 | `pay-cycle.test.ts` › `PATCH /api/settings › changes only the active space` |
| P4-AC5 | `pay-cycle.test.ts` › `PATCH /api/settings › a householdId in the body is a 400; unauthenticated is a 401` |
| P4-AC6 | `apps/server/src/bot/commands/settings.test.ts` › `shows the cycle start day and range` |
| P4-AC7 | `settings.test.ts` › `day picker lists 1–31, 7 per row, marks the current day, carries the space id, and stays within 64 bytes` |
| P4-AC8 | `settings.test.ts` › `set:c:20 updates the active space and a replay is a no-op` (DB block) |
| P4-AC9 | `settings.test.ts` › `parseSettingsCallback rejects malformed cycle data, including the old id-less form` |
| P4-AC10 | `settings.test.ts` › `a picker for another space is answered "out of date" and writes nothing` (DB block) |
| P4-AC11 | `pay-cycle.test.ts` › `PATCH /api/settings › a partner's change sends one message to each other member, and none when nothing changed` |
| P4-AC12 | `pay-cycle.test.ts` › `PATCH /api/settings › a personal space change messages nobody` |
| P4-AC13 | `settings.test.ts` › `a redelivered set:c in a shared space messages the partner once` (DB block) |
| P4-AC14 | `pay-cycle.test.ts` › `PATCH /api/settings › a blocked partner never fails the change` |
| P4-AC15 | `pay-cycle.test.ts` › `PATCH /api/settings › a 429 is retried once after retry_after` |
| P4-AC16 | Screenshot check: Settings budget card, day 20 / day 30 / day 1, personal and shared |
| P4-AC17 | Screenshot check: daily mode preview, day 20 and day 1 |
| P4-AC18 | Screenshot + dev-bot check: picking a day refreshes Today/Stats/History; a 400 reverts the select without "Saved" |

P1-AC24 tightened after review finding 2: `money.test.ts` now asserts exact day-1 strings for `/today` with and without a budget and for `/budget 1500` ("left this month"), taken from `main`; the `as any` cast is gone. All pass (regression guards). Full suite: 35 files, 501 tests passed.

Helper unit tests that back the ACs but aren't ACs themselves:
`cycle.test.ts` (`cycleAlertKey`, `formatDateRangeWithYears`, `ordinalDay`) and
`apps/server/src/telegram/send-with-retry.test.ts`.

### Risks & guardrails

| Guardrail | Risk | Mitigation |
|---|---|---|
| §1 Cost | None. No new service, dependency or Render service | — |
| §2 Money | A cycle-length bug lets allowances exceed the budget | All division stays `divideCentsFloor`; P1-AC14 property over 7 start days × 4 cycle shapes × 5 budgets; P1-AC13 proves the day-1 path is identical |
| §3 Data | Migration on a live DB | Additive column with a default + CHECK; generated; no backfill, drop or rewrite. `budget_alerts` untouched (Q2 A). Rollback never needs a bulk update; a one-row reset needs the owner's approval |
| §3 Idempotency | Double-fired tick, redelivered callback, repeated PATCH | Alerts keep reserve-then-send behind the unique index (P2-AC15, P2-AC21); `set:c:<n>:<id>` is an absolute value (P4-AC8); `updateCycleStartDay` writes only on a real change, so notices go out once (P4-AC11, P4-AC13) |
| §3 Correctness | Alert key collision after a start-day change | Accepted by the owner (Q2 A): at most one skipped threshold, never a duplicate (P2-AC20, P2-AC21); documented in PRD F13 and `apps/server/CLAUDE.md` |
| §4 Auth | The start day is written for the wrong space | The space comes only from `activeHouseholdId(user)`; the body can't carry one (strict schema, P4-AC5); the callback's space id is compared, never written to (P4-AC10); cross-user tests P1-AC22, P2-AC4, P3-AC12, P4-AC5 |
| §6 Privacy | Logging; partner notice content | Log only `userId` and `fields: 'cycleStartDay'` / error class. The notice names the actor's first name and the date range, never amounts. Export default still exports everything (§6 "honour export") |
| §7 Runtime | More queries per request | `activeSpaceSettings` is one primary-key lookup, replacing the existing `effectiveBudgetCents` lookup in `computeSafeToSpend`. Aggregation stays in SQL. History's Cycle chip reuses `/api/stats` (heavier than needed, only when used, cached) |
| §8 Frontend | Bundle size | Four small components and one hook, no dependency; tokens only; transform/opacity only |
| §9 Time | Boundaries in UTC, or an off-by-one at the cycle edge | All cycle maths on `IsoDate` from `todayFor` (user timezone); P1-AC10, P1-AC20 at 00:30 SGT; first/last-day tests; the partner notice uses the recipient's timezone |
| §10 Telegram | Notice fan-out, 429s, slow webhook | One message per other member, sent sequentially to distinct chats; 429 retried once only if `retry_after` ≤ 3 s, else dropped and logged; 403/5xx logged, never fail the change (P4-AC14, P4-AC15); the bot answers the callback before sending; every callback path is answered |
| §11 Scope | Scope creep (heatmap, goals, year views, `/export all`, Today notice line) | Listed as out of scope |
| §13 Testing | Mini App has no test harness (B-016) | UI ACs are screenshot checks (Q8 A); every number and every "sent once" behaviour they rely on is tested server-side |
| Deploy order | The static site deploys before or after the server | `cycle`/`previousCycle` optional in the schema, Mini App falls back to day 1; Everything export sends no `range`; strict settings schema turns a premature `cycleStartDay` into a visible 400. The server never depends on new Mini App fields |
| Behaviour change | Day-1 users | None, except the file name of bounded exports (`/export 2026-10`, `/export 2026`). Called out in the Part 3 PR body |

### PR split

Four PRs, all **F17**, in order, each cut from the latest `main` after the
previous one merges. Until Part 4 ships, no user can change the start day, so
Parts 1–3 are behaviour-identical for everyone (all spaces are at 1, proved by
P1-AC1, P1-AC13, P1-AC19, P2-AC2, P2-AC11, P2-AC18, P3-AC1, P3-AC9), apart
from bounded-export file names in Part 3 and new `/export cycle` options.

| Part | Branch | Contents | ACs | Migration |
|---|---|---|---|---|
| 1 of 4 | `feat/B-032-pay-cycle` | Core `cycle.ts`, safe-to-spend, `households.cycle_start_day` + `updateCycleStartDay`, strict settings schema, `/api/today`, `/api/me` cycle, bot `/today`/`/budget`/capture copy, Mini App Today card, PRD F17, ADR 0007 | P1-AC1 to AC28 (**28**) | **Yes**: one additive column |
| 2 of 4 | `feat/B-032-pay-cycle-periods` | Stats month view (year stays calendar), recap + `/recap` footer, monthly digest, budget alerts + documented limitation, History Cycle chip via `/api/stats` (`features/history/`), recap card tab | P2-AC1 to AC23 (**23**) | No (Q2 A) |
| 3 of 4 | `feat/B-032-pay-cycle-export` | Export parser (`cycle`, `last cycle`, custom ranges, dated file names, `/export` = everything unchanged), bot `/export` + help, `/api/me` `previousCycle`, Mini App export sheet | P3-AC1 to AC17 (**17**) | No |
| 4 of 4 | `feat/B-032-pay-cycle-settings` | Commit 1 (server): `PATCH /api/settings` `cycleStartDay`, bot `/settings` day picker with space id, partner notice + 429 helper. Commit 2 (Mini App): start-day select, daily-mode days | P4-AC1 to AC18 (**18**) | No |

Total: **86** ACs.

### Open questions for the owner

**Q6 — What happens to the unused `budget_periods` table (B-005)?**

*Scenario:* your cycle is 20 Oct – 19 Nov and your budget is S$1,500. On
5 Nov you raise it to S$2,000. Next month you look back at Stats for
20 Oct – 19 Nov: the pace and "on track" figures use S$2,000, today's budget,
not the S$1,500 you actually had for most of that cycle. That's exactly how
calendar months behave today. The `budget_periods` table was meant to fix
this by remembering each month's budget, but no code reads or writes it, and
it's keyed by **user + calendar month**, which doesn't fit budgets that are
**per space** and months that are now **cycles**.

- **A. Leave it alone in B-032; add a note to B-005** that any future use must
  be keyed by space and cycle start date, and must cope with a changed start
  day. *Pro:* no extra scope, no migration; nothing reads the table, so there's
  no behaviour risk; B-032 stays four PRs. *Con:* past cycles keep using
  today's budget (as past months do now) until B-005 is done.
- **B. Fold B-005 into B-032:** re-key the table to (space, cycle start) and
  record each cycle's budget. *Pro:* past cycles show the budget you really
  had. *Con:* a schema change now (dropping or re-keying the old table is a
  destructive migration that needs separate approval), a fifth PR, and it
  delays the item you put first. It also clashes with decision 5: when you
  change the start day, history is re-grouped, so stored per-cycle budgets no
  longer line up with the new cycles, and we'd need a rule for that too.
- **C. Drop the table now** (with an approved migration). *Pro:* removes an
  unused table that invites mistakes. *Con:* destructive, so it needs your
  explicit approval (GUARDRAILS §3, §14); it's B-005's decision, not this
  item's; it closes off option B later.

*Recommendation:* **A.** It keeps B-032 focused, risks nothing, and leaves
B-005 to decide properly once cycles exist. If you choose B or C, the Build
plan needs a revision and a fresh approval before Part 1 starts.

---

## Part 5 — Budget history: Spec — *what* (Stage 1)

*Written 2026-11-01 by `spec-planner`. Also resolves BACKLOG B-005. Parts 1–4
are merged (PR #19). This section and the Part 5 Plan below are approved
separately from Parts 1–4, and the **migration** is approved separately again
(see the approval lines at the top of the file).*

### Part 5 owner decisions (approved 2026-11-01)

| # | Decision |
|---|---|
| Q1 A | Store budget history as a **dated list of changes per space** ("from date D: budget X"), not one row per cycle. Any cycle, under any start day, looks up its budget, so a later start-day change stays correct |
| Q2 A | A cycle whose budget changed partway shows the **last** budget in effect within that cycle (what Today showed at the cycle's end). Precisely: the change with the greatest effective date ≤ the cycle's end date |
| Q3 A | On ship, **seed each space's current budget as effective "from the beginning"**. Nothing that exists today changes on ship day |
| Q4 A | **Rebuild `budget_periods` in place** (per space + effective date, nullable budget for "no budget"). The migration **refuses to run if the table has any rows**. The Plan includes an explicit **backup step**. The owner approves the migration separately |
| Q5 B | Shown in **Stats › Month (cycle) only**: one line `Budget $350 · $40 under` / `· $25 over`, for past and current cycles; hidden when that cycle had no budget. API: a nullable field on the stats response for `period=month` only, backward-compatible both ways |
| Q6 A | Removing a budget is recorded as a change to "no budget"; such cycles show no line |
| Q7 A | No budget line on the Day or Year views |
| Writes | Every budget write path also appends a history row, in the same transaction. Shared spaces: one history per space |
| Out of scope | Budget line in Recap / `/recap`; entering pre-Part-5 budgets by hand; year totals (park in BACKLOG › Later) |

### Problem

PRD F6 and F7 give a past cycle's pace and "on track" against **today's**
budget, because the only stored budget is `households.monthly_budget_cents`.
The owner's example: $350 until March, then $500. Looking back at
20 Jan – 19 Feb shows nothing about the $350 that actually applied. The table
meant to fix this, `budget_periods` (PRD §9, B-005), is keyed by **user +
calendar month** and has never been read or written. Budgets are per space
(F12.5) and months are now cycles (F17). Part 5 re-shapes that table into a
per-space list of dated changes. Every budget write appends to it, and the
Stats month view says what the budget was for that cycle and how the cycle
ended against it.

### Terms used below

- **Change:** one row `(space, effective_from, budget_cents | null)`. Null
  means "no budget" (Q6 A).
- **Effective date of a change:** **the writing user's today in their own
  timezone** (`todayFor(ctx, user)`), the same rule as a transaction's
  `occurred_on` (GUARDRAILS §9). Spaces have no timezone of their own. One
  extra rule keeps the list ordered when members live in different timezones:
  a change is **never dated before the space's latest change**. If the
  writer's today is earlier, the change is filed under the latest change's
  date (it replaces it). So the latest row always equals the live budget.
- **Same-day changes:** at most one row per space per date. A second change on
  the same date replaces the first (last write of the day wins).
- **Unchanged value:** if the new value equals the space's current budget
  (including null = null), **nothing is written**: no history row, and
  `households.updated_at` is not touched. (Recommendation adopted from the
  brief. It makes redelivered `/budget` updates and repeated PATCHes no-ops.)
- **Budget for a cycle:** the budget of the change with the greatest
  `effective_from` ≤ `cycle.end`. No such row → no budget → no line.
- **Epoch:** the seed's "from the beginning" date, **`1970-01-01`**
  (constant `BUDGET_HISTORY_EPOCH` in core). It is never shown to anyone.
  *Why not each space's `created_at`:* every personal space that existed
  before ADR 0006 was created by migration 0004, so its `created_at` is later
  than the budget and transactions it inherited. Cycles before it would wrongly
  show "no budget". `created_at` is also a UTC instant, and its date depends
  on whose timezone you read it in. A fixed epoch has neither problem.
- **Budget line (Mini App, proposed copy):** `Budget $350.00 · $40.00 under`,
  `Budget $350.00 · $25.00 over`, and for exactly on: **`Budget $350.00 · on
  budget`** (proposed, see Q-P5-3). Amounts are formatted with the Mini App's
  `formatMoney`, like every other Stats amount, so they carry cents.
- **Spent, for the line:** `budgetedOutCents` for the whole cycle (out minus
  categories excluded from the budget, PRD F6.7). That is the figure Today and
  the alerts measure. **Pending Q-P5-2**, because Stats' headline "Spent" is
  `outCents`, which includes excluded categories.

### User stories

- As the owner, I want 20 Jan – 19 Feb to say "Budget $350.00 · $40.00 under"
  even though my budget is now $500, so I can judge past cycles fairly.
- As someone who changed the budget mid-cycle, I want that cycle to show the
  budget I ended it on, the same one Today showed me then.
- As someone who later moves the start day, I want past cycles to still show
  the right budget for the dates they now cover.
- As a member of a shared space, I want one history for the space, whichever
  of us made the change.
- As someone with no budget for a cycle, I want no line rather than a made-up
  one (F6.6).

### Acceptance criteria (30: 28 firm + 2 pending an owner answer)

**Fixed scenario "Owner's history"** (extends "Owner's October"): timezone
`Asia/Singapore`, clock `2026-10-31T04:00:00Z` (noon, Sat 31 Oct), start day
20, one personal space with these changes: `(1970-01-01, 35 000)` (the seeded
"$350 from the beginning") and `(2026-03-05, 50 000)` ($500 from 5 Mar). So the
live budget is $500. Expenses (non-excluded categories): $310 on 2026-02-01
(cycle 20 Jan – 19 Feb), $525 on 2026-03-01 (cycle 20 Feb – 19 Mar), and the
Owner's October $100 on 2026-10-05 + $50 on 2026-10-25.

**D5** = touches the dangerous five (money maths, timezone boundaries).
Safe-to-spend, the parser and recurrence are **not** touched: Today, alerts
and digests keep reading `households.monthly_budget_cents`, unchanged.

| # | D5 | Given | When | Then |
|---|---|---|---|---|
| P5-AC1 | money | Budgets and spends in cents: (35 000, 31 000), (35 000, 37 500), (35 000, 35 000), (0, 0), (0, 1 200) | `compareWithBudget(budget, spent)` | `{under, 4 000}`, `{over, 2 500}`, `{on, 0}`, `{on, 0}`, `{over, 1 200}`. `differenceCents` is never negative. A negative or non-integer input throws `ValidationError` |
| P5-AC2 | time | Writer's today and the space's latest change date | `budgetChangeEffectiveFrom(today, latest)` with (2026-11-01, none), (2026-10-31, 2026-11-01), (2026-11-02, 2026-11-01), (2026-11-01, 1970-01-01) | 2026-11-01, **2026-11-01** (never before the latest), 2026-11-02, 2026-11-01 |
| P5-AC3 | — | The migration guard SQL (`0006_budget_periods_guard.sql`) | It runs against a `budget_periods` with one row, then against an empty one (each inside a rolled-back transaction) | With a row it raises an exception whose message contains `budget_periods` and `refusing`, so the whole migration batch rolls back. Empty, it succeeds and changes nothing |
| P5-AC4 | — | Space A with budget 35 000, space B with no budget, empty history for both | The seed SQL (`0009_budget_periods_seed.sql`) runs, then runs again | A has exactly one change `(1970-01-01, 35 000)`. B has none. The second run adds nothing |
| P5-AC5 | — | The rebuilt table | Raw inserts of `budget_cents` −1; two rows with the same (space, effective_from); a row with `budget_cents` null; a row for a non-existent space | −1 rejected by `budget_periods_budget_ck`; duplicate rejected by `budget_periods_household_effective_uq`; null accepted; unknown space rejected by the FK |
| P5-AC6 | — | A space with budget null and no history | `householdsRepo.updateBudget(db, id, 35 000, '2026-01-10')` | The space's budget is 35 000, and history has exactly one change `(2026-01-10, 35 000)` |
| P5-AC7 | — | As P5-AC6 | `updateBudget(db, id, 35 000, '2026-01-12')` (same value, e.g. a redelivered `/budget 350`) | History still has one change. `households.updated_at` is unchanged |
| P5-AC8 | — | A space at 35 000 since 1970-01-01 | Three changes on 2026-03-05: 50 000, then 42 000, then 50 000 | One change dated 2026-03-05 with 50 000 (last write of the day wins); the epoch row is untouched; 2 rows in total |
| P5-AC9 | — | A space at 50 000 | `updateBudget(db, id, null, '2026-06-01')` (budget removed) | The space's budget is null, and history gains `(2026-06-01, null)` (Q6 A) |
| P5-AC10 | time | Shared space; the latest change is `(2026-11-01, 50 000)`, written by an SGT member just after midnight | A member whose today is still 2026-10-31 sets 60 000 | No row dated 2026-10-31. The 2026-11-01 change now holds 60 000. The latest change equals `households.monthly_budget_cents` (60 000) |
| P5-AC11 | — | A space at 35 000 since 1970-01-01 | Concurrently (`Promise.all`): `updateBudget(…, 50 000, d)` and `updateBudget(…, 60 000, d)`; then separately two concurrent `updateBudget(…, 70 000, d2)` | Both runs finish without error, and each time the latest change equals the space's final budget. The identical pair adds exactly one row (row lock, then compare) |
| P5-AC12 | — | Space S has changes `(1970-01-01, 35 000)`, `(2026-03-05, 50 000)`, `(2026-06-01, null)`; space T has `(1970-01-01, 99 900)` | `budgetPeriodsRepo.budgetInEffectOn(db, S, d)` for d = 2026-02-19, 2026-03-04, 2026-03-05, 2026-05-31, 2026-06-01; and for a space U with no rows | 35 000, 35 000, 50 000, 50 000, null; U → null. T's rows never affect S's answers (space isolation) |
| P5-AC13 | time | Owner's history; clock `2026-10-19T16:30:00Z` (00:30 on 20 Oct in Singapore, 19 Oct in UTC) | `PATCH /api/settings {"monthlyBudgetCents": 60000}` | 200, and history gains `(2026-10-20, 60 000)`, never 2026-10-19 |
| P5-AC14 | — | Bot `/budget 500` from a user whose space is at 35 000, clock = Owner's October | `handleBudget` runs | It calls `householdsRepo.updateBudget(db, <active space>, 50 000, '2026-10-31')` (today in the user's timezone). The reply text is unchanged from today |
| P5-AC15 | — | A shared space (creator + partner), budget 100 000 since 1970-01-01 | The **partner** PATCHes 150 000; then the creator PATCHes 150 000 | One change `(2026-10-31, 150 000)` for the shared space after both (the creator's is unchanged, so it's a no-op). Neither member's personal space gains a row. The creator's `GET /api/stats?period=month` shows `budget.budgetCents` 150 000 |
| P5-AC16 | — | Owner's history | `PATCH /api/settings {"monthlyBudgetCents": null}`, then `GET /api/stats?period=month` | History gains `(2026-10-31, null)`. The stats response has `budget: null` (current cycle 20 Oct – 19 Nov ends after the removal) |
| P5-AC17 | money | Owner's history | `GET /api/stats?period=month&anchor=2026-02-01` (cycle 20 Jan – 19 Feb 2026) | `budget` = `{budgetCents 35000, spentCents 31000, status "under", differenceCents 4000}` (**the owner's $350 → $500 example**) |
| P5-AC18 | money | Owner's history | `GET /api/stats?period=month&anchor=2026-03-01` (cycle 20 Feb – 19 Mar 2026, budget changed on 5 Mar) | `budget` = `{budgetCents 50000, spentCents 52500, status "over", differenceCents 2500}` (**mid-cycle change: last wins**, Q2 A) |
| P5-AC19 | money | Owner's history | `GET /api/stats?period=month` (current cycle 20 Oct – 19 Nov) | `budget` = `{budgetCents 50000, spentCents 5000, status "under", differenceCents 45000}`. All Part 2 fields are unchanged (P2-AC1 still passes) |
| P5-AC20 | time | Owner's history, then the start day is changed to 1 (Part 4 path) | `GET /api/stats?period=month&anchor=2026-03-01` and `anchor=2026-02-10` | 1–31 Mar → `budgetCents` 50 000 (change of 5 Mar ≤ 31 Mar); 1–28 Feb → 35 000. **A start-day change after history exists stays correct** (Q1 A) |
| P5-AC21 | time | Changes `(1970-01-01, 35 000)`, `(2026-02-28, 50 000)` and start day 31; then `(2028-02-29, 60 000)` with start day 1 | Stats month for anchors 2026-02-27, 2026-02-28 (day 31) and 2028-02-15 (day 1) | 31 Jan – 27 Feb 2026 → 35 000 (the change falls on the next cycle's first day); 28 Feb – 30 Mar 2026 → 50 000; Feb 2028 (ends 29 Feb, leap) → 60 000 |
| P5-AC22 | — | Owner's history plus `(2026-06-01, null)` | Stats month for anchors 2026-06-25 (cycle 20 Jun – 19 Jul) and 2026-06-05 (cycle 20 May – 19 Jun, which contains the removal) | `budget: null` for both (**removal → no line**, Q6 A; last wins) |
| P5-AC23 | — | Only the seeded change `(1970-01-01, 35 000)` (**"from the beginning"**, Q3 A) | Stats month for anchor 2024-01-05 | `budget.budgetCents` 35 000 |
| P5-AC24 | money | Changes `(1970-01-01, 0)` (a budget of $0, not "no budget") | Stats month with 1 200 spent in the cycle, and in another cycle with nothing spent | `{0, 1200, "over", 1200}` and `{0, 0, "on", 0}` |
| P5-AC25 | — | Owner's history | `GET /api/stats?period=day` and `period=year` | Neither response has a `budget` key (Q7 A). Day and year bodies are otherwise unchanged |
| P5-AC26 | — | Owner's history; stranger B with no budget and no history | B calls `GET /api/stats?period=month&anchor=2026-02-01`; and an unauthenticated call | B gets `budget: null` and none of the owner's spend; unauthenticated is 401 |
| P5-AC27 | — | `statsResponseSchema` | It parses a body **without** `budget` (an old server), with `budget: null`, and with a full `budget` object; and a body with `status: "maybe"` | The first three parse; the last fails. *Why:* a new Mini App must cope with an old server, and an old Mini App ignores the extra field (it never validates responses, `lib/api.ts` `request<T>` only casts) |
| P5-AC28 | — | Stats › Month in the Mini App (start day 20 and start day 1, light + dark, 375px) | It renders: under (Owner's history, anchor Feb), over (anchor Mar), exactly on, no budget, an old server's response with no `budget` field, and the Day and Year tabs | One line under the totals: `Budget $350.00 · $40.00 under`, `Budget $500.00 · $25.00 over`, `Budget $350.00 · on budget`; nothing when `budget` is null or missing; nothing on Day or Year. Tokens only, not red (DESIGN: expenses are not red) (screenshot check, Q8 A) |
| P5-AC29 | money | **Pending Q-P5-2.** Owner's history plus a $100 transfer (an `excludeFromBudget` category) on 2026-02-02 | Stats month for anchor 2026-02-01 | If Q-P5-2 = A: `spentCents` 31 000, still `$40 under` (headline Spent shows $410). If B: `spentCents` 41 000, `$60 over` |
| P5-AC30 | — | **Pending Q-P5-1.** Start day 20, Stats › Month | The user wants to see 20 Jan – 19 Feb | Depends on the answer: A, ‹ › arrows on Stats Month (never past the current cycle); B, the line also shows in History's Cycle stepper; C, current cycle only. Written as a screenshot check once answered |

### Edge cases

| Area | Case | Expected |
|---|---|---|
| Money | Budget 0 | A real $0 budget: line shows `over` or `on budget`, never hidden (P5-AC24). Distinct from null |
| Money | Over / under / exactly on | P5-AC1, P5-AC17–AC19, P5-AC24. `differenceCents` ≥ 0; integer cents; no division, so no rounding question |
| Money | Mid-cycle change | Last change ≤ cycle end wins (P5-AC18, P5-AC22). Today's safe-to-spend is unchanged: it still uses the live budget for the whole current cycle |
| Money | Current cycle | The line compares the budget with the cycle's whole spend so far (including any future-dated entries in the cycle, as Stats' totals do). Wording pending Q-P5-3 |
| Dates | A change on a cycle's last / first day, Feb, leap Feb, day 29–31 clamping | Looked up by `cycle.end` only, so clamping is inherited from `cycleContaining` (P5-AC21) |
| Dates | Start day changed after history exists | Cycles are re-grouped (Part 1 decision 5); each new cycle looks up its own end date (P5-AC20) |
| Dates | Cycle before any change | Only possible for a space whose first budget came after ship: no row ≤ cycle end → no line |
| Time | 00:30 in Singapore | The change is dated the Singapore day (P5-AC13) |
| Time | Shared space, members in different timezones | Never dated before the latest change (P5-AC10). Accepted consequence: a member in a "behind" timezone may see a change land one day later than their own calendar says. Dates never go backwards, and the latest row always equals the live budget |
| Spaces | Personal vs shared | One history per space; written by whichever member changes it (P5-AC15). Switching spaces switches which history Stats reads |
| Spaces | New space created after ship | Starts with no budget and no history (`householdsRepo.create`, `usersRepo.upsertByTelegramId`); the first budget set writes the first row |
| Spaces | Join / leave / switch | No budget change, so no history write (verified in `households.ts`) |
| Telegram | Redelivered `/budget 500` | Same value → nothing written (P5-AC7, P5-AC14) |
| Telegram | Double-fired tick | Not involved: no tick job reads or writes budget history |
| Concurrency | Two members change it at once | Row lock on the space, then compare, then write; the latest row always equals the live budget (P5-AC11) |
| Deploy | Old server running after the migration | It never reads or writes `budget_periods` (verified: only `schema.ts` defines it, only the `BudgetPeriod` type is exported, no query anywhere). But a budget changed through the **old** server in that window updates `households` without a history row. See Q-P5-4 and the Plan's post-deploy check |
| Deploy | New Mini App, old server | No `budget` field → no line (P5-AC27, P5-AC28) |
| Deploy | Old Mini App, new server | Extra field ignored (no response validation in the Mini App) |
| Data | Non-empty `budget_periods` in production | The migration refuses and the deploy fails at build, with the old server still serving (P5-AC3) |

### Out of scope (park in BACKLOG › Later)

- Budget line in the Recap card and `/recap`.
- Entering or editing budgets for cycles before Part 5 shipped (they all show
  the seeded "from the beginning" value).
- Year totals ("Budgets this year: $5,100 · $300 under").
- Using the history for pace or "on track" on past cycles (Stats shows no pace
  today; Today always uses the live budget).
- Showing who changed the budget, or a change log screen (no `set_by` column).
- A space-level timezone.

### Open questions for the owner (Part 5)

**Q-P5-1 — How do you reach a past cycle in Stats? (affects the Mini App only)**

*Scenario:* you open Stats › Month to see how 20 Jan – 19 Feb went. Today,
Stats has **no arrows**: it only ever shows the current cycle
(`screens/Stats.tsx`, the query is `['stats', period]` with no anchor). The
only screen that steps through past cycles is History's "Cycle" chip
(Part 2), and it already loads `/api/stats?period=month&anchor=…` for each
cycle. So with Stats-only (Q5 B) as it stands, you'd only ever see the
current cycle's line.

- **A. Add ‹ › arrows to Stats › Month**, like History's Cycle chip (never
  past the current cycle). Move the presentational `CycleStepper` from
  `features/history/` to `ui/`, so both use one component. *Pro:* matches your
  "Stats only" choice and makes past cycles reachable where you asked for
  them. *Con:* more Mini App work (stepper state, query key gets an anchor,
  charts re-animate between cycles); touches History's import.
- **B. Also show the line in History's Cycle view.** *Pro:* nearly free, since
  the data is already fetched there; you can already step back through cycles.
  *Con:* goes against Q5 B ("Stats only"); History becomes partly a stats
  screen.
- **C. Current cycle only for now**; park navigation. *Pro:* smallest. *Con:*
  your $350 example isn't visible anywhere until navigation is added.

*Recommendation:* **A**, because it's the only option that delivers your
example where you said you wanted it. But it's your call.

**Q-P5-2 — Which "spent" does the line compare with the budget?**

*Scenario:* in 20 Jan – 19 Feb you spent $310 on food and so on, and moved
$100 to savings (a category excluded from the budget). Stats' headline says
**Spent $410.00**. Under it the line says either `Budget $350.00 · $40.00
under` (A) or `· $60.00 over` (B).

- **A. Budgeted spend (excludes excluded categories, PRD F6.7).** *Pro:* the
  same figure Today, the 80/100% alerts and safe-to-spend use, so the verdict
  matches what the app told you during the cycle. *Con:* it can differ from
  the "Spent" number right above it, which may look like a mismatch.
- **B. The headline "Spent" (`outCents`).** *Pro:* the arithmetic is visible
  on screen. *Con:* a transfer to savings would count as "over budget",
  contradicting Today and the alerts.

*Recommendation:* **A**. If the mismatch worries you, the line could say
`Budget $350.00 · $40.00 under (budgeted spending)`. That's a copy tweak, not
a data change.

**Q-P5-3 — Wording for the current cycle, and for "exactly on".**

*Scenario:* it's 31 Oct, the cycle runs to 19 Nov, and you've spent $50 of
$500. "`$450.00 under`" is true but reads like a final result.

- **A. Same words for every cycle:** `under` / `over` / `on budget`.
  *Pro:* one rule, exactly what you specified. *Con:* "under" mid-cycle can
  read as "done".
- **B. Current cycle says `$450.00 left`** (and `over` when over); past
  cycles say `under` / `over` / `on budget`. *Pro:* reads naturally while the
  cycle is running. *Con:* two wordings; the Mini App needs to know whether
  the cycle is current (it can compare `to` with `me.today`).

For "exactly on" the proposal is **`on budget`** (alternatives: `right on
budget`, `$0.00 under`). *Recommendation:* **B** with `on budget`.

**Q-P5-4 — A budget changed during the deploy minutes.**

*Scenario:* Render builds the new version and the migration copies your
$500 into history. In the minute or two before the new server takes over, the
old one is still answering, and you happen to change the budget to $600. The
old server doesn't know about history, so history still says $500 while your
budget is $600. Today is right ($600). But when this cycle becomes a past
cycle, Stats would show $500.

- **A. Accept it, plus a read-only check after deploy** (in the Plan). If it
  finds a mismatch, you fix it with your approval (simplest: set the budget to
  any other value and back to $600 in the app, which writes correct history;
  or an approved one-row insert). *Pro:* no extra code. *Con:* relies on
  running the check.
- **B. Same as A, and don't change any budget during the deploy.** You and
  your partner are the only users, so the risk is nearly zero. *Pro:* almost
  never needs the fix. *Con:* a manual rule.
- **C. The new server repairs it at boot** (writes a history row whenever the
  latest change differs from the live budget). *Pro:* automatic. *Con:* an
  automatic data-repair write at every boot (GUARDRAILS §3 "ask first"), more
  code and tests, and it would also hide real bugs.

*Recommendation:* **B** (it includes A's check).

---

## Part 5 — Budget history: Plan — *how* (Stage 2)

*Read `apps/server/CLAUDE.md` (Database section, deploy order),
`packages/core/CLAUDE.md` and `apps/miniapp/CLAUDE.md` first. Branch:
`feat/B-032-pay-cycle` (the session's assigned branch). Feature ID **F17**
(also closes B-005).*

### Design

**Source of truth stays the same.** `households.monthly_budget_cents` remains
the live budget for safe-to-spend, Today, alerts, digests, recap and
`/budget`. None of those change. `budget_periods` is a **history log**, read
only by the Stats month view. One invariant ties them together: **for every
space with at least one change, the latest change's `budget_cents` equals
`households.monthly_budget_cents`** (P5-AC10, P5-AC11).

**The one write path.** Both production budget writes (`PATCH /api/settings`
in `api/index.ts:175`, bot `/budget` in `bot/commands/money.ts:126`) already
go through `householdsRepo.updateBudget`. Nothing else writes a budget:
`householdsRepo.create` and `usersRepo.upsertByTelegramId` create spaces with
null and need no history; join/leave/switch don't touch budgets; `start.ts`
(onboarding) and `scripts/seed.ts` (categories only) don't write budgets.
**So history is appended inside `updateBudget`.** Every caller, including
tests, gets it, and no call site can forget.

### New core module `packages/core/src/budget-history.ts` (pure)

```ts
/** The seed's "from the beginning" date (B-032 P5, Q3 A). Never displayed. */
export const BUDGET_HISTORY_EPOCH: IsoDate = '1970-01-01';

/** The date a budget change is filed under: the writer's today, but never before the
 *  space's latest change (keeps the list ordered across members' timezones). */
export function budgetChangeEffectiveFrom(writerToday: IsoDate, latest: IsoDate | null): IsoDate;
   // latest !== null && compareIsoDate(writerToday, latest) < 0 ? latest : writerToday

export type BudgetStatus = 'under' | 'over' | 'on';
export interface BudgetComparison { status: BudgetStatus; differenceCents: AmountCents }
/** How a cycle ended against its budget. differenceCents is always ≥ 0. */
export function compareWithBudget(budgetCents: AmountCents, spentCents: AmountCents): BudgetComparison;
   // validate both with positiveOrZero integer check (throw ValidationError, as centsOf does);
   // spent < budget → under, budget − spent; spent > budget → over, spent − budget; else on, 0.
   // Use subtractCents; no division.
```

Export from `packages/core/src/index.ts` (`export * from './budget-history.js';`).

### Schema (end state) `packages/db/src/schema.ts`

Replace the `budgetPeriods` block (keep the `// --- budget history` heading):

```ts
/**
 * Budget history per space (F17 Part 5, B-005): a dated list of changes.
 * A cycle's budget is the change with the greatest effective_from ≤ the
 * cycle's end. budget_cents null = "no budget". Written only by
 * householdsRepo.updateBudget, in the same transaction as the live value
 * (households.monthly_budget_cents), so the latest row always equals it.
 */
export const budgetPeriods = pgTable('budget_periods', {
  id: uuid('id').primaryKey().defaultRandom(),
  householdId: uuid('household_id').notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  /** The writer's today in their timezone, never before the space's latest change. */
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  budgetCents: integer('budget_cents'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('budget_periods_household_effective_uq').on(t.householdId, t.effectiveFrom),
  check('budget_periods_budget_ck', sql`${t.budgetCents} IS NULL OR ${t.budgetCents} >= 0`),
]);
```

The unique index also serves the lookup (`household_id = $1 AND
effective_from <= $2 ORDER BY effective_from DESC LIMIT 1` is an index range
scan). `BudgetPeriod` type export stays. Cascading on space deletion is safe:
spaces are never deleted today (transactions `restrict` it).

### Data: migration (needs its own owner approval)

Four migration files, **in this order, each made by drizzle-kit** so the
journal and snapshots stay consistent (GUARDRAILS §3: generated, committed,
reviewed, applied by the tool). Two are drizzle **custom** migrations
(`drizzle-kit generate --custom`, the tool's supported way to add SQL that
isn't a schema diff, as 0004's data steps did). Two are schema diffs, split so
drizzle never asks the interactive "rename or create?" question (a removal
and an addition on the same table in one diff triggers it, and the build agent
has no TTY).

| # | Command (from repo root) | Content |
|---|---|---|
| 0006 | `pnpm --filter @spendlygo/db exec drizzle-kit generate --custom --name=budget_periods_guard` | Fill the empty file with the guard below |
| 0007 | Edit `schema.ts` to the **intermediate** shape: `budgetPeriods` = `id`, `budgetCents: integer('budget_cents')` (nullable), `createdAt`, with only the new `budget_periods_budget_ck`. Then `pnpm db:generate -- --name=budget_periods_drop_user_month` | Generated: drop the FK, the unique index, `budget_periods_month_ck`; `budget_cents` DROP NOT NULL; replace the budget check; drop `user_id`, `year`, `month`. Removals only, so no prompt |
| 0008 | Edit `schema.ts` to the **end** shape above. `pnpm db:generate -- --name=budget_periods_add_space_columns` | Generated: add `household_id uuid NOT NULL` + FK, `effective_from date NOT NULL`, `updated_at`, unique index. Additions only, so no prompt. `NOT NULL` without a default is fine because 0006 guarantees the table is empty |
| 0009 | `pnpm --filter @spendlygo/db exec drizzle-kit generate --custom --name=budget_periods_seed` | Fill with the seed below |

Guard (0006):

```sql
-- B-032 Part 5: budget_periods is rebuilt in place (owner decision Q4 A).
-- It has never been written by any code. If it has rows, something we don't
-- know about wrote them: refuse, so the whole migration batch rolls back and
-- the deploy fails at build while the old server keeps serving.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "budget_periods") THEN
    RAISE EXCEPTION 'B-032 P5: budget_periods has % row(s); refusing to rebuild it. Back it up and ask the owner.',
      (SELECT count(*) FROM "budget_periods");
  END IF;
END $$;
```

Seed (0009), Q3 A:

```sql
-- B-032 Part 5: every space's current budget applies "from the beginning"
-- (BUDGET_HISTORY_EPOCH in packages/core/src/budget-history.ts). Spaces with
-- no budget get no row: no row means no budget.
INSERT INTO "budget_periods" ("household_id", "effective_from", "budget_cents")
SELECT "id", DATE '1970-01-01', "monthly_budget_cents"
FROM "households"
WHERE "monthly_budget_cents" IS NOT NULL
ON CONFLICT ("household_id", "effective_from") DO NOTHING;
```

**Why this is safe to apply (verify each in the PR):**
- **One transaction.** drizzle's pg migrator runs *all pending migrations in
  one transaction* (`drizzle-orm/pg-core/dialect.js` `migrate()`:
  `session.transaction(...)` around the loop). If 0006 raises, 0007–0009 never
  commit. `scripts/migrate.ts` exits 1, the Render build fails, and the old
  server keeps serving.
- **Ordering gotcha.** The migrator only applies files whose journal `when`
  is **greater** than the last applied one. Generate 0006 → 0009 one after
  another and check in `meta/_journal.json` that each `when` is greater than
  the one before, and greater than 0005's `1793464731783`. Don't hand-edit
  `when`.
- **Old server compatibility.** The running server never reads or writes
  `budget_periods`. Verified: the only references are the table definition in
  `schema.ts` and the `BudgetPeriod` type re-export in `packages/db/src/index.ts`.
  There are no queries, no relational `db.query` use, no tests. The seed only
  *reads* `households`. So the old server works unchanged against the rebuilt
  table.
- **Destructive parts** (DROP COLUMN `user_id`/`year`/`month`, DROP INDEX)
  touch a table that the guard proves empty. This still counts as a destructive
  migration under GUARDRAILS §3/§14, hence the backup step and the separate
  approval.
- **Bulk insert** (the seed) is the owner-approved Q3 A backfill. It's one
  statement in the same transaction.

### Backup step (owner, before merging; Claude never connects to production, GUARDRAILS §3)

1. In the Supabase dashboard › SQL editor of the **production** project, run
   these read-only queries:
   `SELECT count(*) FROM budget_periods;` → expect **0** (if not 0, stop: the
   guard will fail the deploy anyway; tell Claude).
   `SELECT id, monthly_budget_cents FROM households WHERE monthly_budget_cents IS NOT NULL;`
   → download the result as CSV. This is exactly what the seed will copy.
2. Take a dump of both tables from your own machine (a session-mode or direct
   connection string, not the 6543 transaction pooler; `pg_dump` must be the
   same major version as Supabase's Postgres or newer):
   `pg_dump "<prod connection string>" --table=public.budget_periods --table=public.households --format=custom --file=spendlygo-before-B032-P5-2026-11-XX.dump`
   Keep it **outside the repo** (GUARDRAILS §12: never commit real data).
3. Don't change any budget while the deploy runs (Q-P5-4).
4. Record the approval line at the top of this file: `Part 5 migration
   approved by owner, YYYY-MM-DD (backup taken: yes)`.

**After deploy (read-only check, owner or main session with the owner):**

```sql
SELECT h.id, h.monthly_budget_cents, bp.budget_cents AS latest_history
FROM households h
LEFT JOIN LATERAL (
  SELECT budget_cents FROM budget_periods
  WHERE household_id = h.id ORDER BY effective_from DESC LIMIT 1
) bp ON true
WHERE h.monthly_budget_cents IS DISTINCT FROM bp.budget_cents;
```

Expect **0 rows**. Any row is a deploy-window drift (Q-P5-4). Report it.
Fixing it needs the owner's approval.

### Rollback

Migrations are **forward-only**. Three commits, so each later one can be
reverted alone:

1. **Commit 1 — data + write path:** core `budget-history.ts`, schema,
   migrations 0006–0009, `updateBudget` + new repo, both write call sites, DB
   tests.
2. **Commit 2 — Stats API:** `budget` on `/api/stats` month, shared schema,
   API tests.
3. **Commit 3 — Mini App:** the budget line (+ navigation per Q-P5-1).

- Mini App problem → revert commit 3. The server field is ignored.
- Stats API problem → revert commit 2 (and 3). The history keeps being written,
  so nothing is lost. The new Mini App hides the line when the field is
  missing.
- **Never revert commit 1** (it contains the migrations and the schema that
  matches them). Reverting `schema.ts` without its migrations would make the
  next `db:generate` emit a reverse, destructive migration. If commit 1's
  *code* misbehaves, fix forward. The old code ignores the table, so the
  database itself is never the emergency. If history stopped being written for
  a while, the post-deploy check above finds the drift. Fixing it needs owner
  approval.

### Deploy order

One PR. The Render API build runs `db:migrate` (0006–0009 in one
transaction), then the new server passes its health check and takes over. The
static site may deploy before or after:
- New Mini App + old server: no `budget` field, so no line (P5-AC27/28).
- Old Mini App + new server: extra field ignored.
- Old server + migrated DB (build → switch-over window): fine, it never
  touches the table. The only gap is a budget changed in that window
  (Q-P5-4, post-deploy check).

### Files

| File | Change |
|---|---|
| `packages/core/src/budget-history.ts` | **New**, as in *Design*. Header comment cites B-032 P5 / B-005 and the "never before the latest" rule |
| `packages/core/src/budget-history.test.ts` | **New**: P5-AC1, P5-AC2 |
| `packages/core/src/index.ts` | `export * from './budget-history.js';` |
| `packages/db/src/schema.ts` | `budgetPeriods` → end shape (via the intermediate shape for 0007). Doc comment as above |
| `packages/db/migrations/0006_budget_periods_guard.sql`, `0007_budget_periods_drop_user_month.sql`, `0008_budget_periods_add_space_columns.sql`, `0009_budget_periods_seed.sql` + `meta/0006–0009_snapshot.json` + `meta/_journal.json` | Made by drizzle-kit as in *Data*. Only the two custom files' bodies are written by hand (the guard and the seed, verbatim from this plan) |
| `packages/db/src/repositories/households.ts` | `updateBudget(db, householdId, monthlyBudgetCents: number \| null, effectiveFrom: IsoDate): Promise<Household>`. Body: `db.transaction(async (tx) => { … })`: (1) `tx.select().from(households).where(eq(households.id, householdId)).for('update').limit(1)` → missing → throw `No household ${id}` (as today); (2) if `current.monthlyBudgetCents === monthlyBudgetCents` return `current` (no write); (3) `latest = max(effective_from)` for the space (`tx.select({ d: sql<string \| null>\`max(${budgetPeriods.effectiveFrom})\` })…where(eq(budgetPeriods.householdId, householdId))`); (4) `on = budgetChangeEffectiveFrom(effectiveFrom, latest)`; (5) update `households` (`monthlyBudgetCents`, `updatedAt`) `.returning()`; (6) `tx.insert(budgetPeriods).values({ householdId, effectiveFrom: on, budgetCents: monthlyBudgetCents }).onConflictDoUpdate({ target: [budgetPeriods.householdId, budgetPeriods.effectiveFrom], set: { budgetCents: sql\`excluded.budget_cents\`, updatedAt: new Date() } })` (**`excluded.*`**, see the gotcha in `apps/server/CLAUDE.md`); return the updated row. Doc comment: the only budget writer; appends history; unchanged value = no write. Copy the transaction style of `joinByCode` (reads through `tx`) |
| `packages/db/src/repositories/budget-periods.ts` | **New**. `budgetInEffectOn(db, householdId: string, date: IsoDate): Promise<number \| null>`: `select budget_cents … where household_id = $1 and effective_from <= $2 order by effective_from desc limit 1`; no row → null. `listForSpace(db, householdId)` (ordered by `effective_from`, used by tests only, also scoped). Both filter by space themselves |
| `packages/db/src/index.ts` | `export * as budgetPeriodsRepo from './repositories/budget-periods.js';` |
| `packages/db/src/repositories/households.test.ts` | Existing `updateBudget › is visible to every member`: add the 4th argument `'2026-10-31'` (mechanical, no assertion changes). New `describe('budget history (B-032 P5)')`: P5-AC5 to AC11 |
| `packages/db/src/repositories/budget-periods.test.ts` | **New**, DB-backed (`describeIfDb`, cleanup copied from `households.test.ts`, distinct telegram ids `970000000001n…`): P5-AC12 |
| `packages/db/src/budget-periods-migration.test.ts` | **New**, DB-backed. Read the two custom SQL files with `readFileSync(new URL('../migrations/0006_budget_periods_guard.sql', import.meta.url))`; run each inside `handle.db.transaction(async (tx) => { …; tx.rollback() })` (or a raw `BEGIN … ROLLBACK` on a single `postgres` connection), so the shared test DB is never changed: P5-AC3, P5-AC4. The seed assertion checks only the test's own spaces (other rows in the DB are irrelevant) |
| `apps/server/src/api/index.ts` | `PATCH /settings`: `householdsRepo.updateBudget(ctx.db, activeHouseholdId(user), monthlyBudgetCents, todayFor(ctx, user))`. `buildStats`: month branch only, add `budgetPeriodsRepo.budgetInEffectOn(ctx.db, householdId, to)` to the existing `Promise.all` (no new sequential stage); build `budget` = null when the lookup is null, else `{ budgetCents, spentCents: totals.budgetedOutCents, ...compareWithBudget(centsOf(budget), centsOf(totals.budgetedOutCents)) }` **(spent basis pending Q-P5-2; B = `totals.outCents`)**. Day and year: don't set the key at all (Q7 A). Commit 1: the PATCH line; commit 2: stats |
| `apps/server/src/bot/commands/money.ts` | `handleBudget`: pass `todayFor(ctx, user)` as the 4th argument. Reply unchanged |
| `apps/server/src/bot/commands/money.test.ts` | The `updateBudget` mock becomes a `vi.fn()`; new test P5-AC14 asserts its arguments. Existing assertions unchanged |
| Test helpers calling `updateBudget` (`tasks/alerts.test.ts:83, 321`, `tasks/digest.test.ts:69, 292`, `api/pay-cycle.test.ts:162, 208, 228, 318`, `api/recap.test.ts:173`) | Add the 4th argument `BUDGET_HISTORY_EPOCH` (or the test's today). **Type-only/mechanical**, no assertion changes. Allowed edit, listed here so the reviewer can check nothing else moved |
| `packages/shared/src/index.ts` | `export const budgetStatusSchema = z.enum(['under', 'over', 'on']);` and on `statsResponseSchema`: `budget: z.object({ budgetCents: nonneg int, spentCents: nonneg int, status: budgetStatusSchema, differenceCents: nonneg int }).nullable().optional()`. Doc: *"Month (cycle) view only: the budget in effect at the cycle's end (B-032 P5). null = no budget that cycle. Absent on day/year, and from servers before Part 5; the Mini App must treat absent as null."* Export `StatsBudget` type |
| `apps/server/src/api/budget-history.test.ts` | **New**, DB-backed, setup copied from `pay-cycle.test.ts` (`auth()`, `makeApp`, `fixedClock`, distinct telegram ids `930000000001n…`). Seed history with `updateBudget(…, BUDGET_HISTORY_EPOCH)` then `updateBudget(…, '2026-03-05')`. P5-AC13, AC15 to AC26. Plus a pure `describe` (no DB) for P5-AC27 (`statsResponseSchema.safeParse`) |
| `apps/miniapp/src/features/stats/BudgetLine.tsx` + `budget-line.css` | **New** (target layout; `features/stats` is created here, B-020 moves the rest later). Props `{ budget: StatsBudget \| null \| undefined; currency; locale }`; returns null unless `budget` is an object; text per *Terms* (wording per Q-P5-3); `formatMoney` from `lib/format.ts`. Tokens only (`--text-subtle`), never red, ≤ 60 lines |
| `apps/miniapp/src/screens/Stats.tsx` | Under the totals in the first card, `{period === 'month' && <BudgetLine budget={data.budget} … />}`. Copy-only wiring. No other change unless Q-P5-1 = A |
| *(only if Q-P5-1 = A)* `apps/miniapp/src/ui/CycleStepper.tsx` + `cycle-stepper.css` (moved from `features/history/`), `features/history` import updated, `App.tsx` stats query key `['stats', period, anchor ?? 'current']` + anchor state reset on tab/period change, Stats Month renders the stepper (never past the current cycle, as History's `canGoNext`) | Exact wiring is written into this plan after the answer, before build |
| `PRD.md` | §9: replace the `budget_periods` row with the new shape and its rule. F7: Month view shows the budget line (Part 5). F17: a "Budget history" item (dated changes per space, last change ≤ cycle end, seeded from the epoch, removal = no budget) |
| `docs/adr/0007-budget-cycle-per-space.md` | Replace "Later parts" with a **Budget history (Part 5)** section: dated changes vs per-cycle rows (Q1 A), last-wins (Q2 A), epoch vs `created_at`, writer's timezone + never-before-latest, the guarded in-place rebuild, forward-only rollback |
| `apps/server/CLAUDE.md` | Gotchas: (1) "`householdsRepo.updateBudget` is the **only** budget writer and appends `budget_periods` in its transaction. Never `UPDATE households SET monthly_budget_cents` anywhere else (B-032 P5)". (2) "Migration order is by journal `when`, and all pending migrations run in one transaction. A custom guard migration (`drizzle-kit generate --custom`) can abort the whole batch" |
| `packages/core/CLAUDE.md` | Map row: `budget-history.ts`, budget change dating and cycle-vs-budget comparison, F17 |
| `CLAUDE.md` (root) | Layout: `budget-history.ts # F17 budget history: change dating, budget comparison` |
| `BACKLOG.md` | B-005 → Done (resolved by B-032 Part 5). Later: "Budget line in Recap and `/recap`", "Enter budgets for cycles before budget history existed", "Year budget totals" (and Stats navigation if Q-P5-1 = C) |

### Tests

| AC | Test file › test name |
|---|---|
| P5-AC1 | `packages/core/src/budget-history.test.ts` › `compareWithBudget › under, over, on and a $0 budget, never a negative difference` |
| P5-AC2 | `budget-history.test.ts` › `budgetChangeEffectiveFrom › the writer's today, never before the latest change` |
| P5-AC3 | `packages/db/src/budget-periods-migration.test.ts` › `the guard refuses a non-empty budget_periods and passes an empty one` |
| P5-AC4 | `budget-periods-migration.test.ts` › `the seed copies each space's budget from 1970-01-01, skips no-budget spaces, and is re-runnable` |
| P5-AC5 | `packages/db/src/repositories/households.test.ts` › `budget history (B-032 P5) › the table rejects negatives, duplicate dates and unknown spaces, and accepts null` |
| P5-AC6 | `households.test.ts` › `budget history (B-032 P5) › updateBudget records a change dated the given day` |
| P5-AC7 | `households.test.ts` › `budget history (B-032 P5) › an unchanged budget writes nothing` |
| P5-AC8 | `households.test.ts` › `budget history (B-032 P5) › several changes on one day keep only the last` |
| P5-AC9 | `households.test.ts` › `budget history (B-032 P5) › removing the budget records a change to no budget` |
| P5-AC10 | `households.test.ts` › `budget history (B-032 P5) › a change from a timezone behind is never dated before the latest change` |
| P5-AC11 | `households.test.ts` › `budget history (B-032 P5) › concurrent changes leave the latest change equal to the live budget` |
| P5-AC12 | `packages/db/src/repositories/budget-periods.test.ts` › `budgetInEffectOn › the latest change on or before the date, per space` |
| P5-AC13 | `apps/server/src/api/budget-history.test.ts` › `PATCH /api/settings › a change at 00:30 in Singapore is dated that Singapore day` |
| P5-AC14 | `apps/server/src/bot/commands/money.test.ts` › `/budget › records the change under today in the user's timezone` |
| P5-AC15 | `budget-history.test.ts` › `PATCH /api/settings › a shared space keeps one history, whichever member changes it` |
| P5-AC16 | `budget-history.test.ts` › `PATCH /api/settings › removing the budget hides the line for the current cycle` |
| P5-AC17 | `budget-history.test.ts` › `GET /api/stats › owner's example: 20 Jan – 19 Feb shows the $350 that applied, $40 under` |
| P5-AC18 | `budget-history.test.ts` › `GET /api/stats › a cycle with a mid-cycle change shows the last budget, $25 over` |
| P5-AC19 | `budget-history.test.ts` › `GET /api/stats › the current cycle shows the live budget and keeps every Part 2 field` |
| P5-AC20 | `budget-history.test.ts` › `GET /api/stats › after a start-day change each cycle still finds its own budget` |
| P5-AC21 | `budget-history.test.ts` › `GET /api/stats › a change on a cycle boundary in February and leap February` |
| P5-AC22 | `budget-history.test.ts` › `GET /api/stats › cycles ending after a removal show no budget` |
| P5-AC23 | `budget-history.test.ts` › `GET /api/stats › the seeded budget applies from the beginning` |
| P5-AC24 | `budget-history.test.ts` › `GET /api/stats › a $0 budget is over or on, never hidden` |
| P5-AC25 | `budget-history.test.ts` › `GET /api/stats › day and year views have no budget field` |
| P5-AC26 | `budget-history.test.ts` › `GET /api/stats › rejects unauthenticated; a stranger never sees another space's budget` |
| P5-AC27 | `budget-history.test.ts` › `statsResponseSchema › parses with and without budget, rejects an unknown status` |
| P5-AC28 | Screenshot check (Q8 A, no Mini App harness until B-016): Stats Month under/over/on/none/old-server, Day and Year, start day 20 and 1, light + dark, 375px |
| P5-AC29 | `budget-history.test.ts` › `GET /api/stats › the line compares the budget with <budgeted spending \| total spending>` (name fixed once Q-P5-2 is answered) |
| P5-AC30 | Screenshot check, defined once Q-P5-1 is answered |

Test-writer notes: AC17–AC24 build history with `updateBudget(…,
BUDGET_HISTORY_EPOCH)` then later-dated calls; the epoch row stands in for
the migration's seed (which AC4 proves). Assert amounts as cents in the API,
and as `$` strings only in the screenshot check. Every new DB test uses its own
telegram ids and cleans up households before users (the `restrict` FK, see
`households.test.ts`).

### Risks & guardrails

| Guardrail | Risk | Mitigation |
|---|---|---|
| §1 Cost | None | No service, dependency or Render service |
| §2 Money | Wrong under/over; negative difference; float | Integer cents, `AmountCents`, `subtractCents`, no division; `differenceCents` ≥ 0 and validated (P5-AC1, P5-AC24). Safe-to-spend untouched |
| §3 Destructive migration | Dropping columns of a table with unknown data | Guard migration aborts the whole batch if any row exists (P5-AC3); backup step; separate owner approval; one transaction |
| §3 Generated migrations | Hand-written SQL | All four files made by drizzle-kit (two `--custom`); only the guard and seed bodies are hand-filled, verbatim from this plan, reviewed in the PR |
| §3 Backfill | Bulk insert | The seed is the owner-approved Q3 A; one statement, idempotent (`ON CONFLICT DO NOTHING`) (P5-AC4) |
| §3 Idempotency / multi-row writes | Redelivered `/budget`, repeated PATCH, concurrent members | `updateBudget` is one transaction: row lock → compare → update + upsert history; unchanged = no write (P5-AC7, P5-AC11, P5-AC14) |
| §3 Correctness | History drifts from the live budget | Single writer (`updateBudget`); invariant tested (P5-AC10, P5-AC11); post-deploy read-only check; gotcha row in `apps/server/CLAUDE.md` |
| §4 Auth | Another space's budget leaks | Space only from `activeHouseholdId(user)`; repo filters by space (P5-AC12); stranger + 401 test (P5-AC26). No new input fields |
| §6 Privacy | Logging amounts | No new log lines |
| §7 Runtime | Extra query on Stats | One index-backed `LIMIT 1` lookup in the existing `Promise.all`, month only; no extra sequential stage. Aggregation stays in SQL |
| §8 Frontend | Bundle, colours | One small component; tokens only; not red |
| §9 Time | Change dated in UTC; cross-timezone ordering | `todayFor(ctx, user)` (injected Clock); 00:30 SGT test (P5-AC13); never-before-latest (P5-AC2, P5-AC10); Feb/leap cycle boundaries (P5-AC21) |
| §10 Telegram | None | No new sends; `/budget` reply unchanged |
| §11 Scope | Recap line, year totals, pace on past cycles | Out of scope, parked in BACKLOG |
| Deploy | Old server writes during the window | Q-P5-4; post-deploy check |
| Tests not weakened | Existing tests edited | Only the mechanical 4th argument to `updateBudget` and the `vi.fn()` mock; listed in *Files* |

### PR split

Single PR, **F17** (closes B-005), on `feat/B-032-pay-cycle`, as three commits
in the order of *Rollback* (data + write path · Stats API · Mini App). It
contains the migration, so the PR body links the backup step and the owner's
migration approval line. Part 5 total: **30 ACs** (28 firm + P5-AC29/AC30
pending Q-P5-2 / Q-P5-1). B-032 total with Parts 1–4: 116.

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

### Part 5

*Reviewed 2026-11-01 against `feat/B-032-pay-cycle` @ 84d99f5, with the
installed `drizzle-orm@0.38.4` / `drizzle-kit@0.30.6` (lockfile). What I
checked and found to hold:*
- *One transaction: `pg-core/dialect.js` `migrate()` wraps the loop over every
  pending journal entry in a single `session.transaction(...)`. A `RAISE` in
  0006 rolls back 0007–0009 and their `__drizzle_migrations` rows.
  `scripts/migrate.ts` then sets exit code 1, and the `&&` chain in
  `render.yaml` fails the build before `db:seed` and before the new server
  starts.*
- *Generation without prompts: I ran the plan's two schema steps on a scratch
  copy of `packages/db` with stdin closed. Both generated without a prompt.
  The intermediate step emits exactly the drops listed in the plan (including
  `budget_cents DROP NOT NULL` and re-adding `budget_periods_budget_ck`). The
  end step emits only `ADD COLUMN` + FK + unique index. Each `when` was
  greater than 0005's.*
- *Old-server compatibility: nothing reads or writes `budget_periods`.
  Every production budget write goes through `householdsRepo.updateBudget`
  (`api/index.ts:176`, `bot/commands/money.ts:126`). The list of test callers
  in Files is complete.*
- *I recomputed every numeric AC by hand (P5-AC1, 2, 13, 17–24, 29), and all
  of them are correct. The invariant "latest change = live budget" holds under
  the never-before-latest rule.*

**Nothing here blocks approval of the Part 5 spec, plan or migration.** The
findings below are gaps to close in the plan, plus one new owner question
(P5-F2).

**P5-F1 — The "old server + migrated database" window can last much longer
than "a minute or two", and the suggested fix can cause a missed alert. Not
blocking. Should be fixed in the plan before approval.**
- *Scenario:* the migration commits, then `pnpm db:seed` fails or the new
  server fails its health check. Render keeps the **old** server running on
  the migrated database, maybe for days, until the next good deploy. Or,
  after a bad release, the owner presses Render's "Rollback" (the natural
  "revert first" move from WORKFLOW §6). Either way, every budget change in
  that time updates the live budget without a history row. Separately, the
  Q-P5-4 fix says "set it to *any other value* and back". If that other value
  is lower, the hourly tick can see 80%/100% crossed and record the
  `budget_alerts` key. The real alert for that cycle is then suppressed.
- *Detail:* "Never revert commit 1" covers git, but not Render's rollback
  button or a failed deploy. The migration runs in the build, so the window
  is "migrate → a healthy new server" however long that takes. The
  correction is also dated *today*, so cycles ending between the drift and
  the fix still show the old budget.
- *Options:* (a) Add to *Rollback* and *Deploy order*: "after any failed
  deploy or Render rollback, run the drift check again", and change the
  manual fix to "set a **higher** value, then back", or use the approved
  one-row insert dated on the drift day. *Pro:* a few lines of docs. *Con:*
  still relies on someone remembering. (b) Also make the Stats line read the
  live budget for the **current** cycle (see P5-F4). *Pro:* drift can never
  show in the current cycle. *Con:* past cycles can still drift. (c) Q-P5-4
  C (repair at boot). *Con:* as the spec says, an automatic data repair.
  I'd pick (a).

**P5-F2 — Seeding "from 1970" plus unbounded backward navigation shows a
verdict for cycles before you used the app. Not blocking. New owner
question.**
- *Scenario:* in History's Cycle view (or Stats, if Q-P5-1 = A) you tap ‹ a
  few too many times and land on 20 Jan – 19 Feb **2024**, two years before
  Spendlygo existed. It says `Budget $500.00 · $500.00 under`. The same
  happens for a shared space created last month: all its earlier cycles get
  the line.
- *Detail:* `CycleStepper` only has `canGoNext`, so there is no lower bound
  (`features/history/CycleStepper.tsx`). The epoch row matches every cycle
  ever. Q3 A ("from the beginning") was agreed for the owner's real past
  cycles. The recap doesn't show the owner was told it also covers empty,
  pre-app cycles. PRD F7.4 asks for first-class empty states, not a
  confident verdict on nothing.
- *Options:* (a) Hide the line when the cycle has no transactions
  (`count = 0`, already in the stats response). *Pro:* one condition, no
  data change. *Con:* a real "spent nothing, $500 under" cycle also loses
  its line. That's rare, and arguably fine. (b) Stop the stepper at the
  space's earliest transaction. *Pro:* fixes navigation for every view.
  *Con:* a new query, and more Mini App work. (c) Accept it. *Pro:* zero
  work. *Con:* the screen shows something that isn't true.
  Recommendation: (a). **Ask the owner** alongside Q-P5-1.

**P5-F3 — P5-AC3 and P5-AC11 claim more than their tests can prove. Not
blocking.**
- *P5-AC3:* the test runs the guard SQL on its own. It can't show that "the
  whole migration batch rolls back", because that's drizzle's behaviour, and
  CI only ever migrates an *empty* database, where the guard passes
  trivially. The real path (a populated database at 0005 → 0009) is first
  exercised in production. *Options:* (a) Add one DB-backed test that
  creates a scratch database, migrates it to 0005 (temporary journal), and
  inserts a user, a household with a budget and one old-shape
  `budget_periods` row. `migrate()` must throw, `user_id` must still exist
  and `__drizzle_migrations` must be unchanged. Then delete the row, migrate
  again, and assert the seeded epoch row. *Pro:* proves the safety claim and
  rehearses the real upgrade. *Con:* about 60 lines, and it needs `CREATE
  DATABASE` rights in CI (Postgres 16 service container: yes). (b) Reword
  P5-AC3's *Then* to "raises an exception…", and cite the drizzle source
  check (this review) in the PR. *Pro:* honest, and free. *Con:* no
  rehearsal.
- *P5-AC11:* `Promise.all` doesn't force an interleaving. The "identical
  pair adds one row" result also holds **without** the row lock, because the
  unique index merges them. So the test passes whether or not `.for('update')`
  is there. The lock matters in one case: B's no-op check reads a stale value
  while A is mid-transaction, and B's change is silently lost (A
  35 000→50 000, B →35 000 sees 35 000 and skips). *Options:* make the test
  deterministic: open a transaction on a second connection, hold
  `SELECT … FOR UPDATE` on the space, start `updateBudget`, assert it hasn't
  resolved, change the value, release, and assert it wrote. Or reword the
  AC to what it really proves.
- *Nit:* `FOR UPDATE` also blocks the `FOR KEY SHARE` lock that every
  transaction insert takes on its space (the FK check), so a capture waits a
  few milliseconds behind a budget change. `.for('no key update')` gives the
  same protection without that. It's harmless either way.

**P5-F4 — The current cycle's line can disagree with Today across timezones.
Not blocking.**
- *Scenario:* a shared space on start day 1, you're in London, and your
  partner in Singapore changes the budget to $600 at 01:00 on 1 Nov in
  Singapore (still 31 Oct for you). Today shows $600 for your October. Stats
  › Month for October (your current cycle) shows `Budget $500.00`, because
  the change is dated 1 Nov, after October ends.
- *Detail:* P5-AC19 ("the current cycle shows the live budget") only holds
  when everyone shares a timezone. The spec accepts this skew for *past*
  cycles (Edge cases, Time), but not for the current one.
- *Options:* (a) For the cycle containing the viewer's today, use
  `households.monthly_budget_cents`, and use history only for cycles that
  have ended. *Pro:* the current line always matches Today, and deploy-window
  drift (P5-F1) can never show there. *Con:* two sources, one more branch,
  and one more AC. (b) Accept it, and add it to the Edge cases row. *Pro:*
  no code. I'd pick (a), because it's cheap.

**P5-F5 — The backup step is hard for a non-technical owner, and part of it
may not work on the free tier. Not blocking.**
- *Detail:* on Supabase's free plan, the **direct** connection is IPv6-only
  (IPv4 is a paid add-on), so step 2 needs the **session pooler** string,
  not "session-mode or direct". `pg_dump` must also be installed locally at
  version ≥ the server's. What the migration can actually affect is small:
  the guard proves `budget_periods` is empty, and `households` is only read
  (plus a short FK-creation lock). The step-1 CSV is already a complete copy
  of what the seed reads. *Options:* (a) Make the step-1 CSV export (all
  columns of `households`, plus the `count(*) = 0` result) **the** backup,
  and keep `pg_dump` as optional. Still meets GUARDRAILS §3's "explicit
  backup step". (b) Keep `pg_dump`, but give exact steps (installing it,
  where to find the session pooler string). Either way, say the file holds
  personal financial data: keep it off cloud sync and delete it after a
  week.

**P5-F6 — Smaller points. Not blocking.**
- *B-029 migrations:* that branch has its own `0005_classy_absorbing_man`
  and `0006_unique_dexter_bennett`, with journal `when` 1793442114195 and
  1793442831235. Both are **earlier** than main's 0005 (1793464731783). If
  B-029 is ever merged, drizzle's migrator compares only against the latest
  applied `created_at`, so it would **silently skip** both, and the server
  would query tables that don't exist. Part 5 makes this worse (a second
  `0006_*` and four more entries). Not Part 5's to fix, but add it to the
  B-029 note in BACKLOG.
- *Precedent claim:* the plan says the custom files follow "0004's data
  steps". In fact 0004 is one file with schema DDL and hand-added `INSERT`s,
  and its `when` (1788169200000, a round 09:40:00.000) looks hand-set. That's
  fine, but don't cite it as the `--custom` precedent.
- *Command form:* for 0007/0008, use the same form as the custom files,
  `pnpm --filter @spendlygo/db exec drizzle-kit generate --name=…`. Whether
  the extra `--` in `pnpm db:generate -- --name=…` reaches drizzle-kit
  unchanged is unverified, and a wrong name breaks the file names in *Files*.
- *Q-P5-2:* `budgetedOutCents` reads each category's **current**
  `excludeFromBudget` flag. Flipping a category later rewrites every past
  verdict, even though the budget side is now historical. The same is true
  of Today, so it's fine to accept. Mention it in the Q-P5-2 *Con*.
- *Account deletion / leaving / export:* history now cascades from
  `households` (it used to cascade from `users`) and has no `set_by`, so
  B-002 has nothing personal to strip from a shared space. Leaving a space
  writes nothing. The F8 export doesn't need history. No gaps here.
- *Q-P5-1, Q-P5-3 and Q-P5-4:* the recommendations are sound, with the
  caveats in P5-F2 (a lower bound for A), P5-F4 (B's "left" wording relies
  on knowing which cycle is current, and (a) there gives the same signal)
  and P5-F1 (the fix procedure).

---

## Test report (Stages 3–4)

| AC | Test file › test name | Before build | After build |
|---|---|---|---|
| P1-AC1 | `packages/core/src/cycle.test.ts` › `start day 1 is exactly the calendar month for every date 2024–2028` | ❌ failing (expected) (module missing) | ✅ |
| P1-AC2 | `packages/core/src/cycle.test.ts` › `day 20: 31 Oct, first day and last day are in 20 Oct – 19 Nov; 19 Oct is in the previous cycle` | ❌ failing (expected) | ✅ |
| P1-AC3 | `packages/core/src/cycle.test.ts` › `days 29–31 clamp to 28 Feb in a common year` | ❌ failing (expected) | ✅ |
| P1-AC4 | `packages/core/src/cycle.test.ts` › `days 29–31 and 20 in leap February 2028` | ❌ failing (expected) | ✅ |
| P1-AC5 | `packages/core/src/cycle.test.ts` › `day 31 starts on the 30th in 30-day months` | ❌ failing (expected) | ✅ |
| P1-AC6 | `packages/core/src/cycle.test.ts` › `a day-20 cycle spans the new year` | ❌ failing (expected) | ✅ |
| P1-AC7 | `packages/core/src/cycle.test.ts` › `cycles tile with no gaps or overlaps for every start day 1–31` | ❌ failing (expected) | ✅ |
| P1-AC8 | `packages/core/src/cycle.test.ts` › `rejects a start day outside 1–31 or not an integer` | ❌ failing (expected) | ✅ |
| P1-AC9 | `packages/core/src/cycle.test.ts` › `formats a cycle as "20 Oct – 19 Nov", with no year` | ❌ failing (expected) | ✅ |
| P1-AC10 | `packages/core/src/cycle.test.ts` › `GUARDRAILS §9: 00:30 on the start day belongs to the new cycle` | ❌ failing (expected) | ✅ |
| P1-AC11 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › first day of a cycle splits the budget across the whole cycle` | ❌ failing (expected) | ✅ |
| P1-AC12 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › last day of a cycle gets the whole remainder` | ❌ failing (expected) | ✅ |
| P1-AC13 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › a calendar-month cycle gives exactly the old result` | ✅ passes before build (regression guard) | ✅ |
| P1-AC14 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › Σ daily allowance ≤ budget over every cycle shape` | ❌ failing (expected) (cycle.ts missing) | ✅ |
| P1-AC15 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › zero budget and overspend inside a cycle` | ✅ passes before build (regression guard: `cycle` is ignored, and today 2026-11-01 is a calendar month the old path handles identically) | ✅ |
| P1-AC16 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17) › rejects a today outside the cycle` | ❌ failing (expected) | ✅ |
| P1-AC17 | `packages/db/src/repositories/households.test.ts` › `cycle start day › defaults to 1 and the CHECK rejects 0 and 32` | ❌ failing (expected) (column missing) | ✅ |
| P1-AC28 | `packages/db/src/repositories/households.test.ts` › `cycle start day › updateCycleStartDay reports whether it changed anything` | ❌ failing (expected) (function missing) | ✅ |
| P1-AC18 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › owner's example: day 20 counts from 20 Oct` | ❌ failing (expected) | ✅ |
| P1-AC19 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › day 1 is the calendar month, unchanged` | ❌ failing (expected) (the numbers already match; fails on the new `cycle` field) | ✅ |
| P1-AC20 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › a 00:30 entry on the start day is in the new cycle` | ❌ failing (expected) | ✅ |
| P1-AC21 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › a shared space's members share its cycle; switching spaces switches cycle` | ❌ failing (expected) | ✅ |
| P1-AC22 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/today › rejects unauthenticated, and a stranger never gets another space's cycle` | ❌ failing (expected) | ✅ |
| P1-AC23 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/me › returns the current cycle` (plus an unauthenticated 401 case that passes today) | ❌ failing (expected) | ✅ |
| P1-AC24 | `apps/server/src/bot/commands/money.test.ts` › `/today text › names the cycle range for day 20 and is unchanged for day 1` | ❌ failing (expected) (`buildTodayText` missing) | ✅ |
| P1-AC25 | `apps/server/src/bot/capture.test.ts` › `the confirmation card with a pay cycle (F17) › says "this cycle" when over budget with a non-calendar cycle` | ❌ failing (expected) (its day-1 assertions already hold) | ✅ |
| P1-AC26 | Screenshot check (Q8 A), no automated test | n/a | ⏭ not screenshotted (see Build notes) |
| P1-AC27 | `apps/server/src/api/pay-cycle.test.ts` › `PATCH /api/settings › an unknown key is a 400 and changes nothing (strict schema)` | ❌ failing (expected) (returns 200 today) | ✅ |
| P2-AC1 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats › month view is the day-20 cycle with 31 day buckets` | ❌ failing (expected) (still the calendar month) |  ✅ |
| P2-AC2 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats › day 1 month view is unchanged` | ✅ passes before build (regression guard) |  ✅ |
| P2-AC3 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats › anchors either side of a cycle step exactly one cycle, re-grouped by the current start day` | ❌ failing (expected) |  ✅ |
| P2-AC4 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats › rejects unauthenticated and a bad anchor; a stranger sees only their own month` | ✅ passes before build (regression guard) (401, 400 and isolation already hold) |  ✅ |
| P2-AC5 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats › the year view stays the calendar year with a day-20 cycle` | ✅ passes before build (regression guard) |  ✅ |
| P2-AC6 | `apps/server/src/api/recap.test.ts` › `buildRecap with a pay cycle (F17) › a month recap follows the cycle and stops at today` | ❌ failing (expected) |  ✅ |
| P2-AC7 | `apps/server/src/api/recap.test.ts` › `buildRecap with a pay cycle (F17) › a year recap stays the calendar year with a day-20 cycle` | ✅ passes before build (regression guard) |  ✅ |
| P2-AC8 | `apps/server/src/bot/commands/recap.test.ts` › `recapFooter › says "this cycle" only when the start day isn't 1` | ❌ failing (expected) (`recapFooter` missing) |  ✅ |
| P2-AC9 | `apps/server/src/tasks/digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 20 fires on the 19th, including across the new year` | ❌ failing (expected) |  ✅ |
| P2-AC10 | `apps/server/src/tasks/digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 31 fires on 27 Feb (common) and 28 Feb (leap)` | ❌ failing (expected) |  ✅ |
| P2-AC11 | `apps/server/src/tasks/digest-periods.test.ts` › `isMonthlyDigestDay with a cycle › day 1 matches the calendar month end (the existing no-argument tests are untouched)` | ✅ passes before build (regression guard) |  ✅ |
| P2-AC12 | `apps/server/src/tasks/digest.test.ts` › `the digest family › buildMonthlyDigest › names the cycle range and totals only the cycle` | ❌ failing (expected) |  ✅ |
| P2-AC13 | `apps/server/src/tasks/digest.test.ts` › `the digest family › sendDueDigests › sends the monthly digest on the cycle's last day, not the calendar month end` | ❌ failing (expected) |  ✅ |
| P2-AC14 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › spend before the cycle start does not count` | ✅ passes before build (regression guard) (Part 1 already counts only the cycle's spend) |  ✅ |
| P2-AC15 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › a double-fired tick sends the 80% alert once per cycle` | ✅ passes before build (regression guard) (the alert key is still wrong, but one message is sent) |  ✅ |
| P2-AC16 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › thresholds re-arm in the next cycle` | ❌ failing (expected) (key is October, not the month the cycle ends in) |  ✅ |
| P2-AC17 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › the 100% text names the cycle range` | ❌ failing (expected) |  ✅ |
| P2-AC18 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › a day-1 row written before B-032 still suppresses the repeat` | ✅ passes before build (regression guard) |  ✅ |
| P2-AC19 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › switching 1 → 20 after an October alert still alerts in the new cycle` | ❌ failing (expected) |  ✅ |
| P2-AC20 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › documented limitation: switching 20 → 1 on 25 Oct skips October's 80% alert once` | ✅ passes before build (regression guard) (the limitation coincides with today's calendar-month key) |  ✅ |
| P2-AC21 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17) › flipping through every start day on one date never sends a threshold twice` | ❌ failing (expected) (1 message today, expected 2) |  ✅ |
| P2-AC22 | Screenshot check (Q8 A), no automated test: History Cycle chip and arrows, day 20 and day 1 | n/a | ✅ real-stack screenshots 2026-11-01: day 20 "Cycle" chip, `20 Oct – 19 Nov`, Next disabled on the current cycle, Previous → `20 Sep – 19 Oct` (18 Oct shoes, 7 Oct grab); day 1 "Month" + "November 2026" picker unchanged |
| P2-AC23 | Screenshot check (Q8 A), no automated test: Stats month tab and recap card, day 20 and day 1 | n/a | ✅ real-stack screenshots 2026-11-01: Stats month heading `20 Oct – 19 Nov`, $138.50 vs $173.00 → "20% less", bars 20…19; recap tab "This cycle" (day 20) / "This month" (day 1) |
| (helper) | `packages/core/src/cycle.test.ts` › `cycleAlertKey (B-032 Part 2, Q2 A)` (2 tests: month the cycle ends in; 36 distinct keys per start day) | ❌ failing (expected) (`cycleAlertKey` missing) |  ✅ |
| P3-AC1 | `apps/server/src/api/export-range.test.ts` › `parseExportRange › no argument is still everything, named spendlygo-all-time.csv` | ❌ failing (expected) (no `filename` yet) |  ✅ |
| P3-AC2 | `apps/server/src/api/export-range.test.ts` › `"cycle" is this cycle, named with exact dates` | ❌ failing (expected) |  ✅ |
| P3-AC3 | `apps/server/src/api/export-range.test.ts` › `"last cycle" in any spacing or case is the previous cycle` | ❌ failing (expected) |  ✅ |
| P3-AC4 | `apps/server/src/api/export-range.test.ts` › `day 1: this and last cycle are labelled with month names` | ❌ failing (expected) |  ✅ |
| P3-AC5 | `apps/server/src/api/export-range.test.ts` › `YYYY-MM is always the calendar month, whatever the start day` | ❌ failing (expected) (no `filename`) |  ✅ |
| P3-AC6 | `apps/server/src/api/export-range.test.ts` › `YYYY is the calendar year and YYYY-MM-DD a single day, named with exact dates` | ❌ failing (expected) |  ✅ |
| P3-AC7 | `apps/server/src/api/export-range.test.ts` › `a custom from..to range is inclusive; reversed or malformed is null` | ❌ failing (expected) |  ✅ |
| P3-AC8 | `apps/server/src/api/export-range.test.ts` › `ranges spanning New Year carry both years in the label` | ❌ failing (expected) |  ✅ |
| P3-AC9 | `apps/server/src/api/export.test.ts` › `GET /api/export with pay cycles (F17) › no range still exports everything, whatever the start day` | ✅ passes before build (regression guard) |  ✅ |
| P3-AC10 | `apps/server/src/api/export.test.ts` › `GET /api/export with pay cycles (F17) › cycle and last-cycle follow the start day and name the file by dates` | ❌ failing (expected) (400) |  ✅ |
| P3-AC11 | `apps/server/src/api/export.test.ts` › `GET /api/export with pay cycles (F17) › a custom from..to range is inclusive; reversed is a 400` | ❌ failing (expected) (400 on valid range) |  ✅ |
| P3-AC12 | existing `rejects an unauthenticated request` and `never includes another user's transactions` (unchanged, pass), plus `apps/server/src/api/export.test.ts` › `GET /api/export with pay cycles (F17) › range=cycle never includes another user's transactions` | ❌ failing (expected) |  ✅ |
| P3-AC13 | `apps/server/src/bot/commands/export.test.ts` › `exportUsageText › the usage hint lists everything, cycle, last cycle, year and month` (plus DB: `an unknown argument replies with the usage hint for the space cycle`) | ❌ failing (expected) (`exportUsageText` missing) |  ✅ |
| P3-AC14 | `apps/server/src/bot/commands/export.test.ts` › `/export (DB) › an empty last cycle says nothing was logged for its range` | ❌ failing (expected) |  ✅ |
| P3-AC15 | `apps/server/src/bot/commands/export.test.ts` › `/export (DB) › /export cycle sends one file named by dates with a range caption` | ❌ failing (expected) |  ✅ |
| P3-AC16 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/me › also returns the previous cycle` | ❌ failing (expected) |  ✅ |
| P3-AC17 | Screenshot check (Q8 A), no automated test: the export sheet, day 20 and day 1 | n/a | ✅ real-stack check 2026-11-01: 5 options in order, Everything preselected, captions `20 Oct – 19 Nov` / `20 Sep – 19 Oct` (day 1: "This month · November", "Last month · October"), custom Download disabled until from ≤ to, real downloads named `spendlygo_2026-10-20_to_2026-11-19.csv` (5 rows), `spendlygo_2026-09-20_to_2026-10-19.csv` (2), `spendlygo-all-time.csv` (7), `spendlygo_2026-10-05_to_2026-10-24.csv` (4); light and dark, 375px |
| (helper) | `packages/core/src/cycle.test.ts` › `formatDateRangeWithYears (B-032 Part 3)` | ❌ failing (expected) (export missing) |  ✅ |
| (guard) | `apps/server/src/bot/commands/export.test.ts` › `/export (DB) › /export with no argument still sends everything, as today` | ✅ passes before build (regression guard) |  ✅ |
| (guard) | `export-range.test.ts` › `anything else is null` | ✅ passes before build (regression guard) |  ✅ |
| P4-AC1 | `apps/server/src/api/pay-cycle.test.ts` › `PATCH /api/settings › owner's example: setting day 20 on 31 Oct moves Today to 20 Oct – 19 Nov` | ✅ passes after build (was ❌ failing (expected)) (400, `cycleStartDay` not in the schema) | |
| P4-AC2 | `pay-cycle.test.ts` › `PATCH /api/settings › rejects 0, 32, 1.5 and "20" without changing anything` | ✅ passes before build (regression guard: strict schema already 400s the unknown key) | |
| P4-AC3 | `pay-cycle.test.ts` › `PATCH /api/settings › either member of a shared space can change it` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC4 | `pay-cycle.test.ts` › `PATCH /api/settings › changes only the active space` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC5 | `pay-cycle.test.ts` › `PATCH /api/settings › a householdId in the body is a 400; unauthenticated is a 401` | ✅ passes before build (regression guard: strict schema, auth already hold) | |
| P4-AC6 | `apps/server/src/bot/commands/settings.test.ts` › `/settings pay cycle (B-032 Part 4) › shows the cycle start day and range` | ✅ passes after build (was ❌ failing (expected)) (no cycle line) | |
| P4-AC7 | `settings.test.ts` › `/settings pay cycle (B-032 Part 4) › day picker lists 1–31, 7 per row, marks the current day, carries the space id, and stays within 64 bytes` | ✅ passes after build (was ❌ failing (expected)) (no button, `cycleDayPickerKeyboard` missing) | |
| P4-AC8 | `settings.test.ts` › `/settings callbacks (DB) › pay cycle (B-032 Part 4) › set:c:20 updates the active space and a replay is a no-op` | ✅ passes after build (was ❌ failing (expected)) (old format not parsed, day stays 1) | |
| P4-AC9 | `settings.test.ts` › `/settings pay cycle (B-032 Part 4) › parseSettingsCallback rejects malformed cycle data, including the old id-less form` | ✅ passes after build (was ❌ failing (expected)) (the valid forms return null today; the malformed ones already do) | |
| P4-AC10 | `settings.test.ts` › `/settings callbacks (DB) › pay cycle (B-032 Part 4) › a picker for another space is answered "out of date" and writes nothing` | ✅ passes before build (regression guard: unknown data is already answered "out of date"; it must still pass once the handler parses the data and compares the space id) | |
| P4-AC11 | `pay-cycle.test.ts` › `PATCH /api/settings › a partner's change sends one message to each other member, and none when nothing changed` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC12 | `pay-cycle.test.ts` › `PATCH /api/settings › a personal space change messages nobody` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC6 (review finding 1) | `settings.test.ts` › `/settings callbacks (DB) › pay cycle (B-032 Part 4) › a toggle keeps the cycle line in the edited message` | ✅ passing | |
| P4-AC13 | `settings.test.ts` › `/settings callbacks (DB) › pay cycle (B-032 Part 4) › a redelivered set:c in a shared space messages the partner once` | ✅ passes after build (was ❌ failing (expected)) (day stays 1) | |
| P4-AC14 | `pay-cycle.test.ts` › `PATCH /api/settings › a blocked partner never fails the change` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC15 | `pay-cycle.test.ts` › `PATCH /api/settings › a 429 is retried once after retry_after` | ✅ passes after build (was ❌ failing (expected)) (400) | |
| P4-AC16 | Screenshot check (Q8 A), no automated test: Settings budget card, day 20 / day 30 / day 1, personal and shared | n/a | built; screenshot / dev-bot check still to do (orchestrator) |
| P4-AC17 | Screenshot check (Q8 A), no automated test: daily mode preview `= $1,550/month (31 days this cycle)`, day 20 and day 1 | n/a | built; screenshot / dev-bot check still to do (orchestrator) |
| P4-AC18 | Screenshot + dev-bot check (Q8 A): picking a day refreshes screens; a 400 reverts the select without "Saved" | n/a | built; screenshot / dev-bot check still to do (orchestrator) |
| (helper) | `packages/core/src/cycle.test.ts` › `ordinalDay (B-032 Part 4)` (13 cases: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 20th, 21st, 22nd, 23rd, 30th, 31st) | ✅ passes after build (was ❌ failing (expected)) (`ordinalDay` missing) | |
| (helper) | `apps/server/src/telegram/send-with-retry.test.ts` (5 tests: sends once; 429 ≤ 3 retried once with `sleep(retry_after*1000)`; 429 > 3 not retried; retry that fails again is rethrown; 403 not retried) | ✅ passes after build (was ❌ failing (expected)) (file does not load: `./send-with-retry.js` missing) | |

**Checks (Part 4, before build):** `TEST_DATABASE_URL=… pnpm test`: 573 tests counted, 548 passed, 25 failed, plus `send-with-retry.test.ts` which fails to load (its 5 tests are not counted). The 25 failures are 13 `ordinalDay`, 7 API (`pay-cycle.test.ts`), 3 pure `/settings`, 2 DB `/settings`; each fails for the missing feature. 33 new tests in all (28 counted + 5 uncounted); 3 pass as regression guards (P4-AC2, AC5, AC10). All 545 pre-existing tests pass. `fakeBotCtx` in `settings.test.ts` gained `api: { sendMessage: vi.fn() }`; `auth()`, `makeApp()` and `personalSpaceFor()` in `pay-cycle.test.ts` gained optional parameters (first name, bot, sleep). Typecheck fails only for the missing exports (`ordinalDay`; the server's missing `cycleDayPickerKeyboard`, `./send-with-retry.js` and `CreateAppOptions.sleep` follow). **Builder note:** the existing `settings.test.ts` test `each toggle button carries the opposite of the current state` asserts the exact list `['set:d:0','set:hp','set:n:1','set:a:0']`; adding the `Change cycle start day` button will break it, and it must then be updated (the plan only allows updating the 64-byte test). Not changed by the test-writer.

**Checks (Part 4, after build):** typecheck ✓ lint ✓ test 578 passed / 0 failed / 0 skipped; `pnpm ci:local` passed (bundle 87.7 KB gzipped, 44% of the 200 KB budget).

**Checks (Part 3, before build):** 544 tests: 527 passed, 17 failed (14 `parseExportRange`/bot/API/`/me` plus the core helper; all fail for the missing feature). The 3 passing new tests are the guards marked above. No existing test asserts the old `spendlygo-2026-10.csv` name, so none conflicts with the owner's file-name decision.

**Checks (Part 3, after build):** typecheck ✓ (after the test-helper type fix) lint ✓ test 544 passed / 0 failed; ci:local passed.

**Checks (Part 2, after build):** typecheck ✓ lint ✓ test 524 passed / 0 failed (`pnpm ci:local` passed, 524 tests).

**Checks (Part 2, before build):** 524 tests: 510 passed, 14 failed. All 14 failures are new Part 2 tests, each failing for the right reason (missing function or behaviour); the 9 other new tests are day-1 or already-true regression guards. All 501 pre-existing tests pass. Amounts asserted in the app's `$` form.

**Checks (Part 1, before build):** test 472 passed, 15 failed (+ `cycle.test.ts` fails to load: `./cycle.js` missing). All 15 failures and the load failure are new Part 1 tests; every pre-existing test passes.
**Checks (Part 1, after build):** typecheck ✓ lint ✓ test all passing, 0 failed / 0 skipped (`pnpm ci:local` passed; P1-AC24 expectation fixed to the app's `$` format).
**Screenshots:** not taken (see Build notes).

---

## Build notes (Stage 4)

- **Deviations from plan:** none in code. **Blocker, not edited:** `money.test.ts` (P1-AC24) asserts `S$50.00 of S$1,500.00` for user `{currency:'SGD', locale:'en-SG'}`, but `formatCents` (unchanged) renders `$50.00` for `en-SG` on Node 22 (`en-US` would give `SGD 50.00`; only the `S$` in `money.test.ts` is wrong; `core/money.test.ts` `S$12.50` is parsing). `buildTodayText` produces `20 Oct – 19 Nov: $50.00 of $1,500.00` and day 1 `This month: $50.00 …` as intended. Planner/test-writer must fix the expected string (e.g. `$50.00 of $1,500.00`) or the user fixture locale.
- **Screenshots (P1-AC26):** taken by the main session on 2026-11-01 (SGT), after the review, against the **real stack**: the branch's server on the local test Postgres, the built Mini App via `vite preview`, and a properly signed `initData` from a throwaway local bot token (never sent to Telegram). Data: seeded expenses plus a $3,000 salary on 21 Oct. 4 scenarios × light/dark at 375px:
  - day 1, $350: "THIS MONTH · $12.50 of $350.00 · 30 days left"
  - day 20, $350: "20 OCT – 19 NOV · $138.50 of $350.00 · 19 days left · $3,000.00 received this cycle"
  - day 20, $15,000: label still on **one line** (card head 23px tall in every case, so finding 3's wrap risk didn't happen)
  - day 20, no budget: the "No budget yet" card
  API figures were checked by hand (e.g. ($350 − $138.50) ÷ 19 = $11.13; the ring shows what's left today after today's $12.50). The PNGs were shared with the owner in the session; they're not committed to the repo.
- **Part 2 build:** Deviations: `currentCycle` was removed from `service.ts` in the Part 1 tidy-up, so I re-added it (plan listed it as existing; used by `buildMonthlyDigest`). `/stats` anchor check uses `isoDateSchema` + `parseIsoDate` in a small `parseAnchor` helper in `api/index.ts`. The `/recap` bot footer and Mini App wire `cycleStartDay` from `activeSpaceSettings` / `today.cycle`. History `Cycle` stepper in `features/history/` (new `features/` dir). While the cycle query is pending, `historyRange` is `{}` (loads the unfiltered list briefly). No migration, dependency or API shape added. Docs updated: PRD F7/F9.5/F13.2-3 (limitation)/F16.1/F17.5, `apps/server/CLAUDE.md` gotcha, ADR 0007 (alert key + History sections), schema/alerts-repo doc comments.
- **Part 2 screenshots to take (P2-AC22/23), start day 20 and 1, light + dark, 375px:** History > Cycle chip (label "Cycle", `20 Oct – 19 Nov` stepper, 20-31 Oct rows, next arrow disabled on the current cycle, previous goes to `20 Sep – 19 Oct`); day 1 History > "Month" picker unchanged; Stats month tab heading (`20 Oct – 19 Nov` vs `October 2026`); Recap sheet first tab ("This cycle" vs "This month").
- **Part 2 screenshots taken** by the main session on 2026-11-01 (SGT): real stack (the branch server on the local test Postgres, the built Mini App, a signed `initData` from a throwaway local token), light and dark at 375px. The `/api/stats` month figures were checked by hand: day 20 this cycle $138.50, previous cycle (20 Sep – 19 Oct) $173.00; day 1 November $12.50, October $299.00. All as expected. The PNGs were shared with the owner in the session; they're not committed.
- **Review finding 1 verified** by the main session on the real stack (Playwright intercepting `/api/stats?period=month`), start day 20, History › Cycle. **Stalled:** skeleton only, 0 rows (the "All" list had them). **500:** after the app's 2 retries (~3.3 s) "Couldn't load this cycle." plus "Try again", 0 rows, light and dark. **Normal:** only this cycle's rows. **‹ onto a stalled anchor:** 0 rows until loaded, then exactly 20 Sep – 19 Oct (shoes, grab). Observations passed to the re-review: in the error state the ‹ button stays enabled with a blank label; the "Try again" chip may be low-contrast in dark mode (DESIGN §10).
- **Part 2 parked:** none.
- **Part 3 build:** `/api/*` CORS in `app.ts` now has `exposeHeaders: ['Content-Disposition']` so the Mini App reads the export file name (test `app.test.ts › CORS › exposes Content-Disposition…` now passes). Gotcha row added to `apps/server/CLAUDE.md`. Deviations: none. Parked: none.
- **Part 2 re-review fixes (R1, R2):** History's "Try again" now uses `primary primary--inline` (same as `App.tsx`, no `--text-subtle` on `--bg-secondary`); `CycleStepper` ‹ is `disabled={loading || label === undefined}`. No test edits (no Mini App harness until B-016).
- **Part 2 review fix (finding 1, 3):** History's Cycle chip no longer fetches or lists until the cycle bounds are known (`enabled` gated on `historyRange.from`; `App.tsx` passes `[]` + loading while waiting, so the cached All list never shows); if `/api/stats` fails, `HistoryScreen` shows "Couldn't load this cycle." with a Try again button (new optional `loadError`/`onRetry` props, `retry` from `useHistoryCycle`). Day 1 unchanged. Finding 3: "alerts keyed by user, not space" added to `apps/server/CLAUDE.md` and ADR 0007. Screenshots pending (main session).
- **Part 3 build:** Deviations: none from the plan. **(Resolved in 1c660a4: type-only test fix by test-writer)** Former blocker: `apps/server/src/bot/commands/export.test.ts` line ~109 calls `transactionsRepo.create` without `categoryId` and `note`, which `CreateTransactionInput` requires, so `tsc --noEmit` fails (TS2345) and `pnpm ci:local` stops at typecheck. Vitest passes (544). The fix is type-only: add `categoryId: null, note: null` to the `log()` helper. ADR 0007 had no Part 3 item, so unchanged. Docs: PRD F8.1/F8.4/§8, `/help` line.
- **Part 3 screenshots to take (P3-AC17), start day 20 and 1, light + dark, 375px:** Settings > Export CSV opens the sheet with Everything preselected; day 20: "This cycle 20 Oct – 19 Nov" and "Last cycle 20 Sep – 19 Oct"; day 1: "This month October" / "Last month September"; Pick a month shows a month input defaulting to this calendar month; Custom dates shows two date inputs and Download is disabled until both are set and from <= to; Download saves a file with the server's name (`spendlygo_2026-10-20_to_2026-11-19.csv`; Everything gives `spendlygo-all-time.csv`); the footnote under the button is unchanged.
- **Parked ideas:** none
- **Part 4 build (commits 0803a7f server, c3fe88e Mini App):** one deviation. `pay-cycle.test.ts` passes a bare `Bot` (plain `Context`) to `createApp`, which was typed `SpendlygoBot` (`Bot<BotContext>`) and failed typecheck on the test file. The builder first widened `createApp` to `SpendlygoBot | Bot` with a cast; the orchestrator reverted that and typed the test's bot as `Bot<BotContext>` instead (type-only test change, as `alerts.test.ts` does), so production types are unchanged. Other notes: `householdsRepo.updateCycleStartDay` already existed from Part 1, so no repo change; the PATCH response's `user.cycleStartDay` is the active space's saved value (always present). `CycleStartDayField` saves through `settings.mutateAsync` so it can reset on a rejection; its ordinal helper is duplicated from core because the Mini App can't import core. The existing toggle-list test had already been updated by the orchestrator to filter `set:cp:`. P4-AC16 to AC18 are built but their screenshot / dev-bot checks are not done. Parked: none.
- **Follow-up (review finding 1, perf):** the active space is loaded once per request and passed through (`computeSafeToSpend` takes optional `settings`); independent queries run in `Promise.all`. Sequential DB stages after auth: `/api/today` 3 to 2 (settings runs alongside list/recent/streak, then all totals in parallel; 1 is impossible while the cycle start depends on the space row), text and photo-OCR captures 2 to 1 (settings runs alongside the category lookup or the insert), `/api/me` reads the space 3 times to 2 (both reads in one parallel stage; `loadHouseholdView` reads it too). Behaviour identical; `ci:local` green, 501 tests. The now-unused `currentCycle` was removed in the re-review tidy-up.
- **Part 2 review fix (findings 2, 4):** one space read per request/digest; one `cycleLabel` helper in `service.ts` used by `/stats` and the recap (digest heading and `toApiCycle` keep their own month-name-only labels, a different rule). Sequential DB stages, before to after: `/api/stats` month 4 to 3 (space, then totals/categories/previous/series in parallel; was space, 3 parallel, series), day 3 to 1, year 3 to 1 (no space read); `/recap` 3 to 2 (space reads 2 to 1); monthly digest on its day 4 to 2 (space reads 3 to 1). Tests: 524 passed.

- **Part 3 fix (P3-AC17, sheet overlay):** the Export sheet inside Settings rendered clipped under the tab bar because an ancestor trapped `position: fixed`. The shared `components/Sheet.tsx` now renders via `createPortal(…, document.body)`; props, focus, scrim and CSS unchanged. Re-screenshot needed: Export sheet and one existing sheet (Recap or Capture).
- **Part 3 real-stack verification (main session, 2026-11-01).** It found two defects before review, both fixed test-first: (1) the Mini App couldn't read `Content-Disposition` cross-origin, so every Mini App download was named `spendlygo-export.csv` (pre-existing on main); fixed with CORS `exposeHeaders` (a97faa9 test, fa11ffe fix). (2) The export sheet rendered inside Settings, clipped under the tab bar and FAB, with Download unreachable; fixed by portalling the shared `Sheet` to `document.body` (b52837d). Re-verified: the sheet overlays the viewport with a scrim, Download is topmost at 375×812, and the Recap and Capture sheets are unchanged.
- **Part 3 review follow-ups verified on the real stack (main session, 2026-11-01), after 715defb.** With `/api/export` forced to 500, the toast "Couldn't export — try again" shows on top of the sheet (checked at 0.5 s; it lasts 2.6 s), the sheet stays open and "Last cycle" stays selected, and a retry downloads `spendlygo_2026-09-20_to_2026-10-19.csv` and closes the sheet. With the month field forced to a plain text box (as in Telegram macOS), `2026-1` shows "Use the format 2026-10" with Download disabled, and `2026-10` enables it. The bot's custom `from..to` ranges are kept and documented (owner decision).
---

## Review (Stage 5)

*Part 1 only. Reviewed 2026-10-31 by `reviewer` (Opus) against
`git diff 2582885..HEAD` (6bb8b53 tests, 080c074 build, af4fa5c test fix).*

**Verdict:** ready for owner (Part 1). No blocking findings.

**`pnpm ci:local` (real run, local Postgres):** passed. Typecheck ✓, lint +
prettier ✓, Render blueprint ✓, migrations applied ✓ ("Migrations up to date"),
seed ✓, **35 test files, 497 tests passed, 0 failed, 0 skipped** (DB-backed
suites ran), build ✓, Mini App bundle 86.1 KB gz (43% of budget).

**Independent checks (beyond the suite):**
- Cycle maths property run (tsx, scratch only): 31 start days × every date
  2023-12-01..2029-01-31 (58,559 cases). Every cycle contains its date and
  starts on the clamped start day, with 28 to 31 days. Σ `safeTodayCents` ≤
  budget for budgets {1, 7, 99, 3,001, 150,000, 1,234,567, 99,999,999} cents ×
  31 start days × every cycle in 2026–2028, and the allowance is never
  negative. No defect found.
- Start day 1 = today, surface by surface. `cycleContaining(d, 1)` equals
  `monthRange` (P1-AC1). `calculateSafeToSpend` is field-identical (P1-AC13).
  `/api/today` totals use `cycle.start..cycle.end` = `month.start..month.end`.
  `/api/today` and `/api/me` gain only an additive `cycle` field, and
  `serialiseSafeToSpend` copies named fields, so `cycle` doesn't leak into
  `safeToSpend`. The bot `/today`, `/budget` and capture/photo confirmations
  keep the exact old strings behind `startDay === 1`. The Today card renders
  the same text for day 1 or a missing `cycle`.
- Migration `0005_luxuriant_killraven.sql` is generated (drizzle name, CI
  "up to date"). It's additive: `ADD COLUMN cycle_start_day smallint DEFAULT 1
  NOT NULL` + `CHECK (BETWEEN 1 AND 31)`. The snapshot `prevId` = the 0004
  snapshot id, only `public.households` differs, and the journal `when`
  (2026-10-31) is later than 0004. Migrations run in the Render build before
  the new code serves (render.yaml). The old server selects named columns, and
  its inserts get the default. Safe while the old server is running.
- Strict `updateSettingsSchema`: every Mini App build in git history sends
  only `monthlyBudgetCents`, `digestEnabled`, `digestHour` or `alertsEnabled`.
  The bot's `parseSettingsCallback` builds known keys only, and there's no
  other caller. No existing client gets a new 400.
- P1-AC24 correction (`S$50.00` → `$50.00`) **is legitimate**: `formatCents`
  is unchanged and `Intl.NumberFormat('en-SG', {currency:'SGD'})` renders
  `$50.00` on Node 22. `core/money.test.ts:100` asserts `$1,234.56`. The
  `S$` in DESIGN.md §3 is a pre-existing doc/code mismatch for the owner to
  decide, outside B-032.

| # | Severity | file:line | Finding | Failure scenario |
|---|---|---|---|---|
| 1 | Low (non-blocking, §7) | `apps/server/src/api/index.ts:287`, `apps/server/src/api/service.ts:159` | `computeSafeToSpend` now reads the household first, then runs the totals (it needs the cycle), and `/api/today` awaits it before starting its other 4 queries. `/api/today` goes from about 1 to 3 sequential DB round trips, and every capture/confirmation from 1 to 2. `/api/me` also reads the same household twice (`effectiveBudgetCents` + `currentCycle`) | On the Supabase pooler, each round trip adds tens of ms to opening the Mini App and to every bot capture reply. It's slower, never wrong. Possible fix (later, or in Part 2): start today's transactions, recentDays and streak in parallel with `computeSafeToSpend`, and have `/me` call `activeSpaceSettings` once |
| 2 | Low (test strength) | `apps/server/src/bot/commands/money.test.ts:22-33` | P1-AC24 says the day-1 reply is "unchanged, byte for byte", but the test only `toContain`s one line. It doesn't cover the no-budget branch (`Spent this cycle`) or `/budget`'s `left this cycle`, and it hides type drift behind an unneeded `as any` | A later edit to another `/today` line, or to the no-budget copy, for day-1 users would pass the suite. I diffed the code by hand: the day-1 output is identical today |
| 3 | Low (unverified UI) | `apps/miniapp/src/screens/Today.tsx:97-99` | P1-AC26 has no screenshots. The change is copy only, and the day-1 path renders the same text. With day ≠ 1, the 11px uppercase label `20 OCT – 19 NOV` sits in a `flex; space-between` head next to the amount, with no `white-space: nowrap` | At 375px with a large budget (`$12,345.67 of $12,345.67`), the label can wrap onto two lines ("20 OCT –" / "19 NOV"). It's cosmetic and unreachable until Part 4 lets anyone set day ≠ 1. **Verification I'd want:** run `pnpm dev` against the dev DB, set a dev space to 20 with a one-row update in the dev DB only, and screenshot Today at 375px in light and dark, both with a small and a 5-digit budget, plus the no-budget card. Diff the day-1 screenshots against `main`. Can be done before Part 4 ships, not necessarily before this merge |
| 4 | Info (process) | `docs/adr/0007-budget-cycle-per-space.md`, `packages/db/migrations/0005_*` | **Numbering clash.** Unmerged `origin/claude/telegram-expense-tracker-06gr8u` has `docs/adr/0007-multi-currency-via-frankfurter.md` **and** its own `0005_classy_absorbing_man` + `0006_*` migrations on the 0004 snapshot chain. B-011 also plans an "ADR 0007" (BACKLOG.md:105) | If any of that branch is ever adopted, its ADR must be renumbered and its migrations regenerated on top of `0005_luxuriant_killraven`. Two 0005 entries in the journal would break `db:migrate`. B-029 already tracks the branch, so add these two points there. B-011 should take the next free ADR number |
| 5 | Info | `apps/server/src/tasks/alerts.ts:43`, `apps/server/src/tasks/digest.ts:54-55` | They now receive cycle-based `computeSafeToSpend` results, but the alert key/text and the monthly digest stay calendar-month until Part 2 | Unreachable in Part 1, because no path can set day ≠ 1. It matters only if Part 2 were reverted while a space is on day ≠ 1: alerts would then measure the cycle but key by calendar month. Covered by the plan's order (Part 2 before Part 4) |

**Acceptance criteria → tests (Part 1)**

| # | Proven by | Real proof? |
|---|---|---|
| P1-AC1–AC10 | `packages/core/src/cycle.test.ts` (10 tests) | Yes. Exhaustive day-1 sweep, exact clamping fixtures, tiling for 1–31, 00:30 SGT. AC7 doesn't check containment, but my property run covers it |
| P1-AC11–AC16 | `packages/core/src/safe-to-spend.test.ts` › `pay cycles (F17)` | Yes. AC13 compares the full result object for 4 months, every day. AC14 matches the spec. Existing tests unedited |
| P1-AC17, AC28 | `packages/db/src/repositories/households.test.ts` › `cycle start day` | Yes. Raw UPDATE hits the named CHECK. `updated_at` unchanged on the repeat. Unknown id throws |
| P1-AC18–AC23 | `apps/server/src/api/pay-cycle.test.ts` | Yes. Exact numbers from the spec, 00:30 SGT via a real POST without a date, shared space + switch, 401 + a stranger who would see 20 if leaked |
| P1-AC24 | `apps/server/src/bot/commands/money.test.ts` | Partly (finding 2) |
| P1-AC25 | `apps/server/src/bot/capture.test.ts` › `the confirmation card with a pay cycle (F17)` | Yes |
| P1-AC26 | Screenshot check | ✅ done after review: real stack, 4 scenarios × light/dark at 375px, no wrap (see Build notes) |
| P1-AC27 | `pay-cycle.test.ts` › `PATCH /api/settings › an unknown key is a 400…` | Yes. The budget is re-read and unchanged |

**Plan fidelity.** Every Part 1 file in the plan was touched as described,
and nothing outside the plan was built. The docs the plan named are updated:
PRD F6, F17 and §9; root `CLAUDE.md` layout; `packages/core/CLAUDE.md` map
and tests rule; the `apps/server/CLAUDE.md` gotcha; ADR 0007 (cycle per
space, clamped fixed day, default 1, re-grouped history, strict schema,
additive migration; alerts and `budget_periods` deferred to later parts, as
planned). BACKLOG already reads "Part 1 in progress".

**Guardrail self-check** (WORKFLOW §4)
- [x] **Cost:** no new service, dependency or Render service (§1)
- [x] **Money:** integer cents throughout, existing `divideCentsFloor`
  rounding, never negative. Σ ≤ budget proven by test and by property run (§2)
- [x] **Auth + cross-user test:** identity only from `requireInitData`. The
  cycle comes from `activeHouseholdId(user)`, never from the request. 401 and
  stranger tests on `/today` and `/me` (§4)
- [x] **Privacy:** no new logging (§6)
- [x] **Time:** every cycle is computed from `todayFor(ctx, user)` (user
  timezone, injected `Clock`). Core has no `Date.now()`. 00:30 tested at the
  core and API levels (§9)
- [x] Data (§3): the migration is additive and generated. The conditional
  `UPDATE … WHERE cycle_start_day <> day` makes repeats detectable.
  Telegram (§10): no new sends in Part 1

### Re-review (Part 1 follow-ups)

Scope: `ff941f7..HEAD` (8e466ff, bf61091, fa96631). `pnpm ci:local` with
local Postgres: **passed** (typecheck, lint, all tests, build, bundle 86.1 KB
gz, 43% of budget).

- **Finding 1 (perf), resolved.** bf61091 changes no behaviour: `/me`'s
  `settings.budgetCents` is exactly what `effectiveBudgetCents` returned, and
  its cycle is the same `cycleContaining(todayFor, startDay)` that
  `currentCycle` computed. `computeSafeToSpend` with `settings` passed runs the
  same totals as before. The edge still calls service, and service calls the
  repository. The stage counts are true: `/api/today` goes from 3 sequential stages to 2,
  and text and OCR captures from 2 post-insert stages to 1. The capture now reads settings
  before the insert instead of after it. That only matters if the budget or
  start day changes within the same millisecond, so it's harmless.
- **Nit A (not blocking).** The Build notes say "`/api/me` reads the space 2
  times to 1". That's wrong. It was 3 reads (`effectiveBudgetCents`, `currentCycle`, and
  `loadHouseholdView`'s `findById`, `index.ts:699`), and now it's 2. All of them
  run in one parallel stage, so latency is unchanged either way. Fix the wording.
- **Nit B (not blocking, remove now).** `currentCycle` (`service.ts:97`) has
  no callers left in `apps/` or `packages/` and no tests. It's a dead export.
  Lint and typecheck allow it because it's exported. It's 7 lines, so delete
  it instead of parking it.
- **Finding 2, resolved.** 8e466ff's expected day-1 strings match
  `origin/main`'s `handleToday` no-budget reply and `handleBudget`'s set reply
  ("That is $1,450.00 a day for the 1 day left this month."), line for line.
  The mocks stub only the DB and `computeSafeToSpend`. `buildTodayText` and the real
  `handleBudget` wording code still run against real `calculateSafeToSpend`
  output, so the test isn't trivial. The day-1 with-budget case still uses
  `toContain` and not an exact match. That's acceptable.
- **Nit C (doc).** 8e466ff/fa96631 put the "P1-AC24 tightened…" paragraph
  between the P1-AC24 and P1-AC25 rows of the Test report table (around line
  645), which breaks the table. Rows AC25–AC27 no longer render. Move the
  paragraph below the table.
- **Finding 3, resolved.** The Build notes record real-stack screenshots
  (signed initData from a throwaway token, local Postgres, `vite preview`),
  4 scenarios × light/dark at 375px. The figures check out
  (($350 − $138.50) ÷ 19 = $11.13, rounded down). The review table row for
  P1-AC26 matches. The PNGs aren't committed, and the record says so.

**Verdict: ready for owner.** Nits A–C are small doc and dead-code cleanups and
can go in before merge. None of them blocks.

### Review — Part 2

*Part 2 only. Reviewed 2026-10-31 by `reviewer` (Opus) against
`git diff 7152e33..HEAD` (904853c tests, bb444e2 build, 83444c3 screenshot record).*

**Verdict: back to build** (one small Mini App fix, finding 1). The server
side (stats, recap, `/recap`, digest, alerts) is correct and is ready for owner.

**`pnpm ci:local` (real run, local Postgres):** passed. Typecheck ✓, lint +
prettier ✓, blueprint ✓, "Migrations up to date" ✓, seed ✓, **36 test files,
524 tests passed, 0 failed, 0 skipped** (DB-backed suites ran), build ✓, Mini App
bundle 86.6 KB gz (43% of budget).

**Independent checks (beyond the suite):**
- Property run (tsx, scratch only): 31 start days × every date
  2023-12-01..2029-01-31 (58,559 cases). `isLastDayOfCycle(d, s)` holds exactly
  when `d + 1` starts a cycle (so the digest fires on clamped days such as 27/28 Feb
  for day 31, and on 19 Dec / 31 Dec at year end). `cycleAlertKey` differs from the
  previous and the next cycle's key for every start day. For day 1 the key is the
  date's calendar month, and the digest day is the calendar month's last day. No defect.
- Start day 1 = today, surface by surface: the Stats month label is
  `${monthName} ${year}` of `cycle.start` ("October 2026"), with series keys/labels
  identical to the old `toIsoDate`/`index + 1`. The recap label and range are identical.
  The `/recap` footer is unchanged. The digest heading is `monthName(month)` and its
  previous range is the previous calendar month. The alert key is the calendar month,
  and the 100% text is `today.slice(0, 7)`. History shows "Month" and the old
  picker code path. The RecapCard reads "This month".
- Alerts: reserve-then-send behind the unique index is unchanged. P2-AC15 runs
  `checkBudgetAlerts` twice. P2-AC21 really flips 20 → 1 → 2…31 → 20 (33 runs)
  and asserts exactly 2 messages, no 100%. P2-AC18 inserts an old-shape row
  `(user, 2026, 10, 80)` directly, so it's real backward-compatibility proof.
  P2-AC20's test name states the limitation.
- Digest: the monthly gate moved inside `sendOne`, so a failed settings lookup is
  isolated per user, as before. P2-AC13 asserts 1 message on 31 Oct and 2 on 19 Nov.
  Re-tick duplicates for digests are pre-existing (B-007, explicitly out of scope);
  this part neither adds nor removes digest idempotency.
- `currentCycle` (re-added, `service.ts:97`): exactly one caller
  (`digest.ts:238`). It's a 3-line wrapper over `activeSpaceSettings` +
  `cycleContaining`, not a second copy of the cycle maths. Acceptable.
- Auth: `/api/stats` takes the space only from `activeHouseholdId(user)` and the
  start day from `activeSpaceSettings(ctx, user)`. P2-AC4 covers 401, the 400 for
  `2026-02-30`, and a day-1 stranger who gets their own 1–31 Oct with 0 spend.
  Aggregation stays in SQL (`totalsForPeriod`, `totalsByDay`). No new log lines.
- Screenshot record (P2-AC22/23) is consistent: $138.50 vs $173.00 → 19.9%,
  shown as "20% less". The 2026-11-01 SGT date matches a 17:19 UTC run on 31 Oct.
  The day-1 "November 2026" / $12.50 figures match Part 1's record. The record doesn't
  explicitly say the current-cycle list showed only 20 Oct – 1 Nov rows (AC22's
  "lists 20–31 Oct"). It's implied by the Previous-cycle rows quoted.

| # | Severity | file:line | Finding | Failure scenario |
|---|---|---|---|---|
| 1 | **Medium (blocking, cheap fix)** | `apps/miniapp/src/App.tsx:147-151`, `:179-185` | While the cycle query is pending, `historyRange` is `{}`. The History list query then uses key `['transactions', null, null]`, the **"All" list**. That key is always cached, because `historyPeriod` defaults to `'all'`. So tapping "Cycle", and every ‹/› press onto an uncached cycle, first shows the **all-time list** under the Cycle chip with a "…" label, then swaps. It also fires an extra 200-row unfiltered request each time. On `isError`, it stays on the all-time list for good, with a blank label and no error | Day-20 user opens History (All) and taps Cycle. For about 1 s on a warm server, or tens of seconds on a free-tier cold start, they see 1–19 Oct and every older row as if they were "this cycle". If `/api/stats` 5xxs, they're stuck looking at all-time rows labelled as a cycle. **Fix (a few lines):** disable the history query (`enabled: tab === 'history' && !(historyPeriod === 'month' && cycleStartDay !== 1 && !historyCycle.from)`), so the screen shows its existing loading skeleton, and render a short error/retry line in `CycleStepper` when `historyCycle.isError`. Re-screenshot the chip tap |
| 2 | Low (§7 perf) | `apps/server/src/api/index.ts:476` | `/api/stats` now awaits `activeSpaceSettings` **before** `buildStats`. That adds one sequential round trip to every Stats load, including `period=day`/`year`, which don't use it. `handleRecap` also reads the space twice (`buildRecap` + footer, `bot/commands/recap.ts:97`). The digest day reads it twice too (`send-digests.ts` + `currentCycle`) | Tens of ms extra per Stats tab open on the Supabase pooler. Never wrong. Fix later: return `cycleStartDay` from `buildRecap`, and only look the start day up for `period === 'month'` |
| 3 | Low (doc) | `apps/server/CLAUDE.md` gotcha row, `docs/adr/0007-budget-cycle-per-space.md` "Alert keys" | PRD F13.3 says alerts are keyed by **user, not space** (so day-1 personal and day-20 shared spaces can share keys). The Spec says this wording "goes into PRD F13 and `apps/server/CLAUDE.md`", but the gotcha row and the ADR omit it | A future reader of the gotcha assumes per-space keys and "fixes" a perceived bug, or is surprised by a skip after `/switch`. Add one clause to both |
| 4 | Info (dup) | `api/index.ts:770-773`, `api/recap.ts:60-64` | The same `startDay === 1 ? "Month YYYY" : formatCycleRange` label expression appears twice (`toApiCycle` and the digest use the no-year variant) | Copy drift between Stats and recap if one is edited. Could be a `cycleLabelWithYear` helper |
| 5 | Info (process) | spec PR split | The plan named Part 2's branch `feat/B-032-pay-cycle-periods`. The work is on `feat/B-032-pay-cycle` (per the caller's instructions) | None. Note it in the PR body |

**Acceptance criteria → tests (Part 2)**

| # | Proven by | Real proof? |
|---|---|---|
| P2-AC1–AC5 | `apps/server/src/api/pay-cycle.test.ts` › `GET /api/stats` | Yes. Exact from/to/label/out/previous, first and last series keys, re-grouped anchors, 401 + 400 + stranger, calendar year |
| P2-AC6–AC7 | `apps/server/src/api/recap.test.ts` › `buildRecap with a pay cycle (F17)` | Yes. `to` capped at today, previous cycle 10000 |
| P2-AC8 | `apps/server/src/bot/commands/recap.test.ts` | Yes. Exact strings, all four combinations |
| P2-AC9–AC11 | `apps/server/src/tasks/digest-periods.test.ts` | Yes, plus my property run |
| P2-AC12–AC13 | `apps/server/src/tasks/digest.test.ts` | Yes. Heading, total, "50% less" vs the previous cycle. Real `sendDueDigests` at two instants |
| P2-AC14–AC21 | `apps/server/src/tasks/alerts.test.ts` › `pay cycle (F17)` | Yes. Real DB, real `checkBudgetAlerts`, double tick, 33-run flip, old-row insert |
| P2-AC22 | Screenshot (Q8 A) | Done. **Re-take after the finding 1 fix** (chip tap and ‹ press show a skeleton, not the All list) |
| P2-AC23 | Screenshot (Q8 A) | Done, consistent with the API figures |

**Plan fidelity.** Every Part 2 file in the plan was touched as described. The
History chip lives in `features/history/` (`CycleStepper.tsx`,
`cycle-stepper.css`, `use-history-cycle.ts`). It imports only `lib/` and has no
feature→feature imports. `App.tsx` wiring is about 30 lines (the plan said ~15),
all glue. `Stats.tsx` is unchanged, as planned. There's no migration, dependency or
wire-shape change. Docs are updated: PRD F7/F9.5/F13.2–3/F16.1/F17, the
`apps/server/CLAUDE.md` gotcha (see finding 3), ADR 0007 (alert keys + History
reuse), and the schema/repo doc comments. Nothing was built outside the plan.

**Guardrail self-check** (WORKFLOW §4)
- [x] **Cost:** no new service, dependency or Render service (§1)
- [x] **Money:** integer cents, SQL totals. No new arithmetic beyond existing
  `computeSafeToSpend`/`computePeriodStats`. Never negative (§2)
- [x] **Auth:** identity only from `requireInitData` / `appUser`. Space from
  `activeHouseholdId`, start day from the space row, never the request.
  Cross-user + 401 test on `/api/stats` (P2-AC4) (§4)
- [x] **Privacy:** no new log lines. Existing alert/digest logs carry `userId`,
  event and error class only (§6)
- [x] **Time:** every cycle comes from `todayFor` / `isoDateOf(clock, tz)`
  (user timezone, injected `Clock`). Tests pin `fixedClock` at SGT instants (§9)
- [x] Data/idempotency (§3): the alert reserve-then-send is unchanged. No migration.
  The documented skip is accepted by the owner (Q2 A)
- [x] Telegram (§10): no new send paths; digests and alerts reuse existing senders

### Re-review (Part 2 follow-ups)

*Reviewed 2026-10-31 by `reviewer` (Opus) against `git diff 1aaf505..HEAD`
(9eb83f7 finding 1 + 3, 6d18dd3 findings 2 + 4, dddf2cb real-stack record).
`pnpm ci:local` with local Postgres: **passed** (36 files, 524 tests, build,
bundle 86.7 KB gzipped).*

**Verdict: back to build.** One one-line CSS fix (R1). Findings 1–4 are fixed;
everything else is ready for owner.

| # | Severity | Where | What / why | Failure scenario |
|---|---|---|---|---|
| R1 | Medium (DESIGN §10) | `apps/miniapp/src/screens/History.tsx:281`, `styles.css:1063` (`.chip`), `:1763` (`.empty`) | The "Try again" chip sets no `color`; `button { color: inherit }` gives it `.empty`'s `--text-subtle` on the chip's `--bg-secondary`. With the repo's own fallbacks that is `#6b7280` on `#f1f2f5` = **4.32:1**, below the 4.5:1 floor for 14px text. In Telegram both colours come from the theme (`subtitle_text` on `secondary_bg`), so dark-mode contrast isn't guaranteed (e.g. ~3.7:1 for a desktop-style dark palette). Every other chip inherits `--text` | A user on a low-contrast dark theme can't read the only recovery control. Fix: reuse the app error's existing `primary primary--inline` button (`App.tsx:418`), or give this chip `color: var(--text)` |
| R2 | Low (UX, non-blocking) | `features/history/CycleStepper.tsx:27` | In the error state `loading` is false, so ‹ stays enabled with a blank label. Pressing it calls `setHistoryCycleAnchor(prevAnchor)` with `prevAnchor === undefined`, which resets to the **current** cycle. Not a leak, because the list stays gated | A user steps back to Sep, it fails, and pressing ‹ jumps to the current cycle instead of August. Optional fix in the same pass: `disabled={loading \|\| label === undefined}` on both arrows |
| R3 | Info | `apps/server/src/bot/commands/recap.ts:97` | Finding 2 also named the `/recap` **bot** footer's second space read. It's still there (now 3 sequential stages, was 4). `/api/recap` is 3→2 as claimed | Tens of ms per `/recap`. Never wrong. Fine to leave, or return `cycleStartDay` from `buildRecap` |

**Finding 1 (History leak): fixed.** The `history` query is disabled while
`isCycleChip && historyRange.from === undefined`, and `HistoryScreen` gets
`transactions={[]}` in that state regardless of cache. Pending → skeleton,
error → "Couldn't load this cycle." + retry. Anchor change creates a new
`['stats','month',anchor]` key with no data, so `from` is undefined and the
list is gated again (no global `placeholderData`/`keepPreviousData`). A
background refetch error keeps the old data and bounds, so it lists the right
cycle. I found no path where the Cycle chip renders the unfiltered list.
**Day-1 Month picker unchanged:** `isCycleChip` is false, so `enabled` and the props
reduce to the old values. **Placement:** the gating sits beside the `history`
query in `App.tsx`. That's correct for the pre-migration layout
(`apps/miniapp/CLAUDE.md` "Current layout", History not yet migrated, B-016…).
`retry` stays inside the feature hook. There's no automated test (P2-AC22 is
screenshot-only by Q8 A). The main session's real-stack record (dddf2cb:
stalled / 500 / normal / ‹-onto-stalled) covers it.

**Finding 2 (speed): true, with one caveat on counting.** Sequential DB stages,
excluding the auth user lookup: `/api/stats` month 3→2 (settings → one
`Promise.all` incl. `buildSeries`). That is "4→3" only if you count auth, so the claim is right
on that basis. Day/year 3→1 (no settings read; `buildStats` uses
`cycleStartDay` only in the month branch). `/api/recap` 3→2 (settings passed
into `computeSafeToSpend`). Monthly digest 4→2 (one settings read in
`send-digests`, passed through). Behaviour is identical: `buildSeries` is pure
in its arguments, and the settings object is the same row read once. Tests are green.

**Finding 3 (docs): present.** The `apps/server/CLAUDE.md` gotcha row and ADR 0007
"Alert keys" both now say alerts are keyed by user, not space (PRD F13.3).

**Finding 4 (dup): fixed.** `cycleLabel` (`service.ts:106`) is the only
"Month YYYY | range" rule, used by `buildStats` and `recap.ts` `rangeFor`.
`cycle.startDay` equals the passed start day, so the condition is the same. The
digest heading (month name, **no year**, `'This month'` fallback) and
`toApiCycle.label` (month name, no year) produce different strings. They are not a
third copy. `alerts.ts:104` and `money.ts:66` have their own Part 1 formats.

**PR checklist (WORKFLOW §4), follow-ups only**
- [x] Cost (§1): no dependency or service. Fewer DB round trips
- [x] Money (§2): no arithmetic touched
- [x] Data (§3): reads only. No migration or write path changed
- [x] Auth (§4): space still from `activeHouseholdId(user)`. Settings are read once
  per request for the same user, never from the request body
- [x] Privacy (§6): no new log lines
- [x] Runtime (§7): SQL aggregation unchanged. Stages reduced
- [x] Time (§9): no new date sources
- [ ] Design (DESIGN §10): R1 contrast on "Try again"
- [x] Docs: finding 3 wording in `apps/server/CLAUDE.md` and ADR 0007
- [x] `pnpm ci:local` passed

**Owner decision on R1 (2026-11-01):** after the fix (cb993e0), the main session measured "Try again" on the real stack: white on Telegram's button colour = **4.13:1 (light) / 3.72:1 (dark)** with Telegram-default-like theme values, still below DESIGN §10's 4.5:1. Every primary button in the app inherits the same Telegram `button_color`, so this is app-wide, not specific to Part 2. **The owner accepted it for Part 2**, and the app-wide fix is logged under BACKLOG B-010 (polish audit). R2 is verified: ‹ is disabled in the error state. With that waiver, Part 2 is **ready for owner**.

### Review — Part 3 (export)

*Reviewed 2026-10-31 by `reviewer` (Opus) against `git diff 3db44b2..HEAD`
(2b29616 tests, 774ae5a build, 1c660a4 test type fix, a97faa9 + fa11ffe CORS,
b52837d Sheet portal, spec commits). `TEST_DATABASE_URL=… pnpm ci:local`:
**passed** (38 files, 545 tests, build, bundle 87.2 KB gzipped, 44% of budget).*

**Verdict: ready for owner.** No blocking findings. 1 and 2 are small UX gaps
that could be parked in B-010. 3 is spec tidy-up.

| # | Severity | Where | What / why | Failure scenario |
|---|---|---|---|---|
| 1 | Low (UX, partly pre-existing) | `apps/miniapp/src/App.tsx:384-391`, `features/settings/ExportSheet.tsx:140-143` | A failed export only buzzes (`haptics.error()`). There's no toast or message, and the sheet has already closed on Download. The spec's deploy edge case expects the user to see "Export is not available" when an old server returns 400 for `range=cycle`. `ApiRequestError` carries that text, but nothing shows it | During a deploy, or on a cold start that times out, the user taps Download, feels a buzz and gets no file and no explanation. Fix: `onError` → `showToast("Couldn't export. Try again.")` |
| 2 | Low | `ExportSheet.tsx:101-108` | `<input type="month">` isn't supported in WKWebView (Telegram for macOS) or desktop Firefox, so it falls back to free text and ignores `max`. The client only checks that the value isn't empty | On Telegram for macOS someone types "Oct 2026" → server 400 → silent (see 1). The default value (this month) is valid, so the untouched path works. Optional: check `/^\d{4}-\d{2}$/` before enabling Download |
| 3 | Nit (docs) | `docs/specs/B-032-pay-cycle.md` Build notes / Tests | (a) The "**Blocker, not edited:** … `tsc --noEmit` fails" bullet is stale. 1c660a4 fixed it (`categoryId: null, note: null` are in the helper) and ci:local is green. (b) The P3-AC17a row in the plan's Tests table still says "❌ failing (expected)", and it has no row in the results table. (c) The "Part 3 fix (sheet overlay)" and "Part 3 real-stack verification" bullets sit after the `---`, outside Build notes. There are also two separate "Part 3 build:" bullets | A later reader thinks CI was red at merge, or misses the two defect fixes |
| 4 | Info | `apps/server/src/app.ts:52-61`, `app.test.ts` CORS | `exposeHeaders` adds only `Access-Control-Expose-Headers: Content-Disposition`. `origin` is still the single string `config.miniappUrl` (Hono echoes that fixed value, never the request's Origin). Methods, allow-headers and maxAge are unchanged, so nothing is loosened. There's no test that a foreign Origin isn't echoed, but this diff doesn't touch that | — |
| 5 | Info | `apps/server/src/api/export.ts` custom branch | The bot also accepts `/export 2026-10-05..2026-10-24` (it shares the parser), though PRD F8.4 says custom ranges are "offered by the Mini App only". It isn't in the usage hint. Harmless: validated, bounded, user-scoped | — |
| 6 | Info | Plan § PR split | The plan named the Part 3 branch `feat/B-032-pay-cycle-export`. The work is on `feat/B-032-pay-cycle`. Owner's call when opening the PR | — |

**Verified, not just trusted**
- **Everything is unchanged.** `''` → `{ label: 'all-time', filename: 'spendlygo-all-time.csv' }` with no `from`/`to` (P3-AC1, both start days). `buildExportCsv` gets an identical repo call. The API `Content-Disposition` and the bot `InputFile` name/caption (`N entries · all-time`) are byte-identical to main (P3-AC9 + bot guard). The only day-1 change is the dated name for bounded exports, as the owner confirmed.
- **`parseExportRange`.** Normalising (trim, lower-case, whitespace → `-`) covers `Last  Cycle`. `cycle`/`last-cycle` use `cycleContaining`/`previousCycle` from `todayFor` (user tz, injected Clock). `YYYY-MM`/`YYYY`/`YYYY-MM-DD` are calendar ranges for every start day. Custom ranges are inclusive (`lte`/`gte` in SQL; the test proves both edge days and excludes the 4th and 26th). Reversed, garbage or impossible dates (`02-30`) → null → 400. New Year labels carry years only when they differ (`20 Nov – 19 Dec` stays bare). The filename is built only from regex- and `parseIsoDate`-validated dates, so there's no header injection.
- **Usage hint.** Day 20 names both ranges, and day 1 says "this month"/"last month" (P3-AC13). The Markdown is safe (no `_*[` in the ranges).
- **Bounded (§7, F8.6).** `listForExport` is unchanged: SQL `WHERE` on space + `occurred_on` range, `LIMIT EXPORT_ROW_CAP`. The CSV is built in memory and never written to disk. A wide custom range is no worse than Everything.
- **Auth (§4).** The space comes from `activeHouseholdId(user)` and the start day from that space's row, never from the query. Tested: 401 for no initData, a stranger with no range and with `range=cycle`, and the owner's `range=cycle` excludes the stranger.
- **Sheet portal.** Checked by reading (no Mini App harness until B-016). Tokens live on `:root`, and `body` sets font/colour, so nothing is lost leaving `.app` (which only sets padding). No CSS selector scopes sheet content under an ancestor. `#root`/`.app` create no stacking context, so the toast (z 60) and photo viewer (z 100) still sit above sheets (z 50). Escape, body scroll lock, initial panel focus, `env(safe-area-inset-bottom)` and the global reduced-motion rule are unchanged, and they now apply to all four sheets plus SpaceSwitcher. Unmount runs the effect cleanup and React removes the portal node. It's a Vite SPA with no SSR, and `document` is touched only during render in the browser. There was never a focus trap (initial focus only), drag-to-dismiss or Telegram BackButton hook. Those are pre-existing gaps, not regressions.
- **ExportSheet.** It lives in `features/settings/` and imports only `components/Sheet` (legacy shared, per plan), `lib/telegram` and `@spendlygo/shared`. No feature→feature imports. Its CSS uses tokens only. It's 149 lines (≤ 250). For a11y: `fieldset` with `aria-label`, native radios in labels sharing one `name`, and `aria-label` on the month/From/To inputs. Everything sends no `range`, so it works on an old server. Cycle options are hidden when `me.cycle`/`previousCycle` are missing.
- **Docs.** PRD F8.1/F8.4/§8, `/help` (text as planned), `apps/server/CLAUDE.md` CORS gotcha, and the export.ts header comment are all updated. No ADR was needed.
- **Real-stack record.** It's consistent. 5 + 2 = 7 rows (cycle + last cycle = all-time), and the custom 5–24 Oct gave 4. The captions match today = 1 Nov (day 20: `20 Oct – 19 Nov` / `20 Sep – 19 Oct`; day 1: November / October). Both defects it found (CORS, clipped sheet) have commits, and CORS has a test.

**Plan fidelity.** Every Part 3 file in the plan was touched as described.
`exportFilename` is deleted, and the existing export tests are unchanged. Two
changes go beyond the plan, the CORS `exposeHeaders` and the `Sheet` portal.
Both were defects found in verification, recorded in Build notes, and are
minimal. Nothing else was built.

**PR checklist (WORKFLOW §4)**
- [x] **Cost (§1):** no new dependency, service or Render service. Bundle 87.2 KB gz
- [x] **Money (§2):** no arithmetic. CSV formatting of cents is unchanged
- [x] **Data (§3):** read-only. No migration and no write path
- [x] **Auth (§4):** identity from `requireInitData` / `appUser` only. Space from `activeHouseholdId`. 401 + cross-user tests, including `range=cycle` (P3-AC12)
- [x] **Privacy (§6):** no new log lines. The export only goes to the requesting user
- [x] **Runtime (§7):** SQL filter + row cap. No new JS aggregation
- [x] **Time (§9):** `todayFor(ctx, user)` (user tz, injected Clock). Tests pin `fixedClock` at SGT noon
- [x] **Telegram (§10):** the same single `replyWithDocument`. No new send paths
- [x] **Docs:** PRD, `/help`, server CLAUDE.md gotcha
- [x] `pnpm ci:local` passed (545 tests)

- **Part 3 review follow-ups (owner-approved):** export failure now toasts "Couldn't export — try again" and keeps the sheet open with the choice kept (closes only on success, via an `onDone` callback); the month text-box fallback is validated as `YYYY-MM` with an inline "Use the format 2026-10" hint and Download disabled; bot `/export YYYY-MM-DD..YYYY-MM-DD` documented in the usage hint, `/help` and PRD F8.4/§8. No test edits.

### Review — Part 4 (setting the start day)

*Reviewed 2026-11-01 by `reviewer` (Opus) against `git diff origin/main..HEAD`
(b548730 spec, 5c5d7c8 tests, 0803a7f server, c3fe88e Mini App, a1db714 spec
notes, 51329cc test typing). `TEST_DATABASE_URL=… pnpm ci:local`: **passed**
(39 files, 578 tests, build, bundle 87.7 KB gzipped, 44% of budget).*

**Verdict: ready for owner (with nits).** No blocking findings. Finding 1 is a
small bot regression worth a one-line fix before merge. 2–5 can be parked.

| # | Severity | Where | What / why | Failure scenario / fix |
|---|---|---|---|---|
| 1 | Low (bot UX regression) | `apps/server/src/bot/commands/settings.ts:222` | The existing toggle/hour path re-renders the message with `buildSettingsText(updated, ctx.config)` and **no cycle**. So the new `Budget cycle: …` line (P4-AC6) disappears after any other setting is changed. No test covers the text after a toggle | `/settings` shows `Budget cycle: starts on the 20th (20 Oct – 19 Nov)`. The user taps "Digest: on" and the edited message no longer has a cycle line, until they send `/settings` again. Fix: pass `await currentCycle(ctx, updated)` as the third argument (one more `findById`). Add a test asserting the line survives `set:d:0` |
| 2 | Low (Mini App race) | `apps/miniapp/src/features/settings/CycleStartDayField.tsx:33,40` | Nothing stops a second pick while the first PATCH is still in flight. Two PATCHes can reach the server in either order, and each one is a real change | The user picks 20, then 25 straight away. If the server gets 25 before 20, the stored day is 20. There are two "Saved" toasts, and the partner gets two messages, the last saying "20th". After the refetch the select shows 20 (the truth), but the user meant 25. Also, the first refetch changes `startDay` and resets `chosen` while 25 is still pending, so the select flickers 25 → 20 → 25. Fix: `disabled` while a cycle save is pending (or serialise saves) |
| 3 | Nit | `apps/miniapp/src/App.tsx:522`, `screens/Settings.tsx:188-195` | `busy={settings.isPending}` is shared, so picking a cycle day briefly turns the button into "Saving…" and disables "Save budget" | Cosmetic, and the same already happens for the digest hour |
| 4 | Nit (docs) | `PRD.md:507` (F17.5), F17.6 | F17.5 still says "Export and setting the day follow in later parts". Both have now shipped. F17.6 names the PATCH and the bot picker, but not the Mini App Settings › Budget field (P4-AC16) | Fix: drop the stale sentence. Add "and the Mini App's Settings › Budget select" to F17.6 |
| 5 | Nit | `CycleStartDayField.tsx:8` | The `ordinal` helper is a copy of core's `ordinalDay`. That is documented in `apps/miniapp/CLAUDE.md`, and it has to be a copy because the Mini App can't import core | It could move to `@spendlygo/shared` later. The copy is identical, `day % 100` included |
| 6 | Info (§10, accepted by plan) | `apps/server/src/api/index.ts:183`, `bot/commands/settings.ts:207` | Both paths `await notifyCycleChange`, which may sleep up to 3 s per member on a 429. The plan asks for exactly this. In the bot it runs **after** `answerCallbackQuery` and the edit, so the spinner never waits. The worst case for a 2-member space is ~3 s plus 2 sends, well inside grammY's 10 s webhook timeout. If Telegram redelivers anyway, `updateCycleStartDay` returns `false` (an atomic `WHERE cycle_start_day <> $day`), so nothing is sent twice. The PATCH can be ~3 s slow in the rare 429 case. Acceptable | — |

**Fixes (2026-11-01):** finding 1 fixed (toggle path now passes `currentCycle`). Finding 2 fixed (select disabled while a save is pending). Finding 4 fixed (PRD F17.5 and F17.6 updated). Findings 3 and 5 parked.
| 7 | Info | `api/index.ts:175-187` | The space write (budget/cycle) and the user-settings write aren't in one transaction. That was already true for `monthlyBudgetCents`. The Mini App sends `cycleStartDay` alone, so in practice there's no partial write | — |

**Verified, not just trusted**
- **Identity (§4).** The PATCH writes only `activeHouseholdId(user)`, with `user` taken from `requireInitData`. The schema is still `.strict()`, so `householdId` in the body is a 400, and the test checks that neither space changed. The 401 is tested too. In the bot, the space id in `set:c`/`set:cp` is regex- and `z.string().uuid()`-checked, then **only compared** with `activeHouseholdId(appUser)`. The write uses `activeHouseholdId(user)`, never `action.householdId`. A mismatch answers `STALE_TEXT` before any read or write (P4-AC10 test: no edit, no send, both spaces still 1). Telegram only delivers callback_data that the bot itself attached, and the compare-only design holds even if that weren't so.
- **Idempotency.** `updateCycleStartDay` is a single conditional UPDATE … RETURNING, so concurrent identical PATCHes or redelivered callbacks give exactly one `changed = true`. Tests: a second PATCH sends nothing (AC11). A replayed `set:c` leaves `updated_at` untouched (AC8). A shared-space redelivery sends exactly one message, to the creator (AC13). Every callback path answers exactly once (asserted `toHaveBeenCalledTimes(1)`), including the DB-error path ("Couldn't save that", then rethrow), which matches the existing toggle path.
- **Telegram (§10).** Sends are sequential, one per other member and one per chat. `sendMessageWithRetry` retries only `GrammyError` 429 with `retry_after ≤ 3`, exactly once. Above 3, a 403, or a second failure is rethrown, logged and skipped (unit tests for all four, plus AC14/AC15 end to end, with `sleep` called with 1000). Plain text, no `parse_mode`, so first names need no escaping.
- **Privacy (§6).** Logs carry `settings.cycle_notify_failed { userId, errorName, errorMessage }` (the Telegram description only) and `settings.updated { userId, fields: 'cycleStartDay' }`. No amounts, names or chat ids. The notice text has no amounts.
- **Time (§9).** The notice cycle is `cycleContaining(todayFor(ctx, member), day)`, the recipient's own timezone through the injected Clock. The bot text uses `todayFor(ctx, user)`.
- **Mini App.** On success, `refreshAll` refetches `today`, `transactions`, `stats` (History's cycle key starts with `stats`) and `me`, and `['recap']` is now invalidated as well (AC18). On failure, `mutateAsync` rejects and `chosen` resets to the saved day. The hook-level `onError` fires the error haptic and there is no toast. The CSS uses only `--text` / `--text-subtle` tokens. The `<label htmlFor>` and native `<select>` are accessible. The preview uses `me.cycle?.days ?? daysInMonth(today)`, and the "this cycle"/"this month" wording follows the start day (AC17). Older servers fall back to day 1.
- **Currency.** No new `S$` in code or user copy. The only `S$` lines in the diff are the handoff doc's notes about the switch to `$`.
- **Docs.** PRD F17.6 + §8, ADR 0007 rollback note (it matches the Plan's *Rollback*), server and Mini App `CLAUDE.md` gotchas, `/help` line, settings.ts header comment. BACKLOG → Done waits for the release, as planned.
- **Tests weren't weakened.** 5c5d7c8 changed one existing assertion, the toggle-list test, which now filters out `set:cp:`. The plan allowed this ("only if it enumerates exact data"), and P4-AC7 pins the new button. 51329cc changed types only.

**Plan fidelity.** Every Part 4 file in the plan was touched as described. As
the build notes say, there was no repo change (`updateCycleStartDay` already
existed from Part 1). Small, harmless differences from the plan: App.tsx uses
`mutateAsync` instead of `mutate` (it's needed for the revert in P4-AC18, and
it's documented), and the PATCH reuses `activeSpaceSettings` to fill the
response's `cycleStartDay`. The server and the Mini App are in separate commits
(0803a7f, c3fe88e), as the Rollback plan requires. Nothing outside the plan was
built.

**Acceptance criteria → tests**

| # | Proven by |
|---|---|
| P4-AC1 | `api/pay-cycle.test.ts` › "owner's example: setting day 20 on 31 Oct moves Today to 20 Oct – 19 Nov" |
| P4-AC2 | `pay-cycle.test.ts` › "rejects 0, 32, 1.5 and \"20\" without changing anything" (pre-set to 7, so the "unchanged" check is meaningful) |
| P4-AC3 | `pay-cycle.test.ts` › "either member of a shared space can change it" |
| P4-AC4 | `pay-cycle.test.ts` › "changes only the active space" |
| P4-AC5 | `pay-cycle.test.ts` › "a householdId in the body is a 400; unauthenticated is a 401" |
| P4-AC6 | `bot/commands/settings.test.ts` › "shows the cycle start day and range" |
| P4-AC7 | `settings.test.ts` › "day picker lists 1–31, 7 per row, …, and stays within 64 bytes" |
| P4-AC8 | `settings.test.ts` (DB) › "set:c:20 updates the active space and a replay is a no-op" |
| P4-AC9 | `settings.test.ts` › "parseSettingsCallback rejects malformed cycle data, including the old id-less form" |
| P4-AC10 | `settings.test.ts` (DB) › "a picker for another space is answered \"out of date\" and writes nothing" |
| P4-AC11 | `pay-cycle.test.ts` › "a partner's change sends one message to each other member, and none when nothing changed" |
| P4-AC12 | `pay-cycle.test.ts` › "a personal space change messages nobody" |
| P4-AC13 | `settings.test.ts` (DB) › "a redelivered set:c in a shared space messages the partner once" |
| P4-AC14 | `pay-cycle.test.ts` › "a blocked partner never fails the change" + `send-with-retry.test.ts` › "does not retry a 403" |
| P4-AC15 | `pay-cycle.test.ts` › "a 429 is retried once after retry_after" + `send-with-retry.test.ts` › "> 3 seconds" and "only one retry" |
| P4-AC16–18 | Real-stack screenshots and a dev-bot check recorded by the orchestrator (select, caption, hints; `= $1,550/month (31 days this cycle)`; Saved vs forced-400 revert) |
| ordinalDay | `packages/core/src/cycle.test.ts` (1st…31st incl. 11th–13th) |

**PR checklist (WORKFLOW §4)**
- [x] **Cost (§1):** no new dependency or service. Bundle 87.7 KB gz (44%)
- [x] **Money (§2):** no new arithmetic. The preview reuses existing cents maths with `me.cycle.days`
- [x] **Data (§3):** one-row conditional UPDATE, idempotent. No migration (the column is from Part 1). No deletes
- [x] **Auth (§4):** identity from `initData` / `appUser` only. Only the active space is written. Strict schema. Cross-user + 401 tests (AC5), stale-space test (AC10)
- [x] **Privacy (§6):** logs carry user ids and error names only. The notice has no amounts
- [x] **Runtime (§7):** no JS aggregation added
- [x] **Time (§9):** recipient/user timezone via `todayFor` (injected Clock)
- [x] **Telegram (§10):** callbacks answered once on every path. Sequential sends. 429 ≤ 3 s retried once. Notify runs after the answer (see finding 6)
- [x] **Docs:** PRD, ADR 0007, both nested CLAUDE.md files, `/help` (PRD F17.5 tidy-up: finding 4)
- [x] `pnpm ci:local` passed (578 tests)
