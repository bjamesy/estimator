from celery import Celery

from estimator_workers.config import RABBITMQ_URL

app = Celery("estimator_workers", broker=RABBITMQ_URL)

# Extraction pipeline tasks (fetch -> extract -> parse) land here in Phase 3.
# See docs/architecture.md -> Extraction Pipeline.
app.autodiscover_tasks(["estimator_workers"])
