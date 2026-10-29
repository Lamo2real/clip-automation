import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { ROOT } from "./env.mjs";

const LABEL = "com.videostudio.worker";
const PLIST = path.join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const domain = () => `gui/${process.getuid()}`;

// Runs the worker in the background whenever you're logged in, and restarts it if it crashes.
export function installService() {
  const log = path.join(ROOT, "out/worker.log");
  mkdirSync(path.dirname(log), { recursive: true });
  // launchd starts with a bare PATH, so include Homebrew's for ffmpeg, npx and node.
  const envPath = `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`;
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${process.execPath}</string><string>${path.join(ROOT, "studio.mjs")}</string><string>worker</string></array>
  <key>WorkingDirectory</key><string>${ROOT}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${envPath}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict>
</plist>
`);
  try {
    execFileSync("launchctl", ["bootout", domain(), PLIST], { stdio: "ignore" });
  } catch {}
  execFileSync("launchctl", ["bootstrap", domain(), PLIST]);
  console.log(`Worker installed and running. Log: ${path.relative(process.cwd(), log) || log}`);
}

export function uninstallService() {
  try {
    execFileSync("launchctl", ["bootout", domain(), PLIST], { stdio: "ignore" });
  } catch {}
  if (existsSync(PLIST)) unlinkSync(PLIST);
  console.log("Worker stopped and removed.");
}
