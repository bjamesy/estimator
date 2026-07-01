# Estimator

Turns historical purchasing documents into a searchable knowledge base for project estimating. See [`docs/product-mvp.md`](docs/product-mvp.md) for the product spec, [`docs/architecture.md`](docs/architecture.md) for the system design, [`docs/data_model.md`](docs/data_model.md) for the schema, and [`docs/implementation_plan.md`](docs/implementation_plan.md) for the phased build plan.

## Repo Structure

```
web/          Next.js app (TypeScript) -- frontend and server-side API routes
workers/      Python + Celery worker service -- extraction pipeline
database/     Schema migrations -- shared source of truth for web/ and workers/
```

## Phase 0 Setup

Phase 0 (infra and repo setup) is done: Supabase project and RabbitMQ instance are live, migrations applied, `web/.env` and `workers/.env` populated. See each directory's `.env.example` for what's expected.

### Supabase key naming

Supabase's current dashboard (Project Settings → API) uses **Publishable key** and **Secret key**, not the older "anon key"/"service_role key" names you may see in older docs — that's what `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` refer to here. `SUPABASE_JWKS_URL` (Project Settings → API → JWT Keys) is captured but not wired into any code path yet.

### RabbitMQ

Connection string lives in `workers/.env` as `MESSAGE_BROKER_URL`.

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
