---
feature: The CDS hub site
phase: 15
route: /staff/catalog (hub site: connectionsdesignstudios.com; terminal: npm run prices:set)
---

# How to: The CDS hub site

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The hub site is CDS's own public website on the platform domain (HUB-01, D104). Every page is built in code, not in the page builder: a copy change is a code change and a deploy, and that is intended (D104). What staff change without a deploy is the **price catalog**; what staff confirm before launch are the **proof entries** and the **competitor claims** ([Competitor claims](staff-hub-claims.md)).

| Page | Route | Where its content comes from |
|---|---|---|
| Home | `/` | `packages/core/src/marketing/copy.ts`; prices from the catalog; the live demo link; proof from `work.ts` |
| Pricing | `/pricing` | The catalog (per path); the comparison table and cost calculator from `claims.ts` |
| Standard, Studio | `/standard`, `/studio` | `copy.ts` + the catalog; the comparison from `claims.ts` |
| Add-ons | `/add-ons`, `/add-ons/<slug>` | The add-on listings and prices in the Catalog (public add-ons only) |
| Work | `/work` | `WORK_SITES` and `TESTIMONIALS` in `work.ts` |
| About | `/about` | `copy.ts` + `ABOUT_FACTS` in `work.ts` |
| Independent pros, Hosting rules, Privacy | `/independent-pros`, `/hosting-rules`, `/privacy` | `copy.ts`; the privacy notice from `privacy.ts` (marked DRAFT until the user publishes it) |
| Contact, Report, Unsubscribe | `/contact`, `/report`, `/unsubscribe` | Forms ([Contact inquiries](staff-contact-inquiries.md)) |

Outside production (`CDS_ENV` is not `production`) every hub page is `noindex` and shows unconfirmed entries with a **Draft** badge; in production only confirmed entries and verified claims render (P15-P15, A2-Q4).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Browser, the platform domain (dev: `https://cds.needtobeedgy.com/`) | Open `/` | The hub Home page loads with the header (Pricing, Standard, Studio, Add-ons, Work, Contact, **Sign in**, **Start**). View source: it carries `<meta name="cds-surface" content="hub" />` |
| 2 | Terminal at the repo root | Make sure `.env.local` has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD`, then run `npm run prices:set -- --help` | The usage text prints, starting "prices:set - set one catalog price (super_admin, MFA)" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/pricing` | Read a price, for example the Standard monthly base fee | The figure comes from the price catalog (kind `plan`, key `base`, path `standard`). An unset price reads "Price coming soon" |
| 2 | Terminal (Super Admin) | Run `npm run prices:set -- --kind plan --key base --path standard --monthly 4900`, sign in (staff email, password, emailed code), read the old -> new line | The new price is saved and audited (an add-on going to or from $0 first lists the sites it affects and asks y/N). `--dry-run` prints what would be set without signing in |
| 3 | `/pricing` | Reload after about 60 seconds | The new price shows on Pricing, Standard and Home (the hub reads the catalog through a 60-second cache). The same price shows on `/start` and in the owner hub |
| 4 | `/staff/catalog?tab=prices` | Read the grid | The same price sits under **Base fee** · **Standard**. Add-on listings (tagline, description, screenshots) edited on the **Add-ons** tab show on `/add-ons` too ([Catalog](staff-catalog.md)) |
| 5 | `packages/core/src/marketing/work.ts` | For each entry in `WORK_SITES`, `TESTIMONIALS` and `ABOUT_FACTS`, check the facts with the business, then set `confirmed: true` and commit | In dev and preview every entry shows, unconfirmed ones with a **Draft** badge. In production only `confirmed: true` entries render; an empty Testimonials list hides that section. Never add an entry the business did not state |
| 6 | `/` (Home), the proof band | Click **See a live demo** | The demo tenant **Bella's Salon** opens on its preview host (marked "in development", `noindex`). It is wiped and reseeded every night at 3 am America/Chicago (`npm run demo:reset`, [Demo tenant](staff-demo-tenant.md)), so edits made there disappear. If the demo org can't be found the button and the demo panel are hidden |
| 7 | `packages/core/src/marketing/copy.ts` | To change any visible wording, edit the string in `MK_COPY` (never in a page file), run `npm run lint` and `npm test`, commit, push | The change appears after the next deploy of the app (D104). Never invent a capability, a figure or a testimonial in copy |
| 8 | Browser, production apex after the cutover | Open `https://connectionsdesignstudios.com/` in a private window | The hub is indexable and canonical on the apex; `www.` redirects to the apex. The cutover itself is in [Hub cutover](staff-hub-cutover.md) |
