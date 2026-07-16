# Estimator

Turns historical purchasing documents into a searchable knowledge base for project estimating. See [`docs/mvp/product-mvp.md`](docs/mvp/product-mvp.md) for the product spec, [`docs/architecture.md`](docs/architecture.md) for the system design, [`docs/data_model.md`](docs/data_model.md) for the schema, and [`docs/mvp/implementation_plan.md`](docs/mvp/implementation_plan.md) for the phased build plan. `docs/mvp/` is frozen history from the MVP build — `architecture.md` and `data_model.md` are the docs still kept current.

**Status:** MVP complete. All phases (0–7) are implemented — upload a document, it's extracted by a vision LLM, you confirm the extracted data, it's promoted into the historical record, line items are auto-matched to a material catalog, everything is searchable company-wide, and estimates can pull in historical pricing with a markup applied.

## Repo Structure

```
web/          Next.js app (TypeScript) -- frontend, server actions, and the Celery task publisher
workers/      Python + Celery worker service -- extraction pipeline and material matching
database/     Schema migrations -- shared source of truth for web/ and workers/
```

## Setup

You'll need:

1. **A Supabase project.** Apply every file in `database/migrations/` in order (`0001` through `0010` as of this writing — see `database/README.md`), enable email auth (Authentication → Providers), and copy the project URL and keys from Project Settings → API into `web/.env` and `workers/.env` (see each directory's `.env.example`). Supabase's current dashboard uses **Publishable key** and **Secret key** naming (not the older "anon key"/"service_role key"), which is what `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` refer to. This stays a hosted cloud project in both run modes below — this repo has no local Postgres.
2. **A RabbitMQ instance**, unless you're using `docker compose` (below), which runs one for you. For running `web/`/`workers/` natively, use e.g. [CloudAMQP](https://www.cloudamqp.com) (free tier is fine); connection string goes in `workers/.env` and `web/.env` as `MESSAGE_BROKER_URL` — Next.js publishes tasks directly to the broker.
3. **An Anthropic API key** for extraction and material matching, in `workers/.env` as `ANTHROPIC_API_KEY`.

## Run locally

### Option A: Docker Compose

```bash
docker compose up --build
```

Brings up all three pieces: a local RabbitMQ (`docker-compose.yml` overrides `MESSAGE_BROKER_URL` to point at it, regardless of what's in your `.env` files), `web/` on [http://localhost:3000](http://localhost:3000) with hot reload via a bind mount, and `workers/` consuming tasks from it. RabbitMQ's management UI is at [http://localhost:15672](http://localhost:15672) (guest/guest). Still requires `web/.env` and `workers/.env` populated per steps 1 and 3 above — Compose reads Supabase/Anthropic settings from those files, only the broker is swapped for the local container. Code changes in `web/src` pick up immediately (Next dev server); changes in `workers/` need `docker compose restart workers` (no autoreload configured for the Celery process). **Dependency changes** (`workers/pyproject.toml`, `web/package.json`) are the exception to hot reload entirely: the bind mount only covers source code, while installed packages live in the image — a plain `docker compose up` after a dependency change runs new code against old packages (typically a `ModuleNotFoundError` at boot). Re-run with `--build`, or `docker compose build <service>` first.

### Option B: Run natively

```bash
# web
cd web && npm install && npm run dev

# workers -- needs its own terminal, running alongside web/
cd workers && python3.13 -m venv .venv && .venv/bin/pip install -e .
set -a && source .env && set +a && .venv/bin/celery -A estimator_workers.celery_app worker -B --loglevel=info
```

Both need to be running for uploads to actually process — `web/` publishes the extraction task, `workers/` consumes it. Requires a reachable RabbitMQ instance (step 2 above); `docker compose up rabbitmq` on its own is a fine way to get one without a CloudAMQP account (`MESSAGE_BROKER_URL=amqp://guest:guest@localhost:5672//` in both `.env` files in that case).
