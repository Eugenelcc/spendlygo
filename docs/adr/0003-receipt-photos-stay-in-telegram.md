# 0003 — Receipt photos stay in Telegram

**Status:** accepted · **Date:** 2026-08-27

## Context

The app stores receipt photos. Object storage on a zero-budget stack means
Supabase Storage's 1 GB free allowance, which a few years of receipts would
exhaust — and egress is metered too.

Telegram already stores every photo sent to the bot, indefinitely and for free,
and hands back a `file_id` that resolves to the bytes on demand.

## Decision

Photos are never copied off Telegram. We persist `file_id`, `file_unique_id`,
dimensions and size; the Mini App requests them through our API, which calls
`getFile` and streams the result.

## Consequences

- Photo storage is free and effectively unlimited.
- The 500 MB database holds only text rows — roughly a decade of daily use.
- `getFile` URLs expire in about an hour, so the resolved URL is cached for
  ~50 minutes and then re-resolved.
- `file_id` is bot-specific and must never reach the client, so photos are
  proxied rather than linked (`GUARDRAILS.md` section 4).
- We inherit Telegram's ~20 MB download limit, which is far above any photo.
- If the bot token is ever rotated, existing `file_id`s stay valid; if the bot
  is *replaced*, they do not. That is the one real risk, and it is documented.
