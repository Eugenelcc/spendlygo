# apps/server — local rules

The one deployed Render web service: the grammY bot, the Hono `/api` for the
Mini App, and `/tasks/tick`, all in one process. The root `CLAUDE.md` and
`GUARDRAILS.md` still apply. This file only adds what's specific to this
folder. The `packages/db` rules are here too, because this is its only
consumer.

## Map

| Path | What lives there |
|---|---|
| `src/index.ts` | Boot: bind HTTP **first**, then init the bot (ADR 0004), `ensureWebhook` |
| `src/app.ts` | Hono app: `/healthz`, `/telegram/webhook` (secret-token check), mounts `/api` and `/tasks` |
| `src/config.ts` | The only place env is read. Zod-validated, fails fast at boot |
| `src/context.ts` | `AppContext` = `{ config, db, dbHandle, clock }`, passed explicitly to everything |
| `src/api/index.ts` | All `/api` routes; `api/service.ts` holds shared computations (`computeSafeToSpend`, `computePeriodStats`, `todayFor`, `activeHouseholdId`) |
| `src/bot/` | `index.ts` registers commands; `commands/*.ts` one file per command; `capture.ts` is the F1 text path; `photo-capture.ts` handles F4 and F4.6 |
| `src/tasks/tick.ts` | Hourly tick: recurring materialisation, budget alerts, digests, DB keep-warm |
| `src/middleware/` | `auth.ts` (initData → `user`), `errors.ts` (DomainError → status) |
| `src/telegram/` | `init-data.ts` HMAC check, `photos.ts` getFile proxy + URL cache, `ocr.ts` OCR.space, `errors.ts` retry classification |

## Architecture: thin edges, logic in the middle

Every request, whether a bot command, an API route or a tick job, flows the
same way. Keep each layer to its job:

```
Telegram update / HTTP request / cron tick
        │
        ▼
 EDGE      bot/commands/<name>.ts · api/index.ts route · tasks/<job>.ts
           parse + validate input (Zod / parser), get identity, format reply
        │      no SQL, no business rules here
        ▼
 SERVICE   api/service.ts (computeSafeToSpend, computePeriodStats, …)
           orchestrates repositories + pure core functions
        │
        ├──▶ CORE         @spendlygo/core — pure maths, dates, parsing
        └──▶ REPOSITORY   @spendlygo/db repositories — SQL, filtered by user
```

| Rule | Detail |
|---|---|
| One file per bot command | `bot/commands/<name>.ts` exports `handle<Name>`; registered in `bot/index.ts` |
| Bot and API share logic | If the bot and the Mini App show the same number, both call the **same** `service.ts` function (e.g. `/today` and `GET /api/today`) |
| Edges stay thin | A handler that grows business logic moves it into `service.ts`, or into `core` if it's pure |
| Rendering stays at the edge | Bot Markdown (`bot/markdown.ts`) and JSON shapes (`@spendlygo/shared`) are built at the edge, never in services |
| Tick jobs: one file each | `tasks/<job>.ts`, called from `tasks/tick.ts`, idempotent (see below) |

## Rules

- **Identity.** In the API, the user comes only from `c.get('user')`, which
  only `middleware/auth.ts` sets. In the bot, it comes only from
  `botCtx.appUser`, set by `withUser`. Never read a user or space ID from a
  body, query string or header.
- **The active space** comes from `activeHouseholdId(...)`, never from the
  client. Every capture and screen acts on that one space (F12.3).
- **No `process.env`** outside `config.ts`. A new variable means updating
  `config.ts`, `.env.example`, the env table below, and `render.yaml`
  if Render must set it.
- **Errors.** Throw the typed errors from `@spendlygo/core`
  (`ValidationError`, `NotFoundError`, …). `middleware/errors.ts` maps them to
  HTTP status codes. Nothing below the route knows about HTTP. Unknown errors
  become a generic 500.
- **Logging.** Use `logger` with `describeError`, with structured fields only:
  user ID, event kind, outcome. Never amounts, notes, merchant names, receipt
  text or `initData` (GUARDRAILS §6).
- **Webhook handlers** must be fast and idempotent. Always call
  `answerCallbackQuery`, even on the error path.
