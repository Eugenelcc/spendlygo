# Spendlygo — Workflow

How work moves from an idea to production. This file is the process. The
rules it must respect are in [`GUARDRAILS.md`](./GUARDRAILS.md), and what to
build is in [`PRD.md`](./PRD.md) and [`BACKLOG.md`](./BACKLOG.md).

Agreed with the owner (@eugenelcc) on 2026-10-31. To change it: ask, agree,
then edit it in its own `docs/` PR (§12).

---

## 1. The pipeline at a glance

```
 0 INTAKE ─▶ 1 SPEC ─▶ 2 PLAN ─▶ 3 TEST ─▶ 4 BUILD ─▶ 5 REVIEW ─▶ 6 RELEASE ─▶ 7 CLOSE
  B-###      what      how      failing    until     agent, then   deploy +     BACKLOG
             ✋ owner   ✋ owner  tests      green     owner        smoke test   → Done
             approves  approves  first               merges ✋
```

✋ marks a human gate. Claude never passes one alone.

### Who does each stage: models and handoff

Each stage runs as a **project subagent** in `.claude/agents/`, with its own
model. Expensive judgement goes to Opus. Execution against a fixed plan goes
to Sonnet.

| Stage | Agent | Model | Writes |
|---|---|---|---|
| 1–2 Spec + Plan | `spec-planner` | **Opus** | Spec and Plan sections |
| 3 Test | `test-writer` | **Sonnet** | Failing tests + Test report |
| 4 Build | `builder` | **Sonnet** | Code + Test report results + Build notes |
| 5 Review | `reviewer` | **Opus** | Review section (read-only on code) |

**The spec file is the handoff.** Every agent gets only the path
`docs/specs/B-###-<slug>.md`, never the chat history. It then reads that file,
`GUARDRAILS.md`, and the nested `CLAUDE.md` of the areas it touches. Each
agent writes its result back into its section of the spec. Nothing important
lives only in a conversation, so context survives across agents and sessions.

**The main session orchestrates.** It talks to the owner, relays the spec
and plan for approval, records `approved by owner, <date>`, then launches the
next agent. Subagents never ask the owner directly.

**Escalation between models.** When `builder` or `test-writer` hits the
2-attempt limit, or finds that the plan doesn't match the code, it hands back
to `spec-planner` (Opus) to re-plan. A plan change needs the owner's approval
again.

**Small-fix lane:** a change may skip stages 1 and 2 (but nothing else) if it
is **all** of:
- docs, a typo, or a contained bug fix of about **30 changed lines or fewer**
- **no** schema, dependency, API-shape, or external-service change
- **no** change to the dangerous five (money maths, parser, safe-to-spend,
  recurrence dates, timezone boundaries)

If in doubt, it isn't a small fix.

**Escalation rule (every stage):** after **2 honest failed attempts** at the
same problem, stop and report to the owner. Include what failed (the real
output), what was tried, and the options. Never keep looping, and never hide a
failure.

---

## 2. The stages

Each stage lists its input, its output, what success looks like, and what
happens on failure.

### Stage 0 — Intake

| | |
|---|---|
| **Input** | A request from the owner, a bug, or a backlog item |
| **Do** | Find the item in `BACKLOG.md`. If it isn't there, add it with a `B-###` ID, title, feature ID (F1–F16) and section |
| **Output** | A backlog item |
| ✅ **Success** | The item exists and the work maps to exactly one feature ID |
| ❌ **Failure** | It conflicts with `GUARDRAILS.md` or PRD scope (e.g. a deferred feature, a paid service) → **stop and ask** (GUARDRAILS §14). Nothing is built. It spans several features → split into several items |

### Stage 1 — Spec (*what*) ✋

| | |
|---|---|
| **Input** | The backlog item, the relevant PRD sections |
| **Do** | Write `docs/specs/B-###-<slug>.md` from [`docs/specs/TEMPLATE.md`](./docs/specs/TEMPLATE.md): problem, user stories, **acceptance criteria as Given / When / Then**, edge cases, out of scope. Post a summary in the session |
| **Output** | A spec file on the task branch |
| ✅ **Success** | The owner replies **"approved"** in the session. Claude writes `Spec approved by owner, <date>` at the top of the spec |
| ❌ **Failure** | Changes requested → revise and re-post. Unclear → ask, don't guess. The scope grew → split it into new backlog items |

