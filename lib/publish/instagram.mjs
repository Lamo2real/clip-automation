import { requireEnv, sleep } from "../env.mjs";
import { graph } from "../meta.mjs";

// Instagram Reels via the Content Publishing API: create a container from a URL, wait for
// Instagram to process it, then publish. Needs a Business or Creator account linked to a Facebook Page.
export async function postInstagram({ videoUrl, caption }) {
  const igUser = requireEnv("INSTAGRAM_USER_ID", "the Instagram account id linked to your Facebook Page");
  if (!videoUrl) throw new Error("Instagram needs the video in S3 (set S3_BUCKET)");

  const { id: container } = await graph("POST", `${igUser}/media`, { media_type: "REELS", video_url: videoUrl, caption, share_to_feed: true });
  for (let i = 0; i < 60; i++) {
    const { status_code: status, status: detail } = await graph("GET", container, { fields: "status_code,status" });
    if (status === "FINISHED") break;
    if (status === "ERROR" || status === "EXPIRED") throw new Error(`Instagram processing ${status}: ${detail}`);
    if (i === 59) throw new Error("Instagram is still processing after 10 minutes");
    await sleep(10_000);
  }
  const { id } = await graph("POST", `${igUser}/media_publish`, { creation_id: container });
  const { permalink } = await graph("GET", id, { fields: "permalink" });
  return { id, url: permalink };
}
