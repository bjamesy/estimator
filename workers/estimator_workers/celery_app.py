from celery import Celery

from estimator_workers.config import BROKER_URL

app = Celery("estimator_workers", broker=BROKER_URL)

# Explicit import rather than autodiscover_tasks(): autodiscovery is lazy
# and tied to full worker bootstrap signals, which don't fire in every
# entry point (e.g. scripts, tests) -- an explicit import always registers
# the tasks. See estimator_workers/tasks.py (fetch -> extract -> parse
# chain) and docs/architecture.md -> Extraction Pipeline.
import estimator_workers.tasks  # noqa: E402,F401
