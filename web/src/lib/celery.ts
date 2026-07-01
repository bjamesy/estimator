import { randomUUID } from "crypto";

import { createClient } from "celery-node";

const QUEUE = "celery";
const PROCESS_DOCUMENT_TASK = "estimator_workers.tasks.process_document";
const MATCH_MATERIALS_TASK = "estimator_workers.tasks.match_materials";

let client: ReturnType<typeof createClient> | null = null;

function getClient(): ReturnType<typeof createClient> {
  if (!client) {
    const brokerUrl = process.env.MESSAGE_BROKER_URL!;
    // Backend is unused (we never call asyncResult().get() -- pipeline
    // progress comes from polling DocumentProcessingEvent instead), but
    // createClient requires a value; reuse the broker URL.
    client = createClient(brokerUrl, brokerUrl, QUEUE);
  }
  return client;
}

// celery-node's Client.sendTask()/Task.delay() publish fire-and-forget with
// no way to await success or catch a connection failure -- the promise
// chain inside sendTaskMessage() is never returned to the caller. We call
// the broker directly instead so a publish failure surfaces as a thrown
// error rather than a silent unhandled rejection.
async function publishTask(taskName: string, args: unknown[]): Promise<void> {
  const celery = getClient();
  const taskId = randomUUID();
  const message = celery.createTaskMessage(taskId, taskName, args, {});

  await celery.broker.isReady();
  await celery.broker.publish(message.body, "", QUEUE, message.headers, message.properties);
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
