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
- **Receipt photos** — attached to any transaction, stored free inside Telegram
- **Recurring transactions** — rent, salary, and subscriptions log themselves
- **CSV export & daily digest** — your data, and a nightly nudge

## Documentation

| Doc | Contents |
|---|---|
| [PRD.md](./PRD.md) | Product requirements, features, data model, roadmap |
| [GUARDRAILS.md](./GUARDRAILS.md) | Hard rules: cost, money maths, auth, privacy, scope |
| [DESIGN.md](./DESIGN.md) | Design system, motion, haptics, screens |
| [CLAUDE.md](./CLAUDE.md) | Stack, repo layout, commands, conventions, gotchas |

## Stack

TypeScript · grammY · Hono · Supabase Postgres · Drizzle · React 19 · Vite ·
Tailwind v4 · motion — deployed on Render's free tier.

## Status

📋 **Planning complete, implementation not started.** See [PRD.md §13](./PRD.md#13-phased-roadmap)
for the phased build order.

## License

[MIT](./LICENSE)
