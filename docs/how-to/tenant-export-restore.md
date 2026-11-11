---
feature: Tenant export and restore
phase: 02
route: CLI: npm run tenants:export / npm run tenants:restore (production: POST /api/jobs/exports, nightly Coolify scheduled task)
---

# How to: Tenant export and restore

Operator feature with no screen yet. Re-record when P11 (owner Download) and P13 (staff console) add screens.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every night each organization is exported as one JSON file (only approved fields, never passwords, tokens or tenant customer logins) and exports older than 90 days are removed. A super admin can restore one organization from any export; no other organization is touched and the tenant's audit history is kept (TEN-10, TEN-12, TEN-13, LIFE-03).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD` and `PB_APP_KEY` (the same value set on the target PocketBase container; without it PB refuses the staff sign-in) for the target PocketBase. Leave `CDS_ENV` unset outside production. Add `WASABI_ACCESS_KEY_ID`, `WASABI_SECRET_ACCESS_KEY`, `WASABI_REGION` (and `WASABI_BUCKET`) only when Wasabi keys exist, and then also set `CDS_ENV` (`dev` or `production`) | Without Wasabi keys exports go to the local stand-in folder `.storage/` (or `CDS_STORAGE_DIR`). Every run prints a `STORE ...` line naming the store and key prefix; a partial Wasabi setup, or Wasabi without `CDS_ENV`, stops with `FAIL` |
| 2 | Terminal at the repo root | Run `npm run tenants:export -- --dry-run` | One line per organization, `DRY RUN <org-id> -> dev/tenants/<org-id>/exports/<timestamp>.json`, then `DRY RUN N organization(s); nothing written`. No file is created |
| 3 | Coolify, app `cds-platform-prod`, **Scheduled Tasks**, click **+ Add** | Name `exports`, frequency `10 4 * * *` (04:10 UTC daily), container `app`, command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/exports`, then **Save** and **Execute now** | The task log shows `{"exported":N,"pruned":N,"failed":0}`. Production cannot run `npm run tenants:export` (the image has no scripts), so this is how the nightly export runs there |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `npm run tenants:export` | One `PASS exported <org-id> -> dev/tenants/<org-id>/exports/<timestamp>.json` line per organization (active, held and disabled alike), then `PASS pruned N`. The files are under `.storage/dev/tenants/<org-id>/exports/`. Each organization's audit log gets a `tenant.export` row with no actor and `job: nightly-export` |
| 2 | Terminal at the repo root | Pick the organization id and the export key from step 1, then run `npm run tenants:restore -- --org <org-id> --key dev/tenants/<org-id>/exports/<timestamp>.json` | The tool asks for **Staff email** |
| 3 | Same terminal | Type the super admin's email, press Enter, type the password (not shown), press Enter | `Sign-in OTP sent to the staff email. Enter it below.` In dev with `CDS_OTP_STANDIN=1` the 6-digit code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>` |
| 4 | Same terminal | Type the 6-digit code and press Enter | `PASS signed in`, then `PASS restored <org-id> (memberships=N org_hosts=N audit_log=N)`. A `SKIP memberships <id>: user no longer exists` line appears for any member whose login was deleted (`user is CDS staff` for a member who has since become staff). The organization keeps its current status (active, held or disabled); add `--restore-status` to step 2 to take the status from the export instead. A bundle with no owner, an owner who now owns another organization, or an invalid hostname gives `FAIL restore_rejected: ...` and nothing changes |
| 5 | PB admin UI `/_/`, collection **audit_log** | Filter `organization = "<org-id>" && action = "tenant.restore"` | One new row with the super admin as actor and impersonator. Older audit rows are all still there |
| 6 | PB admin UI `/_/`, collections **memberships** and **org_hosts** | Look at another organization's rows | Unchanged by the restore. A support agent who tries step 2 to 4 gets `FAIL forbidden` and nothing changes |
