# B-032 — Pay cycle: the budget month starts on a chosen day

**Feature:** F17 (new: pay cycle) · **Branch:** `feat/B-032-pay-cycle` · **Status:** draft (Grilling recap confirmed; Spec + Plan pending)
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

### Problem
<!-- One or two sentences: what's wrong or missing, for whom. Cite the PRD rule. -->

### User stories
- As <who>, I want <what>, so that <why>.

### Acceptance criteria
<!-- Each one is testable and gets exactly one test in Stage 4. -->

| # | Given | When | Then |
|---|---|---|---|
| AC1 | | | |
| AC2 | | | |

### Edge cases
<!-- Money: 0 budget, over budget, month end, February, leap year.
     Time: 00:30 entries, the user's timezone. Spaces: personal vs shared.
     Telegram: redelivered webhook, double-fired tick. -->
-

### Out of scope
-

---

## Plan — *how* (Stage 2)

### Files
| File | Change |
|---|---|
| | |

### Data
<!-- Schema change? Migration generated by drizzle? Backward-compatible
     with the server that's currently running? Any destructive step → GUARDRAILS §14. -->

### Tests
| AC | Test file › test name |
|---|---|
| AC1 | |

### Risks & guardrails
<!-- Cost, money, auth, privacy, time — or "none", with a reason. -->

### PR split
<!-- One feature ID per PR. "Single PR", or "part 1 of N: …". -->

---

## Second opinion (risky items only, `challenger`)
<!-- Or "n/a: not a risky item". Each finding: scenario, detail, options with pros and cons, blocking? -->

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
