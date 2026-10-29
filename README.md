# Video Studio

Upload a raw video to S3, and a finished, edited version arrives on your WhatsApp. Tap
**Approve** and it's posted to Instagram, Facebook, YouTube and TikTok. Tap **Reject** and nothing
is posted.

```
 you upload                      AWS                          this Mac                       you
 ──────────               ─────────────────            ─────────────────────────         ───────────
 raw.mp4 ──► S3 uploads/<preset>/ ──event──► SQS queue ──► worker: HyperFrames titles ──► WhatsApp:
                                               ▲             + FFmpeg edit + music          preview +
                                               │             (Epidemic Sound)               Approve/Reject
                                               │                                               │
                                 Lambda webhook ◄────────── button tap ◄──────────────────────┘
                                               │
                                               └──► worker ──► Instagram · Facebook · YouTube · TikTok
```

- **Event-driven.** S3 announces each upload on a queue, and your WhatsApp answer goes onto the
  same queue. The worker on your Mac listens to that queue, and your Mac is never exposed to the
  internet.
- **Nothing gets lost.** Events wait in the queue for up to 14 days, so anything uploaded while
  your Mac is asleep is processed when it wakes. A video that fails three times is set aside in a
  "dead-letter" queue instead of retrying forever.
- **The folder picks the style.** `uploads/social/` makes a vertical 9:16 video for all four
  platforms. `uploads/demo/` makes a landscape 16:9 video for YouTube and Facebook. The title
  comes from the file name: `spring_launch-teaser.mp4` becomes **"Spring Launch Teaser"**.

---

## Setup

Take it one part at a time. You can test each part before starting the next.

### Part 1: Tools on this Mac (done)

Node, FFmpeg, HyperFrames and the AWS CLI are already installed, and the AWS CLI is signed in. If
you ever set this up on another Mac:

```bash
brew install node ffmpeg awscli && aws configure
```

```bash
cd ~/projects/social-media/video-studio && npm install
```

### Part 2: Try it without any accounts

This runs a test clip through the whole pipeline. WhatsApp, S3 and posting are only simulated:

```bash
DRY_RUN=1 node studio.mjs process media/raw/spring_launch-teaser.mp4 social
```

The finished video is in `out/jobs/<jobId>/final.mp4`. To simulate tapping Approve:

```bash
DRY_RUN=1 node studio.mjs review <jobId> approve
```

### Part 3: Create the AWS side

This creates the S3 bucket, the queue and the WhatsApp webhook in your AWS account. It costs
almost nothing at this volume (cents per month, plus S3 storage). It asks for your Meta app
secret, so do Part 4 steps 1 and 2 first.

```bash
./infra/deploy.sh
```

It saves the bucket name, queue address and TikTok redirect URL into `.env`, and prints the
webhook URL for Part 4.

### Part 4: Meta (WhatsApp, Instagram and Facebook)

You need a Meta Business account, a Facebook Page, and an Instagram **Business or Creator**
account linked to that Page.

1. Go to <https://developers.facebook.com/apps>, click **Create app**, and choose the **Business**
   type. Add the **WhatsApp** product.
2. In the app, open **App settings → Basic** and copy the **App secret**. `deploy.sh` (Part 3)
   asks for it.
3. Under **WhatsApp → API Setup**, add your phone number as a recipient, then copy the
   **Phone number ID** into `.env` as `WHATSAPP_PHONE_NUMBER_ID`. The free test number works to
   start with.
4. Under **WhatsApp → Configuration → Webhook**, paste the **Callback URL** that `deploy.sh`
   printed. For the verify token, use `WHATSAPP_VERIFY_TOKEN` from `.env`. Then subscribe to the
   **messages** field.
5. Create the review message template in **WhatsApp Manager → Message templates → Create**:
   - Name: `video_review`. Category: **Utility**. Language: **English**.
   - Header: **Video**.
   - Body: `New video ready for review: {{1}}. It will be posted to: {{2}}`
   - Buttons: two **Quick reply** buttons, `Approve` and `Reject`, in that order.
   - Submit it. Approval usually takes minutes.
