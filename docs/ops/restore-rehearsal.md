# Database restore: runbook and rehearsal log

For CDS staff. Covers STAFF-13 (D154, D171): proving the nightly PocketBase backup restores,
and restoring it for real when a database is lost.

How it fits together:

| Piece                         | What it does                                                                                                                                   |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `backup.sh` (data VPS)        | Nightly: dev 04:10 to `/root/pocketbase-cdsp/backups/cdsp-*.zip`, prod 04:20; 14 days local, offsite to Wasabi (90 days)                       |
| `npm run db:restore-rehearse` | Copies the newest backup (read-only), restores it into a throwaway PocketBase on this machine, counts collections and rows, checks migrations  |
| `platform_meta`               | `backup:restore_rehearsed_at` (ISO) and `backup:restore_rehearsal_counts` (`{ zip, collections, rows, newest_migration }`)                     |
| Monitor check 40              | `backups.restore_rehearsed_at`: warns when null or older than 90 days. The staff console Health view shows "Restore last rehearsed N days ago" |

Safety: the SSH alias `pocketbase-cds` is the **data VPS**. The **container** named
`pocketbase-cds` is the old marketing site's live database: never touch it. The rehearsal only
copies `/root/pocketbase-cdsp/backups/cdsp-*.zip` and never runs anything inside a container.

## 1. When

- **Quarterly** (Health warns after 90 days), and after any change to `backup.sh`, the
  PocketBase version or the migration set.
- Before a risky production change (a big migration, a PocketBase upgrade).

## 2. Rehearse (about 2 minutes)

1. From the repo root, with `.env.local` in place: `npm run db:pb:fetch` (once; fetches the
   pinned binary).
2. Run `npm run db:restore-rehearse -- --from-ssh pocketbase-cds`.
   Expected: one line such as
   `Restore rehearsal · cdsp-20261013-041001.zip · 63 collections · 1 204 rows · newest migration 1790000862 · OK`,
   then `Recorded backup:restore_rehearsed_at …`.
3. The script appends a dated line under **Rehearsals** below. Commit it.
4. Without SSH, copy a zip by hand (Wasabi `cds-platform/dev/db`) and run
   `npm run db:restore-rehearse -- --zip <file>`. Delete the zip afterwards: it holds real data.

Options: `--dry-run` rehearses but records nothing; `--keep` keeps the temp dir (real data:
delete it when done); `--help`.

A **FAILED** line or a `FAIL …` message means the backup does not restore cleanly. Treat it as
an incident: check the newest few zips (`--zip`), check `backup.sh` output in the cron log, fix
before the next night.

The record goes to the PocketBase in `PB_URL` (dev in `.env.local`). To rehearse a **prod**
backup, run it with the prod `PB_URL` and superuser in the environment and a prod zip via
`--zip`, so the production monitor sees the date.

## 3. Real restore (database lost or corrupted)

Dev shown; for prod use `pocketbase-cdsp-prod` and `/root/pocketbase-cdsp-prod/`.

1. Pick the backup: newest in `/root/pocketbase-cdsp/backups/`, else from Wasabi
   (`rclone copy wasabi:cds-platform/dev/db/<zip> /root/restore/`).
2. Rehearse it first on your machine (`--zip`, `--dry-run`). Do not restore a zip that fails.
3. On the data VPS: `docker stop pocketbase-cdsp`.
4. Move the broken data aside (never delete it):
   `mv /root/pocketbase-cdsp/pb_data /root/pocketbase-cdsp/pb_data.broken-$(date +%Y%m%d%H%M)`.
5. `mkdir /root/pocketbase-cdsp/pb_data && cd /root/pocketbase-cdsp/pb_data && unzip /root/pocketbase-cdsp/backups/<zip>`.
6. Put the migrations and hooks back: `npm run db:migrate:dev` from the repo (prod: assemble
   and `scp`, see CLAUDE.md "Production PocketBase").
7. `docker start pocketbase-cdsp`, then check `https://api.cds.needtobeedgy.com/api/health`
   answers 200 and the admin `/_/` signs in.
8. Run the rehearsal checks against the live copy: compare the collection and row counts with
   the rehearsal line for that zip.
9. Log what happened in a ticket or incident (`npm run incident:run`), with the zip name and
   the data-loss window (time of the backup to time of the failure).

## Rehearsals

- 2026-10-13 · Restore rehearsal · cdsp-20261013-041001.zip · 55 collections · 38 rows · newest migration 1790000830 · OK
