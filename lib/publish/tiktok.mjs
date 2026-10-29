import { openSync, readSync, closeSync, statSync } from "node:fs";
import { requireEnv, setEnv, sleep } from "../env.mjs";

const API = "https://open.tiktokapis.com/v2";

// TikTok rotates refresh tokens, so the new one is written back to .env on every login.
export async function tiktokAccessToken() {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: requireEnv("TIKTOK_CLIENT_KEY", "TikTok developer portal > your app"),
      client_secret: requireEnv("TIKTOK_CLIENT_SECRET", "TikTok developer portal > your app"),
      grant_type: "refresh_token",
      refresh_token: requireEnv("TIKTOK_REFRESH_TOKEN", "run: node studio.mjs auth tiktok"),
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`TikTok login failed: ${data.error_description ?? data.error ?? res.status}`);
  if (data.refresh_token) setEnv("TIKTOK_REFRESH_TOKEN", data.refresh_token);
  return data.access_token;
}

async function call(token, route, body) {
  const res = await fetch(`${API}${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error?.code && data.error.code !== "ok") throw new Error(`TikTok ${route}: ${data.error.code} ${data.error.message}`);
  return data.data;
}

// Direct post via the Content Posting API. Until TikTok audits your app, posts must be SELF_ONLY
// (visible only to you); after the audit set "privacy": "PUBLIC_TO_EVERYONE" in the preset.
export async function postTikTok({ file, caption, settings }) {
  const token = await tiktokAccessToken();
  const size = statSync(file).size;
  // Chunks must be 5-64 MB; the last one may be bigger. Files up to 64 MB go in one piece.
  const chunk = size <= 64 * 1024 * 1024 ? size : 10 * 1024 * 1024;
  const count = Math.floor(size / chunk);

  const { publish_id: publishId, upload_url: uploadUrl } = await call(token, "/post/publish/video/init/", {
    post_info: { title: caption.slice(0, 2200), privacy_level: settings.privacy ?? "SELF_ONLY" },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
  });

  const fd = openSync(file, "r");
  try {
    for (let i = 0; i < count; i++) {
      const from = i * chunk;
      const to = i === count - 1 ? size - 1 : from + chunk - 1;
      const buf = Buffer.alloc(to - from + 1);
      readSync(fd, buf, 0, buf.length, from);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Length": String(buf.length), "Content-Range": `bytes ${from}-${to}/${size}` },
        body: buf,
      });
      if (!res.ok) throw new Error(`TikTok chunk ${i + 1}/${count} failed (${res.status})`);
    }
  } finally {
    closeSync(fd);
  }

  for (let i = 0; i < 30; i++) {
    const { status, fail_reason: reason } = await call(token, "/post/publish/status/fetch/", { publish_id: publishId });
    if (status === "PUBLISH_COMPLETE") return { id: publishId, url: "posted (check the TikTok app)" };
    if (status === "FAILED") throw new Error(`TikTok rejected the video: ${reason}`);
    await sleep(10_000);
  }
  return { id: publishId, url: "uploaded, still processing on TikTok" };
}
