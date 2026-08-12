# Deployment

Production runs on a single Hetzner server via `docker-compose.prod.yml`
(web, workers, Caddy) — deliberately separate from the root
`docker-compose.yml`, which is dev-only (local throwaway RabbitMQ instead
of the real broker, `next dev` instead of a production build, no reverse
proxy/TLS). See that file's own comment for why dev and prod intentionally
diverge.

## What's provisioned elsewhere (not in this repo)

- **Hetzner server** — the box this all runs on.
- **Domain + DNS** — an A record pointed at the server's IP. Caddy
  (`deploy/Caddyfile`) needs the real domain, not the `your-domain.com`
  placeholder currently checked in — update that file before the first
  deploy.
- **CloudAMQP** — the real message broker (`MESSAGE_BROKER_URL` below).
- **Anthropic** — vision extraction + material matching
  (`ANTHROPIC_API_KEY`, `workers/`). Real per-document cost center; budget
  for it.
- **Resend** — email delivery (`RESEND_API_KEY`, `workers/`). Without it,
  emails silently degrade to console-only logging — easy to "deploy" and
  not notice nothing's actually being sent.
- **Supabase** — already hosted; same project used throughout development.
  Worth deciding whether to clean out test data (see note below) before
  pointing real users at the domain.

## Environment files (created on the server, never committed)

Both are gitignored (`.env*` patterns in `.gitignore`/`web/.gitignore`) —
secret values should never pass through a chat conversation or a commit.
Create these directly on the server via `ssh` + an editor, mirroring the
existing `.env.example` files with these production-specific notes:

**`web/.env.production`** (see `web/.env.example` for the full field
list): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY` — same Supabase project values as local dev.
`MESSAGE_BROKER_URL` — the **real** CloudAMQP URL (dev overrides this to a
local container in `docker-compose.yml`; `docker-compose.prod.yml` does
not override it, so whatever's in this file is what's actually used).

**`workers/.env.production`** (see `workers/.env.example`):
`MESSAGE_BROKER_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — same pattern.
`ANTHROPIC_API_KEY` — required, extraction won't run without it.
`RESEND_API_KEY` + `EMAIL_FROM` — set both for real email delivery.
`APP_BASE_URL` — the real `https://your-domain.com`, not the
`http://localhost:3000` default; this is what gets baked into reminder
email links.

## First deploy

1. On the server: install Docker + Docker Compose plugin if not already
   present; clone this repo.
2. Update `deploy/Caddyfile`'s domain from the placeholder to the real one.
3. Create `web/.env.production` and `workers/.env.production` per above.
4. Firewall: allow 22 (SSH), 80, 443; deny everything else. If Hetzner's
   own Cloud Firewall is already managing this, don't also enable `ufw` —
   two overlapping firewall layers is a good way to lock yourself out by
   accident.
5. Confirm DNS actually resolves to the server before starting Caddy —
   it requests a Let's Encrypt cert on first boot, which needs the domain
   already pointing here, or Caddy's own retry backoff handles it but
   won't succeed until DNS is right.
6. `docker compose -f docker-compose.prod.yml up -d --build`

## Redeploying

`deploy/deploy.sh`, run from the repo root on the server: `git pull`,
rebuild, restart, prune old images. Checked into the repo, no secrets in
it.

## Verifying a deploy

- `https://your-domain.com` loads with a valid cert (Caddy handles
  issuance/renewal automatically — no manual certbot step).
- `docker compose -f docker-compose.prod.yml logs workers` shows a clean
  Celery boot with both scheduled sweeps registered
  (`send-signing-reminders`, `credential-expiry-sweep`) and no broker
  connection errors.
- `docker compose -f docker-compose.prod.yml logs web` shows no Supabase
  client errors.
- Log in and load a real page (e.g. `/estimates`) to confirm the deployed
  app actually talks to Supabase end-to-end, not just that it boots.

## Operational notes

- **TLS certs live in the `caddy_data` named volume.** Don't delete it
  casually — Let's Encrypt rate-limits re-issuance, so losing this volume
  means a forced wait before the domain can get a new cert.
- **Logs**: `docker compose -f docker-compose.prod.yml logs -f <service>`
  (`web`, `workers`, or `caddy`). Nothing beyond `docker logs` is wired up
  yet — no centralized logging or error tracking (e.g. Sentry). Fine to
  start; worth adding before this is load-bearing for real customers.
- **Migrations** are applied directly against the live Supabase project
  (via the Supabase CLI or MCP tooling — see `database/README.md`), same
  process as during development. There is no separate staging database;
  this repo has only ever pointed at one Supabase project.
