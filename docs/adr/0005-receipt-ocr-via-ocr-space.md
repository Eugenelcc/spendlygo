# 0005 — Receipt OCR via OCR.space, as a pre-fill suggestion only

**Status:** accepted · **Date:** 2026-08-31

## Context

F4 (photo attachments) was shipped in v1 with `attachments.ocr_status` and
`ocr_payload` columns reserved but unused, specifically so a later OCR
addition would need no migration (PRD F4.6). GUARDRAILS.md section 1 bans
calling any paid or card-required LLM/OCR/speech API outright — the commercial
options (Google Cloud Vision, AWS Textract, Azure Computer Vision) all require
a credit card on file even to use their free tier, which the zero-cost
constraint (GUARDRAILS.md section 1) treats as equivalent to being paid: a
card on file is a 30-day bomb away from a bill.

Two options were evaluated that don't require a card:

- **Tesseract.js**, self-hosted. Genuinely free and keeps every byte inside
  our own infrastructure, so it needs no exception to any guardrail. Rejected
  for now: it's CPU-heavy, and the runtime budget (GUARDRAILS.md section 7,
  ADR-scale: 512 MB / 0.1 CPU, one process running the bot webhook and the
  API) has no headroom to run a synchronous OCR pass without risking webhook
  latency or the health check.
- **OCR.space**'s free API tier. No credit card to obtain a key, no paid step
  to fall into. Costs nothing but does mean a receipt photo's bytes leave our
  infrastructure for a third party we don't control.

## Decision

Receipt OCR uses OCR.space's free API. This is a **narrow, named exception**
to two guardrails, not a reopening of either:

- GUARDRAILS.md section 1 ("never call a paid LLM/OCR/speech API, or one that
  requires a credit card") — OCR.space needs no card, so it doesn't violate
  the actual cost risk that rule protects against, but it's still an OCR API
  and the rule is written broadly on purpose. The exception is now spelled out
  by name in that section, so nothing else gets to claim the same carve-out
  by analogy.
- GUARDRAILS.md section 6 ("never send user financial data to any third
  party") — a receipt photo is financial data. The exception is scoped as
  tightly as it can be: only the image bytes, nothing else about the user or
  their account; used once for text extraction; the receipt's actual text is
  never logged or stored, only the resulting guessed amount.

The extracted amount is **never authoritative** — meaning never presented or
treated with more confidence than a typed amount gets, not that it needs a
stricter save gate typed capture doesn't have. It goes through the exact
same path every other capture in this app already uses: saved immediately,
shown on a confirmation card that says the amount was guessed and where to
fix it, undoable for five minutes (PRD F1.5, F11.1). A separate pre-save
confirm step was considered and rejected — it would make OCR the one capture
flow in the app that behaves differently, for a source no less correctable
after the fact than a typed guess. A failed or wrong OCR read degrades to
exactly what a captionless photo already asked for — a caption — never an
error state.

## Consequences

- `OCR_SPACE_API_KEY` is a new, **optional** server env var (`.env.example`,
  `CLAUDE.md`, `render.yaml`). Unset, photo attachments keep working exactly
  as before this ADR — the amount pre-fill just doesn't fire.
- OCR.space's free tier is rate-limited (roughly 500 requests/day at the time
  of writing, non-commercial use) — verify the current terms before relying on
  the number. Fits a single-user or small-household bot with room to spare;
  would not fit a multi-tenant product. If usage ever approaches the limit,
  the fallback is silent: manual entry, same as no key configured.
- The request happens after the photo is already safely on Telegram's
  servers (ADR 0003 is unaffected — the photo itself still never gets copied
  into our storage, only sent once, transiently, for OCR).
- `ocr_status` moves from `none`/unused to `done`/`failed`, set once the
  OCR.space call has already resolved — the whole round trip happens inline
  in the webhook handler, so there is no separate `pending` window to
  observe from outside it. `pending` stays reserved on the enum for if OCR
  ever needs to move off the request path (e.g. a queued retry).
- This is now the second approved third-party data processor (Telegram is the
  first, and is unavoidable — it's the whole platform). No third is added
  without going back through GUARDRAILS.md section 1's "ask first" rule.
