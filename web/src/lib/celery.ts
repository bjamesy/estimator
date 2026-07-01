import { randomUUID } from "crypto";

import { createClient } from "celery-node";

const QUEUE = "celery";
const PROCESS_DOCUMENT_TASK = "estimator_workers.tasks.process_document";

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
// error rather than a silent unhandled rejection, which matters here: if
// this fails silently, the Document stays "pending" forever with no
// pipeline ever running and no way for the user to know.
export async function publishProcessDocumentTask(
  documentId: string,
  companyId: string,
  storagePath: string,
): Promise<void> {
  const celery = getClient();
  const taskId = randomUUID();
  const message = celery.createTaskMessage(
    taskId,
    PROCESS_DOCUMENT_TASK,
    [documentId, companyId, storagePath],
    {},
  );

  await celery.broker.isReady();
  await celery.broker.publish(message.body, "", QUEUE, message.headers, message.properties);
}
