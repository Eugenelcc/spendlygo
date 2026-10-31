# B-004 — `/settings` bot command

**Feature:** F9 (F9.1, F9.4; also F13.5) · **Branch:** `ccr-5e696e71-4ezjyv` · **Status:** approved — tests next

Spec approved by owner, 2026-10-31
Plan approved by owner, 2026-10-31
<!-- After each approval, Claude adds a line:
     Spec approved by owner, YYYY-MM-DD
     Plan approved by owner, YYYY-MM-DD -->

Process: [`WORKFLOW.md`](../../WORKFLOW.md). **This one file is the handoff between agents:**
each writes only its own section.

---

## Spec — *what* (Stage 1)

### Problem
PRD §8 lists `/settings` ("Timezone, digest time, notification toggles"), but
it is not registered in `apps/server/src/bot/index.ts`; today the only way to
change the digest hour (F9.1), turn the digest or nudge off (F9.4) or turn
budget alerts off (F13.5) is the Mini App's Settings screen. A user who wants
to silence the bot from chat has no in-chat way to do it.

### User stories
- As a user, I want `/settings` to show my digest time and which notifications
  are on, so I know what the bot will send me.
- As a user, I want one tap to turn the digest, the "nothing logged" nudge, or
  budget alerts on or off, so the bot never becomes nagware (F9.4).
- As a user, I want to pick a different digest hour with buttons, so I don't
  need the Mini App for it.
- As a user, I want a link to the Mini App for everything else (budget,
  categories, export).

### Acceptance criteria

Callback data format (fixed by this spec, used by the tests):
`set:d:0|1` digest · `set:n:0|1` nudge · `set:a:0|1` alerts ·
`set:h:<0..23>` digest hour · `set:hp` open hour picker · `set:back` main view.
Each toggle button carries the **target value**, never "toggle".

| # | Given | When | Then |
|---|---|---|---|
| AC1 | A user with digest on at hour 21, nudge on, alerts off, timezone `Asia/Singapore` | `buildSettingsText(user)` renders the message | It shows the digest as on at `21:00`, the timezone `Asia/Singapore`, nudge on and alerts off |
| AC2 | A user with timezone `America/Los_Angeles` and digest hour 0 | the settings text is rendered | The time shows as `00:00` and the underscore in the timezone is Markdown-escaped (`Los\_Angeles`) |
| AC3 | A user with digest on, nudge off, alerts on | `settingsKeyboard(user, config)` is built | The buttons' callback data are exactly `set:d:0`, `set:n:1`, `set:a:0` and `set:hp` (each button carries the opposite of the current state) |
| AC4 | Any user, and every keyboard this command can build (main view in all 8 toggle combinations, plus the hour picker) | the callback data are inspected | Every value starts with `set:` and is ≤ 64 bytes (UTF-8) |
| AC5 | `miniappUrl` is `https://…` | the main keyboard is built | Its last row is a `web_app` button to `miniappUrl` |
| AC6 | `miniappUrl` is `http://localhost:5173` | the main keyboard and text are built | There is no `web_app` button, and the text points the user to `/app` instead |
| AC7 | the hour picker is built for a user whose digest hour is 21 | `hourPickerKeyboard(user)` is built | It has exactly 24 hour buttons `set:h:0`…`set:h:23` in hour order, the 21 button is marked as current, and a final `set:back` button |
| AC8 | `parseSettingsCallback` | given `set:h:24`, `set:h:-1`, `set:h:7x`, `set:d:2`, `set:zz`, `undo:abc` | It returns `null` for each; for `set:d:0` it returns `{ kind: 'update', input: { digestEnabled: false } }`; for `set:h:7` it returns `{ kind: 'update', input: { digestHour: 7 } }`; for `set:hp` and `set:back` it returns the matching view |
| AC9 | (DB) a user with digest on | they press `set:d:0` | `users.digest_enabled` is false, the callback is answered once, and the message is edited to show the digest off and a `set:d:1` button |
| AC10 | (DB) a user with nudge on | they press `set:n:0` | `users.nudge_enabled` is false and no other settings column changes |
| AC11 | (DB) a user with digest on and alerts on | they press `set:a:0` | `users.alerts_enabled` is false and `digest_enabled` is still true (F13.5 independence) |
| AC12 | (DB) a user with digest hour 21 | they press `set:h:7` | `users.digest_hour` is 7, the callback is answered, and the message is edited back to the main view showing `07:00` |
| AC13 | (DB) a user with digest on | the same `set:d:0` callback is delivered twice (redelivery, or a stale message pressed again), and the second edit rejects with Telegram's "message is not modified" error | Digest stays off (not flipped back on), each delivery is answered, and the handler does not throw |
| AC14 | a callback with invalid data (`set:h:99`) | the callback handler runs | No settings write happens, and the callback is answered with "That button is out of date — send /settings again." |
| AC15 | the settings write throws (DB unreachable) | the callback handler runs | The callback is still answered, with an error text, before the error propagates |
| AC16 | (DB) users A and B both exist, with digest on | B presses `set:d:0` | Only B's row changes; A's `digest_enabled` is still true (identity comes from the callback's sender, never from callback data) |
| AC17 | `set:hp` is pressed | the callback handler runs | No settings write happens; the message's keyboard becomes the hour picker and the callback is answered |
| AC18 | the bot is configured at boot | `configureBotMenu` runs | `setMyCommands` includes `{ command: 'settings', … }` |

### Edge cases
- **Redelivered webhook / stale message:** buttons carry absolute target
  values, so replaying `set:d:0` is a no-op on state (AC13). Editing a message
  to identical content makes Telegram return 400 "message is not modified";
  that edit error is swallowed.
- **Old `/settings` message pressed days later:** it writes the button's value
  and then re-renders from the fresh row, so the message becomes current again.
- **Digest hour vs timezone:** the hour is a wall-clock hour in the user's
  timezone (`send-digests.ts` → `hourOf(now, user.timezone)`); the text names
  the timezone next to the hour so this is visible.
- **Hour 0:** shown as `00:00` (midnight local); a 00:30 tick in the user's
  timezone matches hour 0. No change to digest sending.
- **Changing the hour on the same day:** e.g. 21 → 22 at 21:30 after today's
  digest went out sends a second digest at 22:00; moving to an hour that has
  already passed means no digest today. Same as the Mini App today; not
  changed here.
- **Nudge while digest is off:** the nudge is part of the daily digest
  (`tasks/digest.ts`), so it has no effect while the digest is off. The text
  says so; the button still works.
- **Spaces:** settings are per **user** (`users` columns), not per space. They
  don't change on `/switch`, and in a shared space each partner has their own.
  The command never touches `activeHouseholdId` or the budget.
- **Group chat:** if someone else presses a button on another user's
  `/settings` message, it changes the **presser's** settings (their
  `botCtx.appUser`) and re-renders with theirs. No other user's row can be
  reached.