- **Tick jobs** must be idempotent under a double-fire. Use the
  reserve-then-send pattern from `tasks/alerts.ts`: record first behind a
  unique key, send, and release the record if sending fails. Also, one user's
  failure must never stop the loop for everyone else.
- **Telegram calls** are fallible. Retry 429 honouring `retry_after`. Don't
  retry a permanent 4xx (`isPermanentTelegramError`).
- **Request and response shapes** come from `@spendlygo/shared` (Zod).
  Amounts cross the wire as integer cents.

## Database (`packages/db`)

- Every repository function takes the user (or space) and filters by it
  itself. No call site may add the filter on its own.
- Aggregate in SQL. Never pull rows into JS to sum them.
- Connection: `prepare: false`, small pool (Supabase transaction pooler).
- Schema change: edit `schema.ts` → `pnpm db:generate` → commit the generated
  SQL. Never hand-write production SQL. Drops and narrowing need approval
  (GUARDRAILS §3). The migration must work with the currently running server.
- The partial-index and `excluded.*` gotchas below apply here.

## Tests

- Every new or changed route needs a test showing it **rejects
  unauthenticated and cross-user access**.
- DB-backed tests use `describeIfDb` on `TEST_DATABASE_URL`, so they skip
  locally without a database but always run in CI against Postgres 16. Don't
  replace the real DB with a fake.
- Inject a pinned `Clock` through `AppContext`. Never let a test depend on
  today's date.

---

## Environment variables

*(Moved here from root `CLAUDE.md` on 2026-10-31.)*

Keep `.env.example` in sync with this table. Never commit real values.

| Variable | Where | Purpose |
|---|---|---|
| `BOT_TOKEN` | server | BotFather token. Also the `initData` HMAC key. |
| `TELEGRAM_WEBHOOK_SECRET` | server | Verified against `X-Telegram-Bot-Api-Secret-Token` |
| `DATABASE_URL` | server | Supabase **transaction pooler** URL (port 6543) |
| `MINIAPP_URL` | server | Static site URL, used in `web_app` buttons |
| `CRON_SECRET` | server | Bearer token guarding `/tasks/tick` |
| `OCR_SPACE_API_KEY` | server | Free-tier key for receipt OCR (F4.6, ADR 0005). Optional: photo attachments still work without it, just without the amount pre-fill |
| `ALLOWED_TELEGRAM_IDS` | server | Comma-separated allowlist while private |
| `NODE_ENV` | server | `development` \| `production` |
| `PORT` | server | Injected by Render |
| `AUTO_SET_WEBHOOK` | server | `true` (default) lets the server register its own webhook at boot. Set `false` when a tunnel points a dev bot at localhost |
| `VITE_API_BASE_URL` | miniapp | Server origin. **Public — never put a secret here.** |

Config is read once through a Zod-validated module that fails fast at boot,
naming any missing variable. Nothing calls `process.env` directly.

---

## Deployment

Two Render services, both free, both in `render.yaml`:

1. **`spendlygo-api`** — Web Service (Node). The bot and API in one process.
   Health check `/healthz`.
2. **`spendlygo-app`** — Static Site. The built Mini App. Never sleeps, no
   instance hours.

Database is **Supabase**, provisioned separately and referenced by
`DATABASE_URL`.

Scheduling is external and free (cron-job.org):

| Job | Cadence | Request |
|---|---|---|
| Keep-alive | every 10 min | `GET /healthz` |
| Tick | hourly | `POST /tasks/tick` with `Authorization: Bearer $CRON_SECRET` |

🔴 **Do not add a third Render service.** The free tier grants 750
instance-hours/month; one always-on service uses ~730. See `GUARDRAILS.md` §1.

**Deploying needs no local tooling.** The API service's build command runs
`pnpm db:migrate && pnpm db:seed` after a successful build, Render generates
`TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET` via `generateValue`, and the server
registers its own Telegram webhook at boot (`ensureWebhook`, controlled by
`AUTO_SET_WEBHOOK`). Only `BOT_TOKEN`, `ALLOWED_TELEGRAM_IDS`, `DATABASE_URL`
and, optionally, `OCR_SPACE_API_KEY` are supplied by hand — none of these can
be auto-generated, they come from an external account.

