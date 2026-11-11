---
feature: Search indexing
phase: 13
route: /staff/health?tab=indexing
---

# How to: Search indexing

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every live site is resubmitted to search engines once a week, and its sitemap is checked (STAFF-17, D190). Until IndexNow is connected (P14) the ping is a logged stand-in: it records what it would have sent. **Pages indexed** stays "—" until Search Console is connected. The demo site is always skipped. Both console roles can see this and resubmit; nothing needs a fresh code. The same table shows for one site under Sites › <site> › **Indexing**.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, app `cds-platform-dev` (and `cds-platform-prod` at launch), **Scheduled Tasks** | Add a task, frequency `0 6 * * 0` (Sundays 06:00 UTC), command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/indexing` | The task log shows the job's JSON counts. The **indexing:run** row on Health › Jobs shows its last success (monitor check 35) |
| 2 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |
| 3 | Sidebar | Click **Health**, then the **Indexing** tab | `/staff/health?tab=indexing` opens: "Search indexing for each site" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/health?tab=indexing` | Read the schedule line | "Runs by itself every Sunday. Last run 12 Oct." (or "Not run yet.") |
| 2 | Same tab | Read the table | Site · Last ping ("12 Oct · logged (stand-in)", "OK", "error", "skipped (demo)" or "Never") · Sitemap (**OK**, **Error** or **Not checked**) · Pages indexed ("—"; hover: "Available once Search Console is connected") · Last resubmit · Action. The demo site carries a **Demo** badge. No live sites: "No live sites yet. Sites show here once they go live." |
| 3 | A site row | Click **Resubmit now** (**Resubmit now: Rivera Bakery**) | "Resubmitted Rivera Bakery." The row's Last ping and Sitemap update. A failure adds "The ping failed." or "The sitemap check failed." |
| 4 | Same tab | Click **Resubmit all live sites** | The dialog "Resubmit 14 live sites?" lists the **Live sites** and says "The demo site is skipped." |
| 5 | Same dialog | Click **Resubmit all** (or **Not now**) | "Resubmitted 14 live sites. 0 sitemap errors." With none: "No live sites to resubmit." |
| 6 | `/staff/sites/<org>?tab=indexing` | Open a site, then its **Indexing** tab | The same row for that one site, with **Resubmit now** |
| 7 | A row whose Sitemap reads **Error** | Open the site's `/sitemap.xml` on its live domain | Fix what stops it loading (often the domain or a publish error), then **Resubmit now** again until the Sitemap reads **OK** |
| 8 | Terminal at the repo root | Run `npm run indexing:run -- --dry-run`, then `npm run indexing:run` | The dry run prints what it would ping and check; the real run does the weekly job now (the terminal alternative to **Resubmit all**) |
