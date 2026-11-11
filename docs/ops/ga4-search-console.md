# GA4 and Search Console: staff runbook

For CDS staff. Covers DASH-10, DASH-11 and DASH-13 (D196): setting up Google Analytics 4 and
Google Search Console for a tenant site, granting access when the tenant already has a property,
and handing properties over when a site cancels.

How it fits together:

| Piece                     | What it does                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations.analytics` | Stores the ids: GA4 measurement id, GA4 property id, Search Console site, owner (`cds` or `tenant`). Server only                                                                                   |
| `npm run analytics:set`   | The only way to set them. Staff sign-in with emailed code; audited as `org.analytics_set`                                                                                                          |
| Tenant site               | With a measurement id, the cookie banner names "visitor statistics", and GA4 loads **only after** the visitor picks "Allow all". Never on preview hosts                                            |
| Site Report (owner hub)   | Reads GA4 (users, sessions, top pages) and Search Console (top 10 queries) through the CDS service account, cached once a day per site. Until connected it says "Connects when CDS finishes setup" |

## 0. One-time platform setup (go-live)

Done once for the whole platform, not per tenant.

1. Sign in to the **CDS Google account** (the one that owns CDS's Google Cloud project).
2. In Google Cloud console, create or open the project `cds-platform`.
3. **APIs & Services > Library**: enable **Google Analytics Data API** and **Google Search
   Console API**. Both are free.
4. **IAM & Admin > Service accounts > Create**: name `cds-reports`. No project roles needed.
5. On the new account: **Keys > Add key > JSON**. A JSON file downloads.
6. Put the whole JSON, on one line, into the production app env as
   `GOOGLE_SERVICE_ACCOUNT_JSON` (Coolify app `cds-platform-prod`, Environment Variables,
   mark it secret), and set `CDS_ANALYTICS=google`. Delete the downloaded file.
7. Redeploy. Without both variables the platform uses the stand-in and every Site Report says
   "Connects when CDS finishes setup".

Never paste the key into chat, a ticket or a commit. Note the service account email
(`cds-reports@<project>.iam.gserviceaccount.com`): you grant it access below.

Optional endpoint overrides (only if Google moves an endpoint; https only, anything else is
ignored): `GOOGLE_TOKEN_URL`, `GA4_DATA_API_BASE`, `GSC_API_BASE`.

## 1. New site, CDS-owned properties (default)

### 1a. Create the GA4 property

1. [analytics.google.com](https://analytics.google.com) as the CDS Google account.
2. **Admin > Create > Property**. Name: the site's business name. Time zone: the business time
   zone. Currency: USD.
3. Create a **Web** data stream for the site's live domain (e.g. `https://riverabakery.com`).
   Turn **off** Enhanced measurement > Form interactions (the platform counts form sends itself).
4. Copy the **Measurement ID** (`G-XXXXXXX`) from the stream.
5. **Admin > Property details**: copy the **Property ID** (digits only).
6. **Admin > Property access management > +**: add the service account email as **Viewer**.
7. **Admin > Data collection and modification > Data retention**: set event data retention to
   **2 months** (the shortest). GA4 does not log IP addresses, so there is no IP setting; this
   is the privacy setting that matters.

### 1b. Verify the site in Search Console

1. [search.google.com/search-console](https://search.google.com/search-console) as the CDS
   Google account. **Add property**.
2. Prefer a **Domain** property (`riverabakery.com`). Google shows a TXT record.
   - If the domain's DNS is in CDS's Hostinger account: add the TXT record with the Hostinger
     DNS API (`https://developers.hostinger.com/api/dns/v1/zones/<domain>`, token in
     `~/.hostinger_token`), then click **Verify**.
   - If the tenant manages DNS: send them the TXT record, or fall back to a **URL prefix**
     property (`https://riverabakery.com/`) verified with the **HTML tag** method.
3. **Settings > Users and permissions > Add user**: the service account email, permission
   **Restricted** (read only).

### 1c. Record the ids

```
npm run analytics:set -- --org <org-id> --ga4-measurement G-XXXXXXX --ga4-property 123456789 --gsc-site sc-domain:riverabakery.com --owner cds
```

- The CLI asks for your staff email, password and the emailed code, prints old -> new and ends
  with `Saved. <Business>'s Site Report shows Google data from tomorrow.`
- `--dry-run` signs in and prints old -> new without writing.
- For a URL-prefix property use `--gsc-site https://riverabakery.com/`.
- The cookie banner and GA4 loader pick the id up within 60 s (5 min for the banner text).

Check: open the live site in a private window. The banner names visitor statistics. Before
choosing, DevTools Network shows no `googletagmanager.com` request. After **Allow all**, one
`gtag/js?id=G-…` request. After **Necessary only**, none.

## 2. Tenant already has a GA4 property (tenant-owned)

Do not create a second property. Ask the tenant to grant CDS access instead:

1. Tenant: GA4 **Admin > Property access management > +**, add the service account email as
   **Viewer** (and the CDS Google account as **Editor** if CDS will manage it).
2. Tenant: Search Console **Settings > Users and permissions > Add user**, the service account
   email, **Restricted**.
3. Tenant sends the Measurement ID, Property ID and Search Console property name.
4. Record with `--owner tenant`:

```
npm run analytics:set -- --org <org-id> --ga4-measurement G-XXXXXXX --ga4-property 123456789 --gsc-site https://riverabakery.com/ --owner tenant
```

If the tenant's site is still tagged with GA4 elsewhere (an old site builder), they remove that
tag: two tags double-count.

## 3. Changing or removing ids

- Change one field: name only that flag. Fields not named are kept.
- Remove one field: give it the value `none` (e.g. `--ga4-measurement none`).
- Remove all: `--clear`.

GA4 stops loading on the site within 60 s of removing the measurement id.

## 4. Transfer on cancellation (P14 offboarding links here)

When a site closes, CDS-owned properties go to the tenant (their data, D196):

1. Ask the tenant for a Google account email to receive the properties.
2. GA4: **Admin > Property access management**: add the tenant's email as **Administrator**.
   If the tenant wants the property in their own GA account: **Admin > Property settings >
   Move property** to an account they administer (they must add the CDS account to that account
   first, then remove it after the move).
3. Search Console: **Settings > Users and permissions**: add the tenant's email as **Owner**
   (Domain properties need them to add their own TXT record first).
4. Remove the service account and the CDS Google account from both.
5. Clear the ids: `npm run analytics:set -- --org <org-id> --clear`.

Tenant-owned properties (`owner: tenant`): just remove the service account (and CDS's
account) from both and run `--clear`.

## 5. Notes

- **GA4 undercounts.** It only counts visitors who chose "Allow all", and blockers stop it. The
  Site Report's own visit counts (first-party, cookieless, every visitor) will always be higher.
  Tell owners the GA4 numbers are a consenting sample, not a total.
- Site Report Google numbers refresh once a day per site. A new connection shows data from the
  next day.
- A failing Google call reads as "Connects when CDS finishes setup" for that view and retries
  on the next one; the error name is logged as `[analytics] ga4 read failed (<name>)` without
  ids or keys.
- Universal Analytics ids (`UA-…`) are refused: UA is shut down.
- A visitor who switches the cookie banner back to "Necessary only" stops GA for that page and
  has the `_ga` / `_ga_<id>` cookies expired on the site's host and parent domains. A visitor
  whose stored choice is "Necessary only" gets the same sweep on every page.
