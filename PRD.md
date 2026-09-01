# Spendlygo — Product Requirements Document

**Status:** v1 draft · **Owner:** @eugenelcc · **Last updated:** 2026-08-27
**Related docs:** [`CLAUDE.md`](./CLAUDE.md) · [`GUARDRAILS.md`](./GUARDRAILS.md) · [`DESIGN.md`](./DESIGN.md)

---

## 1. Summary

Spendlygo is a Telegram-native personal finance tracker. It has two faces:

1. **The bot** — a chat surface for sub-3-second capture. Type `12.50 lunch`, done.
2. **The Mini App** — a Telegram Web App launched from the chat, for browsing,
   editing, statistics, and goal setting, with a native-feeling animated UI.

The differentiator is not "another expense log." It is the **daily safe-to-spend
number**: a single, honest figure that answers *"how much can I spend today
without blowing the month?"* and recalculates every single day based on what has
actually happened.

**Non-goal:** becoming a bank aggregator, a receipt-OCR company, or a
multi-currency accounting tool. Scope discipline is what keeps this free to run.

---

## 2. Problem statement

Existing expense trackers fail on one of two axes:

| Failure mode | Example | Why it kills the habit |
|---|---|---|
| Too much friction | Open app → login → new entry → 6 fields → save | Entry takes 30s, so you skip it, so the data is useless |
| Too much data, no answer | Beautiful pie charts of last month | Tells you what happened, never what to *do* today |

Spendlygo's bet: **capture must be under 3 seconds, and the app must always
answer with one number.** Everything else is supporting cast.

---

## 3. Target user

**Primary (v1):** the owner — a single Singapore-based user who already lives in
Telegram, spends mostly in SGD, and wants to stop guessing whether they are on
track this month.

**Secondary (v2+):** a partner or family member sharing one pooled budget.
The data model is built multi-tenant from day one so this needs no migration,
but access is gated to an allowlist until explicitly opened.

---

## 4. Goals & success metrics

| Goal | Metric | Target |
|---|---|---|
| Capture is frictionless | Median time from typing to confirmed entry | < 3 seconds |
| The habit sticks | Days per week with ≥1 logged transaction | ≥ 5 |
| The number is trusted | Days where safe-to-spend is viewed | ≥ 4 / week |
| It runs free | Monthly infrastructure cost | **S$0.00** |
| It stays up | Bot responds to `/start` within 5s, 24/7 | ≥ 99% of pokes |
| No data loss | Transactions lost to infra | 0, ever |

**Anti-metric (watch for these):** if the Mini App is opened more than the bot
is typed into, capture friction has regressed and we've built the wrong thing.

---

## 5. Scope

### 5.1 In scope — v1 (ship this)

- **F1** Quick-text capture in chat (`12.50 lunch #food`)
- **F2** Mini App capture form (numpad, category chips, haptics)
- **F3** Income tracking and net cashflow
- **F4** Photo attachment on any transaction (store + view, OCR pre-fill via
  OCR.space — GUARDRAILS.md section 1, ADR 0005)
- **F5** Recurring transactions (rent, salary, subscriptions)
- **F6** Safe-to-spend daily goals engine
- **F7** Statistics: daily / monthly / yearly
- **F8** CSV export
- **F9** Daily digest message
- **F10** Categories (seeded defaults, user-editable)
- **F11** Edit / delete / undo a transaction

### 5.2 Out of scope — deferred

| Feature | Phase | Why deferred |
|---|---|---|
| Voice-note capture | v2 | Free speech-to-text is hard; Telegram gives us no transcript. |
| Multi-currency + FX | v3 | User spends in SGD. Adds conversion, rate caching, historical rates. |
| Shared households | v2 | Schema is ready; invite flow + permissions are real work. |
| Bank / card import | ✗ | Requires paid aggregators (Plaid etc). Violates the zero-cost rule. |
| Debt & investment tracking | ✗ | Different product. |

### 5.3 Explicit non-goals

