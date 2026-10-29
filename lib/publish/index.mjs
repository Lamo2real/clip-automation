import { dryRun } from "../env.mjs";
import { presign } from "../aws.mjs";
import { postInstagram } from "./instagram.mjs";
import { postFacebook } from "./facebook.mjs";
import { postYouTube } from "./youtube.mjs";
import { postTikTok } from "./tiktok.mjs";

const PUBLISHERS = { instagram: postInstagram, facebook: postFacebook, youtube: postYouTube, tiktok: postTikTok };

// Posts to every platform in the job's preset. A failure on one platform doesn't stop the others,
// and platforms that already succeeded on an earlier attempt are skipped.
export async function publishAll(job) {
  const results = { ...job.results };
  for (const platform of job.platforms) {
    if (results[platform] && !results[platform].error) continue;
    const post = PUBLISHERS[platform];
    if (!post) {
      results[platform] = { error: "unknown platform" };
      continue;
    }
    try {
      if (dryRun()) {
        console.log(`[dry run] ${platform}: would post ${job.output}`);
        results[platform] = { url: `(dry run) ${platform}` };
        continue;
      }
      // Meta fetches the file itself, so it gets a temporary link to the private S3 object.
      const videoUrl = job.s3Key ? await presign(job.s3Key, 3600) : null;
      console.log(`Publishing to ${platform}...`);
      results[platform] = await post({ file: job.output, videoUrl, title: job.title, caption: job.caption, settings: job.settings?.[platform] ?? {} });
      console.log(`  ${platform}: ${results[platform].url}`);
    } catch (err) {
      console.error(`  ${platform} failed: ${err.message}`);
      results[platform] = { error: err.message };
    }
  }
  return results;
}