- **Money / month-end / February:** not applicable; no money or date maths here.
- **Double-fired tick:** not applicable; no tick job is added.

### Out of scope
- Changing timezone, currency or locale from the bot (see open question 1).
- Changing the monthly budget (that's `/budget`).
- Text arguments such as `/settings digest off`.
- Making digests idempotent under a double-fired tick (pre-existing; see Risks).
- Any Mini App change.

### Open questions for the owner

**Resolved 2026-10-31:** the owner accepted all three recommended defaults
(timezone read-only, all 24 hours, 24-hour `HH:00` format).

1. **Timezone in `/settings`.** PRD §8 says `/settings` covers timezone. Today
   nothing in the UI changes it (the Mini App shows it read-only), and
   `PATCH /api/settings` accepts any non-empty string with no IANA check.
   Changing it moves every day/month boundary, the digest hour, and the
   meaning of already-stored `occurred_on` dates.
   **Recommended default:** show the timezone read-only in `/settings`, don't
   allow changing it, and park "change timezone (validated IANA list, effect
   on past dates)" as a new BACKLOG Later item, plus a Drift & debt line for
   the unvalidated `timezone` in `PATCH /api/settings`.
2. **Hour picker range.** **Recommended default:** all 24 hours, as the Mini
   App offers (`Settings.tsx` `DIGEST_HOURS`), shown as a 4 × 6 grid of
   `HH:00` labels.
3. **Time format.** **Recommended default:** 24-hour `21:00` in the bot
   (compact on buttons). The Mini App uses `9:00 PM`; the bot won't match it.

---

## Plan — *how* (Stage 2)