- No web signup, no email, no password. **Telegram is the only identity.**
- No native mobile app.
- No ads, no analytics SDKs, no third-party trackers in the Mini App.

---

## 6. Constraints (these drive every design decision)

| Constraint | Consequence |
|---|---|
| **Zero budget, permanently** | One Render free web service + one free static site + Supabase free Postgres. Nothing else. |
| Render free tier sleeps after 15 min idle | External free cron pings `/healthz` every 10 min. See §11. |
| Render free tier = 750 instance-hours/month | **Exactly one always-on web service.** A second would exceed the quota. |
| Render free Postgres expires after 30 days | Database lives on **Supabase**, not Render. Non-negotiable. |
| Supabase free project pauses after 7 days idle | The same cron touches the DB daily, keeping it warm. |
| 512 MB RAM / 0.1 CPU | Lean runtime (Hono, not Nest). No headless browsers, no ML models. |
| Telegram file storage is free and unlimited | Receipts are **never copied** — we persist `file_id` and proxy on demand. |

Full detail and the rules that follow from these live in [`GUARDRAILS.md`](./GUARDRAILS.md).

---

## 7. Feature requirements

### F1 — Quick-text capture

The fastest path. User types a plain message; bot parses and confirms.

**Grammar** (case-insensitive, all modifiers optional and order-independent):

```
[+|-]<amount> [note words…] [#category] [@date]
```

| Input | Interpretation |
|---|---|
| `12.50 lunch` | Expense, S$12.50, note "lunch", category auto-inferred |
| `12.50 lunch #food` | Same, category explicitly Food |
| `+3000 salary` | **Income** of S$3,000 |
| `-8.20 grab` | Expense (leading `-` is allowed, redundant) |
| `s$12.50 kopi` | Currency symbol tolerated and stripped |
| `12.5k rent` | S$12,500 — `k` suffix multiplies by 1,000 |
| `45 dinner @yesterday` | Dated to yesterday |
| `45 dinner @12/03` | Dated to 12 March, user's timezone, current year |

**Rules**
- **R1.1** Amount is required. No amount → not a transaction; ignore silently
  unless the message starts with `/`.
- **R1.2** Default direction is **expense**. Income requires an explicit `+`,
  an income category, or an income keyword (`salary`, `bonus`, `refund`,
  `dividend`, `payout`).
- **R1.3** Category inference is a **deterministic keyword map** (see F10) —
  no LLM calls, ever. Unmatched → `Uncategorised`.
- **R1.4** Ambiguous parse → bot replies with its interpretation and inline
  buttons to correct, rather than guessing silently.
- **R1.5** Confirmation is a single compact card showing amount, category, note,
  date, **new safe-to-spend**, and an `Undo` button (valid 5 minutes).
- **R1.6** A photo sent with a caption is parsed by the same grammar, and the
  photo is attached (F4).
- **R1.7** A photo sent with **no** caption → bot stores it as a *pending*
  attachment and asks for the amount via a reply prompt.

**Acceptance:** 20 fixture strings covering the table above parse correctly in
unit tests; each has a golden expected output committed.

---

### F2 — Mini App capture form

Launched from the chat via a `web_app` keyboard button or the bot menu button.

**Rules**
- **F2.1** Opens directly on the numpad — no home screen in between. Capture is
  the default intent.
- **F2.2** Large numeric keypad, amount rendered as animated rolling digits.
- **F2.3** Category selected from horizontally-scrolling chips, ordered by the
  user's **recent + frequent** usage (recency-weighted frequency).
- **F2.4** Expense/Income is a single animated segmented toggle.
- **F2.5** Note is optional and never blocks saving.
- **F2.6** Date defaults to today; one tap opens a compact date picker.
- **F2.7** Save uses Telegram's `MainButton`, with haptic feedback on success.
- **F2.8** After save, the safe-to-spend ring animates to its new value before
  the sheet dismisses. The user must *see* the consequence of the spend.
- **F2.9** Optimistic UI: the entry appears instantly; failures roll back with a
  toast and preserve the input for retry.

---

### F3 — Income & net cashflow

