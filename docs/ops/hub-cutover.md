# Hub cutover: connectionsdesignstudios.com moves to the platform

For CDS staff (the owner runs it once). Covers HUB-04 (D34, D62): Coolify stops serving the old
marketing site on `connectionsdesignstudios.com` and `www.connectionsdesignstudios.com`, and the
platform app `cds-platform-prod` serves the CDS hub site there instead. The old app is **stopped,
never deleted**: it stays on `archive/marketing-site-v1` as the fallback.

> **HUMAN-CHECK.** The unattended build never ran `apply` or `rollback` (P15-P21, A4-Q1). It ran
> `plan`, `apply --dry-run` and one read-only `check` (rows in the 15-25 SUMMARY). The owner runs
> the cutover after the final milestone push and a green production deploy.

One command does it, with guard rails:

| Command                           | What it does                                                                             | Changes anything?     |
| --------------------------------- | ---------------------------------------------------------------------------------------- | --------------------- |
| `npm run hub:cutover -- plan`     | Prints the eight apply steps                                                             | No                    |
| `npm run hub:cutover -- check`    | Read-only preflight: one PASS / FAIL / WARN row per item, key names only (never values)  | No (one Run log line) |
| `npm run hub:cutover -- apply`    | Runs `check`, shows the plan, asks you to type `connectionsdesignstudios.com`, cuts over | Yes                   |
| `npm run hub:cutover -- rollback` | Puts both apps back from the saved state (asks you to type the domain)                   | Yes                   |
| any of them with `--dry-run`      | Prints the steps only; makes no call at all                                              | No                    |

Flags: `--expect-sha <sha>` (the commit prod must report on `/api/health`; default `origin/main`,
else `HEAD` with a WARN), `--mailboxes-ready` (you confirmed hello@ and abuse@ receive mail),
`--yes` (skips the typed domain, **only** in a non-interactive run; refused on a terminal),
`--state <path>` (default `.planning/tmp/cutover-state.json`), `--log-file <path>`,
`--coolify-url <url>` (default `http://127.0.0.1:8000/api/v1`, the SSH tunnel), `--insecure-http`.

**Open the SSH tunnel to Coolify first** (in its own terminal; leave it running):

```sh
ssh -i ~/.ssh/pocketbase-cds -N -L 8000:127.0.0.1:8000 root@82.180.132.176
```

The tool calls Coolify at `http://127.0.0.1:8000/api/v1` through the tunnel (WR-B05). Coolify's API
has no HTTPS route, and its token can read every app's secrets and deploy, stop and re-domain apps,
so it never goes over plain HTTP to the public IP: a plain `http://` `--coolify-url` to any
non-loopback host is refused unless `--insecure-http` is also given (avoid it). An `https://` URL
is accepted once Coolify has one (HUMAN-CHECKS P15). Without the tunnel the Coolify rows read
`check could not run (CoolifyError)`.

From Git Bash, prefix commands with `MSYS_NO_PATHCONV=1` (CLAUDE.md). The Coolify token is read from
`~/.coolify_api_token`, else `.env.local` `COOLIFY_API_TOKEN` (quotes stripped). The token needs
Coolify's `read:sensitive` permission: without it the env list comes back without values and the
`prod-env` row FAILs with `check could not run (CoolifyValuesHidden)` (seen in the 15-25 rehearsal).
It is never printed; Coolify errors show only the HTTP status and the call name.

## 1. Prerequisites (what `check` looks for)

Every row below must be true before `apply`. `check` reports the ones it can see; the rest are
yours to confirm (they show as WARN rows or are listed in GO-LIVE).

