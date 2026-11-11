---
feature: Media delivery (public media store)
phase: 07
route: /_media/<asset-id>/<variant> on a tenant host
---

# How to: Media delivery (public media store)

Operator feature with no screen. Owners never see it: the media library (07-17) is the owner-facing part. This is how published images, video and audio reach visitors: from a public media store that holds web copies only (never originals, versions, exports or backups), served by the app at `/_media/<asset-id>/<variant>` until the Bunny CDN is configured (07-10).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Variants: images `w480`, `w960`, `w1600`, `w2560`, `thumb`; video `video.mp4`, `poster.jpg`, `poster.webp`, `thumb`, `captions.vtt`; audio `audio.mp3`. Anything else, another site's asset, an asset still processing, or a private asset without a valid link answers 404.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Repo root, file `.env.local` | For the local stand-in, leave `WASABI_MEDIA_BUCKET` unset | Public media is written to `.storage-public/` at the repo root (or the folder in `CDS_PUBLIC_STORAGE_DIR`, which must differ from `CDS_STORAGE_DIR`). The app serves it at `/_media/...` |
| 2 | Same file (and the Coolify app's environment) | Set `CDS_MEDIA_TOKEN_SECRET` to 32 or more random characters, for example the output of `openssl rand -hex 32` | Media on password-protected pages gets signed links. With `CDS_ENV=production` the app refuses protected media until this is set |
| 3 | Coolify app environment (dev or prod) | To go live on Wasabi, set `WASABI_MEDIA_BUCKET` to a bucket separate from `WASABI_BUCKET` (for example `cds-platform-media`), together with the existing `WASABI_ACCESS_KEY_ID`, `WASABI_SECRET_ACCESS_KEY`, `WASABI_REGION` and `CDS_ENV`, then redeploy | Public media now lives in its own bucket. A partial setup, the same bucket as `WASABI_BUCKET`, or production Wasabi keys without `WASABI_MEDIA_BUCKET` stops with an error naming the missing or wrong value |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | A published page on a tenant host, for example `https://<tenant-host>/` | Right-click, choose **View Page Source**, search for `_media` | Every image, video and audio URL starts with `/_media/<asset-id>/` |
| 2 | Browser address bar | Open one image URL from step 1, then open the browser's developer tools, **Network** tab, and reload | The image loads. The response shows `Cache-Control: public, max-age=31536000, immutable` and `Content-Type: image/webp` (captions and posters: `max-age=300`) |
| 3 | Terminal | Run `curl -s -o /dev/null -D - -r 0-99 https://<tenant-host>/_media/<video-asset-id>/video.mp4` | The first line is `HTTP/1.1 206 Partial Content` (or `HTTP/2 206`) and `Content-Range: bytes 0-99/<size>` is listed. Browsers use this to seek in a video |
| 4 | A password-protected page on the tenant host | View the page source and copy one `/_media/...` URL | The URL ends in `?e=<number>&t=<code>`. It works now, answers `Cache-Control: private, max-age=3600`, and returns 404 about an hour later. The same URL without `e` and `t` is 404 |
