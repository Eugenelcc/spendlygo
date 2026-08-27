# 0004 — The HTTP server starts before the bot

**Status:** accepted · **Date:** 2026-08-27

## Context

grammY needs its bot info — one `getMe` call to Telegram — before it can
dispatch webhook updates. The natural boot order is `await bot.init()` and then
start the HTTP server.

That makes Telegram's availability a hard dependency of process startup. If
Telegram is slow or unreachable during a deploy, Render's health check on
`/healthz` fails and rolls back a perfectly good release. On the free tier,
where every cold start re-runs boot, the same risk recurs all day.

This was caught while smoke-testing with a deliberately invalid bot token: the
process exited before ever binding a port.

## Decision

The HTTP server binds first. `bot.init()` runs in the background with
exponential backoff (5s → 60s). Until it succeeds, the webhook route returns
**503 with `Retry-After`**, which asks Telegram to redeliver rather than
dropping the update.

## Consequences

- `/healthz` answers within milliseconds of process start, verified at ~8 ms
  with an unreachable Telegram.
- A Telegram outage degrades the bot but never takes down the API or the
  health check, and never fails a deploy.
- No update is lost to a cold start — dropping one would be a data-loss bug.
- `createApp` takes an `isBotReady` callback, which also lets the integration
  tests exercise the HTTP surface without contacting Telegram.
