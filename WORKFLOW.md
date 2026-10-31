# Spendlygo — Workflow

How work moves from an idea to production. This is the process; the rules it
must respect live in [`GUARDRAILS.md`](./GUARDRAILS.md), and what to build lives
in [`PRD.md`](./PRD.md) and [`BACKLOG.md`](./BACKLOG.md).

Agreed with the owner (@eugenelcc) on 2026-10-31. Change it the same way: ask,
agree, then edit this file in its own PR.

---

## 1. The loop at a glance

```
BACKLOG item ──▶ plan ──▶ owner OK ──▶ branch ──▶ build + tests + docs
     ▲                                                   │
     │                                                   ▼
  new ideas parked                         checks green ──▶ push
  in "Later"                                             │
     │                                       owner asks ──▶ PR (Claude opens)
     │                                                   │
     │                         CI green + owner review ──▶ owner merges
     │                                                   │
     └──────────── BACKLOG updated ◀── smoke-tested ◀── Render deploys
```

Nothing skips a box. A task is not **done** until the last box (§8).

---

## 2. Session ritual (Claude)

### Start of every session

1. Read `CLAUDE.md`, `GUARDRAILS.md`, and `BACKLOG.md`. Read `PRD.md` /
   `DESIGN.md` sections relevant to the task.
2. Sync: `git fetch origin main`.
3. Confirm which backlog item this session is for. If the request has no
   backlog item, add one first (§3).
4. Create the task branch from the latest `main` (§5), or use the branch the
   session was given.

### End of every session

1. Run `pnpm typecheck && pnpm lint && pnpm test`. Report the real result,
   including failures.
2. Update `BACKLOG.md`: move the item's status, add anything parked (§9).
3. Commit and push the branch.
4. Report to the owner:
   - **Done** — what changed, with the backlog and feature IDs
   - **Not done** — anything skipped or failing, and why
   - **Next** — the single next step (usually "review and ask for the PR" or
     the next backlog item)

---

## 3. Intake: every task is a backlog item

- All work maps to an item in `BACKLOG.md` with an ID (`B-###`) and, where it
  touches product behaviour, a PRD feature ID (`F1`–`F16`).
- A request that isn't in the backlog gets added to it **before** work starts,
  in the right section, with acceptance criteria.
- A request that isn't in the PRD and adds product behaviour needs a PRD entry
  too. Write it in the same PR as the code (§8).
- A request that conflicts with `GUARDRAILS.md` or the PRD's scope stops here:
  surface the conflict and ask (GUARDRAILS §14).

## 4. Plan before building

For anything bigger than a small fix (a typo, a one-line bug fix, a doc
correction), Claude posts a short plan and **waits for the owner's OK** before
writing code:

```
Backlog: B-### — <title>            Feature: F#
Change:  <what, in two or three lines>
Files:   <main files touched>
Data:    <schema/migration change? backward-compatible with the running server?>
Tests:   <which tests are added; any of the dangerous five touched?>
Risks:   <cost, privacy, guardrail notes — or "none">
Split:   <if more than one feature ID: how it splits into PRs>
```

Always plan first, however small the change, when it involves a schema
change, a new dependency, a new external service, or anything in
GUARDRAILS §14.

## 5. Branches

- **One branch per task**, cut from the latest `main`, short-lived.
- Name: `<type>/<backlog-id>-<slug>`, for example `feat/B-003-month-command`,
  `fix/B-007-soft-delete-purge`, `docs/B-012-adr-index`.
  `<type>` is the Conventional Commit type (`feat`, `fix`, `docs`, `refactor`,
  `test`, `chore`, `ci`).
- A cloud session that is assigned a branch name uses that name instead.
- Never commit directly to `main`. Never force-push a shared branch or rewrite
  pushed history.
- Push with `git push -u origin <branch>`.

## 6. Building

- **One feature ID per PR.** Split anything larger into numbered parts, e.g.
  "part 1 of 2 (data model + bot)", "part 2 of 2 (Mini App)", as F12 was.
- Follow the conventions in `CLAUDE.md` and the nested `CLAUDE.md` of the
  workspace you're in (`apps/server`, `apps/miniapp`, `packages/core`).
- Commits are Conventional Commits with the feature ID in the scope or body:
  `feat(stats): F7 add /month summary command`.
- Ideas that come up mid-task go to `BACKLOG.md` → **Later**. They are mentioned
  in the end-of-session report and **never built in the current task**.

## 7. Verification

Every change, before asking for a PR:

| Check | Who | When |
|---|---|---|
| `pnpm typecheck && pnpm lint && pnpm test` | Claude | Before every commit |
| Tests for the dangerous five (money, parser, safe-to-spend, recurrence, timezones) | Claude | Any change touching them, no exceptions |
| Auth + cross-user rejection test | Claude | Every new or changed API route |
| Mini App screenshots: light **and** dark theme at 375px | Claude | Any UI change, via the pre-installed headless Chromium; attached to the PR |
| Try it on the **development bot** + dev Supabase project | Owner | Before merging |
| CI green (`.github/workflows/ci.yml`) | GitHub | Before merging; never merge on red |

## 8. Pull requests and merging

- Claude opens a PR **only when the owner asks**. Claude **never merges.**
- PR body: the backlog ID, the feature ID, what changed, how it was verified
  (§7), screenshots for UI, and any migration notes.
- The owner reviews, confirms CI is green, and merges.
- Migrations ship with the PR that needs them and must work with the currently
  running server (`CLAUDE.md` → Deployment).

### Definition of done

A task is done only when **all** of these hold:

1. **Docs are updated in the same PR.** If behaviour changed, the PRD says so.
   If files moved, `CLAUDE.md`'s layout says so. If you learned a lesson, it's
   in the gotchas. `README.md` status and `BACKLOG.md` are current.
2. **The dangerous five are tested** wherever they were touched.
3. **It's deployed and smoke-tested**: after Render deploys `main`, check
   `/healthz` and log one real transaction through the bot.

Only then does the backlog item move to **Done**.

## 9. The backlog

`BACKLOG.md` is the single plan. Sections:

| Section | Meaning |
|---|---|
| **Now** | Being worked on or next up. Keep it short. |
| **Next** | Agreed and ready, in priority order. |
| **Later** | Parked ideas. Not agreed, not scheduled. |
| **Drift & debt** | Places where the code and docs disagree, or a guardrail isn't met yet |
| **Done** | Finished items, newest first, with their PR number |

Each item: `B-###`, a title, the feature ID, acceptance criteria, and its
status. IDs are never reused.

## 10. When production breaks

**Revert first, fix second.**

1. Roll back: redeploy the last good deploy in Render, or revert the offending
   PR on `main`.
2. Confirm `/healthz` and a real capture work.
3. Open a `fix/B-###-<slug>` branch and fix it through the normal loop,
   including a test that would have caught it.
4. Add the lesson to `CLAUDE.md` → Gotchas.

If real financial data looks wrong (wrong totals, missing or duplicated
transactions), **stop and ask the owner** before touching any data
(GUARDRAILS §3 and §14.6). Never run a repair script unasked.

## 11. Changing this document

This workflow was agreed with the owner. Claude doesn't change it alone.
Propose the change, get agreement, then edit it in its own `docs/` PR.