6. In **Business Settings → Users → System users**, create an admin system user. Assign it your
   app, your Page (full control) and your WhatsApp account. Click **Generate token** with these
   permissions: `whatsapp_business_messaging`, `whatsapp_business_management`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`
   and `business_management`. Choose **never expires**, and save the token as `META_ACCESS_TOKEN`.
7. Look up your Page and Instagram ids, and copy both lines it prints into `.env`:

```bash
node studio.mjs meta ids
```

### Part 5: YouTube

1. In <https://console.cloud.google.com>, create a project and enable **YouTube Data API v3**.
2. Under **APIs & Services → OAuth consent screen**, choose **External** and add yourself as a
   **test user**.
3. Under **Credentials → Create credentials → OAuth client ID**, choose **Desktop app**. Copy the
   client ID and secret into `.env` as `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`.
4. Connect your channel. A browser window opens, and the login is saved to `.env`:

```bash
node studio.mjs auth youtube
```

> **Important:** Google makes every upload from an API project that hasn't passed its audit
> **private**. The upload works, but only you can see the video until you make it public in
> YouTube Studio. Apply for the audit with Google's "YouTube API Services audit and quota
> extension" form. Once it's approved, `"privacy": "public"` in the presets takes effect.

### Part 6: TikTok

1. At <https://developers.tiktok.com>, create an app and add the **Login Kit** and
   **Content Posting API** products, with **Direct Post** turned on.
2. Add the scopes `user.info.basic`, `video.upload` and `video.publish`.
3. As the redirect URI, use `TIKTOK_REDIRECT_URI` from your `.env` (filled in by `deploy.sh`).
4. Copy the **Client key** and **Client secret** into `.env`.
5. Connect your account. Approve in the browser, then paste the code it shows into the terminal:

```bash
node studio.mjs auth tiktok
```

> **Important:** until TikTok audits your app, posts can only be **private** (`SELF_ONLY`),
> visible only to you. Apply for the audit in the developer portal. Once it's approved, set
> `"tiktok": { "privacy": "PUBLIC_TO_EVERYONE" }` in your presets.

### Part 7: Turn it on

Run the worker in this terminal to watch it work:

```bash
node studio.mjs worker
```

Once you're happy, install it as a background service. It then starts when you log in and
restarts itself if it crashes:

```bash
node studio.mjs service install
```

Its log is in `out/worker.log`. To stop it, run `node studio.mjs service uninstall`.

---

## Using it

Upload with the AWS CLI, the S3 web console, or any S3 app on your phone or Finder (for example
Cyberduck or Transmit):

```bash
aws s3 cp ~/Movies/spring_launch-teaser.mp4 s3://<your-bucket>/uploads/social/
```

A few minutes later the preview arrives on WhatsApp. Tap **Approve** or **Reject**. You get a
message back with a link for each platform.

```bash
node studio.mjs jobs
```

That lists recent videos and their status: building, awaiting_review, published, partly_published,
rejected or failed. If one platform failed (for example, its token expired), fix the cause, then
re-approve. Only the failed platforms are retried:

```bash
node studio.mjs review <jobId> approve
```

Finished videos are also kept in S3 under `output/<preset>/`.

## Presets

Each file in [presets/](presets) is one upload folder. Copy one to make a new style, for example
`presets/podcast.json` for `uploads/podcast/`.

| Field | Meaning |
| --- | --- |
| `resolution` | `[1080, 1920]` vertical, `[1920, 1080]` landscape, `[1080, 1080]` square |
| `fit` | `blur` fills empty space with a blurred copy of the video; `pad` uses black bars |
| `intro` / `outro` | Title card text and colours (see [titles/index.html](titles/index.html)). Leave out `outro` to skip it. |
| `music.trackId` | An Epidemic Sound track id (`node studio.mjs music search "lofi"`) |
| `music.search` | Or pick the top result for these words automatically |
| `music.volume` | 0.2 to 0.3 suits talking; ducking lowers it further under speech |
| `caption` | Post text. `{title}` is replaced with the video's title. |
| `platforms` | Any of `instagram`, `facebook`, `youtube`, `tiktok` |
| `youtube` | `privacy`, `categoryId` (22 People & Blogs, 28 Science & Tech) and `tags` |
| `tiktok` | `privacy`: `SELF_ONLY` until your app is audited |

## Limits to know

- **WhatsApp** only accepts videos up to 16 MB, so the preview is a smaller copy when needed. The
  real post uses the full-quality file.
- **WhatsApp texts** (the results after you approve) only go through within 24 hours of your last
  message to the business number. Tapping a button counts, so they normally arrive.
- **Instagram Reels** must be 3 seconds to 15 minutes long, and look best at 9:16.
- **Only your number** can approve. The webhook ignores taps from anyone else, and checks that
  every request really comes from Meta.

## Troubleshooting

- **Nothing happens after an upload:** is the worker running (`tail -f out/worker.log`)? Is the
  file in `uploads/<preset>/` and a video (`.mp4`, `.mov`, `.m4v`, `.webm` or `.mkv`)?
- **No WhatsApp message:** has the `video_review` template been approved? Is `WHATSAPP_TO` your
  number with country code and without `+`?
- **Tapping Approve does nothing:** check that the webhook is subscribed to **messages** in Meta,
  then check the Lambda logs in the AWS console (CloudWatch → Log groups → `/aws/lambda/video-studio-...`).
- **A job keeps failing:** after three tries it moves to the dead-letter queue. See the error with
  `node studio.mjs jobs` and in `out/jobs/<jobId>/job.json`.
- **HyperFrames:** `cd titles && npx --yes hyperframes@0.8.214 doctor`.
