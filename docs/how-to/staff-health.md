---
feature: Health and fail-safe requests
phase: 13
route: /staff/health
---

# How to: Health and fail-safe requests

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Health is the inside view of the platform (STAFF-13, STAFF-14, D154): every component with its state, reading and threshold, the backups and the restore rehearsal, premium add-on health per site, the scheduled jobs' heartbeats, media storage per site (CONT-19) and the requests the fail-safe captured during an outage (D155). The same checks feed `GET /api/monitor/status` for the separate monitor app, and the every-5-minutes health job emails staff once per incident. The view is read-only: nothing here changes a site, except converting or dismissing a fail-safe request.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, app `cds-platform-dev` (and `cds-platform-prod` at launch), **Environment Variables** | Set `CDS_STAFF_ALERT_EMAIL` to the staff inbox, then redeploy | The Health status line reads "Alerts email s•••@…" instead of "Alert emails are off (CDS_STAFF_ALERT_EMAIL not set)" |
| 2 | Coolify, same app, **Scheduled Tasks** | Add a task, frequency `*/5 * * * *`, command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/health` | The task log shows the job's JSON counts. Without it, the **health:run** row on the Jobs tab turns Warning, then Critical |
| 3 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**; **Health** in the sidebar shows a count when a check is Warning or Critical |
| 4 | Sidebar | Click **Health** | `/staff/health` opens with tabs **Platform · Premium · Fail-safe requests · Jobs · Media usage · Indexing** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/health` (Platform) | Read the status line | "Checked 2 min ago · Alerts email s•••@…". **Refresh health** reruns the read ("Refreshing…") |
| 2 | Same tab, "Platform components" | Read the table | Component (PocketBase, Email, Payments, Content scanners, File scanner, CDN …) · State (**OK**, **Warning**, **Critical**, **No data**, or **Stand-in** for a service still on its stand-in) · Reading · Threshold in words ("Warning above 500 ms · Critical above 2 s") · Since |
| 3 | Same tab, **Backups** | Read "Backups and restore rehearsal" | One row per backup with its age and state, then "Restore last rehearsed 12 days ago" (or "Restore never rehearsed"). Older than 90 days turns Warning. "Runbook: docs/ops/restore-rehearsal.md" names the quarterly drill (`npm run db:restore-rehearse`) |
| 4 | `/staff/health?tab=premium` | Read the tab | While no premium add-on is installed: "No premium add-ons are installed yet." and "Booking arrives in v1.1. Health checks, alerts and the fail-safe are ready for it." Later: "Premium add-on health per site" with Site · Add-on · Health checks · Error rate 1h · DB write p95 · Failed emails/payments |
| 5 | `/staff/health?tab=jobs` | Read "Scheduled jobs" | Job (alerts:run, health:run, quotes:run, media job, assembly job, billing:reconcile, support:run, review:run, demo:reset, retention:run, reports:monthly, indexing:run) · Schedule ("every 5 min", "hourly") · Last success ("4 min ago"; hover for the exact time; "Not run yet") · Last counts · State · Threshold ("Warning after 26 h"). The note reads "Jobs run from the scheduler. This view is read-only; run a job from the terminal if you need it now." |
| 6 | `/staff/health?tab=media` | Read "Media storage per site" (see also [Media staff tools](media-staff-tools.md)) | Site · Images · Video · Audio · Downloads · Total vs allowance (badge "80 % used" or "Over allowance") · Delivery this month ("—" until Bunny stats) · **Open site**. Footer like "12 sites · 8.4 GB stored · 1 over allowance" |
| 7 | Same tab | Turn on **Only over allowance** | Only sites at or past their 2 GB allowance stay. None: "No site is over its allowance." |
| 8 | `/staff/health?tab=failsafe` | Read the tab | While the capture service is not deployed: "Capture service: not deployed (GO-LIVE)" and "No fail-safe requests. They appear here after an outage." Once deployed: "Capture service: deployed · 3 waiting · last pull 2:10 PM" |
| 9 | Same tab | Pick **Show** Pending (default), Converted, Dismissed or All; expand a request | Received · Site · Add-on · Request summary, marked "Captured during an outage. Not validated (intent only)." **Captured details** shows Name, Email, Phone, Preferred time and Message |
| 10 | Pending request | Click **Convert** (**Convert request from Ana Ruiz**) | "Converted. Created <reference>." (the record the add-on made) and the row moves to Converted. A clash (the slot is gone): "Couldn't convert: …" and the row stays Pending; call the visitor and dismiss it. Converting into Booking arrives with the add-on in v1.1 |
| 11 | Pending request | Click **Dismiss**, type a **Reason (spam, already handled by phone …)** (up to 200 characters), click **Dismiss request** in "Dismiss this request?" (or **Keep it**) | "Dismissed." Nothing is created in the add-on; the reason goes in the audit log |
| 12 | `/staff/health?tab=indexing` | Read the tab | Search pings and sitemaps per site; see [Search indexing](staff-indexing.md) |
| 13 | Staff inbox (dev: `.storage/dev/mail/`, until SES) | Open the newest Health email after a check crosses its threshold | Subject like "Critical: PocketBase 2.4 s" with "PocketBase crossed its critical threshold.", a Component · Reading · Threshold · Since table and **Open Health** (`/staff/health?tab=jobs`). One email when it opens, one when it escalates from Warning to Critical, and "Resolved: PocketBase" ("PocketBase is back within its threshold.") when it clears. It never repeats while the incident stays open |
| 14 | `/staff/settings?tab=monitor` (Super Admin) | Read the Monitor tab | Whether `MONITOR_TOKEN` is set, the overall state the monitor app sees and the sections of `GET /api/monitor/status`; see [Console settings](staff-settings.md) |
| 15 | Terminal at the repo root | Run `npm run health:run -- --dry-run` | Prints what the job would open, escalate and resolve without emailing anyone |
