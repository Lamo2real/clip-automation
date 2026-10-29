import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { requireEnv, setEnv } from "./env.mjs";

// YouTube: Google lets desktop apps redirect back to a temporary local web server.
export async function authYouTube() {
  const clientId = requireEnv("YOUTUBE_CLIENT_ID", "Google Cloud > Credentials > OAuth client (Desktop app)");
  const clientSecret = requireEnv("YOUTUBE_CLIENT_SECRET", "Google Cloud > Credentials > OAuth client");
  const state = randomBytes(16).toString("hex");
  const port = 8085;
  const redirect = `http://127.0.0.1:${port}/callback`;

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, redirect);
      if (url.pathname !== "/callback") return res.end();
      res.end("YouTube is connected. You can close this tab.");
      server.close();
      if (url.searchParams.get("state") !== state) return reject(new Error("Login state mismatch, try again"));
      url.searchParams.get("code") ? resolve(url.searchParams.get("code")) : reject(new Error(url.searchParams.get("error")));
    }).listen(port, "127.0.0.1");
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/youtube.upload",
      access_type: "offline",
      prompt: "consent",
      state,
    });
    console.log("Opening Google sign-in in your browser...");
    execFile("open", [auth.toString()]);
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code" }),
  });
  const data = await res.json();
  if (!data.refresh_token) throw new Error(`Google didn't return a refresh token: ${data.error_description ?? data.error}`);
  setEnv("YOUTUBE_REFRESH_TOKEN", data.refresh_token);
  console.log("YouTube connected. Refresh token saved to .env.");
}

// TikTok only allows https redirect URIs, so it redirects to the AWS webhook, which shows the
// code for you to paste here.
export async function authTikTok() {
  const clientKey = requireEnv("TIKTOK_CLIENT_KEY", "TikTok developer portal > your app");
  const clientSecret = requireEnv("TIKTOK_CLIENT_SECRET", "TikTok developer portal > your app");
  const redirect = requireEnv("TIKTOK_REDIRECT_URI", "the OAuthRedirectUrl output of the AWS stack");
  const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
  auth.search = new URLSearchParams({
    client_key: clientKey,
    response_type: "code",
    scope: "user.info.basic,video.publish,video.upload",
    redirect_uri: redirect,
    state: randomBytes(16).toString("hex"),
  });
  console.log("Opening TikTok sign-in in your browser...");
  execFile("open", [auth.toString()]);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("Paste the code shown after you approve: ")).trim();
  rl.close();

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirect }),
  });
  const data = await res.json();
  if (!data.refresh_token) throw new Error(`TikTok didn't return a refresh token: ${data.error_description ?? data.error}`);
  setEnv("TIKTOK_REFRESH_TOKEN", data.refresh_token);
  console.log("TikTok connected. Refresh token saved to .env.");
}
