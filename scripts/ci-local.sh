#!/usr/bin/env bash
# The CI pipeline, as one command. GitHub Actions (.github/workflows/ci.yml)
# runs exactly this script after `pnpm install`, so local and CI can't drift.
#
#   TEST_DATABASE_URL=postgresql://postgres@localhost:5432/spendlygo_test pnpm ci:local
#
# Required before every push (WORKFLOW.md). It migrates and seeds the database
# it is given, so it refuses anything that isn't a local, disposable test
# database (GUARDRAILS.md section 3: never point a dev run at production).

set -euo pipefail

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "✗ TEST_DATABASE_URL is not set."
  echo "  Point it at a local, disposable Postgres, e.g."
  echo "  postgresql://postgres@localhost:5432/spendlygo_test"
  exit 1
fi

if [[ ! "$TEST_DATABASE_URL" =~ @(localhost|127\.0\.0\.1)(:[0-9]+)?/ ]]; then
  echo "✗ Refusing to run: TEST_DATABASE_URL must point at localhost."
  echo "  ci:local migrates and seeds that database. Never aim it at Supabase."
  exit 1
fi

export DATABASE_URL="$TEST_DATABASE_URL"

step "Validate the Render blueprint"
node scripts/check-render-blueprint.mjs

step "Typecheck"
pnpm typecheck

step "Lint"
pnpm lint

step "Apply migrations"
pnpm db:migrate

step "Seed default categories"
pnpm db:seed

step "Test"
pnpm test

step "Build"
pnpm build

step "Enforce Mini App bundle budget"
node scripts/check-bundle-size.mjs

printf '\n\033[1;32m✓ ci:local passed: safe to push.\033[0m\n'
