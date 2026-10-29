import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env loader, so settings live in one file next to the project.
const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    // Empty values are skipped so e.g. a blank AWS_REGION= doesn't hide the AWS CLI's region.
    const value = m?.[2].replace(/^["']|["']$/g, "");
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}

export function requireEnv(name, hint) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}. Add it to video-studio/.env (${hint}).`);
  return value;
}

// Saves a value to .env (used for OAuth refresh tokens) without printing it.
export function setEnv(name, value) {
  const text = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
  const line = `${name}=${value}`;
  const re = new RegExp(`^${name}=.*$`, "m");
  writeFileSync(envFile, re.test(text) ? text.replace(re, line) : `${text.replace(/\n?$/, "\n")}${line}\n`);
  process.env[name] = value;
}

export const dryRun = () => process.env.DRY_RUN === "1";

export async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
