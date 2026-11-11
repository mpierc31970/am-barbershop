---
feature: Media staff tools
phase: 07
route: /staff/health?tab=media (terminal: npm run media:usage, npm run media:takedown)
---

# How to: Media staff tools

The staff console shows the same usage report: **Health › Media usage** (`/staff/health?tab=media`) for every site and **Sites › <site> › Media** (`/staff/sites/<org>?tab=media`) for one (13-45). A file is taken down in the console from a Review queue case (**Remove content** › **Take down file**, Super Admin; see [Review queue, reports and DMCA](staff-review.md)); any other take-down is terminal only. The terminal steps below stay as the alternative; both call the same functions.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Two terminal tools for CDS staff, plus one hourly job:

- **`media:usage`**: how much media each site stores against its 2 GB allowance, and (once Bunny statistics are wired) how much it delivered this month. Super admin or support agent (CONT-19).
- **`media:takedown`**: take one media file down for good (a copyright or abuse complaint, D249). The file is deleted even when pages use it; those pages stop showing it. Its copies in both stores are removed and the CDN is purged. Super admin only; audited with your reason (CONT-33).
- **The hourly media job** (`POST /api/jobs/media`): checks the CDN with a published image, switches the sites to short-lived origin links when the CDN is down and back when it recovers, re-queues stuck videos, clears upload leftovers older than 24 hours, and emails staff when the CDN goes down, when it has been down 72 hours (videos then show their cover only), and when a site goes over its 2 GB allowance. Alerts go to `CDS_STAFF_ALERT_EMAIL`, or `CDS_SUPPORT_EMAIL` when that is not set (CONT-20, D278).

Both tools ask for the staff email, password and the emailed sign-in code.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/`, collection **users** | Make sure your record has **staff_role** `super_admin` (takedown) or `support_agent` (usage only) | That person can sign in to the tools |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` for the target PocketBase | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 3 | Coolify, app `cds-platform-dev` (and `cds-platform-prod` at launch), **Environment Variables** | Set `CDS_STAFF_ALERT_EMAIL` to the staff inbox (optional: without it alerts go to `CDS_SUPPORT_EMAIL`). `CDS_JOB_TOKEN` is already set for the quote job | After a redeploy, the media job can email staff |
| 4 | Coolify, same app, **Scheduled Tasks** | Add a task, frequency `0 * * * *` (hourly), command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/media` | The task log shows a JSON line such as `{"probe":"skipped",...,"failedSteps":[]}`. A wrong token prints nothing (404) |
| 5 | Terminal at the repo root | Run `npm run media:usage -- --help`, then `npm run media:takedown -- --help` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/health?tab=media` (staff console, signed in as a Super Admin or Support agent) | Read "Media storage per site"; turn on **Only over allowance** | Site · Images · Video · Audio · Downloads · Total vs allowance ("80 % used" / "Over allowance" badges) · Delivery this month ("—" until Bunny stats) · **Open site**. Footer like "12 sites · 8.4 GB stored · 1 over allowance". None: "No site stores media yet." |
| 2 | `/staff/sites/<org>?tab=media` | Open one site's **Media** tab | The same figures for that site, and the line "Take down one file: npm run media:takedown -- --org <id> --asset <id> --reason "…"". None: "This site stores no media yet." |
| 3 | `/staff/review/<id>` (a held or reported file) | Click **Remove content**, then **Take down file** in "Take down hero.jpg?" (Super Admin, fresh code) or **Keep the file** | The file is deleted and removed from the CDN; the case records the outcome |
| 4 | Terminal at the repo root | Run `npm run media:usage` | The tool asks for **Staff email** |
| 5 | Same terminal | Type your staff email, press Enter, type the password (not shown), press Enter | `Sign-in OTP sent to the staff email. Enter it below.` In dev with `CDS_OTP_STANDIN=1` the 6-digit code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>` |
| 6 | Same terminal | Type the 6-digit code and press Enter | `PASS signed in`, then a table with columns `ORG NAME STORAGE USED FILES DELIVERY (MONTH)`, biggest first. `STORAGE` reads like `1.2 GB of 2 GB used`; `DELIVERY (MONTH)` reads `not tracked yet` until Bunny statistics are wired. Last line, for example: `12 sites · 8.4 GB stored · 2 at 80 % or more · 1 full`. No media at all prints `No sites store media yet.` |
| 7 | Same terminal | Run `npm run media:usage -- --over` (or `-- --org <org-id>`) and sign in | Only sites at 80 % or more (or that one site) are listed |
| 8 | Hub media drawer `/hub/website?tab=media` (while impersonating, TEN-08) or PB admin UI collection **media_assets** | Find the file to take down; copy its id and its **organization** id | You have both 15-character ids |
| 9 | Terminal at the repo root | Run `npm run media:takedown -- --org <org-id> --asset <asset-id> --reason "Copyright complaint 2026-10-06" --dry-run` and sign in as a super admin | The case prints: `Site:`, `File:`, `Kind:`, `Size:`, `Public:` and `Used on: <page titles>` (or `Not used on any page`), then `DRY RUN nothing deleted` |
| 10 | Same terminal | Run the same command without `--dry-run`, sign in, and answer `y` to `Take down this file? (y/N)` (or pass `--yes`) | `Taken down. The file is gone from the site and the CDN; pages refresh within 5 minutes.` Any other answer prints `Cancelled. Nothing was deleted.` |
| 11 | Browser, the tenant page that used the file, and `/_media/<asset-id>/w960` on the tenant host | Reload after 5 minutes | The page no longer shows the image (the rest of the page is unchanged); the `/_media` address answers 404 |
| 12 | PB admin UI `/_/`, collection **audit_log** | Filter `action = "media_assets.takedown"` | One row with you as actor, the site's organization, and `reason`, `kind` and `bytes` in `meta` |
| 13 | Terminal at the repo root | A support agent runs the takedown command | `Only a super admin can take media down.` and nothing is deleted. A wrong id prints `FAIL no such file for that site` |
| 14 | Dev mail log `.storage/dev/mail/` (until SES) | Open the newest `media.alert` message after the hourly job ran | Subject `<Site> is over its 2 GB media allowance`, `Media CDN is down: serving media from the app` or `Media CDN down 72 hours: videos paused`. One email per event: the job does not repeat an alert it already sent |