| #   | Prerequisite                                                                                                                                                                                                                                                                                                                                                                                                                                        | `check` row                                        | Where                                                                 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------- |
| 1   | `cds-platform-prod` (`3l6gwamoblvy8znte9nsxbuv`) builds from the repo `mpierc31970/cds-website` branch `main` with the repo `/Dockerfile`, exposes port `3000`, health path `/api/health` (not the placeholder nginx page). See section 4                                                                                                                                                                                                           | `prod-source`                                      | Coolify, HUMAN-CHECKS P1, GO-LIVE Launch                              |
| 2   | Prod env keys: `PLATFORM_HOSTS` = `connectionsdesignstudios.com,www.connectionsdesignstudios.com,3l6gwamoblvy8znte9nsxbuv.82.180.132.176.sslip.io`; `CDS_PLATFORM_URL` = `https://connectionsdesignstudios.com`; `CDS_ENV` = `production`; `APP_VERSION` (git SHA build arg); `PB_URL`; `PB_APP_KEY`; `CDS_JOB_TOKEN`; `NEXT_PUBLIC_TURNSTILE_SITE_KEY` **marked build-time**; `TURNSTILE_SECRET_KEY` (absent = WARN: production forms fail closed) | `prod-env`                                         | Coolify app env (values never printed)                                |
| 3   | Prod deployed from `main` and healthy: `/api/health` on the sslip address answers `{status:"ok"}` with the expected commit                                                                                                                                                                                                                                                                                                                          | `prod-health`                                      | Coolify deploy                                                        |
| 4   | The hub is served on the sslip address: `/` carries `<meta name="cds-surface" content="hub">` (P15-P12)                                                                                                                                                                                                                                                                                                                                             | `hub-marker`                                       | needs row 2's sslip host in `PLATFORM_HOSTS`                          |
| 5   | Production PocketBase has every migration through P15: core **and** add-on migrations, pushed from the assembled dir (`npm run db:migrations:assemble -- <dir>`, CLAUDE.md "Production PocketBase"). `check` reads `_migrations` over `ssh pocketbase-cds` with `mode=ro` from `/root/pocketbase-cdsp-prod/pb_data/data.db` only                                                                                                                    | `prod-migrations`                                  | HUMAN-CHECKS (P5-P15 pending migrations)                              |
| 6   | The old app (`vok4o448cw0ggws08cg40048`) still holds the apex                                                                                                                                                                                                                                                                                                                                                                                       | `old-app`                                          | Coolify                                                               |
| 7   | Apex and `www` A records point at the Coolify VPS `82.180.132.176` on 1.1.1.1 and 8.8.8.8 (already true at research time: no DNS change expected)                                                                                                                                                                                                                                                                                                   | `dns`                                              | Hostinger zone `connectionsdesignstudios.com`                         |
| 8   | Wildcard preview DNS `*.sites.connectionsdesignstudios.com` + its certificate                                                                                                                                                                                                                                                                                                                                                                       | (not checked)                                      | GO-LIVE P8, `docs/ops/preview-wildcard.md`                            |
| 9   | Turnstile production keys (site key build-time, secret runtime)                                                                                                                                                                                                                                                                                                                                                                                     | `prod-env` (WARN)                                  | GO-LIVE Turnstile                                                     |
| 10  | Email: SES configured, or the logged stand-in kept on purpose (decide and record)                                                                                                                                                                                                                                                                                                                                                                   | (not checked)                                      | GO-LIVE SES                                                           |
| 11  | `hello@` and `abuse@` receive mail                                                                                                                                                                                                                                                                                                                                                                                                                  | `ready-mailboxes` (WARN until `--mailboxes-ready`) | GO-LIVE                                                               |
| 12  | Comparison claims verified (`npm run hub:claims`)                                                                                                                                                                                                                                                                                                                                                                                                   | `ready-claims` (WARN)                              | HUMAN-CHECKS P15                                                      |
| 13  | Proof entries (work sites, testimonials) confirmed                                                                                                                                                                                                                                                                                                                                                                                                  | `ready-proof` (WARN)                               | HUMAN-CHECKS P15                                                      |
| 14  | Old-site parity inventory complete (every topic covered or retired)                                                                                                                                                                                                                                                                                                                                                                                 | `ready-parity` (WARN)                              | `.planning/phases/15-cds-hub-site-and-cutover/15-PARITY-INVENTORY.md` |

