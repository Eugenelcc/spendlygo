# Spendlygo — Guardrails

**These are hard rules.** They exist because breaking one costs money, loses
financial data, or leaks it. When a guardrail conflicts with convenience,
the guardrail wins. When it conflicts with a request, **stop and ask**.

Legend: 🔴 **NEVER** — violating this is a defect, no exceptions.
🟡 **ASK FIRST** — requires explicit human approval before proceeding.
🟢 **ALWAYS** — the required practice.

---

## 1. Cost — the project must remain S$0.00/month

> The single most important constraint. Every architectural decision is
> downstream of it.

- 🔴 **NEVER** add a dependency on a paid service, a paid tier, or a service
  that requires a credit card on file to start.
- 🔴 **NEVER** add a service with a *trial* that converts to paid. A 30-day
  trial is a 30-day bomb.
- 🔴 **NEVER** deploy a second Render web service. Free tier grants **750
  instance-hours/month**; one always-on service consumes ~730. A second one
  breaches the quota and starts billing.
- 🔴 **NEVER** use Render's free Postgres. It is **deleted after 30 days**.
  The database is Supabase. This is not a preference.
- 🔴 **NEVER** call a paid LLM/OCR/speech API. Category inference is a
  deterministic keyword map (PRD F10.4). If a feature seems to need an LLM,
  it is a v2 feature, not an v1 shortcut.
- 🟡 **ASK FIRST** before adding *any* new external service, even a free one —
  it becomes an availability dependency and a data-processor.
- 🟢 **ALWAYS** record, in `docs/adr/`, the free-tier limits of anything added
  and what happens when we hit them.

**The approved infrastructure list. Nothing else without approval:**

| Purpose | Service | Free limits (verify before relying) |
|---|---|---|
| Bot + API | Render Web Service | 512 MB, 0.1 CPU, 750 h/mo, sleeps after 15 min idle |
| Mini App | Render Static Site | Free, CDN-served, never sleeps |
| Database | Supabase Postgres | 500 MB DB, project pauses after 7 days idle |
| Photo storage | **Telegram itself** | Unlimited; we store `file_id` only |
| Scheduling | cron-job.org / UptimeRobot | Free tier |
| CI | GitHub Actions | Free for public repos |

---

## 2. Money arithmetic

- 🔴 **NEVER** represent money as a float, `number` with decimals, or a string
  that gets `parseFloat`ed. **Integer cents only**, everywhere: DB, API, UI
  state. Format to decimal at the very last render step.
- 🔴 **NEVER** store a negative amount. `amount_cents > 0` is a CHECK
  constraint; `direction` (`in`/`out`) carries the sign.
- 🟢 **ALWAYS** round *down* when dividing (e.g. safe-to-spend). The sum of
  daily allowances must never exceed the monthly budget.
- 🟢 **ALWAYS** unit-test money maths against the fixture set, including:
  0 budget, budget exceeded, last day of month, February, leap February,
  month with a mid-month budget change.
- 🟢 **ALWAYS** put currency in the type: `AmountCents` is a branded type, not
  a bare `number`, so a cents value can't be passed where dollars are expected.

---

## 3. Data integrity

- 🔴 **NEVER** hard-delete a transaction on user action. Soft-delete
  (`deleted_at`), exclude from aggregates, purge after 30 days.
- 🔴 **NEVER** run a destructive migration (`DROP COLUMN`, `DROP TABLE`,
  type narrowing) without an explicit backup step and human approval.
- 🔴 **NEVER** write raw SQL migrations by hand against production. Migrations
  are generated, committed, reviewed, and applied by the migration tool.
- 🔴 **NEVER** point a local dev run at the production database. Separate
  Supabase project (or branch) for development.
- 🟡 **ASK FIRST** before any backfill, bulk update, or data-repair script.
- 🟢 **ALWAYS** make every write path idempotent where an external system can
  retry it: Telegram **will** redeliver webhooks, and the cron **will**
  double-fire. Recurring materialisation is keyed
  `UNIQUE (rule_id, occurrence_date)` for exactly this reason.
- 🟢 **ALWAYS** wrap multi-row writes in a transaction.

---

## 4. Authentication & authorisation

- 🔴 **NEVER** trust `user.id` from Mini App `initData` without validating the
  HMAC signature server-side. The client controls that payload entirely.
