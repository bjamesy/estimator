from celery import Celery

from estimator_workers.config import BROKER_URL

app = Celery("estimator_workers", broker=BROKER_URL)

# Disables AMQP heartbeats on this connection entirely -- pre-launch,
# low/no traffic, and CloudAMQP's free-tier plans meter heartbeat frames
# against the same message quota as real messages. This isn't just a
# client-side preference: py-amqp's negotiation (amqp/connection.py
# _on_tune) explicitly overrides the broker's proposed heartbeat interval
# to 0 when the client disables it, and sends that 0 back to the broker
# in ConnectionTuneOk -- so the broker also agrees not to expect
# heartbeats on this connection, rather than us just silently going quiet
# on a connection it still expects to hear from. Revisit once there's
# real uptime/traffic to justify dead-connection detection again.
app.conf.broker_heartbeat = 0

# Explicit import rather than autodiscover_tasks(): autodiscovery is lazy
# and tied to full worker bootstrap signals, which don't fire in every
# entry point (e.g. scripts, tests) -- an explicit import always registers
# the tasks. See estimator_workers/tasks.py (fetch -> extract -> parse
# chain) and docs/architecture.md -> Extraction Pipeline.
import estimator_workers.tasks  # noqa: E402,F401
