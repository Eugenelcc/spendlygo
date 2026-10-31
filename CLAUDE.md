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
| [`WORKFLOW.md`](./WORKFLOW.md) | **Start and end of every session.** The pipeline: intake → spec → plan → build → test → review → release → close, with success/failure for each stage |
| [`docs/specs/`](./docs/specs) | A task is past intake. Each item's spec and plan live here (`TEMPLATE.md`) |
| [`BACKLOG.md`](./BACKLOG.md) | Choosing what to work on. Every task is a `B-###` item here |
| `CLAUDE.md` (this file) | Repo layout, commands, conventions, deployment, gotchas |
| `apps/server/CLAUDE.md`, `apps/miniapp/CLAUDE.md`, `packages/core/CLAUDE.md` | Local rules for that workspace. Loaded automatically when you work there |
| [`docs/adr/`](./docs/adr) | Why a non-obvious decision was made (0001–0006) |

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
| Styling | **Plain CSS over custom properties** (`apps/miniapp/src/styles.css`) | Telegram theme vars flow through tokens; zero runtime cost |
| Animation | **CSS transitions / hand-written** — no animation library installed | Bundle budget; see BACKLOG B-011 for whether to adopt `motion` |
| Data fetching | **TanStack Query** | Cache, optimistic updates, retries |
| Telegram bridge | **Hand-rolled** `apps/miniapp/src/lib/telegram.ts` — no SDK installed | Reads launch params from the URL fragment; no third-party script |
| Charts | **hand-written SVG** | No chart library — full animation control, no bundle cost |

> The stack originally planned Tailwind v4, `motion` and
> `@telegram-apps/sdk-react`. None of them were adopted, and the table above
> shows what is actually installed. Whether to keep it that way is
> BACKLOG B-011.
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
│   │   ├── CLAUDE.md            # local rules for the server (and packages/db)
│   │   └── src/
│   │       ├── index.ts         # boot: HTTP first, then bot init (ADR 0004)
│   │       ├── app.ts           # Hono app: /healthz, webhook + secret check, route mounting
│   │       ├── config.ts        # the only reader of env (Zod, fail fast)
│   │       ├── bot/             # grammY: commands/, capture, photo-capture, keyboards
│   │       ├── api/             # /api routes (index.ts) + shared computations (service.ts)
│   │       ├── tasks/           # /tasks/tick — recurring, budget alerts, digests
│   │       ├── middleware/      # initData auth, error handler
│   │       └── telegram/        # initData HMAC, photo proxy + URL cache, OCR, error classes
│   └── miniapp/             # Render Static Site (React + Vite)
│       ├── CLAUDE.md            # local rules + architecture for the Mini App
│       └── src/                 # TARGET layout — migrating one feature per PR (B-016…B-023)
│           ├── main.tsx         # mount only
│           ├── app/             # thin shell: App.tsx (providers + tabs), providers.tsx
│           ├── features/        # one folder per area: today, capture, stats, history,
│           │                    #   settings, spaces, recap — screen + hooks + CSS + tests
│           ├── ui/              # reusable, no data fetching: Money, Ring, Sheet, charts…
│           ├── lib/             # api client, query keys, Telegram bridge + haptics, format
│           └── styles/          # tokens.css (DESIGN.md §2–5), base.css
│                                # (until migrated: App.tsx, screens/, components/, styles.css)
├── packages/
│   ├── core/                # PURE domain logic — no I/O, no Date.now(), fully unit-tested
│   │   ├── CLAUDE.md            # local rules for the dangerous five
│   │   └── src/
│   │       ├── money.ts         # AmountCents branded type, arithmetic, formatting
│   │       ├── parser.ts        # F1 quick-text grammar
│   │       ├── safe-to-spend.ts # F6 goals engine
│   │       ├── recurrence.ts    # F5 occurrence dates, month-end clamping
│   │       ├── categories.ts    # F10 keyword inference
│   │       ├── time.ts          # user-timezone period boundaries
│   │       ├── clock.ts         # injected Clock
│   │       ├── savings.ts       # F14 savings goal progress
│   │       ├── streaks.ts       # F15 logging streaks
│   │       ├── receipt-text.ts  # F4.6 total guessing from OCR text
│   │       └── csv-export.ts    # F8 CSV rows
│   ├── db/                  # Drizzle schema, migrations, repositories
│   └── shared/              # Zod schemas + types shared by server and miniapp
├── scripts/                 # CI checks: Render blueprint, Mini App bundle size
├── docs/adr/                # Architecture decision records
├── docs/specs/              # one spec + plan per backlog item (TEMPLATE.md)
├── PRD.md  GUARDRAILS.md  DESIGN.md  CLAUDE.md  WORKFLOW.md  BACKLOG.md
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
- Feature code lives in `features/<area>/`; anything reusable moves to `ui/`
  (`apps/miniapp/CLAUDE.md`).
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

The full process is in [`WORKFLOW.md`](./WORKFLOW.md). In short:

1. **Read `GUARDRAILS.md` before changing anything.** It is short, and it is
   binding.
2. **Every task is a `BACKLOG.md` item.** Unless it's a small fix (WORKFLOW
   §1), write a spec, then a plan, in `docs/specs/`. Each needs the owner's
   "approved" before moving on. After 2 failed attempts at anything, stop and
   escalate.
3. **Cite the backlog and feature IDs** in the branch, commits and PR body.
   One feature ID per PR.
4. **Test the dangerous five**: money maths, the text parser, safe-to-spend,
   recurrence dates, timezone boundaries. That's where silent, expensive bugs
   live. No change to them ships without tests.
5. **Run `pnpm typecheck && pnpm lint && pnpm test`** before every commit.
6. **Update docs in the same PR** whenever behaviour, layout or a lesson
   changes, so the docs never drift from the code.
7. **Park side ideas** in `BACKLOG.md` → Later. Never build them in the
   current task.
8. **Ask when uncertain**, especially about cost, data loss or scope
   (`GUARDRAILS.md` §14). Guessing is the expensive option here.
9. **Record non-obvious decisions** as a short ADR in `docs/adr/`.

### Git

- **One branch per task**, cut from the latest `main`, named
  `<type>/<backlog-id>-<slug>` (e.g. `feat/B-003-month-command`). A cloud
  session that is assigned a branch name uses that name.
- `git push -u origin <branch>`. Never commit directly to `main`.
- **Open a pull request only when the owner asks. Never merge.** The owner
  merges after review and green CI.
- Never force-push a shared branch. Keep `main` deployable.
- Production broken? Revert first, fix second (WORKFLOW §6).

---

## Where the rest lives

To keep this file small (it loads in every session and every subagent),
area-specific detail lives in the nested `CLAUDE.md` that auto-loads with
that area:

| Topic | Now in |
|---|---|
| Environment variables, deployment, server and infra gotchas | `apps/server/CLAUDE.md` |
| Mini App architecture, UI rules, Mini App gotchas | `apps/miniapp/CLAUDE.md` |
| Rules and gotchas for the dangerous five | `packages/core/CLAUDE.md` |
| Agent roles and models per stage | `.claude/agents/` (see `WORKFLOW.md` §1) |

A new gotcha goes into the nested file for the area where it bites. Only
something repo-wide goes here.
