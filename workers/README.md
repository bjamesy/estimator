# Workers

Python + Celery extraction pipeline. Consumes tasks published by `web/` over RabbitMQ. See [`docs/architecture.md`](../docs/architecture.md) → Extraction Pipeline.

No tasks are defined yet — this is Phase 0 scaffolding (Celery app + broker connection only). The `fetch` → `extract` → `parse` task chain lands in Phase 3; informal, non-pipelined extraction lands in Phase 2. See [`docs/implementation_plan.md`](../docs/implementation_plan.md).

## Setup

```bash
python3.13 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env   # fill in RABBITMQ_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

## Run

```bash
.venv/bin/celery -A estimator_workers.celery_app worker --loglevel=info
```

Requires a reachable RabbitMQ instance (`RABBITMQ_URL`) — see Phase 0 in `docs/implementation_plan.md` for setting one up (e.g. CloudAMQP).
