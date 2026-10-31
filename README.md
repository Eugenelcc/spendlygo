# Spendlygo

A Telegram-native expense and income tracker with an animated Mini App —
built to run **24/7 for S$0.00/month**.

Log a spend in under three seconds (`12.50 lunch`), then open the Mini App from
the same chat to see one honest number: **how much you can safely spend today**
without blowing the month.

## Features

- **Quick-text capture** — `12.50 lunch #food`, `+3000 salary`, `45 dinner @yesterday`
- **Mini App** — animated numpad, category chips, haptics, native Telegram theming
- **Safe-to-spend** — a daily allowance that recalculates from what you actually spent
- **Statistics** — daily, monthly, and yearly views with drill-through charts
- **Income & net cashflow** — not just what goes out
- **Receipt photos** — attached to any transaction, stored free inside Telegram,
  with an optional OCR pre-fill of the amount (needs a free OCR.space key)
- **Recurring transactions** — rent, salary, and subscriptions log themselves
- **Shared spaces** — a personal budget plus any number of shared ones, joined
  by code and switched between freely (`/switch`) without leaving any of them
- **Spending alerts & digests** — proactive 80%/over-budget warnings, plus a
  nightly, weekly, and end-of-month wrap-up
- **Savings goals** — tracked separately from the monthly budget, funded by
  tagging a transfer to them
- **Logging streaks** — a 🔥 nudge for consecutive days logged
- **Recap** — an on-demand, shareable month or year wrap-up (`/recap`)
- **CSV export** — every transaction, any range, from the bot (`/export`) or the Mini App

## Documentation

| Doc | Contents |
|---|---|
| [PRD.md](./PRD.md) | Product requirements, features, data model, roadmap |
| [GUARDRAILS.md](./GUARDRAILS.md) | Hard rules: cost, money maths, auth, privacy, scope |
| [DESIGN.md](./DESIGN.md) | Design system, motion, haptics, screens |
| [CLAUDE.md](./CLAUDE.md) | Stack, repo layout, commands, conventions, gotchas |
| [WORKFLOW.md](./WORKFLOW.md) | How work flows: backlog → plan → branch → verify → PR → done |
| [BACKLOG.md](./BACKLOG.md) | The plan: what's next, what's parked, known drift |

## Stack

TypeScript · grammY · Hono · Supabase Postgres · Drizzle · React 19 · Vite ·
Tailwind v4 · motion — deployed on Render's free tier.

## Status

🚀 **Usable.** Phases P0–P4 are done: quick-text capture, the Mini App, the
safe-to-spend engine, and statistics.

```
P0 skeleton   ██████████ done
P1 capture    ██████████ done
P2 mini app   ██████████ done
P3 goals      ██████████ done
P4 stats      ██████████ done
P5 automation ██████████ done
P6 polish     █████████░  photos + OCR + CSV export done; purge, account deletion, polish audit open
```

What's left is tracked in [BACKLOG.md](./BACKLOG.md).

450 tests (DB-backed ones run in CI against Postgres), initial Mini App bundle 86 KB gzipped (43% of the 200 KB budget).

## Running it locally

```bash
pnpm install
cp .env.example apps/server/.env      # fill in BOT_TOKEN and DATABASE_URL
pnpm db:migrate && pnpm db:seed
pnpm dev
```

Deployment is described in [CLAUDE.md](./CLAUDE.md#deployment); the Render
blueprint is [render.yaml](./render.yaml).

## Architecture decisions

Short records of the non-obvious calls live in [docs/adr](./docs/adr):

1. One web service plus a static site
2. Supabase instead of Render's Postgres
3. Receipt photos stay in Telegram
4. The HTTP server starts before the bot
5. Receipt OCR via OCR.space, as a pre-fill suggestion only
6. Households become many-to-many "spaces"

## License

[MIT](./LICENSE)
