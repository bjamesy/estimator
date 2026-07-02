import { randomUUID } from "crypto";

import { createClient } from "celery-node";

const QUEUE = "celery";
const PROCESS_DOCUMENT_TASK = "estimator_workers.tasks.process_document";
const MATCH_MATERIALS_TASK = "estimator_workers.tasks.match_materials";

// celery-node's Client.sendTask()/Task.delay() publish fire-and-forget with
// no way to await success or catch a connection failure -- the promise
// chain inside sendTaskMessage() is never returned to the caller. We call
// the broker directly instead so a publish failure surfaces as a thrown
// error rather than a silent unhandled rejection.
//
// Connects fresh for each publish and disconnects immediately after,
// rather than caching one long-lived connection -- deliberately, not an
// oversight. amqplib (celery-node's AMQP client) can't actually disable
// AMQP heartbeats: unlike Celery's Python client, it has no override for
// a client-requested heartbeat of 0, so it always defers to whatever the
// broker proposes (CloudAMQP proposes 300s here, confirmed empirically --
// neither an opts.heartbeat nor a ?heartbeat=0 query param changes the
// negotiated value). A cached connection sitting idle between uploads/
// confirms would therefore keep sending heartbeat frames at the broker's
// interval regardless of what we ask for. A connection this short-lived
// never survives long enough for that interval to elapse, so no
// heartbeat is ever sent. The cost is one extra connect handshake per
// publish (upload/confirm are already infrequent, non-hot-path actions,
// so this is a fine trade for now) -- revisit if publish volume ever
// makes that overhead worth caching a connection again.
async function publishTask(taskName: string, args: unknown[]): Promise<void> {
  const brokerUrl = process.env.MESSAGE_BROKER_URL!;
  // Backend is unused (we never call asyncResult().get() -- pipeline
  // progress comes from polling DocumentProcessingEvent instead), but
  // createClient requires a value; reuse the broker URL. It's never
  // actually connected to -- celery-node only opens it lazily on first
  // access, and we never touch `.backend`.
  const celery = createClient(brokerUrl, brokerUrl, QUEUE);
  const taskId = randomUUID();
  const message = celery.createTaskMessage(taskId, taskName, args, {});

  try {
    await celery.broker.isReady();
    await celery.broker.publish(message.body, "", QUEUE, message.headers, message.properties);
  } finally {
    await celery.broker.disconnect();
  }
}

// If this fails silently, the Document stays "pending" forever with no
// pipeline ever running and no way for the user to know -- see
// publishTask's comment above for why we don't use the high-level API.
export async function publishProcessDocumentTask(
  documentId: string,
  companyId: string,
  storagePath: string,
): Promise<void> {
  await publishTask(PROCESS_DOCUMENT_TASK, [documentId, companyId, storagePath]);
}

// Runs after confirm, not blocking it -- see docs/architecture.md ->
// MaterialMatch. A publish failure here just means no MaterialMatch rows
// get created; the confirmed Invoice/LineItem records are unaffected.
export async function publishMatchMaterialsTask(
  invoiceId: string,
  companyId: string,
): Promise<void> {
  await publishTask(MATCH_MATERIALS_TASK, [invoiceId, companyId]);
}
