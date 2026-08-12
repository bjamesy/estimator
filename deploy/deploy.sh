#!/usr/bin/env bash
# Redeploy path for every future push -- run this ON the server, from the
# repo root. See docs/deployment.md for the first-deploy steps (this
# script assumes the stack is already up once and web/.env.production +
# workers/.env.production already exist).
set -euo pipefail

git pull
docker compose -f docker-compose.prod.yml up -d --build
docker image prune -f
