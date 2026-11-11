# Wildcard preview hosts: runbook

For CDS staff. Covers DOM-01 (D57, D170, D289): one wildcard DNS record and one wildcard
certificate for every preview host `<slug>.sites.connectionsdesignstudios.com`.

> **HUMAN-CHECK: never done unattended.** Every step below touches live DNS or the shared
> Coolify proxy. A person runs it, start to finish, in one sitting.

How it fits together:

| Piece                                | What it does                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Signup (`packages/db/src/signup.ts`) | Writes the org's preview host row (`kind preview`, primary) in the signup batch, so every org has its address from second one |
| `backfillPreviewHosts()`             | Run by `npm run domains:run` every 5 minutes: gives any older host-less org its preview host. Idempotent                      |
| `CDS_PREVIEW_HOST_SUFFIX`            | The suffix. Production: `sites.connectionsdesignstudios.com`; dev: `sites.localhost`                                          |
| `*.sites` A record                   | Sends every preview name to the Coolify VPS (`82.180.132.176`), DNS-only                                                      |
| Traefik resolver `letsencrypt-dns`   | Gets one wildcard certificate over DNS-01 (Cloudflare API), instead of one HTTP-01 certificate per preview host               |

## Interim (until this runbook is done)

Preview hosts are on the edge route list (`GET /api/edge/routes`, see `docs/ops/edge-wiring.md`)
and each one gets its own HTTP-01 certificate from the existing `letsencrypt` resolver. That works
without a wildcard, but every preview host needs its own DNS record first, and Let's Encrypt
allows **50 certificates per registered domain per week**: at 10-50 tenants that is fine; a burst
of signups (or many renames) can hit it. If it does, new previews show a certificate error until
the week rolls over. This runbook removes the limit.

## 1. Preconditions

- The production app is running on the Coolify VPS and `/api/edge/routes` answers (edge wiring done).
- A Cloudflare account exists for CDS (free plan is enough). **Never** sign up or accept terms
  unattended; this is a person's step (`.planning/GO-LIVE.md`).
- A Cloudflare API token scoped to **Zone · DNS · Edit** for `connectionsdesignstudios.com` only.
  Keep it in a file, never in chat or in this repo.
- SSH to the Coolify VPS: `ssh -i ~/.ssh/pocketbase-cds root@82.180.132.176`.

## 2. Steps

### (a) Move `connectionsdesignstudios.com` to Cloudflare, under the P14 gate

The zone is live: it serves the old marketing site (apex, `www`), `api.` for the old
**`pocketbase-cds`** database (the old site's live DB: never touch the container, only keep its
record exactly as it is), `pb.` for production PocketBase, and mail. Every record must be copied
exactly before the nameservers change.

1. Run the read-only gate first:
   `npm run domains:check -- --domain connectionsdesignstudios.com`.
   Expected: every gate rule passes (DNSSEC off, no wildcard surprise, registrar not
   Cloudflare-locked). Any `BLOCK` line: stop and fix that first.
2. Export the current zone from Hostinger (DNS API, zone `connectionsdesignstudios.com`) and keep
   the file. Compare it with the `domains:check` snapshot: same records, same values.
3. In Cloudflare: add the site `connectionsdesignstudios.com`, free plan. Import the records.
   Check by hand that `@`, `www`, `api`, `pb`, `MX`, SPF, DKIM and DMARC are present with the
   **same values**. Set every record to **DNS only** (grey cloud), so traffic still goes straight
   to the VPSes.
4. At Hostinger (the registrar), change the nameservers to the two Cloudflare gives.
5. Wait until both `1.1.1.1` and `8.8.8.8` answer with Cloudflare's NS:
   `nslookup -type=NS connectionsdesignstudios.com 1.1.1.1` and the same with `8.8.8.8`.
6. Check the old site, `https://api.connectionsdesignstudios.com/api/health`,
   `https://pb.connectionsdesignstudios.com/api/health` and mail delivery still work.

### (b) Add the wildcard record

