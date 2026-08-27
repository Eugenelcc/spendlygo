# 0002 — Supabase instead of Render's Postgres

**Status:** accepted · **Date:** 2026-08-27

## Context

Render offers a free Postgres instance alongside its free web service, which
would have been the path of least resistance. It is **deleted 30 days after
creation**. For an expense tracker, that is silent, total data loss a month
after launch.

## Decision

The database is a Supabase free Postgres project (500 MB, no expiry, automatic
backups). Render hosts compute only.

## Consequences

- Supabase pauses a project after ~7 days of inactivity, so the hourly tick
  issues a `select 1` to keep it warm.
- Connections go through Supabase's **transaction pooler**, which rejects
  prepared statements — the driver is configured with `prepare: false`.
- The pool is capped at 3 connections; the free tier's connection limit is
  modest and a service waking from sleep must not exhaust it.
- Nothing in the code is Supabase-specific: it is a `DATABASE_URL`. Moving to
  Neon or self-hosted Postgres is a config change.
- 500 MB is not a practical limit, because photos never enter the database
  (see ADR 0003).
