# 0001 — One web service plus a static site

**Status:** accepted · **Date:** 2026-08-27

## Context

Render's free tier grants 750 instance-hours per month per account. Keeping one
web service awake 24/7 — which the bot must be — consumes roughly 730 of them.
Free web services also spin down after 15 minutes of inactivity, with a cold
start around 50 seconds.

The obvious layout (an API service and a separate Mini App service) needs two
always-on services, or ~1,460 instance-hours. That exceeds the quota and starts
billing.

## Decision

One Render **Web Service** runs the bot webhook, the Mini App API, and the
scheduled tick in a single Node process. The Mini App is a Render **Static
Site**, which is free, CDN-served, never sleeps, and consumes no instance hours.

Sleep is prevented by an external free scheduler pinging `/healthz` every ten
minutes.

## Consequences

- The zero-cost constraint holds with headroom.
- The Mini App has no cold start at all — only the API does.
- A third service is a cost regression, so `GUARDRAILS.md` section 1 forbids it.
- The Mini App is served from a different origin, so the API needs CORS.
- `/healthz` must stay dependency-free; it is load-bearing for staying awake.