- 🔴 **NEVER** accept a `user_id`, `telegram_id`, or account identifier from a
  request body or query string. The authenticated identity comes **only** from
  verified `initData` (Mini App) or the verified webhook `update` (bot).
- 🔴 **NEVER** expose an endpoint that returns another user's rows. Every query
  filters by the authenticated `user_id` — at the repository layer, so it
  cannot be forgotten at a call site.
- 🔴 **NEVER** expose a Telegram `file_id` to the client. Photos are proxied.
- 🟢 **ALWAYS** validate `initData` on every request, not just at session start:
  1. Parse the query-string pairs; extract and remove `hash`.
  2. Sort remaining pairs by key, join as `key=value` with `\n`.
  3. `secret = HMAC_SHA256(key="WebAppData", msg=BOT_TOKEN)`.
  4. Compare `HMAC_SHA256(key=secret, msg=dataCheckString)` to `hash` using a
     **constant-time** comparison.
  5. Reject if `auth_date` is older than 24 hours.
- 🟢 **ALWAYS** set and verify `X-Telegram-Bot-Api-Secret-Token` on the webhook.
  A request without it is not from Telegram.
- 🟢 **ALWAYS** enforce the `ALLOWED_TELEGRAM_IDS` allowlist while the bot is
  private. An unknown user gets a polite decline, not a stack trace.

---

## 5. Secrets

- 🔴 **NEVER** commit a bot token, database URL, service key, or cron secret.
  Not in code, not in a test fixture, not in a comment, not in a `.env` that
  isn't gitignored, not in a doc example.
- 🔴 **NEVER** print a secret to logs, an error message, or a Telegram reply.
- 🔴 **NEVER** put a secret in the Mini App bundle. Anything shipped to the
  browser is public. The Mini App knows the API base URL and nothing else.
- 🟢 **ALWAYS** read config through one typed, validated module that fails fast
  at boot with a clear message naming the missing variable.
- 🟢 **ALWAYS** keep `.env.example` current with every required key — names and
  descriptions only, never values.
- 🟢 If a token is ever exposed: revoke via BotFather **first**, rotate, then
  clean history.

---

## 6. Privacy

- 🔴 **NEVER** log transaction amounts, notes, merchant names, photo contents,
  or full `initData`.
- 🔴 **NEVER** add third-party analytics, ad SDKs, session-replay tools, or
  externally-hosted fonts/scripts to the Mini App.
- 🔴 **NEVER** send user financial data to any third party. There is no
  "just for debugging" exception.
- 🟢 **ALWAYS** log with structured, redacted fields: `user_id`, event kind,
  duration, outcome. Never the payload.
- 🟢 **ALWAYS** honour export (PRD F8) and full deletion on request.

---

## 7. Runtime budget (512 MB / 0.1 CPU)

- 🔴 **NEVER** add a headless browser, image-processing binary, ML runtime, or
  anything else that needs hundreds of MB resident.
- 🔴 **NEVER** load a full transaction history into memory to aggregate it.
  **Aggregate in SQL.** This applies to stats, exports, and digests alike.
- 🔴 **NEVER** use bot polling in production. Webhooks only — polling burns CPU
  continuously and keeps the free tier permanently busy.
- 🟢 **ALWAYS** stream large responses (CSV export) rather than buffering.
- 🟢 **ALWAYS** keep `/healthz` dependency-free — no DB call. It must answer in
  milliseconds even during a cold start, because it's what prevents sleep.
- 🟢 **ALWAYS** use a small connection pool (max 3–5). Supabase free has a
  modest connection cap and a sleeping service that wakes with 20 connections
  will fail.
- 🟢 **ALWAYS** connect via Supabase's **transaction pooler** and disable
  prepared statements in the Postgres driver — the pooler doesn't support them.

---

## 8. Frontend budget

- 🔴 **NEVER** ship a charting library, icon library, or component kit that adds
  more than ~30 KB gzipped for what one hand-written SVG would do.
- 🔴 **NEVER** hardcode colours in the Mini App. Telegram theme variables and
  design tokens only — the app must look right in every Telegram theme.
  See [`DESIGN.md`](./DESIGN.md) §2.
