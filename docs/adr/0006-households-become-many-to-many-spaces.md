# 0006 — Households become many-to-many "spaces"

**Status:** accepted · **Date:** 2026-09-01

## Context

Household sharing (PRD F12) originally modelled membership as `users.household_id`
— one nullable foreign key. A user was either solo (`null`) or in exactly one
household, and joining a new one required leaving the old one first
(`households.leave` then `households.create`/`joinByCode`).

The user asked for something the single-FK model cannot express: stay a member
of a personal budget **and** any number of shared ones at once, and switch
between them freely without leaving any of them. That needs real
many-to-many membership, not a bigger enum.

## Decision

- A new `household_members` join table (`household_id`, `user_id`) replaces
  the single FK for membership.
- `users.household_id` becomes `users.active_household_id` — not "which
  household you're in" but "which of your memberships is currently in
  effect." Always set; never the thing that decides membership.
- Every user gets a **personal space** automatically at creation
  (`households.is_personal = true`), created and joined in the same
  transaction as the user row (`usersRepo.upsertByTelegramId`). Personal and
  shared spaces are the same underlying row shape — a budget and a member
  list — so they work identically everywhere else in the app.
- `users.monthly_budget_cents` is deleted. The budget lives on the space
  (`households.monthly_budget_cents`) unconditionally, personal included —
  this was the other place the old model special-cased "solo" that the new
  one doesn't need to.
- `transactions.household_id` becomes `NOT NULL`. Every entry is a permanent
  snapshot of whichever space was active when it was logged. This collapses
  what used to be two different visibility filters
  (`packages/db/src/repositories/transactions.ts`'s old `visibleTo` for the
  History feed vs. `sharedScope` for aggregates — the union-vs-strict
  asymmetry that let a household's creator keep seeing pre-household history
  invisible to a joining partner) into one filter, `scopedTo(householdId)`,
  used everywhere. A personal space is just a space with one member; there is
  no separate carve-out to keep in sync.

## Consequences

- **Migration** (`0004_multi_space_households.sql`) backfills every existing
  user: a personal space is created and seeded from their old
  `monthly_budget_cents`; every transaction with a null `household_id` (i.e.
  logged while solo) is repointed to that new personal space; a user already
  in a shared household keeps it as their active space. Verified against a
  synthetic dataset covering both the solo and already-shared cases before
  running for real.
- **`transactions.household_id`'s foreign key is `ON DELETE RESTRICT`**, not
  `SET NULL` as it was — a space with real history can no longer quietly
  disappear. Nothing in the app ever deletes a household, so this is pure
  safety margin, but it means any raw cleanup (tests included) must delete a
  user's transactions before their households, before the user.
- The bot gets a new command, `/switch`, to list spaces and move between
  them; `/household invite`, `/join`, and `/leave` all adjust for multiple
  memberships (e.g. `leave` now takes which space, and refuses the personal
  one).
- Every repository function that used to take `(userId, householdId)` for
  scoping now takes `householdId` alone — `userId` was only ever needed to
  resolve the old union filter's "my own pre-household rows" branch, which no
  longer exists.
- The Mini App switcher UI (a tab to move between spaces, matching the bot's
  `/switch`) is a follow-up, not part of this change — this ADR covers the
  data model and the bot; PRD F12.2 notes the Mini App half as not yet built.
