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
  `config.ts`, `.env.example`, root `CLAUDE.md`'s env table, and `render.yaml`
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
- The partial-index and `excluded.*` gotchas in root `CLAUDE.md` apply here.

## Tests

- Every new or changed route needs a test showing it **rejects
  unauthenticated and cross-user access**.
- DB-backed tests use `describeIfDb` on `TEST_DATABASE_URL`, so they skip
  locally without a database but always run in CI against Postgres 16. Don't
  replace the real DB with a fake.
- Inject a pinned `Clock` through `AppContext`. Never let a test depend on
  today's date.