- 🟢 **ALWAYS** keep the initial JS bundle **under 200 KB gzipped**. CI fails
  the build if it exceeds it.
- 🟢 **ALWAYS** animate `transform` and `opacity` only. Animating `width`,
  `height`, `top`, or `left` causes layout thrash on mid-range Android.
- 🟢 **ALWAYS** respect `prefers-reduced-motion` — animations become instant
  state changes, never simply broken layouts.

---

## 9. Correctness of time

- 🔴 **NEVER** compute a "day", "month", or "year" boundary in UTC or in server
  local time. All period logic uses the **user's timezone** (`Asia/Singapore`).
  A 00:30 supper belongs to that calendar day, not the previous one.
- 🔴 **NEVER** use `new Date()` inside domain logic. Time is injected as a
  dependency, so tests can pin it.
- 🟢 **ALWAYS** store `occurred_on` as a date in the user's timezone and group
  statistics by it. `occurred_at` (timestamptz) is for ordering and audit only.
- 🟢 **ALWAYS** test month-end arithmetic against 28/29/30/31-day months.

---

## 10. Telegram platform rules

- 🔴 **NEVER** exceed ~30 messages/second globally or ~1 message/second to a
  single chat. Batch digests; never fan out one message per item.
- 🔴 **NEVER** let a webhook handler run long. Acknowledge fast (return 200),
  do the work, and if something is slow, respond first and follow up.
  Telegram retries on timeout, which causes duplicates.
- 🟢 **ALWAYS** handle `getFile`'s ~20 MB download limit and its ~1-hour URL
  expiry. Cache the resolved URL for ~50 minutes, then re-resolve.
- 🟢 **ALWAYS** answer every `callback_query`, even on error, or the client
  shows a spinner forever.
- 🟢 **ALWAYS** treat any Telegram API call as fallible: retry `429` honouring
  `retry_after`, and degrade gracefully on `5xx`.

---

## 11. Scope discipline

- 🔴 **NEVER** implement a feature listed as deferred in [`PRD.md`](./PRD.md)
  §5.2 (OCR, voice, multi-currency, households, bank import) without an
  explicit decision to promote it. "While I was in there" is how free projects
  become paid ones.
- 🟡 **ASK FIRST** when a request appears to conflict with the PRD, the
  zero-cost rule, or a guardrail. Surface the conflict; don't silently pick.
- 🟢 **ALWAYS** finish the phase in progress before starting the next
  ([`PRD.md`](./PRD.md) §13). A half-built Mini App plus a half-built stats
  screen is worth less than either one finished.

---

## 12. Git & delivery

- 🔴 **NEVER** commit `.env`, `*.db`, `node_modules`, build output, or real user
  data fixtures.
- 🔴 **NEVER** force-push a shared branch or rewrite pushed history.
- 🔴 **NEVER** merge with a failing CI check.
- 🟡 **ASK FIRST** before opening a pull request — PRs are opened on request,
  not automatically.
- 🟢 **ALWAYS** develop on `claude/telegram-expense-tracker-06gr8u` and push
  there with `git push -u origin <branch>`.
- 🟢 **ALWAYS** write commits that state *why*, referencing the PRD feature ID
  (`feat(parser): F1 amount grammar with k-suffix support`).
- 🟢 **ALWAYS** keep `main` deployable.

---

## 13. Testing floor

A change is not done until:

- 🟢 Money maths, the text parser, safe-to-spend, recurrence dates, and
  timezone boundaries have unit tests. These five are non-negotiable — they are
  where silent, expensive bugs live.
- 🟢 Every API route has a test asserting it **rejects unauthenticated and
  cross-user access**.
- 🟢 `typecheck`, `lint`, and `test` all pass locally before commit.
- 🟢 New parser behaviour adds a fixture to the golden set.

---

## 14. When to stop and ask the human

Stop and ask, rather than guessing, when:

1. A change would introduce cost, a new external service, or a second Render service.
2. A migration would drop or narrow a column, or a script would bulk-modify data.
3. A request conflicts with the PRD's scope or with any 🔴 rule above.
4. A feature seems to require an LLM, OCR, or speech API.
5. The requirement is ambiguous in a way that changes the data model.
6. Something in production looks wrong with real financial data.

Asking costs a minute. Any of these going wrong costs money or trust.
