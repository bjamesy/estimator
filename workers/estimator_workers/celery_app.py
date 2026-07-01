from celery import Celery

from estimator_workers.config import BROKER_URL

app = Celery("estimator_workers", broker=BROKER_URL)

# Extraction pipeline tasks (fetch -> extract -> parse) land here in Phase 3.
# See docs/architecture.md -> Extraction Pipeline.
app.autodiscover_tasks(["estimator_workers"])
