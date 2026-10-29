import { receive, ack, retryLater } from "./aws.mjs";
import { handleUpload, handleReview } from "./jobs.mjs";
import { sleep } from "./env.mjs";

// One queue carries both kinds of event: S3 "a file was uploaded" notifications, and
// {"type":"review"} messages from the WhatsApp webhook when you tap Approve or Reject.
async function handle(msg) {
  const body = JSON.parse(msg.Body);
  if (body.Event === "s3:TestEvent") return;
  if (body.type === "review") return handleReview(body);
  for (const record of body.Records ?? []) {
    if (!record.eventName?.startsWith("ObjectCreated")) continue;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
    await handleUpload({ key, etag: record.s3.object.eTag });
  }
}

// Long-polls the queue. Events that arrive while the Mac is asleep wait in SQS (for up to 14 days)
// and are processed when it wakes. A message that fails 3 times moves to the dead-letter queue.
export async function runWorker() {
  console.log("Worker listening for uploads and WhatsApp reviews. Ctrl+C to stop.");
  for (;;) {
    let messages;
    try {
      messages = await receive();
    } catch (err) {
      console.error(`Queue unreachable (${err.message}); retrying in 30s`);
      await sleep(30_000);
      continue;
    }
    for (const msg of messages) {
      try {
        await handle(msg);
        await ack(msg);
      } catch (err) {
        console.error(`Job failed: ${err.message}`);
        await retryLater(msg).catch(() => {});
      }
    }
  }
}