### Files
| File | Change |
|---|---|
| `apps/server/src/bot/commands/settings.ts` | **New.** Everything for this command (details below). |
| `apps/server/src/bot/commands/settings.test.ts` | **New.** Tests for every AC (table below). |
| `apps/server/src/bot/index.ts` | Import `handleSettings`, `handleSettingsCallback`, `SETTINGS_PREFIX`. Add `bot.command('settings', (botCtx) => handleSettings(ctx, botCtx));` next to the other commands. Add `bot.callbackQuery(new RegExp(`^${SETTINGS_PREFIX}`), (botCtx) => handleSettingsCallback(ctx, botCtx));` **directly after the `UNDO_PREFIX` line and before** the catch-all `bot.on('callback_query', …)`. In `configureBotMenu`, add `{ command: 'settings', description: 'Digest time and notifications' }` before `help`. |
| `apps/server/src/bot/commands/help.ts` | In `HELP_TAIL`: change "Turn them on or off in Settings." to "Turn them on or off with /settings." and add `/settings — digest time and notifications` to the *Commands* list, before `/app`. |
| `PRD.md` | §8 `/settings` row: replace the "*not built yet…*" note with "Digest time, digest/nudge/alert toggles; timezone shown read-only (changing it: see BACKLOG)". Adjust if the owner decides otherwise on open question 1. |
| `BACKLOG.md` | **Already done by the main session** (B-027, B-028 added at approval). Builder: no BACKLOG edits. |

**`settings.ts` contents.** Copy the structure of `bot/capture.ts`
(`UNDO_PREFIX`, `undoKeyboard`, `handleUndo`) and `bot/commands/switch.ts`.
Exports:

- `export const SETTINGS_PREFIX = 'set:';`
- `export type SettingsAction = { kind: 'update'; input: usersRepo.UpdateSettingsInput } | { kind: 'view'; view: 'main' | 'hours' };`
- `export function parseSettingsCallback(data: string | undefined): SettingsAction | null` —
  pure. Match with regex `^set:(d|n|a):([01])$`, `^set:h:(\d{1,2})$`, `^set:hp$`, `^set:back$`.
  Map `d`→`digestEnabled`, `n`→`nudgeEnabled`, `a`→`alertsEnabled`, `h`→`digestHour`.
  Then validate the built `input` with `updateSettingsSchema.safeParse` from
  `@spendlygo/shared` (that rejects hour 24+ via `.max(23)`), returning `null`
  on failure. Anything else → `null`.
- `export function buildSettingsText(user: User, config: Config): string` —
  pure, Markdown. Lines: `*Settings*`, blank, `Daily digest: *on* at 21:00 (Asia/Singapore)`
  (or `*off*`, still naming the hour), `"Nothing logged" nudge: *on*` plus
  `_(only sent with the digest)_` when the digest is off,
  `Budget alerts (80% / 100%): *off*`, `Timezone: Asia/Singapore`, blank, and
  then either `Budget, categories and the rest are in the app.` (when
  `canLaunchMiniApp(config)`) or `Budget, categories and the rest are in the app — /app.`
  (when not, AC6 checks the `/app` text). Run the timezone through
  `escapeMarkdown` from `bot/markdown.ts`. Hour formatting: a local
  `formatHour24(h) = `${String(h).padStart(2, '0')}:00``.
- `export function settingsKeyboard(user: User, config: Config): InlineKeyboard` —
  rows: `[Turn digest off|on → set:d:<!digestEnabled>]`,
  `[Change digest time → set:hp]`, `[Turn nudge off|on → set:n:…]`,
  `[Turn alerts off|on → set:a:…]`, and if `canLaunchMiniApp(config)` a last
  row `.webApp('⚙️ More in the app', config.miniappUrl)`. Use `1`/`0` in data.
- `export function hourPickerKeyboard(user: User): InlineKeyboard` — 24
  `.text(label, `set:h:${h}`)` buttons, `.row()` after every 4th; label is
  `formatHour24(h)`, prefixed `• ` for `user.digestHour`; then a row with
  `.text('← Back', 'set:back')`.
- `export async function handleSettings(ctx: AppContext, botCtx: BotContext): Promise<void>` —
  `botCtx.reply(buildSettingsText(botCtx.appUser, ctx.config), { parse_mode: 'Markdown', reply_markup: settingsKeyboard(botCtx.appUser, ctx.config) })`.
