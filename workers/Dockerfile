FROM python:3.13-slim

WORKDIR /app

COPY pyproject.toml ./
COPY estimator_workers ./estimator_workers
RUN pip install --no-cache-dir -e .

COPY . .

CMD ["celery", "-A", "estimator_workers.celery_app", "worker", "--loglevel=info"]
