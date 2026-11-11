# Edge wiring: certificates and routes for tenant domains

For CDS staff. Covers DOM-06 (D13, P14-P7): how the shared Coolify proxy learns which tenant
hostnames to route and certify. **The control plane decides; the edge asks.** The app holds the
list; the proxy only reads it.

> **HUMAN-CHECK.** Nothing in this runbook was done during the unattended build. The Coolify
> proxy is **shared with other client sites**: a broken proxy config takes all of them down.
> A person does this at go-live, with a backup first, and records the result in
> `.planning/HUMAN-CHECKS.md`.

How it fits together:

| Piece                                | What it does                                                                                                                                                                                                                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/edge/routes` (app)         | Traefik HTTP-provider JSON: one https router + one http router per allowed host. Bearer `CDS_EDGE_TOKEN`; 404 otherwise; 500 (never empty) on error                                                                                             |
| `GET /api/edge/ask?domain=<h>` (app) | Caddy `on_demand_tls` ask: `200 ok` when the host is allowed (from a snapshot of allowed hosts, read at most every 30 s; never limited), `404` otherwise, `429` over 120 not-allowed asks/min per registrable domain, `503` on a database error |
| `edgeAllowed` / `edgeRoutes` (db)    | A host is allowed when its `org_hosts` row is a preview row, or a custom/redirect row with `verified_at`, on an `active` organization                                                                                                           |
| Domain move step 7 (edge)            | A custom host gets `verified_at` only after 1.1.1.1 **and** 8.8.8.8 return `CDS_EDGE_IPV4` for apex and `www`                                                                                                                                   |
| Monitor rows 41-50                   | `.planning/design/MONITOR-APP-BRIEF.md` §3 (HTTPS probe, cert expiry, delegation)                                                                                                                                                               |

Current proxy (checked read-only 2026-10-16): container `coolify-proxy`, image `traefik:v3.6`,
compose at `/data/coolify/proxy/docker-compose.yml` on the Coolify VPS (`82.180.132.176`),
ACME store `acme.json`, one resolver `letsencrypt` with the HTTP-01 challenge.

## 1. App environment (both options)

Set on the Coolify app (`cds-platform-prod`, and `cds-platform-dev` to rehearse). No values here:
generate the token on the server and paste it straight into Coolify.

| Variable                   | Value                                                                                                                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CDS_EDGE_TOKEN`           | A long random string (`openssl rand -hex 32`). Same value goes into the proxy header                                                                                                                                         |
| `CDS_EDGE_SERVICE`         | The app's Traefik service: `https-0-<app-uuid>@docker` (prod `https-0-3l6gwamoblvy8znte9nsxbuv@docker`; dev `https-0-aasywyddkdqysddgwjlgikmt@docker`). The http router uses the same name with `https-` replaced by `http-` |
| `CDS_EDGE_HTTP_MIDDLEWARE` | Optional. Default `redirect-to-https@docker`                                                                                                                                                                                 |
| `CDS_EDGE_IPV4`            | The Coolify VPS public IPv4 (`82.180.132.176`). Step 7 waits for public DNS to return it                                                                                                                                     |

Redeploy the app, then check the list from the Coolify VPS:

```sh
curl -s -H "Authorization: Bearer $CDS_EDGE_TOKEN" https://<platform domain>/api/edge/routes | head -c 600
```

Expected: JSON starting `{"http":{"routers":{"cds-h-…`. A `404` means the token is wrong or
unset; a `500 {"error":"routes unavailable"}` means the database read failed or
`CDS_EDGE_SERVICE` is unset.

## 2. Option A (recommended): Traefik HTTP provider

### 2.1 Back up first

On the Coolify VPS:

```sh
cp /data/coolify/proxy/docker-compose.yml /data/coolify/proxy/docker-compose.yml.bak-$(date +%Y%m%d-%H%M)
cp /data/coolify/proxy/acme.json /root/acme.json.bak-$(date +%Y%m%d-%H%M)
```

Keep the backup until the change has run a full day without trouble.

### 2.2 Add the provider

Edit the proxy configuration in Coolify (**Servers › localhost › Proxy › Configuration**), which
writes the same compose file. Add these to the `command:` list of the `traefik` service, next to
the existing `--providers.docker…` lines:

