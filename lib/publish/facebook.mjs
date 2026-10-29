import { requireEnv } from "../env.mjs";
import { graph } from "../meta.mjs";

let pageToken;

// Posts to your Facebook Page. Facebook downloads the video from the temporary S3 link.
export async function postFacebook({ videoUrl, title, caption }) {
  const pageId = requireEnv("FACEBOOK_PAGE_ID", "your Facebook Page id");
  if (!videoUrl) throw new Error("Facebook needs the video in S3 (set S3_BUCKET)");
  // Page posts need the Page's own token, which the system-user token can look up.
  pageToken ??= (await graph("GET", pageId, { fields: "access_token" })).access_token;
  const { id } = await graph(
    "POST",
    `${pageId}/videos`,
    { file_url: videoUrl, title, description: caption, published: true },
    { host: "graph-video.facebook.com", accessToken: pageToken },
  );
  return { id, url: `https://www.facebook.com/${pageId}/videos/${id}` };
}
