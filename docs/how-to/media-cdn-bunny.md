---
feature: Media delivery through Bunny CDN
phase: 07
route: Coolify env (CDS_MEDIA_CDN) + a published page
---

# How to: Media delivery through Bunny CDN

Operator feature with no screen. Re-record in P13 (staff console).

Published images, video and audio are served by the app at `/_media/...` until Bunny is configured (see `media-delivery.md`). Switching to Bunny is configuration only: no code change, no migration. If Bunny goes down, media falls back to 1-hour signed Wasabi links; after 72 hours videos show their cover image only. Media on password-protected pages always stays on the app route.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, app `cds-platform-dev` (or `cds-platform-prod`), **Environment Variables** | Set `CDS_MEDIA_CDN=bunny`, `BUNNY_PULL_ZONE_HOST` (the bare pull-zone host, for example `cds-media.b-cdn.net`), `BUNNY_TOKEN_KEY`, `BUNNY_API_KEY` and `WASABI_MEDIA_BUCKET` (the pull zone's origin bucket), then click **Redeploy** | The redeploy succeeds. A missing or malformed `BUNNY_*` value stops the first media request with an error naming the variable, never its value |
| 2 | A published tenant page, for example `https://<tenant-host>/` | Right-click, choose **View Page Source**, search for `b-cdn.net` (or your pull-zone host) | Image `src` values start with `https://<pull zone>/tenants/<org>/media/image/` and carry `width=` and `format=auto` |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=media` (Website › Media) | Delete a photo no page uses, then open its old pull-zone URL in a new tab | After the purge (a few seconds) the old URL no longer returns the photo |
| 2 | A published tenant page during a CDN outage (the 07-27 probe has recorded it) | View the page source | Image URLs point at `s3.<region>.wasabisys.com` and carry `X-Amz-Expires=3600`. After 72 hours of outage, videos show their cover image only |
| 3 | Terminal, repo root | Run `npm run media:usage` | The storage column shows `n GB / 2 GB` for each site (07-27's CLI) |
