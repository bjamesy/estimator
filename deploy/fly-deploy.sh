#!/usr/bin/env bash
# Redeploy path for both Fly apps -- run from the repo root. Assumes
# `fly apps create estimator-jb` / `estimator-workers` and `fly secrets
# import` have already been run once -- see docs/deployment.md.
#
# `fly deploy` uses the current working directory as the Docker build
# context (and looks for .dockerignore there) -- running it from the
# repo root with just --config web/fly.toml sends the *entire monorepo*
# as context and ignores web/.dockerignore entirely. Each deploy below
# cd's into its own app directory first so the right .dockerignore (and
# only that app's files) is actually used.
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# NEXT_PUBLIC_* vars are inlined into the web client bundle at build
# time, so they have to be passed as --build-arg, not just set as Fly
# runtime secrets. Sourced from the gitignored local env file, never
# echoed or committed.
set -a
source "$repo_root/web/.env.production"
set +a

(
  cd "$repo_root/web"
  fly deploy --config fly.toml \
    --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
    --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
)

(
  cd "$repo_root/workers"
  fly deploy --config fly.toml
)
