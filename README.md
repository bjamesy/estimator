# Estimator

Turns historical purchasing documents into a searchable knowledge base for project estimating. See [`docs/product-mvp.md`](docs/product-mvp.md) for the product spec, [`docs/architecture.md`](docs/architecture.md) for the system design, [`docs/data_model.md`](docs/data_model.md) for the schema, and [`docs/implementation_plan.md`](docs/implementation_plan.md) for the phased build plan.

**Status:** MVP complete. All phases (0–7) are implemented — upload a document, it's extracted by a vision LLM, you confirm the extracted data, it's promoted into the historical record, line items are auto-matched to a material catalog, everything is searchable company-wide, and estimates can pull in historical pricing with a markup applied.

## Repo Structure

```
web/          Next.js app (TypeScript) -- frontend, server actions, and the Celery task publisher
workers/      Python + Celery worker service -- extraction pipeline and material matching
database/     Schema migrations -- shared source of truth for web/ and workers/
```

## Setup

You'll need:

1. **A Supabase project.** Apply every file in `database/migrations/` in order (`0001` through `0009` as of this writing — see `database/README.md`), enable email auth (Authentication → Providers), and copy the project URL and keys from Project Settings → API into `web/.env` and `workers/.env` (see each directory's `.env.example`). Supabase's current dashboard uses **Publishable key** and **Secret key** naming (not the older "anon key"/"service_role key"), which is what `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` refer to.
2. **A RabbitMQ instance** (e.g. [CloudAMQP](https://www.cloudamqp.com), free tier is fine). Connection string goes in `workers/.env` as `MESSAGE_BROKER_URL`, and in `web/.env` as `MESSAGE_BROKER_URL` too — Next.js publishes tasks directly to the broker.
3. **An Anthropic API key** for extraction and material matching, in `workers/.env` as `ANTHROPIC_API_KEY`.

## Run locally

```bash
# web
cd web && npm install && npm run dev

# workers -- needs its own terminal, running alongside web/
cd workers && python3.13 -m venv .venv && .venv/bin/pip install -e .
set -a && source .env && set +a && .venv/bin/celery -A estimator_workers.celery_app worker --loglevel=info
```

Both need to be running for uploads to actually process — `web/` publishes the extraction task, `workers/` consumes it.
