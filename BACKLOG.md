# Spendlygo — Backlog

The single plan. How it's used: [`WORKFLOW.md`](./WORKFLOW.md) §2 and §7.
Each item past intake has a spec in [`docs/specs/`](./docs/specs).
Feature IDs refer to [`PRD.md`](./PRD.md) §7.

**Status key:** `todo` · `spec` (spec written/approved) · `planned` (plan approved) · `tests` (failing tests committed) · `in progress` · `in review` (PR open) · `done`

**Current focus (agreed 2026-10-31):** close the drift and the P6 gaps below
before starting any new feature.

---

## Now

| ID | Title | Feature | Status |
|---|---|---|---|
| B-001 | Soft-deleted transactions are purged after 30 days | F11.3 | todo |
| B-002 | Full account deletion on request | §12, GUARDRAILS §6 | todo |
| B-003 | `/month` bot command | F7, §8 | todo |
| B-032 | **Pay cycle:** budget month starts on a chosen day (e.g. the 20th) | F17 (new) | planned: Part 1 in progress (Parts 1–4 approved; Part 5 budget history to be planned) |

**B-032 — Pay cycle.** Grilled with the owner 2026-10-31. The confirmed
recap is in `docs/specs/B-032-pay-cycle.md`. Each space gets a cycle start day
(1–31, clamped), and everything month-based follows it. **Priority: next,
ahead of B-001–B-003** (owner decision). B-003 `/month` will be built on top
of it. Risky (safe-to-spend, date boundaries), so `challenger` runs.

**B-001 — Soft-delete purge.** PRD F11.3 and GUARDRAILS §3 say soft-deleted
transactions are purged after 30 days. No purge job exists in `tasks/`.
*Accept:* the hourly tick hard-deletes transactions (and their attachment rows)
whose `deleted_at` is more than 30 days old; it's idempotent; there's a test with
a pinned clock at the 30-day boundary. 🟡 This is a bulk delete (GUARDRAILS §3),
so the plan needs explicit owner approval.

**B-002 — Account deletion.** GUARDRAILS §6 and PRD §12 promise full deletion on
request. No code path exists. *Accept:* the user can request deletion (bot
command and/or Mini App setting) with a confirmation step; every row they own
is removed; shared spaces they belong to keep the other members' data;
cross-user test. 🟡 This is irreversible, so the plan needs owner approval,
including how shared-space entries the user logged are handled.

**B-003 — `/month`.** Listed in PRD §8 but not registered in
`apps/server/src/bot/index.ts`. *Accept:* returns the active space's month
in/out/net, budget used, and pace; SQL aggregation; user-timezone month.

**B-004 — `/settings`.** Listed in PRD §8 but not registered. The Mini App
already has `PATCH /api/settings`. *Accept:* the bot shows the current digest
hour, digest, nudge and alerts toggles, with inline buttons to change them, and
links to the Mini App for the rest.

## Next

| ID | Title | Feature | Status |
|---|---|---|---|
| B-005 | Budget history: decide whether to use or drop `budget_periods` | F6, §9 | todo |
| B-006 | Budget suggestion at onboarding | F6.6 | todo |
| B-007 | Digest idempotency on a double-fired tick | F9, GUARDRAILS §3 | todo |
| B-008 | Category learning from corrections | F10.5 | todo |
| B-009 | Income-shift budget suggestion | F3.3 | todo |
| B-010 | Audit P6 polish: empty, error, onboarding states | P6 | todo |
| B-011 | Decide the Mini App's styling and motion stack; record an ADR | DESIGN §5 | todo |
| B-012 | Rate limiting on `/api` | GUARDRAILS §10 | todo |
| B-016 | Mini App test setup: Vitest + Testing Library | DESIGN §11 | todo |
| B-017 | Mini App restructure 1: shell, `ui/`, `lib/`, `styles/`, import rules | — | todo |
| B-018 | Mini App restructure 2: `features/today` | F6, F15 | todo |
| B-019 | Mini App restructure 3: `features/capture` | F2 | todo |
| B-020 | Mini App restructure 4: `features/stats` | F7 | todo |
| B-021 | Mini App restructure 5: `features/history` | F7.3, F11 | todo |
| B-022 | Mini App restructure 6: `features/settings` (goals, household, recurring) | F5, F12, F14 | todo |
| B-023 | Mini App restructure 7: `features/spaces` + `features/recap` | F12, F16 | todo |
| B-026 | Undo callback is never answered if its database read throws | F11.1, GUARDRAILS §10 | todo |

