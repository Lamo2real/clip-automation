import { existsSync } from "node:fs";
import path from "node:path";
import { ROOT, requireEnv, download } from "./env.mjs";

const BASE = "https://api.epidemicsound.com/v0";

async function api(route) {
  const key = requireEnv("EPIDEMIC_API_KEY", "Epidemic Sound Developer Portal > API keys");
  const headers = { Accept: "application/json", Authorization: `Bearer ${key}` };
  if (process.env.EPIDEMIC_USER_ID) headers["x-partner-user-id"] = process.env.EPIDEMIC_USER_ID;
  const res = await fetch(BASE + route, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Epidemic Sound ${route} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

export async function findTracks(term, limit = 10) {
  const data = await api(`/tracks/search?term=${encodeURIComponent(term)}&limit=${limit}`);
  return data.tracks ?? [];
}

export async function searchTracks(term, limit = 10) {
  for (const t of await findTracks(term, limit)) {
    const moods = (t.moods ?? []).map((m) => m.name).join(", ");
    const secs = `${Math.floor(t.length / 60)}:${String(t.length % 60).padStart(2, "0")}`;
    console.log(`${t.id}  ${secs}  ${t.bpm}bpm  ${t.title} - ${t.mainArtists?.join(", ")}  [${moods}]`);
  }
}

// Downloads a track once; later calls reuse the file in media/music/.
export async function pullTrack(id, quality = "high") {
  const dest = path.join(ROOT, "media/music", `${id}.mp3`);
  if (existsSync(dest)) return dest;
  const { url } = await api(`/tracks/${id}/download?format=mp3&quality=${quality}`);
  await download(url, dest);
  console.log(`Saved ${path.relative(ROOT, dest)}`);
  return dest;
}
