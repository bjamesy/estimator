# web

Next.js (TypeScript) app for Estimator — frontend, server actions, and the Celery task publisher (`src/lib/celery.ts`). See the [root README](../README.md) for full setup (Supabase project, RabbitMQ instance, running `workers/` alongside this) and [`docs/`](../docs) for product/architecture/data model.

## Run

```bash
npm install
npm run dev
```

Requires `web/.env` populated (see `.env.example`) and `workers/` running alongside this for uploads/confirms to actually process — this app only publishes tasks to RabbitMQ, it doesn't consume them.

Open [http://localhost:3000](http://localhost:3000).
