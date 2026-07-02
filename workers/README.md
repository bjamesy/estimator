# Workers

Python + Celery services consuming tasks published by `web/` over RabbitMQ. See [`docs/architecture.md`](../docs/architecture.md) → Extraction Pipeline.

## Tasks (`estimator_workers/tasks.py`)

- `process_document(document_id, company_id, storage_path)` — entry point published on upload; kicks off the chain below
- `fetch` → `extract` → `parse` — the extraction pipeline chain (see `extraction.py`). Each stage logs its own `DocumentProcessingEvent` row (including every retry) and retries with linear backoff on failure; a stage that exhausts retries sets `Document.status = failed` and the chain stops
- `match_materials(invoice_id, company_id)` — published by the confirm action after promotion; a single batched LLM call (see `matching.py`) matches every line item on the invoice against the company's `MaterialCatalog`

## Setup

```bash
python3.13 -m venv .venv
.venv/bin/pip install -e .
cp .env.example .env   # fill in MESSAGE_BROKER_URL, SUPABASE_URL, SUPABASE_SECRET_KEY, ANTHROPIC_API_KEY
```

## Run

```bash
set -a && source .env && set +a
.venv/bin/celery -A estimator_workers.celery_app worker --loglevel=info
```

Requires a reachable RabbitMQ instance (`MESSAGE_BROKER_URL`, e.g. CloudAMQP) and must be running alongside `web/` for uploads and confirms to actually process — `web/` only publishes tasks, this is what consumes them.

Or run the whole stack (this, `web/`, and a local RabbitMQ) via `docker compose up --build` from the repo root — see the [root README](../README.md#run-locally).