FAIL rows block `apply`. WARN rows do not, but read each one before going on.

## 2. Run the cutover

1. Push `main` and wait for a green production deploy of `cds-platform-prod`.
2. Run the read-only check:

   ```sh
   MSYS_NO_PATHCONV=1 npm run hub:cutover -- check
   ```

   Expected: a table of rows (`status  check  detail  fix`), then
   `N PASS · N WARN · 0 FAIL` and `Read-only: nothing was written.` Fix every FAIL using its `fix`
   column, then run `check` again.

3. Run the cutover from a terminal (so it can ask you to type the domain):

   ```sh
   MSYS_NO_PATHCONV=1 npm run hub:cutover -- apply --mailboxes-ready
   ```

   It prints the check table and the plan, then
   `Type the domain to continue (connectionsdesignstudios.com):`. Type it exactly.

What each step does (`npm run hub:cutover -- plan` prints the same list):

| Step             | What happens                                                                                                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 `preflight`    | Every check again, read-only; any FAIL stops here with nothing changed                                                                                                                                                                                                       |
| 2 `save-state`   | Both apps' current domains go to `.planning/tmp/cutover-state.json` (rollback reads it)                                                                                                                                                                                      |
| 3 `free-old`     | The old app's domains become `http://vok4o448cw0ggws08cg40048.82.180.132.176.sslip.io`                                                                                                                                                                                       |
| 4 `redeploy-old` | The old app redeploys (`force=false`) and the tool waits until Coolify reports the deployment finished, so the proxy drops its apex and `www` routes (a domain change reaches the proxy only on deploy); the names answer nothing until step 6 finishes (D62 allows the gap) |
| 5 `assign-prod`  | Prod's domains become `https://connectionsdesignstudios.com,https://www.connectionsdesignstudios.com` (Coolify's conflict override is never used: a clash stops the step)                                                                                                    |
| 6 `deploy-prod`  | Prod redeploys (`force=false`) and the tool waits until Coolify reports the deployment finished (up to 15 minutes; a failed or still-running deployment rolls back), so the proxy routes the names and Let's Encrypt issues certificates                                     |
| 7 `verify`       | Polls HTTPS every 10 s for up to 5 minutes: hub marker on the apex `/` and on `www /` (301 to the apex, followed), `/start`, `/report?site=example.com`, `/api/health` ok (and the expected commit)                                                                          |
| 8 `stop-old`     | Stops the old app (never deletes it)                                                                                                                                                                                                                                         |

How long: the deploy takes a few minutes (a cached image skips the build); the tool polls
`GET /deployments/{id}` every 10 s for up to 15 minutes before verify starts. Certificates usually
issue within a minute or two of the deploy finishing. If verify gives up after 5 minutes, the tool
rolls back on its own.

Expected end: `Cutover done. connectionsdesignstudios.com and www.connectionsdesignstudios.com serve
the hub; the old app is stopped (not deleted).` Each step adds a dated line to **Run log** below.

Afterwards: watch monitor checks 1 and 1b on the apex (MONITOR brief), and open
`https://connectionsdesignstudios.com/` in a private window.

## 3. Roll back

