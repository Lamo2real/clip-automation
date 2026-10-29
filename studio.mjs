#!/usr/bin/env node
import path from "node:path";
import { listVideos, pullVideo } from "./lib/tella.mjs";
import { searchTracks, pullTrack } from "./lib/epidemic.mjs";
import { build, renderTitle } from "./lib/build.mjs";

const HELP = `Video Studio: S3 uploads -> HyperFrames + FFmpeg edit -> WhatsApp review -> social posts

Automatic pipeline
  node studio.mjs worker                     Listen for S3 uploads and WhatsApp answers
  node studio.mjs service install            Run the worker in the background, always
  node studio.mjs service uninstall          Stop and remove the background worker
  node studio.mjs process <file> [preset]    Run one local file through the pipeline (for testing)
  node studio.mjs review <jobId> approve     Approve or reject a job without WhatsApp
  node studio.mjs jobs                       List recent jobs and their status

Accounts
  node studio.mjs auth youtube               Connect your YouTube channel
  node studio.mjs auth tiktok                Connect your TikTok account
  node studio.mjs meta ids                   Show your Facebook Page and Instagram ids

Manual tools
  node studio.mjs music search "<words>"     Search Epidemic Sound
  node studio.mjs music pull <trackId>       Download a track to media/music/<id>.mp3
  node studio.mjs title '{"title":"Hi"}'     Render one HyperFrames title card
  node studio.mjs build edits/example.json   Assemble a video from an edit file
  node studio.mjs tella list | pull <id>     Export videos from Tella

Add DRY_RUN=1 in front of any command to skip WhatsApp, S3 uploads and posting.
`;

const [area, action, arg] = process.argv.slice(2);

try {
  if (area === "worker") await (await import("./lib/worker.mjs")).runWorker();
  else if (area === "service" && action === "install") (await import("./lib/service.mjs")).installService();
  else if (area === "service" && action === "uninstall") (await import("./lib/service.mjs")).uninstallService();
  else if (area === "process" && action) {
    const { handleUpload } = await import("./lib/jobs.mjs");
    const file = path.resolve(action);
    const job = await handleUpload({ key: `uploads/${arg ?? "social"}/${path.basename(file)}`, localFile: file });
    if (job) console.log(`Job ${job.id} is waiting for review: node studio.mjs review ${job.id} approve`);
  } else if (area === "review" && action && ["approve", "reject"].includes(arg)) {
    await (await import("./lib/jobs.mjs")).handleReview({ jobId: action, decision: arg });
  } else if (area === "jobs") {
    const { readdirSync } = await import("node:fs");
    const { loadJob } = await import("./lib/jobs.mjs");
    let dirs = [];
    try {
      dirs = readdirSync("out/jobs");
    } catch {}
    const jobs = dirs.map(loadJob).filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (!jobs.length) console.log("No jobs yet.");
    for (const j of jobs.slice(0, 20)) console.log(`${j.id}  ${j.status.padEnd(16)}  ${j.preset.padEnd(8)}  ${j.title}`);
  } else if (area === "auth" && action === "youtube") await (await import("./lib/auth.mjs")).authYouTube();
  else if (area === "auth" && action === "tiktok") await (await import("./lib/auth.mjs")).authTikTok();
  else if (area === "meta" && action === "ids") {
    const { graph } = await import("./lib/meta.mjs");
    const { data = [] } = await graph("GET", "me/accounts", { fields: "id,name,instagram_business_account{id,username}" });
    if (!data.length) console.log("No Facebook Pages are assigned to this token. Assign your Page to the system user.");
    for (const p of data) {
      const ig = p.instagram_business_account;
      console.log(`FACEBOOK_PAGE_ID=${p.id}    (${p.name})`);
      console.log(ig ? `INSTAGRAM_USER_ID=${ig.id}    (@${ig.username})` : "  (no Instagram professional account linked to this Page)");
    }
  }
  else if (area === "tella" && action === "list") await listVideos();
  else if (area === "tella" && action === "pull" && arg) await pullVideo(arg);
  else if (area === "music" && action === "search" && arg) await searchTracks(arg);
  else if (area === "music" && action === "pull" && arg) await pullTrack(arg);
  else if (area === "title" && action) console.log(renderTitle(JSON.parse(action), 30));
  else if (area === "build" && action) build(action);
  else console.log(HELP);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
