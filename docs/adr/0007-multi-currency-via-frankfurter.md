# 0007 — Foreign-currency capture via Frankfurter's free FX API

**Status:** accepted · **Date:** 2026-10-31

## Context

Travelers want to log an expense in the currency they actually paid in (e.g.
USD while abroad) and have it counted correctly against a budget kept in
their home currency. That needs a live exchange rate from somewhere —
GUARDRAILS.md section 1 requires explicit approval before adding **any** new
external service, even a free one, since it becomes both an availability
dependency and a data processor.

Two shapes of the feature were considered and the user chose explicitly:

- **You type the rate.** Zero new dependency. Rejected by the user in favour
  of the next option — more typing, and less accurate at the moment of
  purchase than a fetched rate.
- **A free live FX API.** Chosen. Frankfurter (frankfurter.app) was picked
  over alternatives like exchangerate.host: no API key, no card, backed by
  European Central Bank reference rates (a stable, well-known public-sector
  source), and a simple REST contract (`GET /latest?from=X&to=Y`).

## Decision

Foreign-currency capture (Mini App only, see Consequences) calls
Frankfurter's free, keyless API server-side to convert a logged
foreign-currency amount into the user's home currency at the moment of
capture. This is a **narrow, named exception** to GUARDRAILS.md section 1,
the same shape as ADR 0005's OCR.space carve-out:

- No card, no key, no paid tier to fall into — satisfies the actual risk
  section 1 protects against.
- The rate is fetched once, at creation time, and **frozen** on the
  transaction (`transactions.fx_rate`, alongside `original_currency` and
  `original_amount_cents`) rather than being recomputed from a live rate on
  every read. A later market move never silently re-prices old history —
  the same reasoning that keeps `amountCents` itself as a stored figure, not
  a derived one.
- Unlike OCR, a failed fetch is **not** degraded to a guess. Money math has
  nothing honest to fall back to without a real rate, so `POST
  /api/transactions` returns an error (`fx_unavailable`, mapped to 503) and
  the Mini App asks the user to retry, rather than inventing a conversion.

## Consequences

- No new env var — Frankfurter needs no key, so there is nothing to
  configure or that can be left unset. The feature works identically in
  dev and production.
- Frankfurter publishes no hard rate limit for reasonable personal use at
  the time of writing; it has run as a stable public free service for years,
  but — as with OCR.space — this should be re-verified before leaning on it
  harder than a single-user or small-household bot's capture volume.
- `apps/server/src/fx.ts` is the only place that calls out to Frankfurter —
  `fetchFxRate` never throws, returns `null` on any failure (bad response,
  timeout, unknown currency pair), and the one call site in
  `POST /api/transactions` is what decides what `null` means for the user.
- Scoped to currencies with a 2-decimal minor unit for v1 (USD, EUR, GBP,
  AUD, and similar) — a zero-decimal currency (JPY, KRW, VND, …) stored as
  "amount × 100 cents" would silently misconvert by 100x. The Mini App's
  currency picker only offers 2-decimal currencies; extending to others
  needs a currency-aware minor-unit table, not shipped here.
- Chat capture (PRD F1, the quick-text parser) does **not** support a
  foreign-currency amount in this pass — only the Mini App's capture form
  does. The parser's keyword grammar would need a new currency-code token
  and this ADR's conversion step wired into the bot handler too; scoped out
  to keep this change reviewable. Logged amounts always default to the
  user's home currency from chat, same as before.
- This is now the third approved third-party data processor (after Telegram,
  unavoidable, and OCR.space, ADR 0005) — and the narrowest: Frankfurter only
  ever receives two ISO currency codes, never anything about the user, their
  account, or the amount itself.
