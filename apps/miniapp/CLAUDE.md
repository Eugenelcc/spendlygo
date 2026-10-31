# apps/miniapp — local rules

The React 19 + Vite Mini App, deployed as a Render **static site**. The root
`CLAUDE.md`, `GUARDRAILS.md` and especially `DESIGN.md` apply. This file
only adds what's specific to this folder.

## Map

| Path | What lives there |
|---|---|
| `src/App.tsx` | Tab shell (Today · Stats · History · Settings), TanStack Query provider, space switcher |
| `src/screens/` | `Today`, `Stats`, `History`, `Settings` (one screen per file) |
| `src/components/` | Reusable pieces: `Capture` (sheet), `Ring`, `Money`, `Sheet`, `TransactionRow`, hand-written SVG charts (`BarChart`, `LineChart`, `Sparkline`, `CategoryDonut`, `CalendarHeatmap`), photo viewer, goals/household/recurring sections |
| `src/lib/api.ts` | The only HTTP client. Typed with `@spendlygo/shared`, sends `initData` on every request |
| `src/lib/telegram.ts` | Launch params, theme application, `haptics`, ready/close. Hand-rolled, no SDK |
| `src/lib/format.ts` | Formatting helpers |
| `src/styles.css` | Design tokens (DESIGN §2–5) and all styles |

## What's actually installed

React, React DOM, `@tanstack/react-query`, and `@spendlygo/shared`. Nothing
else ships to the browser. There's **no** Tailwind, `motion`, or
`@telegram-apps/sdk-react`. Styling is plain CSS over custom properties, and
the Telegram bridge reads the launch fragment directly. Whether that's
permanent is tracked as BACKLOG B-011. Adding any runtime dependency is a plan
item, and GUARDRAILS §8's 200 KB gzipped budget is enforced in CI by
`scripts/check-bundle-size.mjs`.

## Rules

- **Imports.** Only `@spendlygo/shared`. Never import `@spendlygo/core`,
  `@spendlygo/db`, or anything from `apps/server`.
- **No secrets.** Everything here is public. The only env value is
  `VITE_API_BASE_URL`.
- **No third-party origins.** No analytics, remote fonts or remote scripts
  (GUARDRAILS §6).
- **Server state** goes through TanStack Query. Writes are optimistic and roll
  back on failure, keeping the user's input (F2.9). Local UI state uses
  `useState` / `useReducer`.
- **Money.** The client holds integer cents. Format only at render time through
  `<Money>`. Never `parseFloat` an amount.
- **Colour** comes from tokens in `styles.css` only, and every Telegram variable
  has a fallback. Never hardcode a hex in a component. Expenses are not red.
- **Motion** animates `transform` and `opacity` only, and honours
  `prefers-reduced-motion`. Use the timings in DESIGN §5.1. Nothing loops
  except a real loading indicator.
- **Haptics** go through `haptics` in `lib/telegram.ts`, which feature-checks.
  They fire only on user actions, never on load or scroll.
- **Navigation.** Use Telegram's `MainButton` and `BackButton`, not custom
  equivalents. Keep primary actions in the bottom third and nothing critical
  in the top-right.
- **Every async view** has loading (skeleton), empty, error and populated
  states.
- **React 19:** `import type { JSX } from 'react'`.

## Verifying a UI change (WORKFLOW §7)

Screenshot the changed screen in **light and dark** at **375px** with the
pre-installed headless Chromium, and attach them to the PR. The owner then
checks it on the dev bot inside Telegram.
