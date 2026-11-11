---
feature: Retention job (ops)
phase: 09
route: terminal: npm run retention:run (production: POST /api/jobs/retention, daily Coolify scheduled task)
---

# How to: Retention job (ops)

Operator feature with no screen. The monitor app shows its health (monitor brief check 26, `jobs.retention`).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The retention job enforces the one retention table (LIFE-02, D283, D290). Each run:

- deletes **closed** sites 30 days after closure, oldest first, at most 5 per run. A site that only lapsed on billing (disabled, no closed reason) is never deleted (invariant 9);
- keeps the deleted site's signed agreements and exports until their own dates run out (signed agreements 7 years);
- deletes signatures and site policy acknowledgements past their keep-until date, and audit rows older than 2 years (the records of a signing, acknowledgement or policy change are kept 7 years, like the agreement);
- lets exports of deleted sites age out after 90 days.

Org names print only in the terminal. The job route's response, the server log and the monitor heartbeat carry counts only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, project **CDS Platform**, app `cds-platform-prod` (environment **live**), **Environment Variables** | Make sure `CDS_JOB_TOKEN` is set (the same value the quotes, media and assembly tasks use). Generate one with `openssl rand -hex 32` if it is missing, then redeploy | The variable is listed. Without it the route answers `404` to every call, so the job never runs (it fails closed) |
| 2 | Same app, **Scheduled Tasks**, click **+ Add** | Name `retention`, frequency `30 4 * * *` (04:30 UTC daily), container `app`, command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/retention`, click **Save** | The task is listed. Its first run log shows one JSON line such as `{"dryRun":false,"orgsDue":0,"orgsDeleted":0,"capHit":false,...,"failedSteps":[]}` and no site names |
| 3 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` for the PocketBase you want to check | The CLI can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 4 | Terminal at the repo root | Run `npm run retention:run -- --help` | The usage text prints and the command exits. Nothing is read or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run retention:run -- --dry-run` | First line `Dry run: nothing was deleted.`, then `Retention run · 2026-10-08 04:30 UTC` (the current UTC time) and the report lines below. Nothing is deleted and no heartbeat is written |
| 2 | Same output, line **Closed sites due (30 days):** | Read the count and the names | For example `Closed sites due (30 days):   1   would delete: Rivera Bakery (cancelled 7 Sep)`: one closed site is due, with its closed reason and closure date. `0` alone means nothing is due |
| 3 | Same output, the next lines | Read **Signatures past 7 years:**, **Audit rows past 2 years:** and the **Kept:** line | Counts of what the run removes. `Kept: 2 signed agreements for deleted sites (each 7 years from signing).` means the deleted site's signed agreements stay until 7 years after each was signed. The last line always reads `Backups and exports age out on their own over 90 days.` |
| 4 | Same terminal | Run `npm run retention:run` (no `--dry-run`) | The same report with `deleted:` instead of `would delete:`. Each deleted site leaves one `organization.delete` row in **audit_log** (PB admin UI `/_/`, filter `action = "organization.delete"`) |
| 5 | Same output, a line starting **Stopped at 5 sites this run** | Read it if present: `Stopped at 5 sites this run; 3 more wait for the next run. Check why so many closed.` | The job deletes at most 5 sites per run, on purpose. The rest go on the next daily run. Many closures at once is unusual: check the closed reasons in **organizations** before the next run. The monitor shows a warning (`cap_hit`) until a run no longer hits the cap |
| 6 | Same output, a line starting **Not finished:** | Read it if present, for example `Not finished: closed-orgs. Run it again; if it fails twice, check the server log.` | One step failed; the other steps still ran. Run the command again. The heartbeat is not updated until a run finishes with no failed step, so the monitor warns after 36 h |
| 7 | PB admin UI `/_/`, collection **platform_meta** | Filter `key ~ "job:retention"` | `job:retention:last_success` holds the time of the last clean run; `job:retention:last_counts` holds the counts (no site ids or names). The monitor reads the same through `retentionStatus()`: `last_success`, `cap_hit` and `overdue_closed_orgs` (closed sites past 30 days still present; critical when above 0 for more than 3 days) |
