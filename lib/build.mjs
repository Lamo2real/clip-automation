import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./env.mjs";

const HYPERFRAMES = "hyperframes@0.8.214";
const CACHE = path.join(ROOT, "out/cache");

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...opts }).toString();
  } catch (err) {
    throw new Error(`${cmd} failed:\n${err.stderr?.toString().slice(-2000) || err.message}`);
  }
}

export function probe(file) {
  const info = JSON.parse(run("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]));
  return {
    duration: Number(info.format.duration),
    hasAudio: info.streams.some((s) => s.codec_type === "audio"),
    size: Number(info.format.size),
  };
}

// Renders the HyperFrames title card with the given variables. Results are cached by content.
// Vertical videos use the portrait template in titles-portrait/.
export function renderTitle(variables, fps, portrait = false) {
  const dir = path.join(ROOT, portrait ? "titles-portrait" : "titles");
  const template = readFileSync(path.join(dir, "index.html"));
  const hash = createHash("sha1").update(template).update(JSON.stringify(variables)).update(String(fps)).update(dir).digest("hex").slice(0, 10);
  const out = path.join(CACHE, `title-${hash}.mp4`);
  if (!existsSync(out)) {
    console.log(`HyperFrames: rendering title "${variables.title ?? ""}"`);
    run("npx", ["--yes", HYPERFRAMES, "render", "--variables", JSON.stringify(variables), "--fps", String(fps), "--quality", "delivery", "--output", out, "--quiet"], {
      cwd: dir,
    });
  }
  return out;
}

// Re-encodes one clip to the shared format so all segments can be joined without re-encoding.
function normalize(clip, index, { width, height, fps, fit }) {
  const src = clip.type === "title" ? renderTitle(clip.variables ?? {}, fps, height > width) : path.resolve(ROOT, clip.src);
  if (!existsSync(src)) throw new Error(`Clip ${index + 1}: file not found: ${src}`);
  const out = path.join(CACHE, `seg-${String(index).padStart(3, "0")}.mp4`);
  const { hasAudio } = probe(src);

  const args = ["-y", "-v", "error"];
  if (clip.in != null) args.push("-ss", String(clip.in));
  if (clip.out != null) args.push("-to", String(clip.out));
  args.push("-i", src);
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  // "blur" fills the empty space with a blurred, zoomed copy of the clip (good for landscape footage
  // in a vertical video); "pad" uses black bars.
  const tail = `fps=${fps},format=yuv420p,setsar=1`;
  const fitted = `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
  const vf = (clip.fit ?? fit) === "blur" && clip.type !== "title"
    ? `[0:v:0]split[bg][fg];[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=40:2[bgb];[fg]${fitted}[fgs];[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${tail}[v]`
    : `[0:v:0]${fitted},pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,${tail}[v]`;
  const volume = clip.volume ?? 1;
  args.push(
    "-filter_complex", vf,
    "-map", "[v]", "-map", hasAudio ? "0:a:0" : "1:a:0",
    "-af", `volume=${volume}`,
    "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
    "-shortest", out,
  );
  console.log(`FFmpeg: clip ${index + 1} (${clip.type}) ${path.relative(ROOT, src)}`);
  run("ffmpeg", args);
  return out;
}

// Takes the path of an edit JSON file, or the edit object itself.
export function build(editOrFile) {
  const edit = typeof editOrFile === "string" ? JSON.parse(readFileSync(editOrFile, "utf8")) : editOrFile;
  const [width, height] = edit.resolution ?? [1920, 1080];
  const fps = edit.fps ?? 30;
  mkdirSync(CACHE, { recursive: true });

  // 1. Normalise every clip (titles come from HyperFrames, footage from S3, Tella or anywhere else).
  const segments = edit.clips.map((clip, i) => normalize(clip, i, { width, height, fps, fit: edit.fit }));

  // 2. Join them losslessly.
  const list = path.join(CACHE, "concat.txt");
  writeFileSync(list, segments.map((s) => `file '${s}'`).join("\n"));
  const joined = path.join(CACHE, "joined.mp4");
  run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", joined]);
  const { duration } = probe(joined);

  // 3. Lay music under the voice, duck it while someone talks, and normalise loudness.
  const output = path.resolve(ROOT, edit.output ?? "out/final.mp4");
  mkdirSync(path.dirname(output), { recursive: true });
  const lufs = edit.loudness ?? -14;
  const loudnorm = `loudnorm=I=${lufs}:TP=-1.5:LRA=11`;
  const args = ["-y", "-v", "error", "-i", joined];
  let filter;
  if (edit.music) {
    const m = edit.music;
    const fadeIn = m.fadeIn ?? 1;
    const fadeOut = m.fadeOut ?? 2;
    args.push("-stream_loop", "-1", "-ss", String(m.start ?? 0), "-i", path.resolve(ROOT, m.src));
    const music = `[1:a]atrim=0:${duration},asetpts=N/SR/TB,volume=${m.volume ?? 0.25},afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, duration - fadeOut)}:d=${fadeOut}`;
    filter = m.duck === false
      ? `${music}[m];[0:a][m]amix=inputs=2:duration=first:normalize=0,${loudnorm}[a]`
      : `[0:a]asplit=2[voice][key];${music}[m];[m][key]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[md];[voice][md]amix=inputs=2:duration=first:normalize=0,${loudnorm}[a]`;
  } else {
    filter = `[0:a]${loudnorm}[a]`;
  }
  args.push("-filter_complex", filter, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output);
  console.log("FFmpeg: mixing music and loudness");
  run("ffmpeg", args);
  console.log(`Done: ${path.relative(ROOT, output)} (${duration.toFixed(1)}s)`);
  return output;
}

// Small copy for WhatsApp, which only accepts videos up to 16 MB.
export function makePreview(src, dest, maxMB = 15) {
  const { duration, size } = probe(src);
  if (size < maxMB * 1024 * 1024) return src;
  const kbps = Math.max(250, Math.floor((maxMB * 8 * 1024) / duration) - 128);
  run("ffmpeg", [
    "-y", "-v", "error", "-i", src,
    "-vf", "scale='if(gt(iw,ih),-2,720)':'if(gt(iw,ih),720,-2)'",
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", dest,
  ]);
  return dest;
}
