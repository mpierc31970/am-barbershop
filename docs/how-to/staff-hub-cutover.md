---
feature: Hub cutover and rollback
phase: 15
route: /staff/health (terminal: npm run hub:cutover -- plan | check | apply | rollback)
---

# How to: Hub cutover and rollback

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The cutover moves `connectionsdesignstudios.com` and `www.connectionsdesignstudios.com` from the old marketing site to the platform app `cds-platform-prod`, which then serves the CDS hub there (HUB-04, D34, D62). The old app is **stopped, never deleted**, and stays the fallback. The full runbook, with every prerequisite and what each `check` row means, is [`docs/ops/hub-cutover.md`](../ops/hub-cutover.md).

- **Run it once, by hand, from a terminal**, only **after the final milestone push and a green production deploy** of `cds-platform-prod` (A4-Q1). Always start with `check`.
- **Open the SSH tunnel to Coolify first**, in its own terminal, and leave it running: `ssh -i ~/.ssh/pocketbase-cds -N -L 8000:127.0.0.1:8000 root@82.180.132.176`. The tool talks to Coolify at `http://127.0.0.1:8000/api/v1` through it, so the token never crosses the internet as plain HTTP. Plain `http://` to any other host is refused unless you add `--coolify-url <url> --insecure-http` (avoid it). Without the tunnel the Coolify rows read "check could not run (CoolifyError)".
- From Git Bash, prefix every command with `MSYS_NO_PATHCONV=1`. The Coolify token is read from `~/.coolify_api_token` (else `.env.local` `COOLIFY_API_TOKEN`) and is never printed. It needs Coolify's `read:sensitive` permission, or the `prod-env` row reads "check could not run (CoolifyValuesHidden)".
- Every `check` adds one line, and every `apply` / `rollback` step one line, to the **Run log** at the end of the runbook.

| Subcommand | Changes anything? |
|---|---|
| `plan`, or any subcommand with `--dry-run` | No: prints the steps only, no call at all |
| `check` | No: Coolify reads, public DNS, a read-only look at production PocketBase's migrations |
| `apply` | Yes: asks you to type the domain first |
| `rollback` | Yes: asks you to type the domain first |

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Run `MSYS_NO_PATHCONV=1 npm run hub:cutover -- --help` | The usage text lists `plan`, `check`, `apply`, `rollback` and the flags `--dry-run`, `--yes`, `--expect-sha`, `--mailboxes-ready`, `--coolify-url`, `--insecure-http` |
| 2 | Same terminal | Run `MSYS_NO_PATHCONV=1 npm run hub:cutover -- plan` | The eight apply steps print (`preflight`, `save-state`, `free-old`, `redeploy-old`, `assign-prod`, `deploy-prod`, `verify`, `stop-old`), then "Dry run: nothing was changed." |
| 3 | [`docs/ops/hub-cutover.md`](../ops/hub-cutover.md) section 1 | Work through the 14 prerequisites: prod built from the repo `Dockerfile` (port 3000, `/api/health`), the prod env keys (`PLATFORM_HOSTS` with the apex, `www` and the sslip address, `CDS_PLATFORM_URL`, `CDS_ENV=production`, `APP_VERSION`, `PB_URL`, `PB_APP_KEY`, `CDS_JOB_TOKEN`, build-time `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`), every migration pushed from the assembled dir, mailboxes, verified claims ([Competitor claims](staff-hub-claims.md)), confirmed proof ([The CDS hub site](staff-hub-site.md)) | Each one is done or consciously left as a WARN. Never write a secret value into a file the repo tracks |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal | Push `main` and wait for Coolify to show a green production deploy of `cds-platform-prod` | Prod answers `/api/health` on its sslip address |
| 2 | Terminal | Run `MSYS_NO_PATHCONV=1 npm run hub:cutover -- check` | A table `status · check · detail · fix` with one row each for `dns`, `prod-source`, `prod-env`, `prod-health`, `hub-marker`, `prod-migrations`, `old-app`, `ready-claims`, `ready-proof`, `ready-parity`, `ready-mailboxes`; then "N PASS · N WARN · N FAIL" and "Read-only: nothing was written." Env rows name keys only, never values. Exit 1 while any row FAILs |
| 3 | Same table | Fix every FAIL using its **fix** column, read every WARN, run `check` again | "N PASS · N WARN · 0 FAIL". FAIL rows block `apply`; WARN rows do not |
| 4 | Terminal (interactive, not a script) | Run `MSYS_NO_PATHCONV=1 npm run hub:cutover -- apply --mailboxes-ready` (add `--mailboxes-ready` only once hello@ and abuse@ receive mail) | The check table and the plan print, then "Type the domain to continue (connectionsdesignstudios.com):". A FAIL row refuses here without asking |
| 5 | Same prompt | Type `connectionsdesignstudios.com` exactly and press Enter | Each step prints as it runs: `preflight` · `save-state` (both apps' domains saved to `.planning/tmp/cutover-state.json`) · `free-old` (old app back to its sslip address) · `redeploy-old` (the proxy drops the old app's apex and `www` routes) · `assign-prod` (prod gets the apex and `www`) · `deploy-prod` (each deploy waits until Coolify reports it finished, up to 15 minutes) · `verify` (polls HTTPS every 10 s, up to 5 minutes) · `stop-old`. It ends "Cutover done. connectionsdesignstudios.com and www.connectionsdesignstudios.com serve the hub; the old app is stopped (not deleted)." |
| 6 | Browser, a private window | Open `https://connectionsdesignstudios.com/`, then `https://www.connectionsdesignstudios.com/`, then `/start` and `/report?site=example.com` on the apex | The hub Home page loads over HTTPS (view source: `<meta name="cds-surface" content="hub" />`); `www` redirects to the apex; Start and Report load |
| 7 | Browser, `https://connectionsdesignstudios.com/start` | Pick a path and add-ons, then go through to create the account | The signup works from the hub as it did on the dev host; the new site appears in `/staff/pipeline` (Leads) |
| 8 | `/staff/health` and the monitor app | Watch checks 1 and 1b for the apex | Both read ok: the apex is a platform host and serves the hub marker |
| 9 | Terminal, if a step fails during `apply` | Read the output | The tool rolls back on its own (any failure from `free-old` through `verify`): it first waits for any deployment still running, then prod back to its sslip address and redeployed, the old app's domains restored and redeployed, the apex polled until it answers from the old site (a hub page counts as a failure). It ends "Cutover failed at <step>; rolled back cleanly." (or names the rollback steps that failed) |
| 10 | Terminal, to roll back by hand later | Run `MSYS_NO_PATHCONV=1 npm run hub:cutover -- rollback` (preview first with `rollback --dry-run`) | The saved state and the five steps print (`rollback-prod-domains`, `rollback-redeploy-prod`, `rollback-old-domains`, `rollback-deploy-old`, `rollback-verify-old`); type the domain to go on. Every step runs even if one fails, and failures are named. With no saved state it refuses |
| 11 | Coolify, only if `stop-old` alone failed after a passing verify | Stop the old app `CDS Website deploy` by hand | The hub stays live. **Never delete** either app |
| 12 | Never touch | Leave alone: the `pocketbase-cds` container (the old site's live database), the `api.connectionsdesignstudios.com` and `pb.connectionsdesignstudios.com` records and routes, and DNS in general | The tool never edits DNS and refuses any domain list naming `api.` or `pb.`. Change the apex or `www` A record only if `check` says it left `82.180.132.176`, saving the old records first |