In Cloudflare DNS for `connectionsdesignstudios.com`:

| Type | Name      | Value            | Proxy    | TTL  |
| ---- | --------- | ---------------- | -------- | ---- |
| A    | `*.sites` | `82.180.132.176` | DNS only | Auto |
| A    | `sites`   | `82.180.132.176` | DNS only | Auto |

Check: `nslookup anything-at-all.sites.connectionsdesignstudios.com 1.1.1.1` answers `82.180.132.176`.

### (c) Add the DNS-01 resolver to Traefik (shared proxy: back up first)

The Coolify proxy is shared with other client sites. A broken config takes all of them down.

1. Back up the proxy config on the Coolify VPS:
   `cp /data/coolify/proxy/docker-compose.yml /data/coolify/proxy/docker-compose.yml.bak-$(date +%Y%m%d%H%M)`
   (and the `dynamic/` folder if you change files there).
2. In Coolify (Servers › proxy › Configuration), add to the Traefik `command:` list, keeping the
   existing `letsencrypt` (HTTP-01) resolver as it is:

   ```
   - '--certificatesresolvers.letsencrypt-dns.acme.dnschallenge=true'
   - '--certificatesresolvers.letsencrypt-dns.acme.dnschallenge.provider=cloudflare'
   - '--certificatesresolvers.letsencrypt-dns.acme.dnschallenge.resolvers=1.1.1.1:53,8.8.8.8:53'
   - '--certificatesresolvers.letsencrypt-dns.acme.storage=/traefik/acme-dns.json'
   ```

3. Add the token to the proxy's environment as `CF_DNS_API_TOKEN`, read from your token file
   (never pasted into chat, never committed).
4. Add one router for the wildcard (a dynamic config file in the proxy's `dynamic/` folder, e.g.
   `cds-preview-wildcard.yml`):

   ```yaml
   http:
     routers:
       cds-preview-wildcard:
         rule: "HostRegexp(`^[a-z0-9-]+\\.sites\\.connectionsdesignstudios\\.com$`)"
         entryPoints: ["https"]
         service: "https-0-3l6gwamoblvy8znte9nsxbuv@docker"
         tls:
           certResolver: letsencrypt-dns
           domains:
             - main: "sites.connectionsdesignstudios.com"
               sans: ["*.sites.connectionsdesignstudios.com"]
   ```

   The service name is the production app's (`CDS_EDGE_SERVICE`).

5. Restart the proxy from Coolify, then watch its log for the certificate:
   `docker logs coolify-proxy --since 5m 2>&1 | grep -i -E "acme|letsencrypt-dns"`.
   No `error` lines; a certificate for `*.sites.connectionsdesignstudios.com` is obtained.

### (d) Verify

1. Sign up a test business (or take any org created after P14). Its preview host is in
   `org_hosts` from the moment it exists.
2. `curl -sI https://<slug>.sites.connectionsdesignstudios.com/` answers `200` with the thin
   "in development" strip and `X-Robots-Tag: noindex` (D170).
3. `echo | openssl s_client -connect <slug>.sites.connectionsdesignstudios.com:443 -servername <slug>.sites.connectionsdesignstudios.com 2>/dev/null | openssl x509 -noout -subject -ext subjectAltName`
   shows `*.sites.connectionsdesignstudios.com`.
4. Set `CDS_PREVIEW_HOST_SUFFIX=sites.connectionsdesignstudios.com` on the production app if it
   is not set yet.

## 3. Rollback

- Proxy: restore the backup (`cp …bak-<stamp> /data/coolify/proxy/docker-compose.yml`), delete
  `cds-preview-wildcard.yml`, restart the proxy. Preview hosts fall back to per-host HTTP-01
  certificates from the route list (the interim above).
- DNS: delete the `*.sites` and `sites` records. To leave Cloudflare entirely, set the
  nameservers at Hostinger back to the originals (kept in the `domains:check` snapshot and the
  Hostinger export from step (a)2).

## Log

| Date | Who | Result |
| ---- | --- | ------ |