**Automatic.** Any failure from step 3 (`free-old`) through step 7 (`verify`) rolls back on its own.
If a deployment apply started is still running, the tool first waits for it to end
(`rollback-wait-deploys`), so it cannot finish later and hand the apex back to prod. Then prod goes back to its sslip address **and is redeployed** (a domain change reaches the proxy only
on deploy: without it prod's running container keeps answering the apex), the old app gets its
saved domains back, the old app is redeployed from `archive/marketing-site-v1`, and the tool polls
`https://connectionsdesignstudios.com/` until it answers 200 **from the old site** (a page with the
hub marker counts as a failure). The output ends `Cutover failed at <step>; rolled back cleanly.`
(or names the rollback steps that failed).

**By hand** (for example the hub misbehaves an hour later):

```sh
MSYS_NO_PATHCONV=1 npm run hub:cutover -- rollback
```

It prints the saved state and the five rollback steps, asks you to type the domain, then runs
`rollback-prod-domains`, `rollback-redeploy-prod`, `rollback-old-domains`, `rollback-deploy-old`,
`rollback-verify-old`.
Every step runs even if one fails; failures are named. A stopped old app starts again with its
redeploy. Preview with `rollback --dry-run`.

If `stop-old` alone failed after a passing verify, the hub is live: stop the old app by hand in
Coolify (never delete it).

## 4. Converting the placeholder prod app

At research time `cds-platform-prod` was still the inline-Dockerfile placeholder
(`git_repository=coollabsio/coolify`, port 80, env without `PLATFORM_HOSTS`, `APP_VERSION`,
`CDS_PLATFORM_URL`). `check` fails `prod-source` until this is done. Two ways (RESEARCH Open Q2):

1. **PATCH the existing app** to the git source: in Coolify (or `PATCH /api/v1/applications/3l6gwamoblvy8znte9nsxbuv`)
   set the repository `mpierc31970/cds-website`, branch `main`, build pack Dockerfile at `/Dockerfile`,
   ports exposes `3000`, health check path `/api/health`. Keeps the uuid: nothing else changes.
   Two traps the dev app hit on its first real deploy (2026-10-18):
   - **Proxy port.** The app's saved custom labels keep `loadbalancer.server.port=80` from the
     placeholder; changing ports exposes does not rewrite them, so the new container is healthy
     but the proxy answers 502. Patch both `http-0-`/`https-0-…loadbalancer.server.port` labels to
     `3000` (`custom_labels` is base64) in the same change.
   - **Health check host.** Use `127.0.0.1`, not `localhost`: in the Alpine image `localhost` is
     `::1` and Next.js listens on IPv4 only, so every check is refused and Coolify rolls back.
     Prod already has `127.0.0.1` and a 20 s start period; turn the health check on when switching.
2. **Create a new app** with `POST /api/v1/applications/private-deploy-key` using the same deploy
   key as the old app (it reads the same repo), in project `CDS Platform`, environment `live`.
   A new uuid then changes: `HUB_CUTOVER_DEFAULTS.prodAppUuid` and `prodSslipUrl` in
   `packages/db/src/ops/hub-cutover.ts`, `CDS_EDGE_SERVICE` (`https-0-<new-uuid>@docker`) and
   `docs/ops/edge-wiring.md`, and the CLAUDE.md infrastructure table. Copy the env keys over
   (row 2 above) and stop (never delete) the placeholder.

Then set the env keys (row 2), deploy, and run `check` again.

## 5. Never touch

- **`pocketbase-cds`**: the old marketing site's live database container
  (`api.connectionsdesignstudios.com`). `check` only uses `pocketbase-cds` as the **ssh host alias**
  for the data VPS and reads `/root/pocketbase-cdsp-prod/pb_data/data.db` read-only; the planner
  refuses any config naming the old container.
- **`api.connectionsdesignstudios.com`** and **`pb.connectionsdesignstudios.com`** DNS records and
  routes: the planner refuses any domain list that names them.
- **DNS in general**, unless `check` says the apex or `www` left `82.180.132.176`. Then change the A
  record in the Hostinger zone (save the prior records first), wait for both resolvers, and run
  `check` again. The tool itself never edits DNS.
- **Deleting either Coolify app** (D62). The tool has no delete call.

## Run log

Each `apply` / `rollback` step adds `- YYYY-MM-DD HH:MM UTC · <command> · <step> · <ok|failed>`;
each `check` adds one summary line.

- 2026-10-18 01:48 UTC · check · 3 PASS, 3 WARN, 5 FAIL · failed