- `export async function handleSettingsCallback(ctx: AppContext, botCtx: BotContext): Promise<void>` —
  1. `const action = parseSettingsCallback(botCtx.callbackQuery?.data)`. If
     `null`: `await botCtx.answerCallbackQuery({ text: 'That button is out of date — send /settings again.' })`; return.
  2. `view` action: `answerCallbackQuery()`, then
     `editMessageReplyMarkup({ reply_markup: view === 'hours' ? hourPickerKeyboard(user) : settingsKeyboard(user, ctx.config) })`
     with `.catch(() => {})`. No DB write.
  3. `update` action: inside `try`, `const updated = await usersRepo.updateSettings(ctx.db, botCtx.appUser.id, action.input)`.
     In `catch (error)`: `await botCtx.answerCallbackQuery({ text: "Couldn't save that — try again." }).catch(() => {})`, then `throw error`
     (so `bot.catch` logs it, GUARDRAILS §10).
     After success: `await botCtx.answerCallbackQuery({ text: 'Saved' })`,
     then `await botCtx.editMessageText(buildSettingsText(updated, ctx.config), { parse_mode: 'Markdown', reply_markup: settingsKeyboard(updated, ctx.config) }).catch(() => {})`
     — the swallowed error covers "message is not modified" on redelivery (same pattern as `handleUndo`).
  4. Log `logger.info('settings.updated', { userId, fields: Object.keys(action.input) })`. Field names only, never values beyond that.