### Stage 2 — Plan (*how*) ✋

| | |
|---|---|
| **Input** | The approved spec |
| **Do** | Fill in the spec's **Plan** section: files touched, data and migration (backward-compatible with the running server?), which test proves each acceptance criterion, risks, PR split. Post it |
| **Output** | A completed Plan section |
| ✅ **Success** | The owner replies **"approved"**. Claude writes `Plan approved by owner, <date>` |
| ❌ **Failure** | It needs a new service, a paid tier, a destructive migration, or a bulk data change → GUARDRAILS §14, stop and ask. Rejected → revise |

### Stage 3 — Test, written first (`test-writer`, Sonnet)

| | |
|---|---|
| **Input** | The spec with Spec and Plan approved |
| **Do** | Write the tests the Plan names, **one per acceptance criterion** plus the edge cases, **before** any feature code. Run `pnpm test`; they should fail |
| **Must include** | Dangerous five touched → their fixture tests (`packages/core/CLAUDE.md`). New or changed API route → a test rejecting unauthenticated and cross-user access. New parser behaviour → a golden fixture |
| **Output** | Committed failing tests. The spec's Test report lists each AC → test → `❌ failing (expected)` |
| ✅ **Success** | Every acceptance criterion has a test, and each fails for the right reason (the feature is missing) |
| ❌ **Failure** | A test passes before the build → it proves nothing; rewrite it or flag it. A criterion can't be tested as written → back to Stage 1 |

### Stage 4 — Build (`builder`, Sonnet)

| | |
|---|---|
| **Input** | The approved plan + the failing tests |
| **Do** | Code on the task branch (§3) until the tests pass. Follow the nested `CLAUDE.md`. Conventional Commits citing the feature ID. Update the docs the plan names, in the same branch. Run `pnpm typecheck && pnpm lint && pnpm test`. UI change → light and dark screenshots at 375px (pre-installed headless Chromium) |
| **Output** | Commits. The spec's Test report shows ✅ per AC with a one-line check summary. Build notes list deviations and parked ideas |
| ✅ **Success** | All checks green, every AC test passes, nothing built beyond the plan |
| ❌ **Failure** | The plan doesn't match the code → hand back to `spec-planner` to re-plan (owner re-approves). Red after **2 honest attempts** → escalate (§1). **Never** skip, disable or loosen a test to get green. Side idea → park it in BACKLOG → Later |

### Stage 5 — Review (`reviewer`, Opus, then the owner ✋)

| | |
|---|---|
| **Input** | The green task branch |
| **Do** | **5a, agent review:** `reviewer` checks the diff against the spec and GUARDRAILS, reruns the checks, and writes the Review section with a verdict. **5b, owner review:** when the owner asks, Claude opens the PR. Body: backlog ID, feature ID, spec link, summary, **the review checklist (§4)**, screenshots for UI, migration notes. The owner tests on the **dev bot** + dev Supabase |
| **Output** | Review verdict in the spec, then an open PR |
| ✅ **Success** | Reviewer verdict `ready for owner`, CI green, checklist holds, the owner merges. **Claude never merges** |
| ❌ **Failure** | Verdict `back to build` → Stage 4 with the listed findings. `back to plan` → Stage 2. CI red or owner changes → Stage 4. A design flaw → Stage 2 |

### Stage 6 — Release

| | |
|---|---|
| **Input** | The merge to `main`. Render deploys automatically |
| **Do** | Smoke test: `GET /healthz` responds, and one real transaction logs through the bot |
| **Output** | Live in production |
| ✅ **Success** | Both smoke checks pass |
| ❌ **Failure** | **Revert first, fix second** (§6) |

### Stage 7 — Close

