# Session handoff — 2026-11-01

Written by the outgoing Claude session (owner: @eugenelcc) so a new session can
continue without the old conversation. Read this, then `CLAUDE.md`,
`WORKFLOW.md`, `GUARDRAILS.md`, `BACKLOG.md`, and the active spec.

## Where things stand

### B-032 Pay cycle (F17): Parts 1–3 merged, Part 4 is next
Spec (requirements, build plan, all owner decisions, reviews, test reports):
`docs/specs/B-032-pay-cycle.md`.

| Part | What | Status |
|---|---|---|
| 1 | Cycle maths (`packages/core/src/cycle.ts`), `households.cycle_start_day` (migration 0005, default 1), safe-to-spend, Today, `/today` | ✅ merged (#16) |
| 2 | Stats month view, History "Cycle" chip, recap, monthly digest, alerts (Q2 A key) | ✅ merged (#17) |
| 3 | Export: `/export` = everything (unchanged); `cycle`, `last cycle`, calendar month/year, custom `from..to`; dated file names; Mini App picker; CORS `exposeHeaders`; `Sheet` portals to `document.body` | ✅ merged (#18) |
| **4** | **Setting the start day:** `PATCH /api/settings {cycleStartDay}`, `/settings` day picker (callbacks carry space id), Mini App budget card select, partner notification, rollback note: P4-AC1…P4-AC18 | **next: start with the test-writer** |
| 5 | Budget history: past cycles show the budget that applied then, per space. Owner chose to **rebuild `budget_periods` in place** (destructive), so it needs grilling → Requirements → Build plan → `challenger`, a **backup step**, and separate owner approval of the migration | not planned yet |

Until Part 4 ships, every space is on start day 1, so the app looks unchanged.
The owner's real setup will be **start day 20** (paid on the 20th).

### Other open items
- **Branch `docs/B-037-requirements-build-plan` is NOT in main:** the
  "Requirements / Build plan" renaming (WORKFLOW, TEMPLATE, agents), DESIGN.md
  `S$` → `$` (owner chose `$`), and BACKLOG B-038–B-041 (runbook, postmortems,
  changelog, Definition of Ready). Ask the owner whether to open a PR for it.
  The spec and agents already use the new names on main via B-032 work, but the
  agent files in main still say "Spec/Plan approved", so tell agents that
  "Requirements approved" / "Build plan approved" count as the approvals.
- **B-029:** branch `claude/telegram-expense-tracker-06gr8u` (another session)
  has **unapproved** multi-currency (Frankfurter API), split expenses, and its own
  ADR 0007 + migrations 0005/0006 that clash with main. **Don't merge it.** The
  owner decides later.
- **B-010** now includes: primary buttons use Telegram `button_color`, which
  measured 4.13:1 (light) / 3.72:1 (dark), below DESIGN §10's 4.5:1. The owner
  accepted it for B-032 Part 2; fix it app-wide in B-010.
- **Now** queue after B-032: B-001 (purge soft-deleted), B-002 (account deletion),
  B-003 (`/month`, build on top of cycles).
- **Project starter kit:** a separate session ("Project starter kit (from
  Spendlygo foundation)") is building `Eugenelcc/project-starter-kit`. Claude
  can't create repos on this account (403), so the owner creates it.
- Stale remote branches the owner may delete: `ccr-5e696e71-4ezjyv`,
  `docs/B-031-workflow-foundation`, `feat/B-004-settings-command`.

## How the owner wants to work (binding, see WORKFLOW.md)
- **Never assume.** If unsure, ask, with a **plain-language scenario first**, then
  the technical detail, and **pros/cons for every option** plus a recommendation.
  Grill in rounds (≤4 questions) before any spec; play back a recap.
- Model routing: Opus = `spec-planner`, `challenger`, `reviewer`; Sonnet =
  `test-writer`, `builder`. Tests are written first. The main session
  orchestrates, verifies, and talks to the owner.
- **Verify every subagent claim yourself** (diff, test changes, real test count
  via `pnpm ci:local`). This caught several real problems.
- One feature per PR; open a PR only when the owner says yes; Claude never merges.
  The owner often deletes the branch on merge: recreate it from `main`
  (`git checkout -B feat/B-032-pay-cycle origin/main`); nothing is lost.
- Money prints as `$` (`formatCents`, SGD, en-SG), never `S$`.

## Environment recipes (cloud container)

**Local Postgres for `pnpm ci:local`** (Postgres 16 binaries are installed; the
data dir must live outside /tmp scratch dirs, or it dies on restart):
```bash
D=/var/lib/postgresql/spendlygo-test
[ -d $D ] || su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $D -U postgres --auth=trust"
rm -f $D/postmaster.pid
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $D -o '-p 5432 -k /tmp' -l $D/log start"
psql -h localhost -U postgres -tAc "create database spendlygo_test" 2>/dev/null
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/spendlygo_test pnpm ci:local
```
The container restarts stop Postgres; re-run the `pg_ctl start` line.

**Real-stack screenshots of the Mini App** (how P1/P2/P3 UI ACs were verified):
1. Start the server against the local DB with throwaway env (never real
   secrets): `BOT_TOKEN='123456:LOCAL_SCREENSHOT_ONLY_not_a_real_token'`,
   `TELEGRAM_WEBHOOK_SECRET`, `DATABASE_URL=…spendlygo_test`,
   `MINIAPP_URL=http://localhost:4173`, `CRON_SECRET` (≥16 chars),
   `ALLOWED_TELEGRAM_IDS=980000000050`, `AUTO_SET_WEBHOOK=false`, `PORT=3000`,
   then `cd apps/server && npx tsx src/index.ts`.
2. `VITE_API_BASE_URL=http://localhost:3000 pnpm --filter @spendlygo/miniapp build`,
   then `cd apps/miniapp && npx vite preview --port 4173`.
3. Sign `initData` with that token (HMAC: secret = HMAC_SHA256("WebAppData",
   token); hash = hex HMAC_SHA256(secret, sorted `key=value` lines)), and open
   `http://localhost:4173/#tgWebAppData=<initData>&tgWebAppColorScheme=dark&tgWebAppThemeParams=<json>`
   in Playwright (`createRequire(import.meta.url)('playwright')`; ESM `import`
   fails) at 375×812.
4. Set the start day directly for testing:
   `update households set cycle_start_day=20 where id=(select active_household_id from users where telegram_id=980000000050)`
   (Part 4 adds the real setter).
5. Use `page.route` to force slow or failed API calls. Toasts last 2.6 s, so
   check right after the action. Kill the server and preview by PID when done.

**GitHub:** the `mcp__github__*` tools work for PRs and checks. CI status can be
read without auth from `https://api.github.com/repos/Eugenelcc/spendlygo/actions/runs?head_sha=…`.
`*.onrender.com` is blocked by the proxy (you can't hit prod).

## Next action for the new session
1. Confirm with the owner that Part 4 should start. Then launch `test-writer`
   for **Part 4 only** (P4-AC1…AC18) on `feat/B-032-pay-cycle`, then `builder`,
   verify, take real-stack screenshots (budget card select, `/settings` day
   picker text), run the `reviewer`, and ask the owner before opening the PR.
2. After Part 4 merges, the owner sets day 20; then ask about Part 5 (grill first).
