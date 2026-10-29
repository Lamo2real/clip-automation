import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT, dryRun } from "./env.mjs";
import { build, makePreview } from "./build.mjs";
import { findTracks, pullTrack } from "./epidemic.mjs";
import { downloadObject, uploadObject } from "./aws.mjs";
import { sendReview, sendText } from "./whatsapp.mjs";
import { publishAll } from "./publish/index.mjs";

const JOBS = path.join(ROOT, "out/jobs");
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const DEFAULT_PRESET = "social";

const jobFile = (id) => path.join(JOBS, id, "job.json");
export const loadJob = (id) => (existsSync(jobFile(id)) ? JSON.parse(readFileSync(jobFile(id), "utf8")) : null);
function saveJob(job) {
  mkdirSync(path.dirname(jobFile(job.id)), { recursive: true });
  job.updatedAt = new Date().toISOString();
  writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2));
  return job;
}

function loadPreset(name) {
  const file = path.join(ROOT, "presets", `${name}.json`);
  if (existsSync(file)) return { name, ...JSON.parse(readFileSync(file, "utf8")) };
  console.warn(`No preset "${name}", using "${DEFAULT_PRESET}"`);
  return { name: DEFAULT_PRESET, ...JSON.parse(readFileSync(path.join(ROOT, "presets", `${DEFAULT_PRESET}.json`), "utf8")) };
}

// "my_product-launch v2.mp4" -> "My Product Launch V2"
const titleFromFile = (file) =>
  path.parse(file).name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/\b\w/g, (c) => c.toUpperCase());
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

async function resolveMusic(music) {
  if (!music) return undefined;
  let src = music.src;
  if (music.trackId) src = await pullTrack(music.trackId);
  else if (music.search) {
    const [track] = await findTracks(music.search, 1);
    if (!track) throw new Error(`No Epidemic Sound track for "${music.search}"`);
    src = await pullTrack(track.id);
  }
  return { ...music, src };
}

// An upload landed (from S3, or a local file for testing): edit it and send it for review.
// `key` looks like uploads/<preset>/<file name>; the folder picks the preset.
export async function handleUpload({ key, etag, localFile }) {
  const fileName = path.basename(key);
  if (!VIDEO_EXT.has(path.extname(fileName).toLowerCase())) return console.log(`Skipping ${key}: not a video`);
  const parts = key.split("/");
  const preset = loadPreset(parts.length >= 3 ? parts[1] : DEFAULT_PRESET);

  const id = createHash("sha1").update(`${key}:${etag ?? (localFile ? statSync(localFile).size : "")}`).digest("hex").slice(0, 10);
  const existing = loadJob(id);
  if (existing && existing.status !== "failed") return console.log(`Job ${id} already ${existing.status}, skipping duplicate event`);

  const title = titleFromFile(fileName);
  const job = saveJob({ id, key, title, preset: preset.name, platforms: preset.platforms, status: "building", createdAt: new Date().toISOString() });
  console.log(`\nJob ${id}: "${title}" (preset ${preset.name})`);
  try {
    const dir = path.join(JOBS, id);
    const raw = path.join(dir, `source${path.extname(fileName).toLowerCase()}`);
    if (localFile) copyFileSync(localFile, raw);
    else await downloadObject(key, raw);

    const clips = [{ type: "title", variables: { ...preset.intro, title } }, { type: "video", src: raw }];
    if (preset.outro) clips.push({ type: "title", variables: preset.outro });
    job.output = build({
      output: path.join(dir, "final.mp4"),
      resolution: preset.resolution,
      fps: preset.fps,
      fit: preset.fit,
      clips,
      music: await resolveMusic(preset.music),
      loudness: preset.loudness,
    });
    job.caption = (preset.caption ?? "{title}").replaceAll("{title}", title);
    job.settings = { youtube: preset.youtube, tiktok: preset.tiktok };

    if (process.env.S3_BUCKET && !dryRun()) {
      job.s3Key = await uploadObject(job.output, `output/${preset.name}/${id}-${slug(title)}.mp4`);
    }
    const preview = makePreview(job.output, path.join(dir, "preview.mp4"));
    await sendReview(job, preview);
    return saveJob({ ...job, status: "awaiting_review" });
  } catch (err) {
    saveJob({ ...job, status: "failed", error: err.message });
    await sendText(`Video "${title}" failed to build: ${err.message.slice(0, 300)}`);
    throw err;
  }
}

// You tapped Approve or Reject in WhatsApp.
export async function handleReview({ jobId, decision }) {
  const job = loadJob(jobId);
  if (!job) return console.warn(`Review for unknown job ${jobId}`);
  // A partly published job can be approved again to retry just the platforms that failed.
  const retry = job.status === "partly_published" && decision === "approve";
  if (job.status !== "awaiting_review" && !retry) return console.log(`Job ${jobId} is ${job.status}; ignoring repeated ${decision}`);

  if (decision === "reject") {
    saveJob({ ...job, status: "rejected" });
    return sendText(`OK, "${job.title}" won't be posted.`);
  }
  saveJob({ ...job, status: "publishing" });
  await sendText(`Posting "${job.title}" to ${job.platforms.join(", ")}...`);
  const results = await publishAll(job);
  const failed = Object.values(results).some((r) => r.error);
  saveJob({ ...job, status: failed ? "partly_published" : "published", results });
  const lines = Object.entries(results).map(([p, r]) => (r.error ? `✗ ${p}: ${r.error.slice(0, 200)}` : `✓ ${p}: ${r.url ?? "posted"}`));
  await sendText(`"${job.title}"\n${lines.join("\n")}`);
}
