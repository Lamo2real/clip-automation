import { readFileSync } from "node:fs";
import path from "node:path";
import { requireEnv, dryRun } from "./env.mjs";
import { graph } from "./meta.mjs";

const phoneId = () => requireEnv("WHATSAPP_PHONE_NUMBER_ID", "Meta > WhatsApp > API Setup > Phone number ID");
const to = () => requireEnv("WHATSAPP_TO", "your own WhatsApp number, international format without +");

async function uploadVideo(file) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", "video/mp4");
  form.append("file", new Blob([readFileSync(file)], { type: "video/mp4" }), path.basename(file));
  const { id } = await graph("POST", `${phoneId()}/media`, form);
  return id;
}

// Sends the preview with Approve / Reject buttons. Uses an approved message template because
// WhatsApp only allows free-form messages within 24 hours of your last message to the number.
export async function sendReview(job, previewFile) {
  const platforms = job.platforms.join(", ");
  if (dryRun()) {
    console.log(`[dry run] WhatsApp: would send "${job.title}" (${path.basename(previewFile)}) for review -> ${platforms}`);
    return;
  }
  const mediaId = await uploadVideo(previewFile);
  await graph("POST", `${phoneId()}/messages`, {
    messaging_product: "whatsapp",
    to: to(),
    type: "template",
    template: {
      name: process.env.WHATSAPP_TEMPLATE || "video_review",
      language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
      components: [
        { type: "header", parameters: [{ type: "video", video: { id: mediaId } }] },
        { type: "body", parameters: [{ type: "text", text: job.title }, { type: "text", text: platforms }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `approve:${job.id}` }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `reject:${job.id}` }] },
      ],
    },
  });
  console.log(`WhatsApp: sent "${job.title}" for review`);
}

export async function sendText(text) {
  if (dryRun()) return console.log(`[dry run] WhatsApp: ${text}`);
  try {
    await graph("POST", `${phoneId()}/messages`, { messaging_product: "whatsapp", to: to(), type: "text", text: { body: text } });
  } catch (err) {
    // Outside the 24-hour window WhatsApp rejects plain texts; the log still has the details.
    console.error(`WhatsApp text not delivered: ${err.message}`);
  }
}