**Shared path with the Mini App.** `PATCH /api/settings` writes personal
settings through `usersRepo.updateSettings(ctx.db, user.id, personalInput)`
and validates with `updateSettingsSchema`. The bot uses **the same two**
(no new service function, and the API route is not touched, so its existing
auth / cross-user coverage is unchanged). The identity is only
`botCtx.appUser.id` (set by `withUser` from the callback's `from`); callback
data never carries a user or space id.

### Data
No schema change, no migration. `digest_hour`, `digest_enabled`,
`nudge_enabled`, `alerts_enabled` and `timezone` already exist on `users`
(`packages/db/src/schema.ts`). Single-row update by primary key, so no
transaction is needed. Fully compatible with the running server.

### Tests
All in `apps/server/src/bot/commands/settings.test.ts`.

- **Pure block** `describe('/settings rendering (PRD F9.4)')`: build a `User`
  literal (cast `as User`) and a `Config` via a `contextWith`-style helper
  copied from `bot/webhook.test.ts`.
- **Handler fakes:** a `fakeBotCtx(appUser, data)` returning
  `{ appUser, callbackQuery: { data }, answerCallbackQuery: vi.fn().mockResolvedValue(true), editMessageText: vi.fn().mockResolvedValue(true), editMessageReplyMarkup: vi.fn().mockResolvedValue(true), reply: vi.fn().mockResolvedValue(undefined) } as unknown as BotContext`.
- **DB block** `describeIfDb('/settings callbacks (DB)')`: copy the setup from
  `tasks/alerts.test.ts` (`const describeIfDb = TEST_DATABASE_URL ? describe : describe.skip;`,
  `createDatabase(..., { maxConnections: 2 })`, `fixedClock`, `setLogLevel('error')`,
  `cleanUp()` deleting `households` by `createdBy` then `users` by `telegramId`).
  Telegram ids **`980000000001n`** (A) and **`980000000002n`** (B) — unused elsewhere.
  Read state back with `usersRepo.findById(handle.db, id)`.

| AC | Test file › test name |
|---|---|
| AC1 | settings.test.ts › shows digest state and hour, timezone, nudge and alerts |
| AC2 | settings.test.ts › pads midnight to 00:00 and escapes the timezone |
| AC3 | settings.test.ts › each toggle button carries the opposite of the current state |
| AC4 | settings.test.ts › every callback_data is set:-prefixed and within 64 bytes |
| AC5 | settings.test.ts › links to the Mini App over HTTPS |
| AC6 | settings.test.ts › points to /app when the Mini App cannot launch |
| AC7 | settings.test.ts › hour picker lists 24 hours in order, marks the current one, and has Back |
| AC8 | settings.test.ts › parseSettingsCallback accepts only well-formed data |
| AC9 | settings.test.ts › turning the digest off saves, answers and re-renders |
| AC10 | settings.test.ts › turning the nudge off changes only nudge_enabled |
| AC11 | settings.test.ts › turning alerts off leaves the digest on |
| AC12 | settings.test.ts › picking an hour saves it and returns to the main view |
| AC13 | settings.test.ts › a redelivered callback is idempotent and tolerates "message is not modified" (second `editMessageText` mock: `mockRejectedValueOnce(new Error('Bad Request: message is not modified'))`) |
| AC14 | settings.test.ts › stale or malformed data is answered without writing (non-DB: `ctx.db = {} as never`, so any write would throw) |
| AC15 | settings.test.ts › answers the callback even when saving fails (non-DB: `ctx.db = {} as never`; expect the promise to reject **and** `answerCallbackQuery` called once) |
| AC16 | settings.test.ts › a callback only changes the sender's own settings |
| AC17 | settings.test.ts › opening the hour picker edits the keyboard without writing (non-DB: `ctx.db = {} as never`) |
| AC18 | settings.test.ts › /settings is in the bot's command menu (`new Bot<BotContext>('111111:token', { botInfo: undefined as never })` as in `tasks/alerts.test.ts`; replace `bot.api.setMyCommands` and `bot.api.setChatMenuButton` with `vi.fn().mockResolvedValue(true)`; call `configureBotMenu(bot, ctx)`) |

### Risks & guardrails
- **Cost (§1):** none. No new service, dependency, env var, or Render change.
- **Money (§2):** none. No amounts are read or written.
- **Data integrity (§3):** single-row idempotent update (absolute values, not
  toggles), safe under redelivery. No migration.
- **Auth (§4):** identity only from `botCtx.appUser` (allowlist + `withUser`
  run first). Callback data holds no ids. AC16 is the cross-user test. No
  API route is added or changed.
- **Secrets (§5):** none.
- **Privacy (§6):** the log line holds the user id and changed field names only.
- **Runtime (§7):** one indexed UPDATE per tap.
- **Time (§9):** no boundary maths. The hour is shown with the user's timezone;
  `send-digests.ts` already interprets it in that timezone.
- **Telegram (§10):** every path answers the callback exactly once, including
  invalid data (AC14) and a failed write (AC15). The handler does one DB write
  and two Telegram calls, so it's fast. 64-byte limit: the longest data is
  `set:h:23` (8 bytes, AC4).
- **Scope (§11):** timezone editing deliberately excluded (open question 1).
- **Noticed, not fixed (park in BACKLOG Drift & debt; not this PR):**
  (a) `handleUndo` doesn't answer the callback if `findById` throws;
  (b) `sendDueDigests` has no reserve-then-send record, so a double-fired tick
  in the digest hour sends the digest twice;
  (c) `PATCH /api/settings` doesn't validate `timezone` as an IANA zone.

### PR split
Single PR, feature ID **F9**: `feat(bot): F9 /settings command with digest, nudge and alert toggles`.

---

## Test report (Stages 3–4)

| AC | Test file › test name | Before build | After build |
|---|---|---|---|
| AC1 | settings.test.ts › shows digest state and hour, timezone, nudge and alerts | ❌ failing (expected) | ✅ |
| AC2 | settings.test.ts › pads midnight to 00:00 and escapes the timezone | ❌ failing (expected) | ✅ |
| AC3 | settings.test.ts › each toggle button carries the opposite of the current state | ❌ failing (expected) | ✅ |
| AC4 | settings.test.ts › every callback_data is set:-prefixed and within 64 bytes | ❌ failing (expected) | ✅ |
| AC5 | settings.test.ts › links to the Mini App over HTTPS | ❌ failing (expected) | ✅ |
| AC6 | settings.test.ts › points to /app when the Mini App cannot launch | ❌ failing (expected) | ✅ |
| AC7 | settings.test.ts › hour picker lists 24 hours in order, marks the current one, and has Back | ❌ failing (expected) | ✅ |
| AC8 | settings.test.ts › parseSettingsCallback accepts only well-formed data | ❌ failing (expected) | ✅ |
| AC9 | settings.test.ts › turning the digest off saves, answers and re-renders | ❌ failing (expected) | ✅ |
| AC10 | settings.test.ts › turning the nudge off changes only nudge_enabled | ❌ failing (expected) | ✅ |
| AC11 | settings.test.ts › turning alerts off leaves the digest on | ❌ failing (expected) | ✅ |
| AC12 | settings.test.ts › picking an hour saves it and returns to the main view | ❌ failing (expected) | ✅ |
| AC13 | settings.test.ts › a redelivered callback is idempotent and tolerates "message is not modified" | ❌ failing (expected) | ✅ |
| AC14 | settings.test.ts › stale or malformed data is answered without writing | ❌ failing (expected) | ✅ |
| AC15 | settings.test.ts › answers the callback even when saving fails | ❌ failing (expected) | ✅ |
| AC16 | settings.test.ts › a callback only changes the sender's own settings | ❌ failing (expected) | ✅ |
| AC17 | settings.test.ts › opening the hour picker edits the keyboard without writing | ❌ failing (expected) | ✅ |
| AC18 | settings.test.ts › /settings is in the bot's command menu | ❌ failing (expected) | ✅ |

**Checks (after build):** typecheck ✓ lint ✓ test 468 passed / 0 skipped.

**Checks (before build):** all 18 fail at import (`./settings.js` missing); `pnpm typecheck` fails on the same missing module (expected while red).
**Screenshots:** n/a (bot only)

---

## Build notes (Stage 4)

- **Deviations from plan:** `logger.info` field `fields` is a comma-joined string (the logger type rejects arrays). No other deviation.
- **Parked ideas:** none.

---

## Review (Stage 5)

**Verdict:** `ready for owner` — no blocking findings. Reviewed `6ac997b..HEAD` (0ebbc4b tests, 335e731 build).

| # | Severity | file:line | Finding | Failure scenario |
|---|---|---|---|---|
| 1 | Low | `apps/server/src/bot/commands/settings.ts:135` (also `:116`) | The success-path `answerCallbackQuery` is awaited without `.catch`. If it rejects, the handler throws after the write: the message is not re-rendered and the `settings.updated` log line is skipped. | A tap answered late (e.g. a slow cold start, "query is too old") saves `digest_enabled=false`, but the message keeps showing "on" and a "Turn digest off" button. No data harm: the write is absolute, `bot.catch` logs it, and pressing again re-renders. Same pattern as `handleUndo`. Optional: `.catch(() => {})` on these two answers. |
| 2 | Low (test) | `apps/server/src/bot/commands/settings.test.ts:341-354` | AC13 does not assert that `second.editMessageText` was called, so it does not prove the "not modified" rejection was actually reached and swallowed. It does prove the important part: a toggle implementation would flip the digest back on and fail the `false` check. | A future refactor that skips the edit on replay would still pass, which is harmless. A refactor that removes the `.catch` would fail correctly, but only because the edit happens to be called. |
| 3 | Low (test) | `settings.test.ts:208-212` | AC15 checks that the promise rejects and that the callback was answered exactly once. It does not check the error text, and the failure is a `TypeError` from `{}` as db rather than a connection error. The behaviour under test (answer before rethrow) is still proven. | An answer with no text (spinner stops, user sees nothing) would pass. |
| 4 | Info | `settings.test.ts:356-360` | AC16 sets `appUser` directly, so it proves that callback data carries no id and that the write is keyed by the sender. Deriving `appUser` from `from` is the existing `withUser` middleware, which this test does not cover. | Acceptable: the spec places identity in `withUser`, which is unchanged. |
| 5 | Info | `settings.ts:144-147` | Builder deviation: `fields` is a comma-joined string of field names (e.g. `digestEnabled`). It holds no values, so it is privacy-safe (§6). Accepted. | — |

**Other checks, all OK**
- **Callback routing:** `set:` is registered after `undo:` and before the catch-all `bot.on('callback_query')`. The two prefixes are disjoint, no other handler or button uses `set:`, and the prefix holds no regex metacharacters. Unparseable `set:` data is answered with the stale text (AC14).
- **Shared path:** the bot validates with the same `updateSettingsSchema` and writes through the same `usersRepo.updateSettings` (filtered by `users.id`) as `PATCH /api/settings`. The API route is untouched.
- **Answering:** every path answers exactly once: invalid data, view, failed write (answer, then rethrow) and success.
- **Telegram limit:** callback data is at most 8 bytes (`set:h:23`).
- **Plan fidelity:** only the planned files changed. `help.ts` and the PRD §8 row are updated, and the B-026/B-027/B-028 and B-007 drift items exist in BACKLOG. Nothing was built outside the plan.
- **Checks (run by reviewer):** `pnpm typecheck` passed, `pnpm lint` passed, `pnpm test` passed 468/468 with the DB tests running against the local Postgres. All 18 `settings.test.ts` tests pass, none skipped.

**Acceptance criteria → tests:** AC1–AC18 map 1:1 to `apps/server/src/bot/commands/settings.test.ts`, under the names in the Test report table above. Every test exercises its criterion; findings 2 and 3 note where an assertion could be tighter.

**Guardrail self-check** (WORKFLOW §4)
- [x] **Cost:** no new service, dependency or env var (§1)
- [x] **Money:** n/a, no amounts read or written (§2)
- [x] **Auth + cross-user test:** identity only from `botCtx.appUser` (`withUser`, after `allowlist`); the repository update is keyed by user id; the AC16 cross-user test is present (§4)
- [x] **Privacy:** the log holds the user id and field names only (§6)
- [x] **Time:** no boundary maths. The hour is shown next to the user's timezone and interpreted by the existing `send-digests.ts`; no `new Date()` added in domain logic (§9)
