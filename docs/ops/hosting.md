# Hosting: shared VPSes and container limits (D61)

The platform shares two VPSes with live client sites, so every platform container runs
with a hard resource limit (D61). Limits are set persistently, never with `docker update`.

## Limits chosen (P1)

| Container                                                   | Host                         | Memory                         | CPUs | Where it is set                                                   |
| ----------------------------------------------------------- | ---------------------------- | ------------------------------ | ---- | ----------------------------------------------------------------- |
| `cds-platform-dev` (Coolify app `aasywyddkdqysddgwjlgikmt`) | Coolify VPS `82.180.132.176` | 1g (swap 1g, so no extra swap) | 1    | Coolify API: `limits_memory`, `limits_memory_swap`, `limits_cpus` |
| `pocketbase-cdsp`                                           | Data VPS `31.220.21.126`     | 512m                           | 1    | `/root/pocketbase-cdsp/docker-compose.yml`: `mem_limit`, `cpus`   |

Verify with `docker inspect <container> --format '{{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'`:
`1073741824 1000000000` (web) and `536870912 1000000000` (PB).

## Host capacity observed (2026-09-26, read-only)

| Host                         | vCPU (`nproc`) | RAM total | RAM available | Swap |
| ---------------------------- | -------------- | --------- | ------------- | ---- |
| Coolify VPS `82.180.132.176` | 2              | 7941 MB   | 4619 MB       | none |
| Data VPS `31.220.21.126`     | 2              | 7940 MB   | 4596 MB       | none |

Each limit leaves more than half of the available memory and one full vCPU to the
neighbouring client sites. PocketBase used about 16 MiB at rest, so 512m is ample.

## Dev PocketBase runs with `--automigrate=false`

The repo (`packages/db/pb_migrations`) is the single migration source (D19). With
automigrate off, a collection edited in the PB admin UI does not generate a stray
migration file on the server that the repo does not know about. Pending migrations are
still applied on every `serve` start, so `npm run db:migrate:dev` (scp, then restart
`pocketbase-cdsp`) keeps working.

## Building the image

- The root `Dockerfile` is a node:22-alpine multi-stage build of `apps/web` with
  `NEXT_OUTPUT=standalone`; the server entry is `apps/web/server.js`.
- Runs as non-root `nextjs` (uid 1001); `HEALTHCHECK` hits `/api/health`.
- `/api/health` (and the monitor status) report the commit: Coolify's runtime `SOURCE_COMMIT`
  first, so every Coolify deploy reports itself with nothing to update. Outside Coolify, pass
  the SHA as `--build-arg APP_VERSION=<sha>` or set `APP_VERSION`; neither set reads `dev`.
- Set the runtime env var `PLATFORM_HOSTS` (comma-separated, exact hostnames that serve
  the hub, e.g. `cds.needtobeedgy.com` on dev). It is required in production: if it is
  missing or empty, the middleware throws on every routed request instead of falling
  back to the dev default. `/api/health` checks the same value and returns
  `503 {"status":"misconfigured"}`, so the `HEALTHCHECK`, Coolify and the monitor app
  all fail the bad deploy.
- When a workspace package is added (including each `packages/addons/<slug>`), add its
  `package.json` to the deps stage COPY list. `tests/structure.test.ts` fails until you do.
- On the shared hosts, build under `nice -n 10` and never run `docker builder prune` or
  `docker system prune`: other clients' caches live there.

## Payments (P10)

Set on the Coolify app (`cds-platform-dev`, `cds-platform-prod`). Values never go in the
repo; dev values live in the gitignored `.env.local`.

| Env var                                        | Meaning                                                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDS_PAYMENTS`                                 | `fake` (default): the fake adapter and the dev-only `/test-pay/*` pages; refuses every money call when `CDS_ENV=production` ("Payments open soon"). `stripe`: the Stripe adapter |
| `STRIPE_SECRET_KEY`                            | CDS's own Stripe secret key. `sk_test_` first. An `sk_live_` key is refused unless `CDS_ENV=production` **and** `STRIPE_ALLOW_LIVE=1`                                            |
| `STRIPE_ALLOW_LIVE`                            | `1` in production only, set with the live key; guards against a live key on dev                                                                                                  |
| `STRIPE_WEBHOOK_SECRET`                        | Signing secret of the CDS-account endpoint `POST /api/webhooks/stripe`                                                                                                           |
| `STRIPE_CONNECT_WEBHOOK_SECRET`                | Signing secret of the Connect endpoint `POST /api/webhooks/stripe-connect` ("Events on Connected accounts")                                                                      |
| `CDS_JOB_TOKEN`                                | Existing bearer for every `/api/jobs/*` route, billing included                                                                                                                  |
| `CDS_FILE_SCANNER`, `CLAMD_HOST`, `CLAMD_PORT` | Existing (P7). Forms Pro file uploads open only when the scanner is `clamd` and reachable                                                                                        |

- **Webhook endpoints:** create both in the Stripe dashboard on the **same API version as
  the SDK pin** (a mismatch changes payload shapes). Each verifies its signature and
  answers 200 to a duplicate without a second change.
- **Hourly billing task:** a Coolify scheduled task, hourly, on each app:
  `POST /api/jobs/billing` with `Authorization: Bearer $CDS_JOB_TOKEN` (the same `wget`
  pattern as the quotes, assembly and retention tasks). It reconciles events a webhook
  missed. The standalone image has no scripts, so production runs it only through this
  route; `npm run billing:reconcile` is the by-hand version.
- **Switching to Stripe:** set the keys, then run `npm run prices:set -- --sync-all` once
  so every priced catalog row gets its Stripe price.

## Move-out trigger (D61)

Move the platform to its own VPS when either of these holds:

- **Sustained CPU pressure** on a shared VPS: the platform container sits at its 1-CPU
  cap for long stretches, or neighbours slow down while it is busy.
- **SQLite write contention** in PocketBase: `database is locked` errors or write
  latency climbing as tenants grow.

At 10 to 50 tenants neither is expected soon; watch the monitor app's host signals.