- **F3.1** Income and expense share one `transactions` table, distinguished by
  `direction` (`in` / `out`). No parallel schemas.
- **F3.2** Net cashflow for a period = income − expenses.
- **F3.3** Income does **not** automatically raise the monthly budget. The user
  sets the budget deliberately; the app *suggests* an adjustment when average
  income shifts by >10% for two consecutive months.
- **F3.4** Statistics screens show income, expense, and net as three distinct
  series, never merged into one signed total.

---

### F4 — Photo attachments, with OCR pre-fill

- **F4.1** Photos are **never copied** off Telegram. We store `file_id`,
  `file_unique_id`, dimensions, and byte size.
- **F4.2** Viewing goes through our API, which calls `getFile`, caches the
  resulting temporary URL in memory (~50 min TTL, Telegram's is ~60), and
  streams the bytes. `file_id` is never exposed to the client.
- **F4.3** Multiple photos per transaction are allowed (cap: 5).
- **F4.4** Deleting a transaction deletes its attachment rows. The underlying
  Telegram file is not ours to delete.
- **F4.5** In the Mini App, a transaction with an attachment shows a thumbnail
  badge; tapping opens a full-screen pinch-zoom viewer.
- **F4.6** A captionless receipt photo sends its bytes (not the `file_id`, not
  any other user data) to **OCR.space**'s free API for text extraction — see
  GUARDRAILS.md section 6 for the exact, narrow scope of that exception, and
  ADR 0005 for why. The extracted total is a **suggestion, never authoritative
  input**: it is saved through the same confirmation-card-plus-five-minute-undo
  path every other capture in this app already uses (F1.5, F11.1) — not a
  stricter pre-save confirm step, since that would be the one capture flow in
  the app that behaves differently, for a source no less correctable than a
  typed guess. The confirmation card says the amount was guessed and where to
  fix it. A failed or mis-read receipt degrades to asking for a caption, the
  same request a captionless photo always got. `attachments.ocr_status`
  (`none` / `pending` / `done` / `failed`) and `ocr_payload` (the guessed
  amount, for debugging a bad read — never the raw receipt text) track this
  per photo.

---

### F5 — Recurring transactions

- **F5.1** A rule defines: amount, direction, category, note, cadence
  (`daily` / `weekly` / `monthly` / `yearly`), anchor date, optional end date.
- **F5.2** Monthly rules anchored to days 29–31 clamp to the last day of shorter
  months. Explicitly tested.
- **F5.3** Materialisation runs from the daily cron tick (§11), in the user's
  timezone, and is **idempotent** — keyed on `(rule_id, occurrence_date)` with a
  unique constraint. A cron double-fire can never double-charge.
- **F5.4** If the service was asleep or down, the next tick backfills every
  missed occurrence since `last_run_at`. Missed days are never skipped.
- **F5.5** Generated transactions are flagged `source = 'recurring'`, are
  editable, and deleting one does not delete the rule.
- **F5.6** The user gets one digest line per materialised recurring item, not one
  message each.

---

### F6 — Safe-to-spend goals engine ⭐

The core feature. One number.

**Definition**

```
budget          = user's monthly spending budget (SGD cents)
spentMTD        = Σ expenses this month, in user's timezone,
                  excluding categories flagged excludeFromBudget
daysRemaining   = daysInMonth − dayOfMonth + 1        // today counts
remaining       = budget − spentMTD
safeToSpendToday = max(0, floor(remaining / daysRemaining))
```

**Rules**
- **F6.1** Recomputed on every read and after every write. Never cached across a
  day boundary.
- **F6.2** Overspending today shrinks tomorrow automatically. Underspending grows
  it. This is the whole point — do not add a separate "rollover" toggle in v1.
- **F6.3** `remaining < 0` → the number is **0** and the UI switches to an
  over-budget state showing the overage, not a negative allowance.
- **F6.4** **Pace indicator:** `expectedSpend = budget × (dayOfMonth / daysInMonth)`.
  - `spentMTD < expectedSpend × 0.9` → **Ahead**
  - within ±10% → **On track**
  - `> expectedSpend × 1.1` → **Behind**
- **F6.5** Also surfaced: spent today, remaining this month, projected month-end
  total (`spentMTD / dayOfMonth × daysInMonth`).
- **F6.6** No budget set → onboarding suggests one from the last 60 days of data
  (or asks directly if there's no history). Until set, stats work and
  safe-to-spend shows an empty state. It must never show a fabricated number.
- **F6.7** Categories may be flagged `excludeFromBudget` (e.g. Transfers,
  Reimbursed) so one-off noise doesn't distort the daily figure.
- **F6.8** All arithmetic is integer cents. Division rounds **down**. Rounding
  must never let the sum of daily allowances exceed the monthly budget.

**Acceptance:** a property test asserts that for any budget and any spending
sequence, `Σ safeToSpend` over the month never exceeds `budget`.

---

### F7 — Statistics

| View | Contents |
|---|---|
| **Daily** | Spent today vs today's allowance (ring), today's transactions, 7-day sparkline |
| **Monthly** | Total in/out/net, category donut, day-by-day bars, top 5 merchants/notes, vs last month |
| **Yearly** | 12-month bars, yearly totals, category trend, best & worst month, average monthly burn |

**Rules**
- **F7.1** All aggregation happens in **SQL**, not JavaScript. Never pull a full
  transaction set into the API to sum it.
- **F7.2** Period boundaries are computed in the user's timezone
  (`Asia/Singapore`), not UTC. A 1 a.m. purchase belongs to that calendar day.
- **F7.3** Every chart is tappable, and every slice drills through to its
  filtered transaction list.
- **F7.4** Empty states are first-class, never a blank chart.
- **F7.5** Charts animate in on mount and animate *between* periods, never
  snapping (see [`DESIGN.md`](./DESIGN.md) §5).

---

### F8 — CSV export

- **F8.1** `/export` in chat, or a button in Mini App settings.
- **F8.2** Generated in-process and sent as a Telegram document. Never written to
  disk (there is no persistent disk).
- **F8.3** Columns: `date, direction, amount_sgd, category, note, source, has_photo, created_at`.
- **F8.4** Optional range argument: `/export 2026` or `/export 2026-08`.
- **F8.5** Amounts render as decimal SGD in the CSV, even though they're stored
  as cents.
- **F8.6** A large range must not blow the 512 MB runtime budget. In practice: one
  bounded query (capped well above this app's realistic scale of thousands of
  rows, as a typo/sanity guard rather than a real limit) generates the whole
  CSV in memory in one pass — simpler than chunked/streamed generation, and
  comfortably within budget at that scale.

---

### F9 — Daily digest

- **F9.1** Sent from the cron tick at a user-configured hour (default 21:00
  Asia/Singapore).
- **F9.2** Content: spent today, tomorrow's safe-to-spend, pace indicator,
  anything materialised by recurring rules, and a nudge if nothing was logged.
- **F9.3** One message. Never a thread.
- **F9.4** Fully disableable, and the "you logged nothing today" nudge is
  separately disableable. It must not become nagware.
- **F9.5** Weekly (Sunday) and monthly (last day) variants add period summaries.

---

### F10 — Categories

- **F10.1** Seeded on first run: Food, Groceries, Transport, Shopping, Bills,
  Health, Entertainment, Travel, Education, Gifts, Transfers, Uncategorised
  (expense); Salary, Bonus, Refund, Investment, Other Income (income).
- **F10.2** Each has an emoji, a colour token, and a keyword list.
- **F10.3** Users can rename, re-emoji, reorder, and archive. **Archive, never
  delete** — historical transactions must keep their category.
- **F10.4** Keyword inference is a deterministic map, e.g.
  `grab|gojek|mrt|bus|taxi → Transport`, `kopi|cafe|lunch|dinner → Food`.
- **F10.5** When a user corrects an inferred category, the note's keywords are
  added to that category's user-level overrides. It learns without an LLM.

---

### F11 — Edit, delete, undo

- **F11.1** `Undo` inline button on every confirmation card, valid 5 minutes.
- **F11.2** Full edit of every field in the Mini App.
- **F11.3** Deletes are **soft** (`deleted_at`), excluded from all aggregates,
  purged after 30 days.
- **F11.4** Every edit that changes amount, date, direction, or category
  re-animates the safe-to-spend figure so the consequence is visible.

---

## 8. Bot command surface

| Command | Behaviour |
|---|---|
| `/start` | Onboarding: timezone, monthly budget, opens Mini App |
| `/app` | Opens the Mini App |
| `/today` | Spent today + safe-to-spend + pace |
| `/month` | Month summary |
| `/budget [amount]` | Show or set the monthly budget |
| `/recent` | Last 10 transactions with edit buttons |
| `/undo` | Undo the most recent transaction |
| `/export [range]` | CSV export |
| `/recurring` | List and manage rules |
| `/settings` | Timezone, digest time, notification toggles |
| `/help` | Grammar cheat-sheet with examples |

Plain text with a leading amount is a capture. Anything else gets a gentle
"I didn't find an amount — try `12.50 lunch`" hint, at most once per hour.

---

## 9. Data model (logical)

```
users            id, telegram_id (unique), first_name, username, timezone,
                 currency, locale, monthly_budget_cents, digest_hour,
                 digest_enabled, nudge_enabled, onboarded_at, created_at

categories       id, user_id (nullable = system default), name, emoji,
                 color_token, kind (expense|income), keywords[],
                 exclude_from_budget, sort_order, archived_at

transactions     id, user_id, direction (in|out), amount_cents (int, > 0),
                 category_id, note, occurred_on (date, user tz),
                 occurred_at (timestamptz), source (chat|miniapp|recurring),
                 recurring_rule_id, deleted_at, created_at, updated_at

attachments      id, transaction_id, user_id, tg_file_id, tg_file_unique_id,
                 width, height, file_size, ocr_status, ocr_payload, created_at

recurring_rules  id, user_id, direction, amount_cents, category_id, note,
                 cadence, anchor_date, day_of_month, end_date, last_run_on,
                 active, created_at

recurring_runs   id, rule_id, occurrence_date, transaction_id, created_at
                 UNIQUE (rule_id, occurrence_date)      ← idempotency key

budget_periods   id, user_id, year, month, budget_cents, created_at
                 (historical budgets so past months stay accurate)

events           id, user_id, kind, payload_json, created_at
                 (append-only audit; also powers Undo)
```

**Invariants**
- `amount_cents` is a positive integer. Direction carries the sign. Never store
  negative amounts, never store floats.
- Every user-owned row has `user_id`, and every query filters on it.
- `occurred_on` is the user-timezone calendar date and is what all statistics
  group by. `occurred_at` exists for ordering and audit only.

---

## 10. Architecture

```
┌──────────────┐   webhook    ┌───────────────────────────────┐
│   Telegram   │─────────────▶│  Render Web Service (free)    │
│              │◀─────────────│  Hono + grammY (single proc)  │
└──────┬───────┘   Bot API    │  /telegram/webhook            │
       │                      │  /api/*   (initData auth)     │
       │ opens Mini App       │  /tasks/tick  (cron secret)   │
       ▼                      │  /healthz                     │
┌──────────────────┐          └───────────┬───────────────────┘
│ Render Static    │  fetch /api/*        │ postgres
│ Site (free, CDN, │─────────────────────▶│
│ never sleeps)    │                      ▼
│ React Mini App   │            ┌───────────────────┐
└──────────────────┘            │ Supabase Postgres │
                                │   (free tier)     │
┌──────────────────┐            └───────────────────┘
│ cron-job.org     │  every 10 min → /healthz   (anti-sleep)
│ (free)           │  every 1 hour → /tasks/tick (recurring + digest)
└──────────────────┘
```

**Why one process:** Render's free tier allows 750 instance-hours/month. Keeping
a single service awake 24/7 costs ~730. A second service would breach the quota
and start costing money. The Mini App is therefore a **static site** (free,
unmetered, no cold start), not a second web service.

Repository layout, library choices, and commands are specified in
[`CLAUDE.md`](./CLAUDE.md).

---

## 11. Scheduling & uptime

| Job | Cadence | Endpoint | Purpose |
|---|---|---|---|
| Keep-alive | every 10 min | `GET /healthz` | Prevent Render's 15-min idle spin-down |
| Tick | hourly | `POST /tasks/tick` | Materialise recurring rules, send digests due this hour, touch the DB so Supabase never pauses |

Both are driven by a free external scheduler (cron-job.org or UptimeRobot).
`/tasks/tick` requires a bearer secret and is **idempotent** — running it twice
in the same hour must be a no-op.

---

## 12. Security & privacy

- Mini App requests authenticate by validating Telegram `initData` HMAC
  server-side against the bot token. The client's claimed `user.id` is **never**
  trusted. Full algorithm and rules: [`GUARDRAILS.md`](./GUARDRAILS.md) §4.
- Webhook requests are verified via `X-Telegram-Bot-Api-Secret-Token`.
- Access is allowlisted to the owner's Telegram ID until multi-user ships.
- Financial amounts, notes, and photos are never logged.
- No third-party analytics, no ad SDKs, no external fonts in the Mini App.
- The user can export everything (F8) and request full deletion at any time.

---

## 13. Phased roadmap

| Phase | Contents | Definition of done |
|---|---|---|
| **P0 — Skeleton** | Monorepo, DB schema + migrations, health check, webhook, `/start`, deployed | Bot replies in production |
| **P1 — Capture** | F1 parser, F10 categories, F11 undo/edit, confirmation cards | 20 parser fixtures green; can log a day of real spending from chat |
| **P2 — Mini App** | F2 form, auth, transaction list, design system, motion | Opens from chat, logs a transaction, feels native |
| **P3 — Goals** | F6 safe-to-spend, budget onboarding, pace, ring | The number is right for every edge case in the test suite |
| **P4 — Stats** | F7 daily/monthly/yearly, drill-through, charts | All three periods, all charts animated |
| **P5 — Automation** | F5 recurring, F9 digest, cron wiring, F3 net cashflow | Rent auto-logs; 21:00 digest arrives |
| **P6 — Polish** | F4 photo viewer + OCR pre-fill, F8 export, empty states, error states, onboarding | Ready to hand to a second person |
| **v2** | Voice capture | — |

---

## 14. Open questions

| # | Question | Needed by | Default if unanswered |
|---|---|---|---|
| Q1 | What monthly budget should we seed? | P3 | Ask during `/start` onboarding |
| Q2 | Digest at 21:00 SGT — right time? | P5 | 21:00, user-configurable |
| Q3 | Should Transfers be excluded from budget by default? | P3 | Yes, excluded |
| Q4 | Preferred free cron provider — cron-job.org or UptimeRobot? | P0 | cron-job.org (supports POST + auth headers) |
| Q5 | Do you want the "you logged nothing today" nudge at all? | P5 | On, but one tap to disable |

---

## 15. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Render changes its free tier | Medium | High | Nothing Render-specific in code; Dockerfile + env-only config means we can move to Fly/Railway in an afternoon |
| Supabase pauses the project | Low | High | Hourly tick touches the DB; documented unpause procedure |
| Cold start makes the bot feel dead | Medium | Medium | 10-min keep-alive; Telegram retries webhooks; `/healthz` stays dependency-free so it answers instantly |
| Parser mis-reads amounts | Medium | High | Confirmation card on every capture + 5-minute undo; never silently save an ambiguous parse |
| Free-tier DB fills up (500 MB) | Low | Medium | Photos live in Telegram, not the DB. Text rows are tiny — 500 MB is ~10 years of daily use |
| Scope creep into voice/multi-currency, or OCR becoming authoritative instead of a suggestion | **High** | High | This document. Deferred means deferred; F4.6's guess is always visibly flagged and undoable, same as any other capture — never presented or treated as more certain than that. |
