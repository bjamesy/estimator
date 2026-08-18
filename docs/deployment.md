# Deployment

Production currently runs on **Fly.io** as two apps: `estimator-jb` (the
Next.js web app, at `estimator-jb.fly.dev` — `estimator` itself was
already taken on Fly by another account) and `estimator-workers` (the
Celery worker, no public hostname). A Hetzner + Docker Compose + Caddy
path was also built out and is kept in the repo, prepared but not
currently deployed — see the second half of this doc.

## Fly.io (current)

### What's provisioned elsewhere (not in this repo)

- **CloudAMQP** — the real message broker (`MESSAGE_BROKER_URL` below).
- **Anthropic** — vision extraction + material matching
  (`ANTHROPIC_API_KEY`, `workers/`). Real per-document cost center; budget
  for it.
- **Resend** — email delivery (`RESEND_API_KEY`, `workers/`). Without it,
  emails silently degrade to console-only logging — easy to "deploy" and
  not notice nothing's actually being sent.
- **Supabase** — already hosted; same project used throughout
  development. Worth deciding whether to clean out test data (see note
  below) before pointing real users at the app.

No domain/DNS step — Fly issues a free `*.fly.dev` subdomain with
automatic TLS for every app. A real custom domain can be attached later
via `fly certs add <domain>` without touching anything else here.

### Environment files (created locally, never committed)

Both are gitignored (`.env*` patterns in `.gitignore`/`web/.gitignore`) —
secret values should never pass through a chat conversation or a commit.
Create these locally, mirroring the existing `.env.example` files with
these production-specific notes:

**`web/.env.production`** (see `web/.env.example` for the full field
list): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY` — same Supabase project values as local dev.
`MESSAGE_BROKER_URL` — the **real** CloudAMQP URL (dev overrides this to
a local container in `docker-compose.yml`).

Note: the two `NEXT_PUBLIC_*` values get inlined into the client bundle
at **build time** by Next.js, not read at runtime — `fly-deploy.sh`
sources this file and passes them as `--build-arg` for that reason. `fly
secrets import` (below) also imports them as runtime secrets, which is
harmless but not what actually makes them reach the browser.

**`workers/.env.production`** (see `workers/.env.example`):
`MESSAGE_BROKER_URL`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` — same
pattern. `ANTHROPIC_API_KEY` — required, extraction won't run without it.
`RESEND_API_KEY` + `EMAIL_FROM` — set both for real email delivery.
`APP_BASE_URL` — `https://estimator-jb.fly.dev` (or the custom domain,
once attached), not the `http://localhost:3000` default; this is what
gets baked into reminder email links.

### First deploy

1. `fly apps create estimator-jb` and `fly apps create estimator-workers`
   (region `iad` for both, matching `web/fly.toml` / `workers/fly.toml`).
2. Create `web/.env.production` and `workers/.env.production` locally per
   above.
3. `fly secrets import --app estimator-jb < web/.env.production` and
   `fly secrets import --app estimator-workers < workers/.env.production`.
4. `bash deploy/fly-deploy.sh` from the repo root — builds and deploys
   both apps (the web build passes the two `NEXT_PUBLIC_*` build args
   sourced from `web/.env.production`).

### Redeploying

`deploy/fly-deploy.sh`, run from the repo root: rebuilds and deploys both
apps. Checked into the repo, no secrets in it (sources the local env file
at run time instead).

### Verifying a deploy

- `https://estimator-jb.fly.dev/login` loads with a valid cert (Fly
  issues and renews it automatically).
- `fly logs -a estimator-workers` shows a clean Celery boot with both
  scheduled sweeps registered (`send-signing-reminders`,
  `credential-expiry-sweep`) and no broker connection errors.
- `fly logs -a estimator-jb` shows no Supabase client errors.
- Log in and load a real page (e.g. `/estimates`) — this is the real test
  that the client bundle actually got real `NEXT_PUBLIC_*` values baked
  in at build time, not just that the app boots.

### Operational notes

- **Secrets**: `fly secrets set KEY=value --app <app>` for one-offs,
  `fly secrets import --app <app> < file` to bulk-load. `fly secrets list
  --app <app>` shows names only, never values.
- **Logs**: `fly logs -a <app>`. Nothing beyond that is wired up yet — no
  centralized logging or error tracking (e.g. Sentry). Fine to start;
  worth adding before this is load-bearing for real customers.
- **Migrations** are applied directly against the live Supabase project
  (via the Supabase CLI or MCP tooling — see `database/README.md`), same
  process as during development. There is no separate staging database;
  this repo has only ever pointed at one Supabase project.
- **Scaling**: both apps are pinned to `min_machines_running = 1` /
  no autostop (`web/fly.toml`, `workers/fly.toml`) — `estimator` because
  cold starts on login are a bad look for a real deployed app, and
  `estimator-workers` because a scaled-to-zero worker silently stops
  processing the queue. Revisit if cost becomes a concern.

## Hetzner (prepared, not currently deployed)

A single-server Docker Compose + Caddy path was also built out
(`docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/deploy.sh`,
`web/Dockerfile.prod` — shared with the Fly path above). Kept in the repo
in case it's picked up later; not currently running anywhere.

### What it needs

- **Hetzner server** — the box this would run on.
- **Domain + DNS** — an A record pointed at the server's IP. Caddy
  (`deploy/Caddyfile`) needs the real domain, not the `your-domain.com`
  placeholder currently checked in.
- Same CloudAMQP / Anthropic / Resend / Supabase accounts as the Fly path
  above — `web/.env.production` and `workers/.env.production` would be
  created directly on the server instead of locally.
- Same `NEXT_PUBLIC_*` build-time caveat as above:
  `docker-compose.prod.yml`'s `web.build.args` reads `${NEXT_PUBLIC_...}`
  from a root `.env` file or the shell environment — export those two
  vars (or add a root `.env`) before `docker compose build`, since the
  service's `env_file` alone only affects the running container, not the
  build.

### Steps, if resumed

1. On the server: install Docker + Docker Compose plugin; clone the repo.
2. Update `deploy/Caddyfile`'s domain from the placeholder to the real one.
3. Create `web/.env.production` and `workers/.env.production` on the
   server.
4. Firewall: allow 22 (SSH), 80, 443; deny everything else. If Hetzner's
   own Cloud Firewall already manages this, don't also enable `ufw`.
5. Confirm DNS resolves to the server before starting Caddy — it requests
   a Let's Encrypt cert on first boot.
6. `docker compose -f docker-compose.prod.yml up -d --build`

Redeploy via `deploy/deploy.sh` (`git pull` + rebuild + restart + prune).
TLS certs live in the `caddy_data` named volume — don't delete it
casually, Let's Encrypt rate-limits re-issuance.