**B-005.** The `budget_periods` table exists in the schema, but no code reads
or writes it. The live budget is `households.monthly_budget_cents`, so a past
month's pace and stats may use today's budget. *Decide:* wire it in, keyed per
space rather than per user, or drop it with an approved migration.

**B-006.** `suggestBudgetFromHistory` exists in `packages/core/src/safe-to-spend.ts`
but nothing in `apps/` calls it. F6.6 says onboarding suggests a budget from the
last 60 days. *Accept:* `/start` and the Mini App's empty state offer the
suggestion when there's history.

**B-007.** `tasks/tick.ts` documents that a re-fired tick in the same hour
re-evaluates digests. Verify whether a cron double-fire can send a digest twice.
If it can, add a sent-record keyed per user, period and kind, the same pattern
as `budget_alerts`.

**B-008.** F10.5 says correcting an inferred category adds the note's keywords
to that category's user overrides. Nothing in the code implements this yet.
Verify, then build or descope it in the PRD.

**B-009.** F3.3 says the app suggests a budget change when average income
shifts by more than 10% for two consecutive months. Nothing in the code
implements this yet. Verify, then build or descope it.

**B-010.** P6's definition of done is "ready to hand to a second person".
Check every screen against DESIGN §11 (light/dark, 375/430px,
loading/empty/error/populated). Each gap found becomes its own item.

**B-011.** CLAUDE.md used to list Tailwind v4, `motion` and
`@telegram-apps/sdk-react`, but none are installed. The Mini App uses plain
CSS custom properties (`styles.css`), hand-rolled Telegram launch-param
parsing (`lib/telegram.ts`) and TanStack Query. *Decide:* keep this as the
permanent choice (write ADR 0007, which likely fits GUARDRAILS §8 better), or
adopt the libraries.

**B-012.** CLAUDE.md's layout mentioned rate-limit middleware, but none exists.
*Decide:* whether `/api` needs one, given the allowlist and `initData` auth. If
not, record that decision.

**B-016 to B-023: the Mini App restructure** (agreed 2026-10-31; target layout in
`apps/miniapp/CLAUDE.md`). One PR each, in order. **No behaviour change** in
any of them: the app works the same at every step.

- **B-016:** add `vitest`, `@testing-library/react` and `jsdom` as
  **dev-only** dependencies. Extend `vitest.config.ts` to pick up
  `apps/miniapp/**/*.test.tsx` with a jsdom environment. First tests cover
  `lib/format.ts`. *Accept:* `pnpm test` runs them in CI; the bundle size is
  unchanged.
- **B-017:** create `app/` (thin `App.tsx` + `providers.tsx`), move reusable
  components to `ui/`, add `lib/query-keys.ts`, split `styles.css` into
  `styles/tokens.css` and `styles/base.css` (feature CSS stays put for now),
  and add `no-restricted-imports` boundaries. *Accept:* checks green;
  light/dark screenshots identical before and after.
- **B-018 to B-023:** per feature, move the screen and its sections into
  `features/<name>/`, move its queries and mutations out of `App.tsx` into
  `use-*.ts` hooks, move its CSS beside it, and add loading, empty, error
  and populated tests. *Accept:* `App.tsx` shrinks each time; it ends at
  ~100 lines after B-023.

