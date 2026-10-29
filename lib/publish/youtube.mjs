import { readFileSync, statSync } from "node:fs";
import { requireEnv } from "../env.mjs";

export async function youtubeAccessToken() {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: requireEnv("YOUTUBE_CLIENT_ID", "Google Cloud > Credentials > OAuth client (Desktop app)"),
      client_secret: requireEnv("YOUTUBE_CLIENT_SECRET", "Google Cloud > Credentials > OAuth client"),
      refresh_token: requireEnv("YOUTUBE_REFRESH_TOKEN", "run: node studio.mjs auth youtube"),
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube login failed: ${data.error_description ?? data.error}`);
  return data.access_token;
}

// Resumable upload via the YouTube Data API. Vertical videos under 3 minutes become Shorts automatically.
export async function postYouTube({ file, title, caption, settings }) {
  const token = await youtubeAccessToken();
  const size = statSync(file).size;
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify({
      snippet: { title: title.slice(0, 100), description: caption, tags: settings.tags ?? [], categoryId: settings.categoryId ?? "22" },
      status: { privacyStatus: settings.privacy ?? "public", selfDeclaredMadeForKids: false },
    }),
  });
  if (!start.ok) throw new Error(`YouTube upload refused (${start.status}): ${await start.text()}`);
  const upload = await fetch(start.headers.get("location"), {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: readFileSync(file),
  });
  const data = await upload.json();
  if (!upload.ok) throw new Error(`YouTube upload failed (${upload.status}): ${data.error?.message}`);
  return { id: data.id, url: `https://youtu.be/${data.id}` };
}
