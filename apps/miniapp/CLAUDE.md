# apps/miniapp — local rules

The React 19 + Vite Mini App, deployed as a Render **static site**. The root
`CLAUDE.md`, `GUARDRAILS.md` and especially `DESIGN.md` apply. This file
only adds what's specific to this folder.

## Architecture: one folder per feature

Agreed with the owner on 2026-10-31. **Status: target.** The code is moving
there one feature per PR (BACKLOG B-016 to B-023). Until a feature has moved,
its files are still in the current layout (below). **All new code goes into
the target layout.**

```
src/
├── main.tsx                  # mount <App/> only
├── app/
│   ├── App.tsx               # thin shell: providers + tab switch + space pill (≤ ~100 lines)
│   └── providers.tsx         # QueryClient, theme application
├── features/                 # one folder per product area
│   ├── today/                # TodayScreen.tsx · use-today.ts · today.css · *.test.tsx
│   ├── capture/              # CaptureSheet.tsx · use-create-transaction.ts
│   ├── stats/                # StatsScreen.tsx · CategoryDonut.tsx · CalendarHeatmap.tsx
│   ├── history/              # HistoryScreen.tsx · use-transactions.ts
│   ├── settings/             # SettingsScreen.tsx · GoalsSection · HouseholdSection · RecurringForm
│   ├── spaces/               # SpaceSwitcher.tsx · use-spaces.ts
│   └── recap/                # RecapCard.tsx · use-recap.ts
├── ui/                       # reusable, presentational, NO data fetching:
│                             #   Money, Ring, Sheet, TransactionRow, BarChart,
│                             #   LineChart, Sparkline, PhotoViewer, PhotoThumbnail
├── lib/
│   ├── api.ts                # the only HTTP client (typed with @spendlygo/shared)
│   ├── query-keys.ts         # every TanStack Query key, in one place
│   ├── telegram.ts           # launch params, theme, haptics, ready/close
│   └── format.ts
└── styles/
    ├── tokens.css            # DESIGN §2–5 tokens: the only place colours are defined
    └── base.css              # resets, typography, layout primitives
```

### Rules for the structure

| Rule | Why |
|---|---|
| `features/*` may import `ui/`, `lib/`, `@spendlygo/shared` | Features are composed from shared parts |
| `ui/` imports only `lib/` (formatting) and React. **Never** `features/` or `lib/api.ts` | Keeps reusable parts pure and testable |
| Features **don't import each other**. Something two features need moves to `ui/` or `lib/` | Stops a hidden web of dependencies |
| A feature's data hooks (`use-*.ts`, wrapping `useQuery`/`useMutation`) live **in that feature** | `App.tsx` no longer owns every query |
| Query keys come from `lib/query-keys.ts` | So invalidation after a write is never a typo |
| A feature's CSS sits beside it (`today.css`), using tokens only | No 2,000-line stylesheet. Colours still come from one place |
| Component files ≤ ~250 lines. Split before going over | Reviewable diffs |
| Files: components `PascalCase.tsx`, hooks and modules `kebab-case.ts`, tests `*.test.ts(x)` beside the file | Matches root `CLAUDE.md` naming |

These boundaries are meant to be enforced with ESLint's built-in
`no-restricted-imports` (no new dependency), set up in B-017.

### Current layout (until migrated)

| Path | What's there today |
|---|---|
| `src/App.tsx` | ~600 lines: tab shell **and** all 29 queries and mutations |
| `src/screens/` | `Today`, `Stats`, `History`, `Settings` |
| `src/components/` | Reusable pieces mixed with feature sections (`GoalsSection`, `HouseholdSection`, …) |
| `src/lib/` | `api.ts`, `telegram.ts`, `format.ts` |
| `src/styles.css` | ~2,200 lines: tokens and every style |

## What's installed

React, React DOM, `@tanstack/react-query`, `@spendlygo/shared`. Nothing else
ships to the browser. There's **no** Tailwind, `motion`, or
`@telegram-apps/sdk-react`. Styling is plain CSS over custom properties, and
the Telegram bridge reads the launch fragment directly (whether that's
permanent: BACKLOG B-011). A new runtime dependency is a Plan-stage decision.
The 200 KB gzipped budget (GUARDRAILS §8) is enforced in CI by
`scripts/check-bundle-size.mjs`.

## Rules

- **Imports.** Only `@spendlygo/shared` from the monorepo. Never
  `@spendlygo/core`, `@spendlygo/db`, or `apps/server`.
- **No secrets.** Everything here is public. The only env value is
  `VITE_API_BASE_URL`.
- **No third-party origins.** No analytics, remote fonts or remote scripts
  (GUARDRAILS §6).
- **Server state** goes through TanStack Query hooks inside the feature.
  Writes are optimistic and roll back on failure, keeping the user's input
  (F2.9). Local UI state uses `useState` / `useReducer`.
- **Money.** The client holds integer cents. Format only at render, via
  `<Money>`. Never `parseFloat` an amount.
- **Colour** comes from tokens only, and every Telegram variable has a
  fallback. Never hardcode a hex in a component. Expenses are not red.
- **Motion** animates `transform` and `opacity` only, and honours
  `prefers-reduced-motion`. Use the DESIGN §5.1 timings. Nothing loops except
  a real loading indicator.
- **Haptics** go through `haptics` in `lib/telegram.ts` (feature-checked) and
  fire on user actions only.
- **Navigation.** Use Telegram's `MainButton` and `BackButton`. Primary
  actions go in the bottom third. Nothing critical in the top-right.
- **Every async view** has loading (skeleton), empty, error and populated
  states.
- **React 19:** `import type { JSX } from 'react'`.

## Tests

**Agreed:** Vitest + Testing Library (dev-only dependencies, no bundle cost).
**Status:** not set up yet. That's BACKLOG B-016, the first restructure step.
Once it is:
- Hooks and `lib/` functions get unit tests.
- Every feature screen gets tests for its **loading, empty, error and
  populated** states, against a mocked `lib/api.ts`.
- Tests sit beside the file (`TodayScreen.test.tsx`).

Until then, UI changes are verified by light and dark screenshots at 375px
(headless Chromium) and the owner's dev-bot check (WORKFLOW Stage 4–5).

## Gotchas

| Gotcha | Handling |
|---|---|
| Telegram theme vars differ across clients | Always supply a CSS fallback: `var(--tg-theme-bg-color, #fff)` |
| Haptics throw on unsupported clients | Feature-check before every call |
| React 19 removed the global `JSX` namespace | `import type { JSX } from 'react'` |
| The cycle start day field saves through `mutateAsync` (B-032 part 4) | `CycleStartDayField` shows the picked day at once and falls back to `me.cycle.startDay` when the promise rejects (e.g. a 400 from an older, strict server), so there is never a false "Saved". The ordinal helper is duplicated from `@spendlygo/core` because the Mini App can't import it |
