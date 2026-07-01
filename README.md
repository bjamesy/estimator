# Estimator

Turns historical purchasing documents into a searchable knowledge base for project estimating. See [`docs/product-mvp.md`](docs/product-mvp.md) for the product spec, [`docs/architecture.md`](docs/architecture.md) for the system design, [`docs/data_model.md`](docs/data_model.md) for the schema, and [`docs/implementation_plan.md`](docs/implementation_plan.md) for the phased build plan.

## Repo Structure

```
web/          Next.js app (TypeScript) -- frontend and server-side API routes
workers/      Python + Celery worker service -- extraction pipeline
database/     Schema migrations -- shared source of truth for web/ and workers/
```

## Phase 0 Setup

Currently at Phase 0 (infra and repo setup). Scaffolding for `web/` and `workers/` is done; the following external accounts still need to be created by hand:

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Apply the migrations in `database/migrations/` in order — see `database/README.md`.
3. In the Supabase dashboard, enable email auth (Authentication → Providers) for company/user sign-up.
4. Copy the project URL and keys from Project Settings → API into `web/.env` and `workers/.env` (see each directory's `.env.example`).

### 2. RabbitMQ

1. Create a managed instance (e.g. [CloudAMQP](https://www.cloudamqp.com), free tier is fine for MVP).
2. Copy the AMQP connection URL into `workers/.env` as `RABBITMQ_URL`.

### 3. Run locally

```bash
# web
cd web && npm install && npm run dev

# workers
cd workers && python3.13 -m venv .venv && .venv/bin/pip install -e .
.venv/bin/celery -A estimator_workers.celery_app worker --loglevel=info
```

## Next

Phase 1 (projects + document upload) starts once the Supabase project and RabbitMQ instance above are live. See `docs/implementation_plan.md`.