```yaml
- "--providers.http.endpoint=http://<app container>:3000/api/edge/routes"
- "--providers.http.pollInterval=10s"
- "--providers.http.pollTimeout=5s"
- "--providers.http.headers.Authorization=Bearer <CDS_EDGE_TOKEN>"
```

- `<app container>`: the app container's name on the `coolify` network (Coolify shows it on the
  app's page; `docker ps --filter name=<app-uuid>` on the VPS). Using the internal name keeps the
  token off the public internet. If the internal name is not stable across deploys, use the
  platform's public `https://` URL instead.
- `providers.http.headers` sends the bearer on every poll. Keep it out of screenshots and
  tickets; it is a secret.
- Save and **Restart Proxy** in Coolify.

### 2.3 Verify

1. `docker logs --since 2m coolify-proxy 2>&1 | grep -i "http provider\|providers.http"`: no
   errors. A `404` from the provider means the header or token is wrong.
2. The Traefik dashboard (if enabled) or `docker exec coolify-proxy wget -qO- http://localhost:8080/api/http/routers`
   lists `cds-h-…@http` routers.
3. Every other client site on the proxy still loads (spot-check three).
4. **Test host:** take a verified custom host (or a preview host) from the list, then
   `curl -sI https://<host>/` answers `200`/`301` with a valid certificate
   (`curl -vI` shows `issuer: … Let's Encrypt`). The first request after a new host can take
   a few seconds while the certificate is issued.

### 2.4 Rollback

Remove the four `--providers.http…` lines (or restore the backup compose file) and restart the
proxy. Tenant custom domains stop routing; the platform domain and other client sites keep the
routes they had from Docker labels.

## 3. Option B: Caddy ask (alternative)

Only if the edge is ever Caddy instead of Traefik. Caddy issues on demand and asks the app first:

```caddy
{
	on_demand_tls {
		ask http://app:3000/api/edge/ask
	}
}

https:// {
	tls {
		on_demand
	}
	reverse_proxy app:3000
}
```

- Caddy sends `?domain=<name>`; any non-2xx is a deny, so a database error (503) or the per-IP
  limit (429) never issues a certificate.
- Use `ask` only. Do **not** set `interval` / `burst` (Caddy marks them not recommended since 2.8).
- The ask endpoint needs no token: it only answers yes/no for one exact name.

## 4. Preview wildcard (DNS-01)

Until the platform zone is on Cloudflare, preview hosts (`<slug>.sites.connectionsdesignstudios.com`)
are on the route list and get one HTTP-01 certificate each. The wildcard certificate with a
DNS-01 resolver is a separate change: see `docs/ops/preview-wildcard.md`.

## 5. Let's Encrypt limits (why step 7 waits)

| Limit                                        | Value           | What it means here                                                                 |
| -------------------------------------------- | --------------- | ---------------------------------------------------------------------------------- |
| Failed validations per hostname, per account | 5 per hour      | A route added before DNS points here burns these; the host is then blocked an hour |
| Certificates per registered domain           | 50 per 7 days   | All `*.sites` preview certificates share `connectionsdesignstudios.com`            |
| New orders per account                       | 300 per 3 hours | Not a concern at 10-50 tenants                                                     |

So a custom host only joins the list (gets `verified_at`) at move step 7, after both public
resolvers return `CDS_EDGE_IPV4`. Step 8 probes HTTPS with backoff (1, 2, 4, 8, 15, 30 min, then
failed), not every tick. Traefik may not retry a failed certificate until its config changes:
staff **Retry** bumps the router name (`cds-h-<sha8>-r<n>`) to force a fresh attempt.

## 6. Checklist (copy into HUMAN-CHECKS when done)

- [ ] App env set: `CDS_EDGE_TOKEN`, `CDS_EDGE_SERVICE`, `CDS_EDGE_IPV4`; `/api/edge/routes` answers JSON with the bearer, 404 without
- [ ] Proxy compose backed up
- [ ] `providers.http` added, proxy restarted, no provider errors, other client sites still load
- [ ] On-demand certificate issued for one verified custom host