**B-026.** In `bot/capture.ts`, `handleUndo` reads the transaction
(`transactionsRepo.findById`) outside any error handling. If that read throws,
`answerCallbackQuery` is never called and the Telegram client spins forever.
Found while planning B-004. The same applies to the hour-picker button's
answer in `bot/commands/settings.ts` (~line 116; found in the B-004
re-review). It saves nothing, so the risk is low. *Accept:* every path,
including a DB or Telegram failure, answers the callback; there's a test with a
throwing DB.

**Ordering note:** these sit in Next, after B-005 to B-012. Reorder if you'd
rather restructure before building new Mini App features: new UI work goes
into the target layout either way.

## Later

Parked ideas. Not agreed, not scheduled. Promote one only by agreement.

| ID | Idea | Notes |
|---|---|---|
| B-013 | Voice-note capture | PRD §5.2, v2. Needs a zero-cost speech-to-text option first (GUARDRAILS §1). |
| B-014 | Multi-currency + FX | PRD §5.2, v3. |
| B-033 | Reserve upcoming bills: safe-to-spend sets aside recurring expenses due before the cycle ends | Owner interested (2026-10-31). Changes safe-to-spend maths; grill + challenger |
| B-034 | Custom alert thresholds (e.g. 50 / 80 / 100%) instead of fixed 80 / 100% | Owner interested. Small, low risk |
| B-035 | Per-category limits with their own alerts (e.g. Food ≤ $200 per cycle) | Owner interested. New data + screens |
| B-036 | Weekend vs weekday allowance, same total per cycle | Owner interested. Changes safe-to-spend maths; grill + challenger |
| B-028 | Change timezone from the bot or Mini App | Needs a validated IANA list and a decision on how already-stored `occurred_on` dates are treated. Parked at B-004 approval; `/settings` shows timezone read-only. |

## Drift & debt

Places where the code and docs disagree, or a guardrail isn't met yet. Items
with their own ID above are tracked there. This list is the remainder.

| ID | Item | Status |
|---|---|---|
| B-029 | **Unapproved work on branch `claude/telegram-expense-tracker-06gr8u`** (another Claude session, 2026-10-31, 3 commits ahead of `main`): (1) foreign-currency capture using the external Frankfurter FX API: PRD §5.2 defers multi-currency to v3, and GUARDRAILS §1 requires asking before any new external service; (2) who-owes-who split expenses, a new `transaction_splits` table with no PRD feature; (3) a savings-goal progress chart. Its ADR 0007 also clashes with the ADR 0007 planned for B-011. The owner has **not** approved these. **Don't merge that branch** until the owner decides | owner decision |
| B-027 | `PATCH /api/settings` accepts any non-empty `timezone` string, with no IANA check. A bad value would break every day boundary for that user. Found while planning B-004 | todo |

## Done

Newest first. Earlier work (P0–P6 to date: PRs #4–#12) predates this backlog.

| ID | Title | Feature | PR |
|---|---|---|---|
| B-004 | `/settings` bot command; owner confirmed it working live on 2026-10-31 | F9 | #14, #15 |
| B-015 | README figures refreshed: 450 tests, Mini App bundle 86.1 KB gzipped | — | (this branch) |
| B-030 | GitHub CI unblocked: owner cleared the billing lock; a latent `pnpm/action-setup` version clash fixed; first green CI run | — | #13 |
| B-031 | Grilling before spec/plan, the never-assume rule, `challenger` second-opinion agent, `pnpm ci:local` as the single CI pipeline, CI pinned to ubuntu-24.04 | — | (this branch) |
| B-025 | Model routing (Opus plan/review, Sonnet test/build) via `.claude/agents/`; spec file as the agent handoff; root CLAUDE.md slimmed 18.7 → 12.6 KB | — | (this branch) |
| B-024 | Workflow v2: spec stage, success/failure per stage, review checklist, spec template, Mini App target architecture | — | (this branch) |
| B-000 | Docs foundation: WORKFLOW.md, BACKLOG.md, nested CLAUDE.md files, F13–F16 in the PRD, drift fixes | — | (this branch) |