Migrations run in the **build**, not at boot: a failed migration then fails the
deploy loudly instead of leaving a half-working service serving traffic. Both
commands are idempotent, so they are safe on every deploy.

**Deploy order for a schema change:** migrations ship with the deploy that needs
them, so they must be backward-compatible with the *currently running* server —
the old version keeps serving until the new one passes its health check.

---

## Gotchas (learned the hard way — add to this list)

| Gotcha | Handling |
|---|---|
| Render free tier sleeps after 15 min idle | 10-minute keep-alive ping; `/healthz` must have **zero dependencies** so it answers instantly during a cold start |
| Render free Postgres is deleted after 30 days | We don't use it. Database is Supabase. |
| Supabase free project pauses after ~7 days idle | The hourly tick touches the DB, keeping it warm |
| Supabase transaction pooler rejects prepared statements | `postgres(url, { prepare: false, max: 3 })` |
| Telegram redelivers webhooks on timeout | Every handler is idempotent; acknowledge fast, work after |
| `getFile` URLs expire in ~1 hour | Cache the resolved URL ~50 min, then re-resolve. Never store the URL in the DB — store `file_id`. |
| `file_id` is bot-specific and must stay server-side | Photos are proxied through `/api/photos/:id` |
| `callback_query` left unanswered | Always `answerCallbackQuery`, even on the error path, or the client spins forever |
| tsup bundling a CJS dependency into ESM | Its `require()` calls throw at runtime and only in production. `skipNodeModulesBundle: true` keeps node_modules external; only `@spendlygo/*` is bundled |
| Server bundles `@spendlygo/db` source | That package's runtime imports (`drizzle-orm`, `postgres`) become the server's, and pnpm's strict layout means they must be declared in `apps/server/package.json` |
| `bot.init()` before `serve()` | Makes Telegram a hard dependency of startup, so an outage fails the Render health check and rolls back the deploy. HTTP binds first; the webhook returns 503 until the bot is ready (ADR 0004) |
| Postgres treats NULLs as distinct in unique indexes | `UNIQUE (user_id, slug)` does **not** constrain system categories where `user_id IS NULL`. A partial unique index `ON (slug) WHERE user_id IS NULL` does, and is the seed's conflict target |
| `onConflictDoUpdate` with `set: { name: table.name }` | Assigns each column to itself and silently does nothing. Use ``sql`excluded.name` `` |
| pnpm runs each script with its own package as cwd | A plain `dotenv/config` would read `packages/db/.env` for migrations and `apps/server/.env` for the bot. Every script resolves the **root** `.env` explicitly |
| Render's `fromService` returns `host:port`, never a URL | No scheme, so it fails URL validation and makes the Mini App fetch a relative path. Config normalises a bare host; `render.yaml` uses literals |
| Telegram's `secret_token` charset | Only `A-Za-z0-9_-`. Render's `generateValue` emits base64 with `+/=`, so `setWebhook` returns `400: secret token contains illegal characters`. Config hashes the configured secret to a hex token that is always legal — so what we send Telegram is never the raw value |
| Retrying a Telegram 4xx | A malformed request fails identically forever. `isPermanentTelegramError` stops the loop and logs once, loudly; 429 stays retryable because it asks us to retry |
| Postgres NOTICEs on re-migration | `CREATE ... IF NOT EXISTS` for drizzle's bookkeeping logs a NOTICE object every run. Suppress with `onnotice` or it reads like a failed migration |
| Drizzle 0.38 has no `.nullsNotDistinct()` on the index builder | Use a partial unique index with `.where()` instead |
| `budget_alerts.year/month` = the calendar month the **cycle ends in**, not of today (B-032) | `cycleAlertKey` in core. Moving the start day can skip one threshold once (never double-sends); documented in PRD F13.3. No per-cycle table on purpose (owner choice Q2 A). Alerts are keyed by user, not space: switching spaces does not reset them (PRD F13.3) |
| Cross-origin JS can't read response headers unless CORS exposes them | `exposeHeaders: ['Content-Disposition']` in the `/api/*` CORS config, so the Mini App reads export file names (B-032 part 3) |
| `updateSettingsSchema` is `.strict()` on purpose (B-032) | A new field must be added to the schema in the same PR as the route that handles it, so an older server answers 400 instead of silently dropping it |
