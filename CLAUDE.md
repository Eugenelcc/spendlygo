# CLAUDE.md — Spendlygo

Operating manual for Claude Code (and any human) working in this repository.
Read this first, then the doc it points you to for the task at hand.

---

## What this is

**Spendlygo** is a Telegram-native personal expense and income tracker with a
Mini App front end. Its core feature is a daily **safe-to-spend** number that
answers *"how much can I spend today without blowing the month?"*

It must run **24/7 for S$0.00/month, permanently.** That constraint drives
nearly every technical decision here.

## Document map

| Doc | Read it when |
|---|---|
| [`PRD.md`](./PRD.md) | You need to know *what* to build, feature IDs (F1–F11), the data model, or the phase order |
| [`GUARDRAILS.md`](./GUARDRAILS.md) | **Before every change.** Hard rules on cost, money maths, auth, secrets, privacy, and scope |
| [`DESIGN.md`](./DESIGN.md) | You are touching anything the user sees — colour, type, motion, haptics, components |
| `CLAUDE.md` (this file) | Repo layout, commands, conventions, deployment, gotchas |

If a request conflicts with `GUARDRAILS.md`, **stop and ask.** Do not silently
resolve the conflict.

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, `strict: true` | One language across bot, API, and UI; shared domain types |
| Runtime | Node 22 LTS | Pinned in `.nvmrc` and `engines` |
| Package manager | pnpm workspaces | Fast, disk-efficient, first-class monorepo support |
| Bot | **grammY** | Modern, typed, excellent webhook + middleware story |
| HTTP | **Hono** | Tiny and fast; matters on a 512 MB / 0.1 CPU instance |
| DB | **Supabase Postgres** | Free tier with no expiry (Render's free Postgres self-deletes after 30 days) |
| ORM | **Drizzle** + `postgres.js` | SQL-first, typed, generated migrations, tiny runtime |
| Validation | **Zod** | One schema shared by API boundaries and the parser |
| Mini App | **React 19 + Vite** | Fast builds, small output |
| Styling | **Tailwind v4** over CSS custom properties | Telegram theme vars flow through tokens |
| Animation | **motion** | Spring physics + shared layout transitions |
| Data fetching | **TanStack Query** | Cache, optimistic updates, retries |
| Telegram SDK | `@telegram-apps/sdk-react` | Typed access to theme, haptics, MainButton |
| Charts | **hand-written SVG** | No chart library — full animation control, no bundle cost |
| Tests | **Vitest** | Fast; same config across packages |

**Rejected on purpose:** Nest (memory), Prisma (bundle + engine size), Recharts
and friends (bundle), any component kit (fights Telegram's theme), any paid or
credit-card-required service (see `GUARDRAILS.md` §1).

---

## Repository layout

```
spendlygo/
├── apps/
│   ├── server/              # THE deployed Render web service (bot + API, one process)
│   │   └── src/
│   │       ├── index.ts         # Hono app, route mounting, boot
│   │       ├── bot/             # grammY: commands, capture handler, callbacks, keyboards
│   │       ├── api/             # /api routes consumed by the Mini App
│   │       ├── tasks/           # /tasks/tick — recurring materialisation + digests
│   │       ├── middleware/      # initData auth, webhook secret, rate limit, error handler
│   │       └── telegram/        # Bot API helpers, file proxy + URL cache
│   └── miniapp/             # Render Static Site (React + Vite)
│       └── src/
│           ├── screens/         # today, capture, stats, history, settings
│           ├── components/      # Ring, Odometer, Money, charts, sheets
│           ├── theme/           # Telegram theme vars → design tokens
│           └── lib/             # api client, haptics, formatters
├── packages/
│   ├── core/                # PURE domain logic — no I/O, no Date.now(), fully unit-tested
│   │   └── src/
│   │       ├── money.ts         # AmountCents branded type, arithmetic, formatting
│   │       ├── parser.ts        # F1 quick-text grammar
│   │       ├── safe-to-spend.ts # F6 goals engine
│   │       ├── recurrence.ts    # F5 occurrence dates, month-end clamping
│   │       ├── categories.ts    # F10 keyword inference
│   │       └── time.ts          # user-timezone period boundaries
│   ├── db/                  # Drizzle schema, migrations, repositories
│   └── shared/              # Zod schemas + types shared by server and miniapp
├── docs/adr/                # Architecture decision records
├── PRD.md  GUARDRAILS.md  DESIGN.md  CLAUDE.md
└── render.yaml              # Infrastructure as code for both Render services
```

**Layering rule:** `core` depends on nothing. `db` depends on `core`.
`server` depends on both. `miniapp` depends only on `shared`.
Never import `db` from `core`, and never import server code into the Mini App.

---

## Commands

```bash
pnpm install              # install everything

pnpm dev                  # server (tsx watch) + miniapp (vite) together
pnpm dev:server           # server only
pnpm dev:miniapp          # miniapp only

pnpm build                # build all workspaces
pnpm typecheck            # tsc --noEmit everywhere  ← must pass before commit
pnpm lint                 # eslint + prettier check  ← must pass before commit
pnpm test                 # vitest run               ← must pass before commit
pnpm test:watch

pnpm db:generate          # generate a migration from schema changes
pnpm db:migrate           # apply migrations
pnpm db:studio            # Drizzle Studio
pnpm db:seed              # seed default categories

pnpm bot:set-webhook      # register the webhook with Telegram
pnpm bot:delete-webhook   # unregister (needed before local polling)
```

**Local development:** run `pnpm dev`, expose the server with a free tunnel
(`cloudflared tunnel --url http://localhost:3000`), and point a **separate
development bot** at it. Never point a dev run at the production bot or the
production database (`GUARDRAILS.md` §3).

---

## Environment variables

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

## Conventions

**TypeScript**
- `strict: true`, no `any`. Use `unknown` and narrow.
- Money is `AmountCents` (a branded `number`), never a bare number.
- Domain errors are typed classes; API boundaries map them to status codes.
- Prefer pure functions in `core`. Side effects live at the edges.

**Time**
- Never call `new Date()` inside domain logic — inject a `Clock`.
- Every "day"/"month"/"year" boundary is computed in the **user's timezone**.

**Database**
- Every user-owned table has `user_id`, and filtering happens in the repository
  layer so no call site can forget it.
- Aggregate in SQL, never in JavaScript.
- Soft-delete transactions; never hard-delete on user action.

**API**
- Routes under `/api`, authenticated by validated `initData` on every request.
- Request and response bodies are Zod-validated at the boundary.
- Amounts cross the wire as integer cents.

**React**
- Function components, hooks, no class components.
- Server state lives in TanStack Query; local state in `useState`/`useReducer`.
- Component files are one component plus its styles; anything reusable moves to
  `components/`.
- Colours come from tokens only (`DESIGN.md` §2).

**Naming**
- Files `kebab-case.ts`; components `PascalCase.tsx`; DB `snake_case`;
  TS/JSON `camelCase`.
- Booleans read as predicates: `isDeleted`, `hasPhoto`, `canEdit`.

**Commits**
- Conventional Commits, with the PRD feature ID in the scope or body:
  `feat(parser): F1 support k-suffix amounts`
  `fix(safe-to-spend): F6.3 clamp negative remaining to zero`

---

## Working agreement

1. **Read `GUARDRAILS.md` before changing anything.** It is short, and it is
   binding.
2. **Work the phases in order** (`PRD.md` §13). Finish P1 before starting P2.
   A half-built parser plus a half-built stats screen is worth less than either
   one finished.
3. **Cite the feature ID** you're implementing in the commit and the PR body.
4. **Test the dangerous five** — money maths, the text parser, safe-to-spend,
   recurrence dates, timezone boundaries. Those are where silent, expensive bugs
   live. No change to them ships without tests.
5. **Run `pnpm typecheck && pnpm lint && pnpm test`** before every commit.
6. **Ask when uncertain**, especially about cost, data loss, or scope
   (`GUARDRAILS.md` §14). Guessing is the expensive option here.
7. **Record non-obvious decisions** as a short ADR in `docs/adr/`.

### Git

- Develop and push on **`claude/telegram-expense-tracker-06gr8u`**.
- `git push -u origin claude/telegram-expense-tracker-06gr8u`.
- **Do not open a pull request unless explicitly asked.**
- Never force-push a shared branch. Keep `main` deployable.

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
| Telegram theme vars differ across clients | Always supply a CSS fallback: `var(--tg-theme-bg-color, #fff)` |
| Haptics throw on unsupported clients | Feature-check before every call |
| Month-end recurrence (29–31) | Clamp to the last day of shorter months; explicitly tested |
| Float money errors | Integer cents everywhere; `AmountCents` branded type prevents mix-ups |
| `callback_query` left unanswered | Always `answerCallbackQuery`, even on the error path, or the client spins forever |
| tsup bundling a CJS dependency into ESM | Its `require()` calls throw at runtime and only in production. `skipNodeModulesBundle: true` keeps node_modules external; only `@spendlygo/*` is bundled |
| Server bundles `@spendlygo/db` source | That package's runtime imports (`drizzle-orm`, `postgres`) become the server's, and pnpm's strict layout means they must be declared in `apps/server/package.json` |
| `bot.init()` before `serve()` | Makes Telegram a hard dependency of startup, so an outage fails the Render health check and rolls back the deploy. HTTP binds first; the webhook returns 503 until the bot is ready (ADR 0004) |
| Postgres treats NULLs as distinct in unique indexes | `UNIQUE (user_id, slug)` does **not** constrain system categories where `user_id IS NULL`. A partial unique index `ON (slug) WHERE user_id IS NULL` does, and is the seed's conflict target |
| `onConflictDoUpdate` with `set: { name: table.name }` | Assigns each column to itself and silently does nothing. Use ``sql`excluded.name` `` |
| React 19 removed the global `JSX` namespace | `import type { JSX } from 'react'` |
| pnpm runs each script with its own package as cwd | A plain `dotenv/config` would read `packages/db/.env` for migrations and `apps/server/.env` for the bot. Every script resolves the **root** `.env` explicitly |
| Render's `fromService` returns `host:port`, never a URL | No scheme, so it fails URL validation and makes the Mini App fetch a relative path. Config normalises a bare host; `render.yaml` uses literals |
| Telegram's `secret_token` charset | Only `A-Za-z0-9_-`. Render's `generateValue` emits base64 with `+/=`, so `setWebhook` returns `400: secret token contains illegal characters`. Config hashes the configured secret to a hex token that is always legal — so what we send Telegram is never the raw value |
| Retrying a Telegram 4xx | A malformed request fails identically forever. `isPermanentTelegramError` stops the loop and logs once, loudly; 429 stays retryable because it asks us to retry |
| Postgres NOTICEs on re-migration | `CREATE ... IF NOT EXISTS` for drizzle's bookkeeping logs a NOTICE object every run. Suppress with `onnotice` or it reads like a failed migration |
| Drizzle 0.38 has no `.nullsNotDistinct()` on the index builder | Use a partial unique index with `.where()` instead |
