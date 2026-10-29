import path from "node:path";
import { ROOT, requireEnv, download, sleep } from "./env.mjs";

const BASE = "https://api.tella.com/v1";

async function api(method, route, body) {
  const key = requireEnv("TELLA_API_KEY", "Tella > Workspace settings > API");
  const res = await fetch(BASE + route, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Tella ${method} ${route} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function listVideos(limit = 20) {
  const { videos } = await api("GET", `/videos?limit=${limit}`);
  if (!videos.length) console.log("No videos in this Tella workspace yet. Record one in Tella, then run this again.");
  for (const v of videos) {
    console.log(`${v.id}  ${v.aspectRatio ?? ""}  ${v.updatedAt?.slice(0, 10)}  ${v.name}`);
  }
}

// Starts a Tella export, waits for it to finish, and saves the MP4 to media/raw/.
export async function pullVideo(id, { resolution = "1080p", fps = "30" } = {}) {
  const { export: job } = await api("POST", `/videos/${id}/exports`, {
    granularity: "video",
    resolution,
    fps,
  });
  console.log(`Tella export ${job.exportId} started`);
  let status = job;
  while (status.status !== "completed") {
    if (status.status === "failed") throw new Error("Tella export failed");
    await sleep(5000);
    ({ export: status } = await api("GET", `/videos/${id}/exports/${job.exportId}`));
    process.stdout.write(`\r  ${status.status} ${status.progress ?? 0}%   `);
  }
  const dest = path.join(ROOT, "media/raw", `${id}.mp4`);
  await download(status.downloadUrl, dest);
  console.log(`\nSaved ${path.relative(ROOT, dest)}`);
  return dest;
}