| | |
|---|---|
| **Input** | Release passed |
| **Do** | Move the item to BACKLOG → Done with its PR number. Confirm the docs are current |
| ✅ **Success** — the **Definition of Done** | (1) docs updated in the same PR, (2) dangerous five tested wherever touched, (3) deployed and smoke-tested |
| ❌ **Failure** | Any of the three missing → the item is **not** Done; open a follow-up item |

---

## 3. Branches and commits

- **One branch per task**, from the latest `main`, named
  `<type>/<backlog-id>-<slug>`, e.g. `feat/B-003-month-command`.
  `<type>` is `feat`, `fix`, `docs`, `refactor`, `test`, `chore` or `ci`.
- A cloud session assigned a branch name uses that name instead.
- Never commit to `main`, never force-push a shared branch, never rewrite
  pushed history. Push with `git push -u origin <branch>`.
- Commits: Conventional Commits with the feature ID,
  e.g. `feat(stats): F7 add /month summary command`.

## 4. PR review checklist

Every PR body carries this, filled in by Claude:

**Acceptance criteria → tests**

| # | Given / When / Then (from the spec) | Proven by |
|---|---|---|
| AC1 | … | `path/to/file.test.ts` › "test name" |

**Guardrail self-check**

- [ ] **Cost:** no paid or card-required service, no new external service, no
  second Render service (GUARDRAILS §1)
- [ ] **Money:** integer cents only, no negatives, division rounds down
  (§2)
- [ ] **Auth:** identity only from verified `initData` / webhook; every query
  filtered by the user; cross-user test present (§4)
- [ ] **Privacy:** no amounts, notes, merchants or `initData` in logs; no
  third parties (§6)
- [ ] **Time:** user-timezone boundaries, injected `Clock` (§9)

A box that can't honestly be ticked is explained in the PR body. It is never
ticked anyway.

## 5. Session ritual (Claude)

**Start:** read `CLAUDE.md`, `GUARDRAILS.md`, `BACKLOG.md` (and any spec for
the item) → `git fetch origin main` → confirm the B-### item and its current
stage → create or check out the task branch.

**End:** run the checks → update the spec's status and BACKLOG → commit and
push → report to the owner:
- **Done:** what changed, with IDs, and which stage the item has reached
- **Not done:** anything skipped or failing, with the real output
- **Next:** the single next step (often "approve the spec" or "ask for the PR")

## 6. When production breaks

1. **Revert first:** redeploy the last good build in Render, or revert the PR.
2. Confirm `/healthz` and a real capture work.
3. Fix on a `fix/B-###-<slug>` branch through the pipeline, with a test that
   would have caught the bug.
4. Add the lesson to the Gotchas table of the nested `CLAUDE.md` for that
   area (`apps/server`, `apps/miniapp` or `packages/core`).

If **real financial data** looks wrong, **stop and ask** before touching any
data (GUARDRAILS §3, §14.6). Never run a repair script unasked.

## 7. The backlog

`BACKLOG.md` is the single plan: **Now** (in progress or next up) · **Next**
(agreed, ordered) · **Later** (parked, not agreed) · **Drift & debt** (code
and docs disagree, or a guardrail is unmet) · **Done** (newest first, with the
PR). Each item has an ID (`B-###`, never reused), a feature ID, acceptance
notes, and a status: `todo` → `spec` → `planned` → `tests` → `in progress` → `in review`
→ `done`.

## 8. Where things live

| Artifact | Location |
|---|---|
| What the product does | `PRD.md` (F1–F16) |
| What's next | `BACKLOG.md` |
| What one task will do, how, its test results and review | `docs/specs/B-###-<slug>.md`: one file per task, the handoff between agents |
| Agent roles and models per stage | `.claude/agents/*.md` |
| Why a non-obvious decision was made | `docs/adr/NNNN-*.md` |
| How code is organised | root `CLAUDE.md` + `apps/server/CLAUDE.md`, `apps/miniapp/CLAUDE.md`, `packages/core/CLAUDE.md` |

## 9. Changing this document

Agreed with the owner, so Claude doesn't change it alone. Propose the change,
get agreement, then make the edit in its own `docs/` PR.
