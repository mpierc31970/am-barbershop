# CDS Platform — Design Outline

> **Status:** Design complete; 302 decisions (D1–D302); integration-gap review complete
> (2026-09-26); pricing, support and Shop decisions D296–D302 folded into `.planning/`. GSD `.planning/` scaffold in place. **No code yet.**
> Next: `/gsd:discuss-phase 1` (see `.planning/ROADMAP.md`).

---

## 1. What the platform is

**CDS owns and operates a multi-tenant website platform. Tenants sign up to use it.**

1. **CDS's site is the hub** — storefront and control tower of a product.
2. **Each customer is an organization (tenant)** with its own website, hosted by CDS.
3. **Components are installable add-on products** — the "component picker" model already
   named in `WEBSITE_BLUEPRINT.md`: chosen at signup, installable later in one click.
4. **The org owner gets a dashboard** that is also their communication channel with CDS.
5. **The shape is a customer onboarding system**, with CDS present at each stage.
6. **CDS manages DNS** for each organization's URL.
7. **Organizations have levels of sign-in** — a role hierarchy per org.
8. **Setup effort for CDS must be minimal** — onboarding collects what provisioning
   needs, and the site auto-assembles.

---

## 2. What this project actually is

Not greenfield invention. It is the **extraction and productization of a pattern that
has already converged across ~12 live Next.js + PocketBase client sites.**

### Asset inventory — github.com/mpierc31970 (19 repos, mostly private)

| Repo | Role in this project |
|---|---|
| `DCR-Website` | **Port baseline.** Newest. Columns page builder, credentials, SES, `impeccable` design system |
| `palm-science` | Origin of `page_sections`. Full booking admin suite. v2.3, phase 44 |
| `pride-and-fuerza` | DCR lineage, mid-migration (has *both* `ColumnsEditor` and old `Hero`/`About`) |
| `barutispa` | `page_sections` ported verbatim; fuller `MediaLibrary`; schema components |
| `texas-ceu-app` | **LMS source.** Video player, timers, attestation, certificates, wallet, sponsor payouts |
| `cds-website` | Current CDS marketing site. **Repo reused for the platform; code is not.** Source of `WEBSITE_BLUEPRINT.md` |
| `spiritual-empowerments` | Alternative booking calendar (not used — see D39) |
| `metaphysicalevents` | **Supabase**, not PocketBase. Entitlement ideas only (see D42) |
| `TxLEC` / `txlec-watch` / `lobbying` | The same legislative-watch app three times. **Dropped** (D41) |
| `map` | palm lineage + theming, no builder |
| `tarotafterdark` | Passwordless auth flow, email capture bands, moderation tools |
| `spankmastertees` | No components directory |
| `venice`, `personalCalendar`, `vidgen`, `card-creator`, `card-pull` | Unrelated |

**The house stack is settled by evidence, not preference: Next.js + TypeScript +
PocketBase, deployed by Coolify.**

### Not the basis
- **The existing `cds-website` marketing-site code.** The repo is reused; the code is not.
- Existing client sites stay on their own PocketBase instances. Never migrated.

### The business model is already written down
`cds-website/WEBSITE_BLUEPRINT.md`:
- *"the **component picker** model (pay monthly for the components you use)"*
- *"Practitioner site from $1,500 · Business site from $3,500 · **Care Plan $99/mo base
  (+ component add-ons)**"*
- Three pillars: **Web · Print · AI**. Flagship specialty: the metaphysical community.
- Tagline "Making Connections Happen"; philosophy "If You Win, We Win."

This confirms the billing decision independently — it was already the intended model.
**The blueprint's prices are historical.** Current pricing (D181, D299, D300): build fees
fixed at **Standard $1,500 / Studio $3,500** (Shop: $0 template or $499 setup); a monthly
**base platform fee** of **Standard $39 / Studio $49 / Shop $59** with support included;
the **Care Plan ($99/mo) is an optional upgrade** for done-for-you edits; add-ons on top.

---

## 3. Database architecture

**One shared PocketBase instance**, holding both a control plane and a data plane.

- `organizations` collection. **Every tenant-owned collection gains an `organization`
  relation**, including `page_sections`.
- **All data access goes through a single repository layer that takes organization
  context as a required, non-optional argument.** This is the existing
  `app/api/admin/**` + field-allowlist convention, promoted from convention to the only
  way to reach the database.
- **Two auth collections:** platform users (CDS staff + org members) and tenant end
  users. PocketBase supports multiple auth collections natively.
- Public reads keep API-rule filtering (`organization = X && is_published = true`).

### Why not PocketBase-per-tenant
1. **One-click install would become a migration.** With a database per tenant, adding
   Booking means a schema change inside that tenant's database — orchestrated and
   fallible. In one shared schema **every add-on's tables already exist and sit empty**;
   installing is inserting rows and granting an entitlement. This is the decisive reason.
2. **The control plane cannot be per-tenant.** So the choice is not "one database or
   many," it is "one, or one plus N."
3. **N tenants = N containers**, backups, certs, health checks, migration targets.

### Why not Postgres + RLS
Considered and rejected **after** discovering the components are PocketBase-native:
1. The rewrite would be the entire data layer — `page_sections`, booking, media, flags,
   every admin route. Months of rework on working code.
2. **RLS's advantage is partly moot here.** The established pattern already writes
   through a **superuser client**, and a superuser connection bypasses row-level rules.
   Isolation lands in the API layer either way.

### The honest cost — accepted explicitly
- **Isolation is enforced in application code, not by the database.** One bug in the
  repository layer can cross tenants. Three mandatory mitigations:
  1. a single chokepoint module — **no other code may hold a PocketBase client**;
  2. organization context as a required argument, never defaulted or inferred;
  3. a test that, **for every collection**, attempts a cross-tenant read *and* write and
     asserts failure.
- **SQLite has one writer**, now shared by all tenants rather than one per site. Fine at
  10–50 small-business sites; **measured, not assumed**, as booking volume grows.
- **Cross-tenant reporting is weaker** than SQL for the staff console. Acceptable here.
- **The repository layer is also the Postgres seam** — it exists for isolation first, but
  makes a future migration a swap rather than a rewrite.

**At 10–50 tenants this decision does not rest on scale** — per-tenant databases would be
survivable at that size. It rests on the instant-install promise and the control plane.
If instant install were ever abandoned, the calculus would genuinely change.

---

## 4. Architecture — building blocks

1. **Tenant core** — `organizations`, `memberships` with roles, hostname → tenant
   resolution, the org-scoped repository chokepoint.
2. **Tenant site rendering** — Next.js resolves hostname → organization → that org's
   `page_sections`, rendered by the section components, with that org's design tokens.
3. **Add-on registry** — one definition per add-on: identity, marketing, price,
   components, install recipe, dependencies, settings schema.
4. **Installer** — given (organization, add-on), runs the recipe idempotently: seed
   `page_sections` rows, seed records, grant entitlement. **Never a migration.**
5. **Onboarding pipeline** — staged, saveable, resumable structured content intake.
6. **Owner dashboard** — build progress, add-on management, the page builder for every
   page (D183), billing, requests, tickets, files, analytics.
7. **CDS staff console** — lead pipeline, organizations, approvals, review-and-polish
   queue, impersonation with audit, catalog authoring.
8. **Billing & entitlements** — build fee + base platform fee per path + per-add-on
   recurring, with the Care Plan as an optional item (D299, D300). Tenants' own customers
   pay on the tenant's own gateway through a core gateway interface (D296).
9. **Site templates** — pre-designed section arrangements with named slots, filled from
   onboarding intake. Built on `BlockTemplatePicker`.

---

## 5. The page builder — already the right abstraction

From `DCR-Website`'s `lib/section-layouts.ts` and `types/content.ts`:

- **`page_sections`** — PocketBase collection: `page_slug`, `section_type`, `row_layout`,
  `content` (json), `settings` (json), `sort_order`, `is_published`, `legacy_id`.
  Indexed on `(page_slug, sort_order)`.
- **`row_layout`** — 12 layouts: `full-width`, `50-50`, `25-75`, `75-25`, `40-60`,
  `60-40`, `30-70`, `70-30`, `33-33-33`, `25-50-25`, `25-25-25-25`, `20-20-20-20-20`
- **`section_type`** — `hero`, `text-image`, `service-grid`, `testimonials`,
  `cta-banner`, `text-only`, `signup-form`, `quiz`, `columns`, `books`, `custom`
  (**`custom` is dropped by D281**: no raw HTML)
- **`columns`** holds N columns of ordered primitives: `heading`, `text`, `list`,
  `image`, `button`, `spacer`, `divider`

### The two insights that make this the platform's content system

**1. The schema is universal; only the vocabulary varies.** From `barutispa`'s own
migration comment:
> *"Copied 1:1 field-for-field from palm-science… the field list transfers verbatim.
> `section_type` is Baruti's OWN vocabulary, not palm-science's eight types — nothing
> about the FIELD SHAPE depends on which vocabulary populates it, which is exactly why
> the field list ports unchanged while the values it holds do not."*

**Adding an `organization` relation to this collection is essentially the entire
multi-tenant content step.**

**2. Layout belongs to the container, not the content.** From `section-layouts.ts`:
> *"A predefined content block is always created on a 100% row and can never have
> another: row layout belongs to the container, not to content. Only `columns` chooses a
> split, which is what keeps the admin comprehensible — there is exactly one place
> layout is picked."*

Supporting mechanics already built: `RowRenderer` owns grid/padding/background;
`COLUMN_COUNT` derives column count so stored data cannot disagree with the rendered
grid; `clampLayout()` guards legacy rows; shrinking a layout appends overflow items to
the last column rather than destroying content.

### How this maps to add-ons
The **platform** owns `page_sections`, `RowRenderer`, `columns`, and the primitives.
**Each add-on contributes one or more `section_type` values** plus its content shape,
renderer, and admin form.

**The one real change needed:** `section_type` is currently a fixed union in
`types/content.ts`. It must become **add-on-contributed**, extended by the registry at
build time.

### It also gives the tenant editor its safety model
`content` and `settings` as JSON per section is exactly the structure-vs-slots
separation the simplified editor needs:
- **Structure** (composition, layout, block order) — CDS only.
- **Named slots** (hero headline, intro text, an image) — exposed to the tenant.
- **Add-on records** (testimonials, events, services) — fully tenant-managed.

The tenant editor never manipulates a free-form nested block tree.

> **Revised by D183.** Tenants now add pages and add, reorder and remove blocks on every page. What stays true: blocks are predefined (never free-form), every block renders from the site's fixed theme, and layout still belongs to the container (invariant 6). Structure/slots describe how CDS assembles the **first version**; D184 adds per-page version history as the new safety net.

---

## 6. Component abstraction inventory

All 19 repos scanned.

### Platform core — extract to shared packages

| Area | Components | Source |
|---|---|---|
| **Page builder** | `SectionForm` `SectionsList` `BlockTemplatePicker` `ColumnsEditor` `ColumnItemForm` `RowRenderer` `ColumnsSection` `ColumnItemRenderer` + `types/content.ts` `lib/section-layouts.ts` `lib/columns-content.ts` | DCR |
| **Data access** (chokepoint) | `lib/pb/{admin,browser,env,middleware,server,require-admin}.ts` | DCR |
| **Rich text** | `RichTextEditor` `RichTextToolbar` `rich-text-extensions` `RichTextBody` `lib/rich-text.ts` `lib/section-rich-text-fields.ts` | DCR |
| **Media** | `ImageUpload` `MediaLibraryPicker` `MediaLibrary` `Photo` `PlaceholderImage` `ImageSlot` `avatar-uploader` `site-image-editor` + `lib/{upload-image,s3,storage-keys}` `api/storage/[...path]` `api/admin/upload` | DCR + barutispa |
| **AI images** | `GenerateImagePanel` + `lib/ai-images/{gemini,openai,prompt,types}` | DCR |
| **Admin shell** | `AdminShell` `AdminHeader` `Sidebar` `MobileNav` `StatsCard` `QuickActions` `RecentActivity` `AlertSlideout` `UndoToast` `SortSelect` `NotificationBell` `admin-dropdown` `profile-dropdown` `components/ui/*` | DCR |
| **Site shell** | `Header` `Footer` `Container` `Section` `Breadcrumbs` `ScrollTopOnNavigation` `SkipToContent` `Bloom` | DCR + barutispa + tarot |
| **Settings** | `BusinessSettings` `NavigationSettings` `IntegrationSettings` `ProfileSettings` + `lib/{nav-settings-api,site-navigation.server,integration-secrets-*}` | DCR |
| **SEO** | `lib/{seo,jsonld}` `robots.ts` `sitemap.ts` `BusinessSchema` `ServiceSchema` | DCR + barutispa |
| **Analytics / consent** | `ConsentBanner` `WebVitalsReporter` `Analytics` + `lib/{analytics,google-analytics,google-search-console}` | DCR |
| **Auth** | `LoginForm` `ProtectedRoute` `preview-gate`; **passwordless** `AuthFlow` + `EmailStep`/`CodeStep`/`CodeInput` | DCR + tarot |
| **Email infra** | `lib/{ses,email-compile,email-text}` `api/webhooks/ses` | DCR (supersedes palm's `mailer`/`campaign-mail`) |
| **Theming** | **BUILD NEW** — see §7 | new |
| **Entitlements** | **BUILD NEW** — reuse only the `FeatureGuard`/`FeatureInline` prop surface and the column-allowlist pattern | new |

### Add-on catalog

| Add-on | Status | Port from |
|---|---|---|
| **Booking** | **First catalog.** Largest by far | `components/booking/*` (9) · `admin/{CalendarView,DayView,WeekView,WeeklySchedule,BlockedDates,BookingsList,BookingSlot,BookingFilters,BookingDetailModal,ConflictWarning,TimeRangeInput,UpcomingBookings}` · `api/booking/*` · `lib/{booking-api,availability-api,booking-settings-api,admin-bookings-api,google-calendar,live-calendar}` · `types/booking.ts` |
| **Testimonials** | **First catalog.** Simple proof case | `Testimonials.tsx` `admin/{TestimonialForm,TestimonialsList}` + `section_type: testimonials` |
| **Credentials list** | **First catalog** | `views/Credentials.tsx` `(client)/credentials/page.tsx` — DCR only |
| **Events** | **First catalog** | `(client)/events/*` `admin/events` `api/admin/events/*` `0011_event_price` `0012_event_registration_url` |
| **Newsletter** | **First catalog** | `admin/campaigns` `admin/EmailBuilder` `api/{campaigns,subscribers}/*` `api/tracking/open` `unsubscribe` + `EmailCaptureForm` `NotifyBand` `WaitlistBand` |
| Blog | Later | `blog/*` `admin/blog` `BlogPostCard` `legacy-blog-redirects.json` |
| Courses / LMS | Later — biggest after booking | **texas-ceu-app**: `course-player` `video-player` `lesson-list` `course-timer` `CourseContext` `certificate-download` `AttestationModal` `wallet-certificate-card` |
| Quizzes | Later | `admin/QuizBuilder` `api/quizzes/*` + `section_type: quiz` |
| Store | **v1.1** (D302); included in the Shop plan (D300), with the Shop template and theme library (D301) | New build per `.planning/design/STORE-PROPOSAL.md` (D239–D247) |
| Landing pages | **v1.1, before Newsletter** (D141) | `go/[slug]` `admin/landing-pages` `api/landing-pages/*` `lib/landing-page-templates` |
| Pricing tables | Later | `PackageCard` `PriceRow` `TreatmentRow` — barutispa |
| Before/after slider | Later | `BeforeAfter.tsx` — barutispa |
| FAQ | Later | `Faq.tsx` — barutispa |
| CTA bands | Later | `Cta` `DualCta` `MediaCard` |
| Books | Later | `BooksEditor` `BooksSection` `0015_books` — DCR only |
| Sponsor / payouts | Later | `expense-manager` `payout-pool-summary` `sponsor-*` — texas-ceu |
| Moderation | Later | `AllowlistEditor` `FlagList` — tarot |
| Misc | Unassigned | `QrCodeButton` `StaggerGrid` `OutboundLink` `LeavingNotice` |
| ~~Astrology / advice / directory~~ | **Dropped** | metaphysicalevents |
| ~~Legislative watch~~ | **Dropped** | TxLEC family |

**Core, not add-ons:** Services (`ServiceCard` `ServiceForm` `lib/services-api.ts` +
`section_type: service-grid`) and Payments (`lib/{stripe,stripe-client}` `api/payment/*`
`api/webhooks/stripe` `EmbeddedPaymentForm` `PaymentModal` `checkout-button`).

### Repo observations (not decisions)
- `DCR-Website` **deleted** `Hero.tsx` and `About.tsx` — hardcoded sections replaced by
  the columns builder. That is the direction of travel; the platform starts at the
  destination.
- `palm-science` has theming but no builder; `DCR` has the builder but no theming.
  Neither has both.
- `TxLEC`, `txlec-watch`, `lobbying` are one app three times — consolidation opportunity
  outside this project.
- `pride-and-fuerza` is mid-migration: both `ColumnsEditor` and old `Hero`/`About`.
- Two booking admin implementations exist; two LMS implementations exist. Both resolved
  in the decisions log.

---

## 7. Theming — mood-board driven

The tenant supplies a **mood board image**. Colors, fonts, textures, and component
visuals derive from it.

### The schema already exists — `impeccable`
`impeccable` is a **Claude Code design skill**, vendored into the newest repos
(`DCR-Website`, `pride-and-fuerza`; partially `barutispa`) and **absent** from
`palm-science`, `map`, `metaphysicalevents`, `cds-website` — it arrived alongside the
columns builder.

**Its output becomes `organization.design`:**
- **`DESIGN.md`** — YAML: `colors`, `typography` (display / heading / subhead / body /
  inscription / record), `rounded`, `spacing`, `components`
- **`.impeccable/design.json`** — `schemaVersion: 2`, with `colorMeta`
  (**`role: primary|secondary|accent|neutral`** + `tonalRamp` arrays), `typographyMeta`
  (purpose per style), `shadows`, `motion`, `breakpoints`, and `components` carrying both
  `html` and `css`
- **`.impeccable/config.json`** — a **design-drift detector** with ignore rules and reasons

It already satisfies the hard requirements: semantic color roles, tonal ramps, and real
contrast math (DCR's primary button documented as *"Teal field, white label at 6.76:1"*).

### What is actually derivable from an image

| Target | Feasible | How |
|---|---|---|
| **Colors** | Reliable | Deterministic quantization → dominant + accents |
| **Textures** | Partial | Grain/gradient *character* inferable; a tileable texture is not extractable |
| **Fonts** | **Not extractable** | Font ID from a collage is unreliable; a mood board shows vibe, not licensable fonts |
| **Component visuals** | Not extractable | But **derivable** from vibe classification → radius, shadow, border weight, density |

`impeccable`'s `extract` pulls tokens from **existing code**, not images; `colorize`
requires existing brand colors and defers to `new-work.md` for a new identity. So DCR's
design system came from **Claude-assisted design work with the mood board as input** — a
design-time process, not a runtime extractor.

### The pipeline
1. Tenant uploads the mood board during onboarding.
2. Platform runs **cheap deterministic color extraction** for an instant preview, so
   onboarding feels responsive.
3. **CDS runs the `impeccable` flow** to author the real design system — minimal admin
   effort: running a skill, not designing by hand.
4. Authored as files (`DESIGN.md` + `.impeccable/`), then **synced into
   `organization.design` JSON** — so a theme change is data, not a deploy.
5. **`impeccable`'s detector runs in platform CI** so templates and add-ons cannot drift
   off-token.

### Three non-negotiable constraints
1. **Contrast must be solved, not assumed.** Mood boards routinely yield text/background
   pairs that fail WCAG AA. Every palette passes through a contrast solver before it
   becomes a token. Easy to forget until launch; produces unreadable sites.
2. **The mood board produces a PROPOSAL, never the live theme.** Proposal → CDS/tenant
   review → committed to `organization.design`. **Never derive at render time**, or every
   deploy looks different.
3. **Colors map to semantic roles, not raw values.** Five attractive colors are not a
   design system. `impeccable`'s `colorMeta.role` already does this.

### CDS supplies the curated sets
The mood board generates the palette. **CDS supplies the curated font pairings, textures,
and component style sets** selected from, plus fallback presets for tenants with no mood
board.

---

## 8. Add-ons as independently editable packages

**Independently editable: yes. Independently versioned per tenant: no** — that breaks the
one-codebase rule. Tenant differences stay settings and feature flags.

```
packages/addons/<slug>/
  addon.config.ts    manifest: slug, name, category, price, deps, settings schema,
                     hub nav entry: tab in an item, or own sidebar item; label,
                     icon, badge source (D311)
  migrations/        its own PocketBase migrations
  collections.ts     the collections it owns
  install.ts         install recipe — seed page_sections + records
  uninstall.ts       disable, retain data
  sections/          public site components (contributes section_type values)
  admin/             tenant dashboard panel
  training/          title, video reference, written steps (D87)
  today/             Today card + Needs-you items for the owner's home screen (D310)
  repo.ts            org-scoped data access via the chokepoint
  index.ts           the only export the registry reads
```

**Four isolation rules:**
1. An add-on never imports from another add-on — it declares a dependency instead.
2. An add-on touches only its own collections.
3. Org context is passed in, never read from global state.
4. Shared UI comes from `packages/ui`; never copied between add-ons.

The registry auto-discovers `packages/addons/*`. Platform code imports add-ons **only**
through the registry, so adding one is dropping in a folder.

### How code changes reach live tenants
1. **One codebase, one `main`, every tenant on the same version.** Trunk-based.
2. **Variation is data, never code.** If a tenant "needs a code change," that is a signal
   it should become a setting or a new add-on — built once, sellable to the next customer.
3. **Pipeline:** branch → PR → CI (tests + cross-tenant isolation assertions) → merge →
   staging with a real tenant fixture → smoke test → production.
4. **Staged rollout via feature flags, not branches.** Own site first, then a canary
   org or two, then everyone. Identical code; only the flag differs.
5. **Migrations forward-only and backward-compatible** (expand/contract), with `down()`
   so restores can be rehearsed.
6. **Bespoke work** = a private add-on installed only for that tenant, or a theme
   override. Same codebase, same pipeline.
7. **Tenant preview is a content feature** — `is_published` draft/publish, not a branch.

---

## 9. Identity, roles, DNS

### Two user populations — kept separate
The most damaging mistake here is putting a tenant's customers in the platform's users
table.

**Platform users** — CDS staff and org members; a user **owns at most one organization**
and may hold Staff or Renter grants in others (D69, D286). Base roles also include
**Staff** and **Renter**, governed by one per-feature permission matrix (D285):

| Org role | Can |
|---|---|
| **Owner** | Everything: billing, purchases, domains, delete org. At least one required |
| **Admin** | Members, settings, content, install add-ons — **no billing** |
| **Editor** | Create and publish content only |
| **Viewer** | Read-only incl. analytics — stakeholders, accountants |

Plus **per-add-on grants** so a receptionist can manage Bookings without touching the
website. CDS staff roles are separate and orthogonal; support access is
**impersonation, always written to the audit log**, with MFA on every staff account and a
deny-list of actions staff cannot take while impersonating (D287).

**Tenant end users** — the tenant's own customers (someone booking with a therapist).
Separate auth collection, org-scoped, never a platform user.

### DNS

> **Rewritten 2026-09-26** to match D54–D58, D169, D282, D288 and D289. The earlier
> subdomain-default / "Mode A" text (D11, D12) is superseded.

- **Preview: `<tenant>.sites.connectionsdesignstudios.com`** (D57) — one wildcard record
  and a **DNS-01 wildcard certificate** (D289). Live the moment the organization is
  created; preview only, with the "in development" strip and `noindex` (D170).
- **Live: the tenant's own custom domain, from day one** (D54), attached at Launch.
- **CDS takes delegated DNS control** (D55): the tenant points their nameservers at
  **Cloudflare DNS (free plan)**, managed through its API (D289). Hostinger DNS is for
  existing client sites and dev only.
- **CDS never owns the domain** (D56): no transfers; the registrar account stays in the
  tenant's name.
- **The zone-copy gate is mandatory** (D58): before any nameserver switch, the existing
  zone is exported and MX, SPF, DKIM, DMARC and every TXT verification recreated exactly,
  enforced by tooling. The one-click domain move (D169) starts with this copy and the
  tenant's nameserver change (D288); leaving CDS runs it in reverse, **DNS handback
  first** (D282).

> **The standing hazard:** taking over nameservers means inheriting the customer's
> **email**. A mistake takes down their email, not just their website. D58's gate is the
> mitigation and is not optional.

- **TLS at scale:** a reverse proxy with **on-demand TLS** that asks the control plane
  "is this hostname a verified domain?" before issuing. No per-tenant action, abuse-proof.
  Coolify keeps deploying the app; the proxy handles per-hostname certificates.

---

## 10. Onboarding as content intake

Onboarding is the most important surface in the product. **It is not lead capture; it is
structured site-content capture**, and everything provisioning needs must come from it.

| Group | Fields |
|---|---|
| Identity | business name, tagline, logo, **mood board**, font preference |
| Contact | address, phone, email, hours, service area, socials |
| Copy | about text, mission, headline preferences |
| Offerings | services with descriptions and prices |
| Proof | testimonials, credentials/licenses, awards |
| People | team members with photos and bios |
| Media | logo, hero image, gallery |
| Domain | desired subdomain; custom domain if any |
| Add-ons | selection + per-add-on config (booking services and availability, first events) |
| Integrations | GA4, socials |
| Legal | privacy/terms inputs |

**Five design consequences:**
1. **Templates with named slots are mandatory.** Provisioning picks a template and fills
   its slots from intake. Without them CDS hand-builds every site and minimal-admin fails.
2. **Staged, saveable, resumable.** It asks for a lot; nobody finishes in one sitting. A
   clear "what's still needed" state is required.
3. **Must tolerate incompleteness.** Every slot needs a fallback so a tenant with no
   testimonials yet can still launch.
4. **File upload is core infrastructure**, needed in the first phase.
5. **CDS review is a gate, not construction** — staff approve and polish an assembled
   site, never a blank page.

### The customer journey
**Discover** → **Configure** (guided builder, live total, resumable) → **Account**
(create org) → **Submit** (CDS notified) → **Pay** → **Provision** (org + site + add-ons)
→ **Build** (milestones, files, change requests, messaging) → **Review & Launch**
(preview, domain, go live) → **Operate** (analytics, support, editing, **and add-on
expansion — the recurring revenue loop**).

---

## 11. Decisions log

| # | Decision | Answer |
|---|---|---|
| D1 | Project basis | A **new, separate project**. Client sites are donors for components and patterns only |
| D2 | Existing client sites | Stay on their own PocketBase instances; never migrated |
| D3 | Platform repository | **`mpierc31970/cds-website` emptied and reused.** Archive to a tag/branch first; confirm the Coolify deploy source before clearing `main` |
| D4 | Stack | **Next.js + TypeScript**, confirmed by the existing fleet |
| D5 | Database | **One shared PocketBase**, all access behind an org-scoped repository chokepoint that doubles as a Postgres seam |
| D6 | Per-tenant database | **Rejected** — install would become a migration; the control plane can't be per-tenant |
| D7 | Per-tenant export/restore | **Required** first-class feature |
| D8 | Identity | **Two auth collections**: platform users vs tenant end users |
| D9 | Org roles | Owner / Admin / Editor / Viewer, plus per-add-on grants |
| D10 | Staff access to tenants | **Impersonation only**, always audited |
| D11 | Default domain | Platform subdomain via wildcard DNS + wildcard cert — *superseded by D54* |
| D12 | Custom domain default | **Mode A — customer keeps their DNS.** Mode B premium opt-in only — *superseded by D54 (DNS: D55, D289)* |
| D13 | TLS | Reverse proxy with on-demand TLS, verified against the control plane |
| D14 | Scale target | **10–50 tenants**, productized agency. Simplicity over fleet automation |
| D15 | Per-tenant code branches | **Rejected** — one codebase, one `main`, all tenants same version |
| D16 | Per-tenant variation | Configuration and feature flags only, **never code** |
| D17 | Tenant-specific rollout | Feature flags with canary organizations |
| D18 | Add-on update rollout | **All tenants immediately** on one deploy; risky changes behind a flag |
| D19 | Migrations | Forward-only, expand/contract, with `down()` for rehearsed restore |
| D20 | Bespoke customer work | A **private add-on** or theme override in the same codebase |
| D21 | Private add-ons | **Allowed**, same repo, not listed in the public catalog |
| D22 | Tenant site preview | Draft/publish via `is_published`, **not** code branches |
| D23 | Who builds a tenant site | **CDS builds**; tenant manages content after |
| D24 | Tenant content editing | **Purpose-built simplified editor**, scoped to installed add-ons. Not a full CMS — **revised by D183: tenants edit every page in the page builder, within their fixed theme** |
| D25 | Billing | **Build fee + monthly recurring** — the blueprint's model: $1,500 / $3,500 + Care Plan $99/mo + component add-ons — **made fixed per path (Standard / Studio) with a 6-payment option by D181** — *revised by D299 and D300: a base platform fee per path (Standard $39, Studio $49, Shop $59) replaces the required Care Plan, which becomes an optional $99 upgrade* |
| D26 | Signup | **Open signup; CDS approves before launch** |
| D27 | Uninstall | **Disable and retain**; reinstall restores. Matches billing-lapse behavior |
| D28 | Onboarding | **Structured content intake**, not a lead form |
| D29 | Admin effort | Site **auto-assembles** from intake; CDS reviews and polishes |
| D30 | Site templates | **Required**; built on the existing `BlockTemplatePicker` |
| D31 | Content model | Adopt **`page_sections` verbatim**, plus an `organization` relation |
| D32 | `section_type` | Becomes **add-on-contributed**, not a fixed union. The one real change to the existing design |
| D33 | Port baseline | **`DCR-Website`** — newest; already replaced hardcoded sections with the columns builder |
| D34 | Marketing site | **Platform ships a new hub that replaces it.** Old site retired at cutover |
| D35 | Add-on packaging | Independently **editable** packages; **never** per-tenant versions |
| D36 | First catalog | **Booking, Testimonials, Credentials, Events, Newsletter** — *superseded by D177 (Booking split into Studio Booking and Appointments)* |
| D37 | Services | **Core**, not an add-on. Every tenant gets it |
| D38 | Payments | **Core**, not an add-on |
| D39 | Booking source | **palm-science / DCR** (12-component admin suite). Not spiritual-empowerments |
| D40 | LMS source | **texas-ceu-app**. Not first-catalog — a later phase |
| D41 | Dropped from catalog | **Astrology / advice / directory** (metaphysicalevents) and **legislative watch** (TxLEC family) |
| D42 | Entitlements | **Build new.** metaphysicalevents is **Supabase** with hardcoded flag/tier literals — wrong shape for registry-derived entitlements. **Reuse only** the `FeatureGuard`/`FeatureInline` prop surface and the deny-by-default column allowlist |
| D43 | Theming | **Built new**, not ported. palm's is single-site |
| D44 | Theme schema | **`impeccable`'s output as `organization.design`** — `DESIGN.md` + `design.json` (schemaVersion 2) |
| D45 | Theme authoring | **CDS runs `impeccable` per tenant.** Tenant supplies the mood board only |
| D46 | Theme storage | **Both** — authored as files, then synced into `organization.design` JSON so a theme change is not a deploy |
| D47 | Mood-board pipeline | Upload → instant deterministic color extraction for preview → CDS runs `impeccable` → import into the org record |
| D48 | Design-drift detection | Adopt `impeccable`'s detector in platform CI |
| D49 | Email | **SES** (`lib/ses.ts`); drop palm's `mailer.ts` / `campaign-mail.ts` |
| D50 | Communication style | Keep written output short and scannable |
| D51 | Tenant payment flow | **Stripe Connect — each tenant's own account.** Tenant funds and chargeback liability never touch CDS. Onboarding gains a Connect step |
| D52 | Platform transaction fee | **None.** Revenue is build fee + Care Plan + add-on subscriptions only. No `application_fee` logic — *revenue lines revised by D299 and D300 (base plan fee, optional Care Plan, paid services and custom work); no fee on tenant transactions stands, restated by D296* |
| D53 | Tenant end-user accounts | **Yes — passwordless (email code).** Second auth collection ships in v1. Port `AuthFlow` + `EmailStep`/`CodeStep`/`CodeInput` from `tarotafterdark` |
| D54 | Live tenant domain | **REVISES D11/D12. Custom domain is the default, from day one** — not a platform subdomain, not an opt-in |
| D55 | DNS control | **CDS takes delegated DNS control** — nameservers delegated to CDS's Cloudflare. This makes the old "Mode B" the default |
| D56 | Domain ownership | **CDS does NOT accept domain transfers.** The tenant keeps the registrar account in their own name |
| D57 | Build/preview URL | **`<tenant>.sites.connectionsdesignstudios.com`** — one wildcard record + wildcard cert. Live the moment the org is created; the custom domain is attached at Launch |
| D58 | Zone migration | **Mandatory checklist before any nameserver switch:** export the existing zone and recreate MX, SPF, DKIM, DMARC and every TXT verification exactly |
| D59 | Analytics and DNS | **Analytics needs no DNS control.** GA4 is a page script; Search Console verifies by HTML file, meta tag or the GA4 property; certs use the HTTP challenge |

### Why ownership and control are separated (D55 + D56)
A domain is the client's most valuable digital asset. Owning the registration would give
CDS **renewal liability** (an expired domain takes the client's business offline), 60-day
transfer locks, auth-code friction when a client leaves, and an ugly dispute if a
relationship sours. **Nameserver delegation gives the same operational control with none
of it.**

> **The standing hazard (unchanged, now the default path):** taking over nameservers
> means inheriting the tenant's **email**. A mistake takes down their email, not just
> their website — a materially worse failure and a permanent support obligation. D58 is
> the mitigation and is not optional.

| D60 | Site templates | **One template.** The mood-board design system carries the visual variety; distinctiveness comes from tokens, not layout. Slot contract still built so more can drop in later — *extended by D301: a second template, the Shop template, with a library of 8 ready-made themes (v1.1)* |
| D61 | Hosting | **Existing Hostinger VPS via Coolify**, alongside the current client sites |

| D62 | Marketing site during the build | **Keep it live, deployed from the archive branch/tag**, until the hub reaches parity at P14. The archive tag is therefore a **deployed artifact** — never garbage-collect it |
| D63 | Dashboard branding | **Neutral / unbranded** — the tenant's own site admin, no CDS marks. Keeps reselling possible later |
| D64 | Support entry point | Because of D63, the CDS channel must be **explicit UI** — a "Get help" / "Request a change" surface. No logo implies who is behind it |
| D65 | Scope: three pillars | **All three on-platform** — Web, Print, AI/automation |
| D66 | Money direction split | Tenant's customer → tenant = **Connect** (D51). Tenant → CDS (build fee, Care Plan, add-ons, **print orders, automation projects**) = **CDS's own Stripe** |
| D67 | Work order model | One generic **work order** abstraction with a work type — web build, print job, automation project — shared by all three pillars |
| D68 | Print depth — **proof approval reversed by D108** | **Quote → proof approval → pay → status.** Status entered manually by CDS. **No** printer API, **no** shipping integration |

| D69 | Multi-org per user | **One org per user, enforced.** Store as a join table with a unique constraint, so relaxing it later drops a constraint instead of migrating every query — *revised by D286: one owned org per user; Staff or Renter grants elsewhere allowed* |
| D70 | Page builder scope | **IN SCOPE — corrects the earlier out-of-scope wording.** That line meant a free-canvas (Webflow-style) builder. **DCR-Website's advanced page builder is the platform's content editor** |
| D71 | Where drag-and-drop exists | Verified in DCR: `@dnd-kit/core` + `/sortable` + `/utilities` are real deps. **`ColumnsEditor.tsx`** drags items *inside* a columns block; **`SectionsList.tsx`** reorders *sections on a page* (backed by `api/admin/page-sections/reorder`) |
| D72 | Builder access | **SUPERSEDED by D183 (tenants add pages and blocks on every page).** Was: **ASSUMPTION — confirm.** CDS uses the full builder (sections + columns). Tenants get within-component drag plus slot editing. Consistent with D23, D24, D29 |
| D73 | Client-facing AI chatbot | **IN SCOPE** — reverses the earlier exclusion, now that the AI pillar is on-platform (D65). **Needs scoping:** what it answers from, and who pays for tokens — *superseded by D201* |
| D74 | Still out of scope | Free-canvas visual builder · third-party plugin marketplace · native mobile app · migrating existing PocketBase client sites |

| D75 | Column reordering | **Columns within a `columns` block are reorderable.** Columns already carry ids from `newColumn()`, so this is an array move, not a schema change |
| D76 | Reorder semantics | Reordering moves **content between the row's fixed width slots** — `row_layout` stays positional, per "row layout belongs to the container, not to content." Ship a separate **flip layout** action (`25-75` ↔ `75-25`) that swaps widths and leaves content in place; for asymmetric two-column rows that is usually the intended gesture |
| D77 | Reorder must use stored columns | **Trap to design around.** `resolveColumns()` merges overflow into the last column when a layout shrank, so the editor may render fewer columns than are stored. Reordering the *resolved* view and saving would silently destroy hidden columns' separation. **Fix: normalize on layout change** — persist what `resolveColumns()` returns so stored and drawn always agree; reorder is then a plain array move |
| D78 | Self-serve purchase flow | **Register → choose components → see pricing → sign agreement → pay (CDS Stripe) → CDS builds.** Tenant-facing and self-serve all the way to payment |
| D79 | Pricing visibility | The picker shows **per-component price, a live running total, and the total price of the website being purchased** — not just a component list. Ports the donor picker's `estimated_total_cents` behaviour |
| D80 | **Agreements — NEW, was missing** | Tenants **sign agreements in-platform before checkout**. Payment is gated on a completed signature. Nothing in D1–D77 covered this, and it sits on the critical path |
| D81 | Agreement requirements | **Versioned templates** — it must be provable which version was signed · presented before payment · signature captured with **timestamp and IP** · an **immutable stored signed copy** · defined retention · signer can **retain their own copy**. Follows ESIGN/UETA: demonstrated intent to sign, consent to transact electronically, signature associated with the specific record. **A bare "I agree" checkbox with no stored versioned artifact is not sufficient**, and this is expensive to retrofit |
| D82 | Communication lives in the tenant admin | CDS message threads, **notes**, **alerts** and **documents** all live inside the tenant's dashboard — not email-only |
| D83 | Branding, refined — **narrows D63** | **Dashboard chrome stays neutral** (the tenant's own site admin). **The CDS communication surface inside it is CDS-branded** — threads, notes, alerts and documents from CDS carry CDS identity, because those *are* CDS speaking. Also satisfies D64: the support entry point becomes visually obvious instead of needing signposting |
| D84 | Alerts and notes | An **alerts/notifications model** is required, surfaced in the dashboard. Donor components exist: `AlertSlideout`, `NotificationBell`, `UndoToast` |
| D85 | Funnel order — **RESOLVED by D213** | Requirement wording implies **register first, then configure**. The plan currently has Configure → Account, so anonymous visitors can build a quote. Registering first raises the barrier but captures the lead even on abandonment. **Needs a decision** |
| D86 | Decline-after-payment path — **RESOLVED by D214** | Checkout completes before CDS reviews the build, so CDS can take money from a customer it would rather decline. **Needs a refund/decline policy** and the UI to execute it |
| D87 | Per-add-on training module | **Every add-on ships a training module** — title, video, and written steps — surfaced in the tenant dashboard **only for add-ons they have installed**. This **extends the D35 package contract** with a tenth element, `training/` |
| D88 | Training content ships in the package | Training is **identical for every tenant**, so it is versioned with the add-on rather than stored per-organization. It updates when the add-on updates (D18), and does not violate D16 because it is not tenant-varying data. Video files live in object storage like other media |
| D89 | Online store add-on | A catalog add-on: products, orders, and checkout. **Payments route through the tenant's own Stripe Connect account** (D51), so it needs no new payment topology. Scoped to **v2.1+** |
| D90 | Member portal add-on | A catalog add-on: gated content and member management. **Depends on tenant end-user accounts** (D53), which already exist. Scoped to **v2.1+** — *superseded by D243 and D252 (shared core package)* |
| D91 | Member portal precedes LMS | The portal is the **access layer the LMS needs** — course enrolment is gated membership. Sequence the portal before or alongside the LMS (D40) rather than building access twice |
| D92 | Support tickets — **one typed system** | Support tickets and change requests are **one system** with a `type`: **Problem / Change request / Question / Billing**. One form, one inbox, one workflow. **Narrows COMM-06 and STAFF-05**, which listed them separately |
| D93 | Who files and sees tickets | **Owner, Admin and Editor** file; **every org member, Viewer included,** can read the org's tickets. Tickets are org-owned and go through the repository chokepoint like any tenant collection (D5, TEN-03) |
| D94 | Ticket intake | The form carries a **target picker** (one of the org's pages, or an installed component/add-on), **file and screenshot uploads**, and **auto-captured context** — page URL, browser, timestamp — recorded silently |
| D95 | Ticket lifecycle | **Open → In progress → Waiting on you → Resolved → Closed.** A tenant reply on *Waiting on you* moves it back to *In progress*. *Resolved* **auto-closes after 7 days**; a tenant reply before then reopens it. After close, a new ticket is filed |
| D96 | Staff ticket tools | **Public replies** and **internal notes** (never visible to the tenant), **assignment** to one staff owner, **priority** Low / Normal / High / Urgent, and **canned replies**. **No SLA tiers** — one response target for every Care Plan, for now |
| D97 | Ticket notifications | **Dashboard bell and email** on each staff reply and status change. Email **links back to the dashboard** — **no reply-by-email**, so the conversation stays in-app (D82) and no inbound mail parsing is needed |
| D98 | CDS staff roles | Two roles, **orthogonal to org roles** (§9): **Super Admin** — everything, including billing, staff management and platform-wide service mode. **Support Agent** — tickets, incidents, tenant-scoped service mode, and audited impersonation (D10). Fills the gap §9 left as "CDS staff roles are separate" |
| D99 | Service mode | Staff can put a target **into service**: a **notice on the affected dashboards** plus an **edit lock** on the target. **Dashboard only** — the public site is unaffected. Scopes: **platform, add-on, organization, page, component** |
| D100 | Service-mode scope follows the kind of change | **Code changes are platform-wide** — one codebase, every tenant on it (D15/D16) — so they use **platform** or **add-on** scope, the latter reaching only tenants with that add-on installed. **General support is tenant-scoped** — organization, page or component. Permission follows: **Agents** set tenant scopes; **Super Admin only** sets platform and add-on scopes |
| D101 | Scheduled service windows | A service window has a **start and end** and **clears itself**. It can be set ahead of time for planned work, and may link to an incident (D103) |
| D102 | Lock behaviour | If a tenant is mid-edit when a lock starts, **their unsaved work is saved as a draft** and the editor turns **read-only** with the notice. The lock is **enforced in the repository chokepoint** — a write to a locked target is rejected server-side, not merely hidden in the UI. **Staff writes bypass the lock**, since staff are the ones doing the fix |
| D103 | Incidents | A **platform incident** groups tickets from many tenants reporting one problem. **Resolving the incident updates and notifies every linked ticket at once.** An incident is platform-owned; each tenant sees only the incident's public text and **its own** linked ticket — never which other organizations are affected |
| D104 | Hub pages are hand-built in code | The CDS hub's public pages — front page and every page that introduces what CDS does — are **designed one at a time in code** and changed through Claude Code, **not** through the page builder or any editing interface. They have **their own shape, form and style**, outside the tenant design-token system (D44–D48) and the one-template rule (D60). Invariants 7 and 8 in `CLAUDE.md` govern **tenant sites only**; a hub change is a deploy, and that is intended |
| D105 | Social media section — CDS accounts via Blotato | Platform admin gets a **Social Media** section for **CDS's own accounts only**. Posts are **composed and scheduled in admin** and pushed through the **Blotato API** (`POST /v2/posts`, with `scheduledTime`); **status is pulled back** (scheduled / published / failed, plus the published URL). The Blotato API key lives server-side only. Whether engagement metrics are available from the API is **not yet verified** |
| D106 | Social holding pen | New **testimonials and reviews** land in a **holding pen**. Nothing posts automatically; a staff member **chooses** whether each one becomes a social post, and edits it before it is scheduled — *narrowed by D294: tenant reviews go to that tenant's Testimonials* |
| D107 | Platform admin is its own track | The CDS platform-admin side (staff console, support, social, accounting, content) gets **its own design discussion and milestones**, separate from the tenant-facing roadmap |
| D108 | Print sales — **reverses D68's in-app proof approval** | CDS sells **business cards, brochures and other print items** from a catalog whose items and **prices CDS adds and maintains** in admin. **Proofs are handled by email**, not by a sign-in proof portal. D68's "no printer API, no shipping integration, status entered by CDS" still stands; only the in-platform proof-approval state machine is dropped |
| D109 | Customer archive | Each print order has an **archive** holding the **order, the artwork, the invoice, proof of sale, and the proof emails**. Stored in **object storage** — Wasabi or Google Drive folders, **not yet chosen** |
| D110 | How-to steps are part of "done" — **extends D87** | **Every component and every user-facing feature** — add-ons *and* core (tickets, billing, onboarding, domains, the editor) — is not complete until its **how-to** is written: the exact steps a user takes to **activate** it and then **use** it. Each step records the **screen/route, the action, and the expected result**, so the steps double as a **video script**. Once the system is built, CDS produces how-to and showcase videos from them with **Remotion** and **Venice AI**, for the dashboard training modules (D87) and the hub (D104) |
| D111 | Email sending = Amazon SES; mailboxes are separate — **mailbox question closed by D173 (no CDS mailboxes)** | **Amazon SES** (already used by DCR) sends all platform and newsletter mail. **SES sends; it does not host mailboxes.** Mailboxes on a tenant's custom domain come from a **third-party mailbox provider** — **not yet chosen** (Q8). Amazon WorkMail is ruled out: closed to new customers since April 2026, end of support March 2027 |
| D112 | Tenants who already have email | CDS **never takes over an existing mailbox**. Their MX records are preserved exactly (D58). To send newsletters **from their own domain**, CDS adds SES **DKIM, SPF and DMARC** records through its DNS control (D56) |
| D113 | Newsletter send pricing — **see the price before sending** | Each newsletter send is **billed per recipient**. Before sending, the tenant sees **recipient count × rate = price** and confirms. CDS's cost basis is SES à la carte (**$0.10 per 1,000**, plus $0.12/GB attachments); CDS adds a markup. Charged to **CDS's own Stripe** (D66). Rate, minimum and prepaid-vs-per-send **not yet set** (Q9) — *superseded by D142* |
| D114 | Shared sending reputation | Every tenant sends through one SES account, so **one tenant's spam hurts every tenant's delivery**. Mandatory: per-tenant SES configuration sets, bounce and complaint handling with a suppression list, a working unsubscribe on every send, and CDS's ability to **pause a tenant's sending** |
| D115 | Multi-staff scheduling — **not yet designed** | The ported booking suite (palm-science) assumes **one provider per tenant**. Tenants such as a barbershop need **staff scheduling for many people**, managed in the tenant dashboard, which booking and a chatbot (Q3) can read. This component **does not exist yet** and needs its own design (Q10). Booking is v1.1, so multi-staff must be decided **before Booking is built**, or it becomes a retrofit onto live bookings — *superseded by D144* |
| D116 | Countdown timer block — **new, no donor** | A page-builder item counting down to a date. **Not found in any donor repo** — built new. Can target a manually entered date or, once Events exists (v1.1), an event record. Behaviour at zero and placement still to confirm |
| D117 | Announcement banner — **site chrome, not a section** | A tenant-controlled banner (e.g. "Sale this week") with **on/off toggle** and **tenant-written message**. It sits in the **site chrome above every page**, so it is a site setting rather than a `page_sections` row — layout stays with the container (invariant 6). Editing it is content, so tenants own it (invariant 7). No donor exists |
| D118 | Button-triggered pop-ups + pop-up designer | A button can **open a pop-up**. Pop-ups are **reusable records** designed in the page builder, and a button's action points at one. Pop-up content is built from the **existing column item types** so there is one builder, not two. Accessibility comes from the overlay foundation found in `spankmastertees` (`ui/overlay/useOverlay`, `useFocusTrap`, `Sheet`): focus trap, Esc to close, dialog semantics. No pop-up designer exists in any donor |
| D119 | Product principle — **curated, not exhaustive; ease first** | The platform is **not a Wix**. It offers a **curated** set of components, each one as easy and as flexible as it needs to be. Every component and area is designed by asking **"what makes this person's job a little easier?"** — especially removing repetitive entry and chances to mistype. These small workflow innovations are the product's differentiator, and are raised in every component discussion |
| D120 | Bulk CSV import — **part of the add-on contract** | Every add-on that manages **lists of records** (services, events, staff, products, testimonials, credentials…) ships a **downloadable CSV template** with explicit columns and an example row, and an **importer** that **validates and previews every row before anything is saved**, shows row-level errors in plain language, and imports all-or-nothing. **Extends the D35 package contract** alongside training (D87) |
| D121 | Pricing rule — **blocks included, capabilities sold** | **Display blocks** (countdown, announcement banner, pop-ups, columns, text, images, buttons) are **included in the standard price**. **Paid add-ons** are things that **store business data, run a workflow, or cost CDS per use** — Booking, Newsletter (per-send, D113), chatbot, store, member portal. A pop-up is included; a **sign-up form inside it requires the Newsletter add-on**, which is where the sign-ups go — *superseded by D272 (and D271 for sign-up forms)* |
| D122 | Countdown completion message | The tenant writes the **message shown when the countdown reaches zero**. Refines D116 |
| D123 | Scheduled banner | The announcement banner takes an optional **start and end**, turning itself on and off — **set it and forget it**. Refines D117 |
| D124 | Pop-up interaction is tenant-chosen | The tenant picks **how each pop-up meets visitors** from a curated list: **button click**, **after a delay**, **on scroll**, **when leaving (exit intent)**, **on page load** — plus **how often**: every visit, once per session, or once per visitor. Refines D118 |
| D125 | Smart CSV import + JSON backups — **refines D120** | The importer reads the columns CDS provided and offers two modes: **Replace all** or **Update only what changed**. Rows are matched by an **ID column** (present on exported rows, blank on new ones), falling back to a per-add-on natural key (e.g. event title + start date). **Duplicate rows are detected and removed** — within the file and against existing records — and the preview shows how many. **Every import first saves a JSON backup** of the current records automatically, and tenants can also save one manually. Previous backups are listed and **restorable**, which is also the **undo** for a bad import. CSV export produces the same columns, so download → edit → re-upload round-trips |
| D126 | Backup retention and Replace-all guard | Each add-on keeps the **last 3 JSON backups**; saving a fourth drops the oldest. **Replace all** requires a **second confirmation** that lists exactly which records will be removed. Refines D125 |
| D127 | Events: duplicate + recurring | The Events add-on (v1.1) supports **one-click duplicate** and **recurring events** (e.g. "every Tuesday for 6 weeks") so tenants never re-enter the same event by hand (D119) |
| D128 | Newsletter subscribers | One subscriber record per **email address per tenant — never duplicated**. A subscriber carries **any number of categories** at once (e.g. General + VIP + an event) |
| D129 | Newsletter categories | Three kinds: **General** (everyone subscribed), **system categories** the platform maintains (e.g. one per event, added when someone registers), and **tenant-created categories** (VIP, favourite customers, anything they define). A new site sign-up gets a **welcome email** immediately |
| D130 | Campaign audience | A campaign is a one-off mailing. The tenant **selects one or more categories**; the audience is **everyone in any selected category**, and because addresses are unique **each person receives it once**. The recipient count feeds the pre-send price (D113) |
| D131 | Campaign builder + boundary with LMS | Campaigns are built in a **simplified, email-safe version of the page builder** with **ready-made templates**, Mailchimp-style. Donor: DCR's `admin/campaigns` and `EmailBuilder`. **LMS student messaging stays in the LMS**, not the newsletter |
| D132 | Double opt-in | The **first email is a double opt-in confirmation**: a new subscriber must **click to confirm** before they receive anything else. Unconfirmed addresses are never mailed. This **exceeds** CAN-SPAM (an opt-out law that does not itself require it) and protects shared sending reputation (D114) |
| D133 | CAN-SPAM on every campaign — **enforced by the builder** | Every campaign carries, and the builder will not send without: a **working one-click unsubscribe**, the **tenant's physical postal address**, an **accurate From name and subject**. Unsubscribes take effect **immediately** (the law allows 10 business days). The tenant's postal address is collected at onboarding |
| D134 | Landing pages with QR codes as a sign-up source | A tenant can make a **landing page with its own QR code** for a trade show, fair or pop-up event. Everyone who registers there is **automatically placed in a category for that source** (e.g. "Trade show: Spring Expo"), so lists segment themselves. The platform **generates the QR code** for printing on signage |
| D135 | Newsletter consent on event forms | Event registration forms carry an **"Also send me news" checkbox**. Only people who tick it join **General**; everyone who registers still gets that event's category for event-related mail |
| D136 | Landing-page sign-up is consent | Registering through a landing page **counts as agreeing to be contacted**, because signage tells people up front that their email is collected. The landing page **stores the consent wording shown**, so consent can be demonstrated later |
| D137 | Campaign shortcuts | **Send a test to myself · schedule for later · duplicate a past campaign · templates that pick up the tenant's brand automatically (D44) · save my own templates** |
| D138 | Unsubscribe is total | An unsubscribe removes the person from **General and every category** and adds them to a **suppression list**, so no campaign can reach them again — even if they are later re-imported or re-tagged. Only a new, confirmed opt-in by that person lifts it |
| D139 | QR / landing-page sign-ups still confirm | Landing-page sign-ups (D136) also receive the **double opt-in confirmation** (D132). Consent is given at the stand; the confirm click catches **typo'd addresses** typed in a hurry on phones, which would otherwise bounce and damage shared sending reputation (D114) |
| D140 | Unsubscribe covers marketing only | D138 stops **campaigns**. **Transactional** email the person needs — booking and event confirmations, reminders, receipts — continues, which CAN-SPAM permits |
| D141 | Landing pages move to **v1.1, before Newsletter** | Moved from v2.1 because QR sign-ups (D134) feed the newsletter. Donor: `go/[slug]`, `admin/landing-pages`, `lib/landing-page-templates` |
| D142 | Newsletter pricing — **resolves Q9, refines D113** *(revised 2026-09-24: replaces a flat $0.02/email, which priced a weekly 5,000-list sender at ~$400/mo)* | **Allowance + overage, on the monthly invoice.** Newsletter add-on **$25/mo including 10,000 campaign emails**; beyond that **$0.002 per email** ($2 per 1,000). **Transactional mail is free.** Cost basis: SES **$0.0001/email** (stored as a staff-editable setting). A 5,000-list tenant pays $25 sending monthly or twice monthly, ~$45 weekly — vs Mailchimp $75, MailerLite $39. Dashboard shows a **usage meter** and warns at **80%** of the allowance; the pre-send screen shows any overage (D113). Fee, allowance and overage are **settings**, not code |
| D143 | **No charge for list size** | Unlike Mailchimp, MailerLite and Constant Contact (which price by contact count — e.g. Constant Contact Standard $110/mo at 5,000), **tenants are never billed for how many subscribers they store.** Stored contacts cost CDS effectively nothing; sending is what costs, and D142 already scales with it. "**Unlimited subscribers**" is a selling point. Guardrails, not fees: lists above **25,000** trigger a conversation with CDS (single-writer SQLite and shared SES reputation, D61/D114), and a **list-cleanup tool** flags long-unengaged and bounced addresses |
| D144 | Booking: staff, services, resources — **resolves Q10's core** | Many staff, each with their own schedule. A service lists **which staff can perform it**, duration and price. A service may require a **resource** (e.g. one laser, a treatment room) with a **capacity**; a time is offered only when a **qualified person and every required resource** are free — so laser bookings never overlap. Full proposal: `.planning/design/BOOKING-PROPOSAL.md` |
| D145 | Staff self-service | Each employee gets a **limited login** (an org member with a staff grant, TEN-07) to write their **bio**, upload their **photo**, and manage their own schedule and time off. Bios and photos **feed the "Our Team" section automatically** |
| D146 | CDS never processes tenant payments — **confirms D51** | Online booking payments go to the tenant's **own Stripe** (an existing account can be connected). Tenants on Square, PayPal, Clover etc. use **pay-in-person**. Other gateways are built only if several tenants ask — *revised by D296: a core gateway interface, with a Square adapter in v1.1; other gateways still pay-in-person until an adapter is built on demand* |
| D147 | Booking coupons | Coupons live **in booking, not the gateway**, so they work with any payment method: code, % or $ off, applicable services, expiry, one use per client. Online → applied to the charge; in person → shown on the booking. The engine is reused by the Store later — *superseded by D251 (core discount engine)* |
| D148 | Invite back with a personal note | After a visit the client receives a **personal note from the person who served them**, a **"Book again with [name]"** button, and optionally a **next-visit coupon** |
| D149 | Booking proposal sections 2–5 accepted | Accepted in full from `.planning/design/BOOKING-PROPOSAL.md`: **money** (deposits, card on file, cancellation policy agreed at booking, self-service reschedule, refunds, tips attributed to staff), **retention** (rebook rhythm, one-tap rebook, review request → Testimonials, birthday offer, waitlist), **daily operations** (reminders, buffer time, service add-ons, walk-ins, all-staff day view, shop hours and holidays, Google Calendar sync, no-show tracking), **client records** (history, private staff notes, intake and consent forms, prepaid packages, optional client login). Section 6 (owner reports) awaits a decision — *revised by D250: packages move to the core stored-value layer* |
| D150 | Booking — deferred past v1.1 — **SMS reversed by D160** | **SMS reminders** (per-message cost; a paid capability under D121), **gift cards**, **processing-time gaps**, **commission/payroll**, **Square/PayPal integrations** |
| D151 | Owner/manager staff page + reports — **accepts proposal section 6** | The owner or manager gets **their own page for monitoring employees**: schedules, bookings, and **reports** — **revenue and tips per staff member**, **rebooking rate per staff member**, **no-shows and late cancellations** |
| D152 | Chair / booth renters — **designed in D162–D165** | Some salons and barbershops **rent chairs** to independent stylists, so staff need a **type**: employee vs booth renter. Renters often keep their own clients and money, which may change who is paid and what the owner sees (Q11) |
| D153 | Booking is the **premium product** | Booking is positioned as the premium add-on, competing with Mindbody, Boulevard and Vagaro **plus** the website, newsletter and CDS services they lack, and **no CDS transaction fees** (D51). **Suggested** tiers by staff count: **Solo (1) $49/mo · Team (2–5) $99/mo · Studio (6+) $179/mo** (**renamed by D180: the 6+ tier is now Large Team**; the product is now **Studio Booking**, D177) — final numbers set at launch. A **competitor comparison** is kept ready to show value |
| D154 | **Premium services are monitored — a standing rule** | **Every premium add-on** (Booking first, and every premium service added later) ships with the **same monitoring and recovery standard**, and is **not complete without it**: **(1)** automatic health checks per tenant that has it installed (their booking page loads, a booking can be made); **(2)** early-warning signals — error rates, slow database writes (the D61 single-writer risk), failed emails/payments, disk and memory; **(3)** **alerts to CDS staff** before tenants notice; **(4)** a **monitoring view in the staff console** showing each premium tenant's health; **(5)** **frequent off-server backups with a rehearsed restore**, and a written **recovery runbook** so a tenant is back up quickly. The add-on manifest marks it `premium`, and the registry refuses a premium add-on that declares no health checks |
| D155 | **Fail-safe capture — never lose a booking during an outage** | When the booking system is unhealthy, the booking page **automatically switches to a simple request form** instead of failing: name, contact, service, preferred staff and times. Each request is **emailed immediately to the owner and the chosen staff member**, the client gets **"We received your request — we'll confirm shortly"**, and the request is **stored outside the main database**. When the system recovers, requests appear in a **"Pending requests" inbox** and become real bookings **in one click**, with a conflict check. No deposit is taken in fallback mode. **The fallback must not share the failure**: it runs **off the main server** (CDS controls DNS, D56, so traffic can fail over), otherwise a whole-server outage would take the form down too. Part of the D154 standard for every premium add-on. Target recovery: **~15 minutes** |
| D156 | **Principle: premium services never cost tenants money** | A tenant runs their business through a premium service, so an outage must never lose them a sale, a client or a message. **Every premium add-on must define, before it ships, what happens when each part it depends on fails** — the database, the server, email, payments — and provide a **fallback that keeps the business running**. D155 is Booking's; others follow the same pattern (e.g. Newsletter: queue and retry, never lose or double-send a campaign; payments down: booking held as unpaid, not refused). **Fallbacks are tested, not assumed** — each is exercised in a rehearsed outage before launch |
| D157 | Premium recovery objectives + alerts | **Worst-case data loss: 1 hour** — backups of premium data run **at least hourly**, stored off the server. **Recovery target ~15 minutes** (D155). Alerts reach CDS staff by **email and text**; **phone push** is wanted but **still to be discussed** (Q12). **Alert channels revised by D174: web-app push + email, no SMS** |
| D158 | Contracts — month-to-month at certain service levels — **settled by D180: every plan is month-to-month** | Tenants get **month-to-month** terms **at certain service levels** — a deliberate contrast with Mindbody's reported 24-month contracts. **Which levels, and the terms for the others, are still to decide** (Q13). Tenant data can be **exported free at any time** (D7, TEN-10) |
| D159 | Solo Booking stays $49 — no cheaper bundle | Solo is **not discounted** to match GlossGenius/Vagaro/Booksy (~$28–30 with a site). CDS competes on **value, not price**. Levers that do not cheapen the product — free migration, founding-customer rate lock — are proposed in `.planning/research/BOOKING-STRATEGY.md` |
| D160 | SMS reminders move into **v1.1** — **reverses part of D150** | SMS reminders ship with Booking in v1.1 as a **metered paid capability**, priced like the newsletter (allowance + overage, D142). They are the #1 no-show reducer and 5 of 8 competitors have them. Gift cards, processing gaps, payroll and other gateways stay deferred — *superseded by D265 (SMS deferred to v2)* |
| D161 | Launch offers | **Free migration** ("we move you over" from their current booking system) for the first cohort, and a **founding-customer rate lock** — early tenants keep their launch price for **2 years**. Neither discounts the product (D159) |
| D162 | Chair renters — **all through the house** (resolves Q11) | Every chair renter's bookings are paid through the **salon's own Stripe**. The system keeps a **statement per renter**: sales − refunds − house fee = amount owed, on a payout schedule the owner chooses; the owner pays out their own way and marks it paid (CDS never moves the money, D146). The **house fee** is set per renter — % per sale, flat per sale, fixed rent, or a mix. **Tips go 100% to the renter.** Renters **pay CDS nothing**; each counts as a staff seat in the salon's tier. A renter sets their own services, prices, hours, coupons and invite-back notes, and sees only their own clients, bookings and money (an extra privacy layer inside the tenant, tested like TEN-03) |
| D163 | The tenant owns every list | All clients and newsletter contacts generated by **employees and chair renters belong to the tenant** (the salon) — the service happened under its roof and reputation. Each renter's clients carry a category, e.g. **"Stylist: Maria"**, so the salon knows whose they are |
| D164 | When a renter leaves — **the salon decides** — **exit-time choice replaced by D166** | The renter's login closes and their future bookings are flagged for the owner to reassign or notify. The owner then chooses: **(a) release** the renter's category so the contacts move with them — **only into the renter's own CDS site**, as an owner-approved, audit-logged transfer (the one sanctioned exception to tenant isolation), with each contact receiving a double opt-in confirmation from the new business (D132); or **(b) absorb** — the contacts stay with the salon and the renter takes nothing |
| D165 | Renter spin-off via tenant referral — **amount set by D167; referral gate replaced by D168** | A departing renter who wants their own website gets a **discount on their own CDS site — only when referred by the salon tenant**. The referral is what unlocks it. Discount amount and any reward to the referring salon **not yet set** |
| D166 | Renter lists — **decided up front, replaces D164's exit-time choice** | Each renter has a **list setting chosen by the salon when the renter joins**, visible to both, and not changeable on the way out: **(a) Salon owns all (default)** — every contact belongs to the salon and the renter leaves with nothing; **(b) Renter keeps their own list** — the renter's clients form a list the renter owns, which the salon can also use while they work there; on exit **the salon keeps everyone on its list and the renter keeps theirs**. A kept list moves only into the renter's own CDS site or as an export, and its contacts get a double opt-in confirmation from the new business (D132). Renter login closes and future bookings are flagged for the owner (as D164) |
| D167 | Renter spin-off discount — **sets D165's amount** | **25% off the setup (build) fee and the first month of Care Plan free.** No reward to the salon for now — departures are often not amicable |
| D168 | Independent-pro offer is **public and neutral** — **replaces D165's referral-only rule** | The D167 offer is a **standing public offer on the CDS hub**: anyone who has worked inside a CDS-powered business and starts their own gets 25% off setup and the first month free. **Salon owners are told up front** in the agreement they sign (D80). **CDS never contacts a departing renter or staff member**, and **never uses a tenant's data** (staff roster, renter contacts) for its own marketing. People learn of it from the hub or the "Powered by CDS" footer. The owner may click **"Introduce to CDS"** when someone leaves on good terms, but the **discount is the same either way** — the salon neither grants nor blocks it |
| D169 | **Moving a tenant's domain is a built-in platform operation** | A CDS admin changes **where a tenant lives** (preview → live domain at Launch, or old domain → new domain later) from the staff console, and the platform does the rest: **(1)** writes the DNS records through the DNS provider's API (D55), **(2)** registers the hostname with the proxy so the certificate issues on demand (DOM-06), **(3)** waits until DNS resolves and HTTPS returns 200, **(4)** only then switches the organization's primary hostname, **(5)** 301-redirects the old hostname to the new one, keeping paths, and **(6)** writes it all to the audit log. Each step shows its status in the console. On failure it stops and the site stays on its current domain. **No SSH, no hand-edited proxy config, no manual DNS.** This is a *domain move*, not a registrar transfer: D56 still holds. The reference sequence is how the dev environment was stood up by hand on 2026-09-24 (DNS API → proxy route → cert → health check) |
| D170 | **Preview address kept (D57), clearly marked as a preview** | `<tenant>.sites.connectionsdesignstudios.com` stays as the build/preview URL. Every page served on a preview hostname shows a **thin strip across the top**, e.g. **"Preview: this site is in development and not live yet."** It can't be dismissed, sits outside the tenant's design (platform chrome, not a section), and **never appears on the live domain**. Preview hostnames are also **`noindex`**, so search engines never list the CDS-branded address. Tenants always go live on their own domain (D54) |
| D171 | **Backups: one Wasabi bucket, two layers** | One bucket, **`cds-platform`**. **(1) Whole-database snapshots** in `platform/db/`: the disaster-recovery copy, nightly, and **hourly** while any premium add-on is installed (D157). **(2) A folder per tenant**, `tenants/<org-id>/`, holding `exports/` (a nightly export of that tenant only, D7) and `media/` (its uploads). The per-tenant export exists because the database is shared (D5): restoring the whole snapshot to fix one tenant would roll back every tenant. Folders are keyed by **org ID**, never domain or name, because domains move (D169). **Retention is 90 days** for backups and exports (**live `media/` is excluded, D223**), since Wasabi bills a 90-day minimum per object anyway. Restores are rehearsed (D154). Dev backups use `dev/db/` in the same bucket |
| D172 | **Launch review: the owner approves the whole site before it can go live** | The tenant's half of launch, ahead of CDS approval (D26). The **"Ready to launch →"** button stays **locked** until all of these are done: **(1)** every page reviewed: the preview strip (D170) shows **"Page 3 of 7"** with **✓ Looks good / ✎ Needs a change**; **(2)** "Needs a change" opens a note on that page and sends CDS a change request with the page attached; **(3)** the **key facts** confirmed on one screen: business name, phone, email, address, hours; **(4)** a **phone check**: a QR code opens the preview on a phone, then the owner ticks "Checked on my phone"; **(5)** a **test form** submission, confirmed received; **(6)** no open change requests. The final screen reads *"Your site goes live at **yourbusiness.com**."* **(7)** CDS gives final approval, then the domain move runs (D169). **Editing a page after approval resets it to unreviewed.** Every approval is audit-logged with who and when |
| D173 | **CDS is not an email provider — tenants bring their own** (resolves Q8, completes D111) | CDS hosts **no mailboxes** and resells none. Onboarding asks **"Where should your email go?"**: one address used for everything by default, with a **"use a different address for…"** override per type: **website inquiries** (more than one address allowed), **newsletter** (sender name + reply-to), **billing from CDS**, and **account & support**. Each address is confirmed with a **one-click email**, which also counts toward the launch key-facts check (D172). A bouncing address raises a **dashboard warning**. Platform mail goes out through **SES under the business's name**, with **Reply-To** set to the tenant's address. It is never sent *as* `@gmail.com`/`@yahoo.com`, because those providers reject mail sent from other servers. Tenants with their own domain can send from it (D112). For tenants who want a professional address, a **how-to (D110)** walks them through getting one in **their own** account (Hostinger, Google, Zoho…), and the platform adds the DNS records. **Rejected:** mailboxes on CDS's Hostinger Cloud plan, because they are free for year 1 only, then billed per mailbox to CDS's account, and they would make CDS the email support desk |
| D174 | **Staff alerts: a monitor web app with push, no SMS** (resolves Q12, **revises D157's alert channels**) | CDS builds a **monitoring web app**, installed on the staff phone Home Screen, hosted on the **third VPS** (`31.97.136.23`, idle today) so it watches the platform **from outside** and survives a platform outage. It checks the platform and premium services (D154) and on a critical problem sends a **web push** (*"CDS: booking system down. Tap to open"*) that opens the app on that issue. **Repeats every 15 min until acknowledged.** **Email via SES** is the free backup channel. A **free external check-in service** alerts if the monitor itself stops. **No SMS / Twilio for staff alerts** (cost). Known limit: web push cannot break through Do Not Disturb, so allow the app through Focus settings; **Pushover** ($5 one-time) can be added later for guaranteed night alerts. The same VPS is the natural home for the fail-safe capture form (D155) |
| D175 | **The platform publishes a monitor status contract, and keeps a brief for the monitor app** | The platform exposes one read-only endpoint, **`GET /api/monitor/status`**, authenticated by a dedicated **`MONITOR_TOKEN`** (never a user login). It returns overall health, components, tenants (IDs, names, domains, premium add-ons), premium-service health (D154), fail-safe state (D155), backup freshness (D171), email reputation (D114), failed payment webhooks, and service mode. **No tenant content or personal data.** A missing or unknown token gets 404. Fields are added, never renamed. The spec lives in **`.planning/design/MONITOR-APP-BRIEF.md`**, which any change to something monitorable updates **in the same commit**, so the monitor app (D174), built later as a separate project, always has a current source of truth |
| D176 | **Two paths: Standard and Studio** | Onboarding starts with a choice of path. **Standard**: practitioners, stores, shops, coaches, anyone whose site doesn't run on staff bookings. **Studio**: service businesses whose clients book services with staff: salons, spas, barbers, estheticians, nails, lashes, massage, tattoo. Inside each path, **"What kind of business?"** shows the **recommended products** for that type, and everything else sits under **"See all add-ons"** (D119: curated, not a Wix). A paint store never sees Appointments or Events unless it goes looking. The path is **configuration, not code** (invariant 2): it decides which products are offered. How the D25 build prices ($1,500 / $3,500) map onto the paths is **not yet set** |
| D177 | **Booking terminology, and Appointments and Studio Booking kept strictly separate** | Three words, one meaning each. **Appointment** (**Appointments** add-on, Standard path): a customer picks a person from a list, then an open fixed-length slot. **Booking** (**Studio Booking** add-on, Studio path only): a client books a **service** with a **qualified staff member** inside their schedule and the shop's hours, with service length, resources, deposits and renters. This is the D144–D168 design, formerly called just "Booking". **Registration** (**Events** add-on): many people sign up for one scheduled event. **Appointments and Studio Booking are separate add-on packages** (`appointments`, `studio-booking`) that share **no logic** (invariant 4). The only shared pieces are generic UI from `packages/ui`. They are **never offered on the same path** |
| D178 | **Appointments: the spec** | **Slot length** is set by the site owner for the whole site, **default 30 minutes** (no per-person lengths; the owner handles preferences). The owner keeps **one list of people**, internally **Hosts**, with the **label chosen by the owner** ("Readers", "Consultants"…), and that label flows through the whole site and its emails ("Choose a reader", "Your reader: Maria"). Each person gets **available times** ("Maria, Saturday 11–4"). **Appointment types** are optional and **site-wide**, each with a **length** in slot steps and a **price** (free or fixed). Payment per type is either **Pay at the visit** (default; the time is just reserved) or **Pay online when booking** (the tenant's own Stripe, no CDS fee, D51/D52). **Customer path:** type → person → open slot → contact details → pay or reserve → confirmation email. **No** services menu, per-person qualifications, work schedules, resources or renters: those belong only to Studio Booking (D177) |
| D179 | **Appointments and Events pricing** | **Appointments $19/mo · Events $19/mo · both $29/mo**, kept cheap on purpose. A new owner's first appointment type comes **pre-filled** as *"30-minute session · $30"*, ready to edit — *revised by D308: Events is free; Appointments stays $19* |
| D180 | **Terms and the Studio package** (resolves Q13, settles D158) | **Every plan on both paths is month-to-month**; **paying a year upfront gets 2 months free**. **Booking products are their own subscription** (own line and receipt, upgraded, downgraded or cancelled without touching the site plan; dropping one disables and retains, D27). **Studio includes Newsletter and the landing page builder** at no charge; they are not shown as add-ons on the Studio path. **Newsletter overage still applies** past the 10,000 included emails ($0.002 each, D142), because sending costs real SES money. **Studio Booking tiers** (**renames D153's tiers**) are priced by team size with **identical features in every tier**: **Solo** (1) $49 · **Team** (2–5) $99 · **Large Team** (6+) $179. Chair renters count as seats (D162) — *revised by D263: one subscription per tenant, not a separate Booking subscription* |
| D181 | **Build fees: fixed per path, pay in full or in 6 payments** (**revises D25's "from" prices**) | The build fee is a **fixed price per path**, shown before commitment (core value): **Standard $1,500** and **Studio $3,500**. Checkout offers **Pay in full** first, then **6 monthly payments with no surcharge**: Standard **6 × $250**, Studio **6 × $583.33**, on the same monthly bill. **Priced extras** are ticked in the configurator (copywriting, logo design, sourced photos, rush launch; extra pages moved to D185). **Care Plan $99/mo on both paths.** If a tenant cancels the monthly plan mid-way, the **remaining build payments are still owed**, because the site was delivered; this goes in the agreement (P8). **Studio scope** also covers Studio Booking set up (staff, services and hours imported by CSV), Newsletter and landing pages set up, and free migration (D161). Prices hold after competitor review: competitors' "free setup" is do-it-yourself software paid for by card processing and commissions (D182) — *revised by D299 and D300: the Care Plan is an optional $99 upgrade; the monthly base fee is Standard $39 / Studio $49; build fees unchanged; the Shop path starts at $0 or $499* |
| D182 | **Sales pitch: show how competitors make their money** | The hub's pricing and Studio pages carry a comparison, **"How they make their money, and how we don't"**: competitors' setup is free because they take **card processing on every sale** (~2.3–3.6%), **marketplace commissions** (Fresha 20% of a new client's first sale, Booksy Boost 30%), **stacked paid add-ons** (Vagaro reportedly ~$200+/mo) and **long contracts** (Mindbody ~24 mo, Boulevard 12 mo). CDS charges a **one-time build fee** and **never takes a cut of the tenant's sales** (D51, D52), month-to-month (D180). Include a simple calculator: *"Your monthly card sales → what processing costs you elsewhere."* **Every competitor claim is sourced, dated, and re-verified before publishing and at least every 6 months**, because comparative advertising must be accurate. Source: `.planning/research/BOOKING-COMPETITORS.md` — *extended by D296: the copy and calculator must state that the tenant still pays their own gateway's fees* |
| D183 | **Tenants build their own pages; CDS builds the first version** (resolves Q5; **revises D24, D72 and invariant 7**) | **CDS builds the first version**: a **fully laid-out home page plus one additional page**, so the tenant sees the theme carried across the site. The tenant signs it off in the launch review (D172). **After launch the tenant is responsible for content.** **Every page, the home page included, is editable by the tenant** in the page builder: add pages, add, reorder and remove blocks. **The theme is fixed per site** (colors, fonts, button styles; D44–D47), and every block renders from it, so tenant pages stay on-brand without a design eye. **No page templates.** Instead there are **suggested blocks**: preset layouts such as *About: photo left, bio right* (a preset `columns` block, invariant 6), and **data-bound add-on blocks** that fill themselves, such as **Our Team** (Studio), which lists the staff entered in Studio Booking and updates as staff are added. CDS still assembles the first version from intake with templates and named slots (§10); named slots are the **starting content**, not a limit on the tenant — *on the Shop path, revised by D301: a $0 tenant starts from a library theme through the self-serve wizard, and CDS builds only on the $499 setup or the $1,500 custom build* |
| D184 | **Restore previous version** | Because every page is tenant-editable (D183), each page keeps its **last 10 saved versions** with **"Restore previous version"**. It protects the CDS-built pages and means a bad edit never needs a support ticket. Restoring is itself a saved version, so it can be undone — *revised by D254: versions are written on publish, not save* |
| D185 | **Pages: 10 included, then +5 for $10/mo** | Every site on **both paths** includes **10 pages**. On the 10th, the **"Add page" button is replaced** by *"You've used all 10 pages included with your site. Add 5 more pages for $10/month."* with a one-click purchase, after which they keep building. Repeatable in packs of 5. **Removes "extra pages" from D181's one-time extras** |
| D186 | **Add-ons: free setup at signup, $25 after launch** | Add-ons chosen **during signup** carry **no setup fee**, only their monthly price, so the setup screen can say *"Add it now, setup is free."* An add-on added **after the site is launched and approved** costs a **$25 setup charge plus the monthly price prorated to the end of the month**; from the next month it is billed in full **with all the other charges** on the one monthly bill. Installing is still instant (invariant 3) |
| D187 | **Backups and versions are JSON in Wasabi, not database rows; published pages served from JSON** | To keep the database small and its load low, **snapshots are JSON files in object storage** (bucket `cds-platform`, D171): **page versions** (D184) at `tenants/<org-id>/versions/pages/<page-id>/<timestamp>.json`, **add-on pre-import backups** (D125/D126) at `tenants/<org-id>/backups/<add-on>/`, and **per-tenant nightly exports** (D171). The database keeps only current data. **Publishing a page also writes its published JSON**, and the public site renders from that cache, so visitor traffic does not hit the database. **Security, deny by default:** a snapshot writes only an **approved field list per collection**; anything unlisted, including new fields, is left out. **Never included:** passwords or hashes, auth or session tokens, API keys, Stripe/SES/SMTP credentials, or any auth collection (D8, D53). The bucket is private and encrypted, and files are read only through the platform, never by public URL. A test snapshots a record carrying a password and an API key and **fails if either appears**. **Exception:** the whole-database disaster-recovery snapshot (`platform/db/`, D171) stays a full encrypted database backup, because only it can rebuild auth after a server loss; it is never used for everyday restores |
| D188 | **Core SEO baseline, built into every site and the page builder** (not an add-on; paid SEO services stay Q6) | **(1) Server-rendered HTML** for every public page; D187's JSON is internal storage and bots always get full HTML. Blocks emit semantic markup, with **exactly one H1 per page, enforced** by the builder. **(2) A per-page SEO panel**: title, meta description, URL slug and share (Open Graph) image, **pre-filled with suggestions**, plus a green/amber checklist (missing description, title too long, no H1, missing alt text). **(3) Images**: alt text requested on upload; automatic resizing and modern formats. **(4) Structured data (JSON-LD, schema.org)** generated from data tenants already enter: the business type (e.g. HairSalon, DaySpa, LocalBusiness), address, hours, services, events, team and FAQ, plus BreadcrumbList. **(5) Sitemap.xml and robots.txt** per site, automatic; preview hostnames stay noindex (D170). **(6) Renaming a page's URL auto-creates a 301 redirect** from the old URL, so tenant edits (D183) never break search links; domain moves redirect too (D169). Canonical URLs on every page. **(7) AI search**: AI crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) are allowed by default with a per-site toggle; an **llms.txt is auto-generated** but **never sold as an SEO feature**, because Google's June 2026 guidance says it has no effect on rankings or AI Overviews. **(8) Speed and mobile**: every block is mobile-first, and a Lighthouse performance check runs in CI and **fails the build** when a page drops below the threshold |
| D189 | **Free Site Report in every site** (covered by the build fee and Care Plan, not an add-on) | The dashboard shows one broad report from three sources: **(1) GA4** behind a **cookie consent banner** (Consent Mode): visitors, sources, top pages, devices; **(2) built-in, cookieless platform metrics**: page speed scores from real visitors (Core Web Vitals, via the DCR `WebVitalsReporter`), the D188 SEO health score, form submissions, 404s; **(3) Search Console**: the searches that showed the site. One line explains that GA4 only counts visitors who accept cookies, so its numbers run lower. A **monthly "Your site this month" email**: five lines and one tip. Extends D59 |
| D190 | **Search-engine indexing is automatic; staff console is the backup** | **IndexNow** is pinged on every publish, reaching Bing, Yandex, Seznam and Naver instantly (and DuckDuckGo, Yahoo and ChatGPT search, which draw on Bing). **Google** has no push option for ordinary pages (sitemap ping retired; Indexing API is jobs/livestreams only), so the sitemap is **submitted through the Search Console API** at launch and after a domain move (D169), with `lastmod` updated on every edit; the sitemap is also submitted to **Bing Webmaster Tools**. The **staff console** shows per-tenant indexing status (last ping, sitemap status, pages indexed), a **"Resubmit now"** for one tenant or all, and a **weekly scheduled resubmit** as a safety net. Tenants do nothing |
| D191 | **Growth: one comprehensive SEO + marketing add-on, never piecemeal** | Paid SEO and marketing are sold as **one package, "Growth"**: **SEO Pro** (D192), **Google Business Profile sync** (D193), **review requests** (D194) and a **monthly "what to do next" report**. **$50/mo; Studio tenants 50% off ($25/mo)**, consistent with Studio bundling Newsletter + landing pages (D180). Do-it-yourself with AI; no done-for-you staff tier. Pitch: **"agency SEO, one tap at a time"** (agencies charge ~$300–1,000/mo). AI-written descriptions alone are table stakes (Wix, Squarespace, GoDaddy); the advantage is AI that **uses the tenant's real data** and **tells them the next task**. Social media tracking is **not** in Growth (Q14). Resolves Q6 |
| D192 | **SEO Pro: AI that knows the business** | Part of Growth. **(1) One-tap rewrite** of titles, meta descriptions and alt text, always shown **before/after for approval**, never auto-published. **(2) "Fix all" screen**: every amber D188 item across the site in one list, approve all at once. **(3) Long-tail keyword finder** built from business type, city, services and the real Search Console queries (e.g. "balayage near downtown Austin"). **(4) A target keyword per page**; the D188 checklist grades the page against it. **(5) "Almost there" alerts**: "You're #11 for X, here's the fix to reach page 1". **(6) Rank tracking** for ~20 keywords over time. **(7) 404 / broken-link watch** with one-tap redirect |
| D193 | **Google Business Profile sync** | Part of Growth. Hours, services and photos are **pushed from the site's data** to the tenant's GBP, so they are entered once. GBP also supplies the **Google review link** used by D194 |
| D194 | **Review requests** | Part of Growth. After a **completed Appointment, Booking or Event registration**, an email asks for a Google review, linking straight to the review box (D193). **Email first via SES, sent as the business (D173); SMS later.** Defaults: sent **2 hours** after the visit; a customer is asked **at most once per 90 days** and **never again once they have reviewed** (where detectable); **the tenant can change both in settings**. Shortcut: **CSV upload of past customers** for a one-time "we'd love a review" send (D120). **No review gating**: everyone gets the same ask (Google bans filtering for happy customers). New Google reviews land in the D106 testimonial pen |
| D195 | **Growth gets light monitoring, not the premium standard** | A Growth outage costs no one money, so D154's full standard does not apply. The monitor app (D174) raises a **warning per tenant** when GBP sync, Search Console, IndexNow or rank tracking fail, via the status contract (D175) |
| D196 | **CDS owns the Google Analytics and Search Console setup; transferred to the tenant on cancel** | By default **CDS creates the GA4 property and Search Console verification under the CDS Google account**; the tenant does nothing and sees the data in the D189 report. Access is **shared with the tenant only on request**. A tenant who **already has GA4** grants CDS access and their existing property is used. **On cancellation, CDS transfers the GA4 property and Search Console ownership to the tenant** so they keep their history. Closes the Q6 detail |
| D197 | **Growth ships in v1.1** | Growth (D191–D195) joins the first catalog, alongside Appointments, Studio Booking and Events, because review requests (D194) are triggered by them |
| D198 | **Tenants run their own social media; the dashboard holds their accounts** | CDS **never posts to or manages** tenant social accounts (Blotato, D105, stays CDS-only). The dashboard has a **"My social accounts"** list, pre-filled with Facebook, Instagram, TikTok, YouTube, LinkedIn, Pinterest, X, Threads, Yelp and Nextdoor, plus **"Add another"** for any other (e.g. Substack, Bluesky) with a name and URL. Entered once, the list feeds the **footer social icons**, the schema.org `sameAs` links (D188) and GBP sync (D193). Free |
| D199 | **Social tracking through tracked links, free** | Each saved account gets a **"Copy link for your <platform> bio"** button that gives a short link on the tenant's domain (e.g. `bellasalon.com/ig`) which redirects with UTM tags, because in-app browsers (Instagram, TikTok) often hide the referrer. The D189 Site Report shows **visits and conversions (bookings, form submissions) by social source**, from GA4 and the built-in counter (UTM first, referrer as fallback): *"Instagram sent 84 visitors and 6 bookings."* **Follower counts are not pulled in v1**: it needs every tenant to connect each platform, and visits and bookings matter more |
| D200 | **"Grow your social": free tips, AI post ideas in Growth** | A dashboard section with a **free checklist of tips** by platform and business type. **Part of Growth (D191)**: **AI post ideas built from the tenant's own site content** (a new 5-star review, an upcoming event, a new service), each with a **"Copy caption"** button; the tenant posts it themselves. Resolves Q14 |
| D201 | **Chatbot: tenant-built, part of Growth, ships in v2.0** | CDS does **not** build or run chatbots for tenants. The chatbot is **built into the platform** (one codebase, invariant 2), **not per-tenant n8n workflows**, and it reads tenant data only through the repository layer (invariant 1). Brain: **Claude Sonnet 5**, behind a provider setting so it can be swapped. **Setup (~10 min):** turn on, pick a voice (Friendly / Professional / Playful, or paste sample posts or emails), choose the hand-off (email me / show phone / leave a message), test in preview, publish. **No training step:** each answer is grounded in the tenant's own platform data (pages, services and prices, hours, staff bios, events, FAQ, policies), so edits apply immediately. Shortcut: a **"Questions I couldn't answer" inbox**; the tenant answers once, the bot learns it, and one tap adds it to the site FAQ block (D188). Answers **only** from tenant data, otherwise hands off; never invents prices or promises; no medical or legal advice. Part of **Growth (D191)**, added in **v2.0** after the booking add-ons it links to are stable. Resolves Q3 |
| D202 | **Chatbot allowance, overage, off switch and spending cap** | Growth includes **200 chats/month**; overage is bought automatically at **+$15 per 250 chats**, with an alert at 80% (same shape as D142). In the tenant's admin: a **chatbot on/off switch** that hides the bubble instantly, and a **spending cap**: "stop at my included chats" or "allow overage up to $X", after which the bot pauses itself |
| D203 | **Chatbot abuse and break-in protection** | Spam is stopped **before the AI is called**, so blocked chats cost nothing and don't count toward the allowance: invisible bot check (Cloudflare Turnstile) before the first message, per-visitor limits (e.g. 20 messages per 10 min, 5 chats a day), a per-site hourly ceiling, message and chat length caps, and a **spike auto-pause** that emails the tenant and alerts CDS staff via the monitor app (D174). Break-in attempts fail by design: the bot sees **only public information plus open time slots**, cannot read customer data, change records or see other tenants. It stays on-topic, suspicious chats are **flagged** in the tenant's chat log, repeat offenders are blocked, and every transcript is reviewable |
| D204 | **The chatbot never books; it hands off a pre-filled booking** | For a Studio tenant with the chatbot, the bot offers open slots ("Maria has 2:00 or 4:30, tap one to book") and a tap opens the **normal booking page pre-filled** with service, staff member and time; the customer confirms there, so deposits, policies and all booking rules apply and there is only one way bookings are made. Bookings that started in chat are **tagged "via chat" with the transcript attached** |
| D205 | **Staff are notified of their bookings** | Studio Booking notifies **the staff member the booking is for, and the owner**, of every new, changed or cancelled booking, with the customer's name, **phone and email**, the service and time, and a one-tap **"Contact customer"**, so they can reach the customer immediately to reschedule. Chat-originated bookings (D204) carry the "via chat" tag and transcript. Email now; phone push later. Fills a gap in D144–D168 |
| D206 | **Appointments notify the person booked too** | D205 applies to **Appointments** (Standard path) as well: the person on the owner-labeled list (D178) the appointment is with, and the owner, get every new, changed or cancelled appointment with the customer's name, phone and email and one-tap "Contact customer"; chat-originated appointments carry the "via chat" tag and transcript (D204) |
| D207 | **Print is a main-CDS-site service, designed after the tenant website side** | Print is a **separate CDS service sold on the main CDS site**, not part of the tenant website platform. Its open details (who orders, pay before/after proof, proof-email archiving, Wasabi vs Drive) **wait until every tenant-website topic is covered** (Q15). Settled now: **platform tenants get a print discount** (amount TBD) |
| D208 | **Where tenants find how-tos** (extends D87, D110) | Four places, all fed by the same how-to steps: **(1) a "?" button on every dashboard screen** that opens the how-to for that exact screen; **(2) a searchable Help center** in the dashboard listing every how-to for the tenant's installed add-ons and core features; **(3) a first-use tour**: the first time a feature is opened, a short skippable click-through points at each control; **(4) showcase videos on the public hub** for sales |
| D209 | **A permanent demo tenant for videos and sales** | One demo organization (e.g. "Bella's Salon") seeded with **realistic, fake** services, staff, bookings, reviews and content. It **resets nightly** from its seed so every recording starts from the same state, and it **doubles as the sales demo** shown to prospects. It **never contains real customer data**, is noindex, and is an ordinary organization under the same tenant isolation (invariant 1); the reset touches only that organization |
| D210 | **Staff can open a ticket for a tenant** (extends D92–D97) | When a tenant phones or emails CDS, staff log it as a ticket **on the tenant's behalf** so nothing is lost. It appears in the tenant's dashboard like any ticket, marked **"Opened by CDS"**, and follows the normal lifecycle (D95) and notifications (D97). Written to the audit log |
| D211 | **Visible ticket numbers** | Every ticket gets a short, human-friendly number (e.g. **#1042**) from one platform-wide sequence, shown to the tenant and staff in the dashboard, emails and staff console, and searchable, so "about ticket 1042" works on the phone or in email. Lookup by number is **scoped to the tenant's organization** in the repository layer: another org's number resolves as not found (404), never as forbidden |
| D212 | **Satisfaction rating on resolve** | When a ticket moves to *Resolved*, the tenant gets a one-tap **👍 / 👎** with an optional comment (dashboard and the resolve email). Staff see results **per agent and overall** in the staff console; a **👎 alerts a Super Admin** to follow up. Rating is optional and never blocks closing |
| D213 | **Funnel order: configure first, "save your quote" with just an email** (resolves Q1 and D85) | **(1)** A visitor starts picking components **immediately**, anonymously, with the live price (D79). **(2)** After the first choice or two a small prompt offers **"Save your quote? Just your email."**: email only, no password. **(3)** That email **captures the lead**; staff see it as an abandoned quote (STAFF-01). **(4)** If they leave, **two reminder emails** (default day 1 and day 3), each with an unsubscribe link and a link that **reopens their exact quote**. **(5)** The **full account and organization are created only at Submit**, with **passwordless email login** (ported from `tarotafterdark`), and the saved quote merges into the new organization. Needs an anonymous quote token with an expiry (default 30 days) and the merge at Submit |
| D214 | **Declining a customer after payment** (resolves Q2 and D86) | **(1)** Most declines are prevented **before payment** by the fit check (D215). **(2)** CDS may decline within **5 business days of payment, before build work starts**; the agreement (D80) says so. **(3)** A CDS decline is **always a full refund**: one action in the staff console refunds through Stripe and **cancels remaining build installments** (D181) and any subscriptions. **(4)** **Super Admin only**, audit-logged with a reason. **(5)** The customer gets a respectful email and dashboard message with a reason category and, where sensible, a referral. **(6)** The organization is marked **Declined**, the preview site is taken down, tenant data is kept **30 days then deleted**; the signed agreement and payment records are **retained** for legal and tax purposes |
| D215 | **Acceptable use: what CDS hosts is stated up front, on multiple fronts** | CDS keeps a list of site types it **will not host** (legal or policy reasons) and types that are **allowed but reviewed first**, in `.planning/design/ACCEPTABLE-USE.md` (list approved 2026-09-24). It is shown **(1)** on a public hub page, **(2)** in a **"Can my site be hosted here?" FAQ box** inside the configurator, **(3)** in the **signed agreement** (D80) with CDS's right to take a site down. **(4)** The intake is **screened at Submit** (keyword list + AI review of the answers): clear matches are **blocked** with an explanation; unclear ones are **held for staff review before checkout**, so CDS knows what the site is before accepting it. **(5)** People can misstate their business, so after launch a live site that breaks the rules is handled by the takedown steps: illegal content or a legal demand means **immediate suspension** by a Super Admin; a guideline breach gets **3 days to fix** (revised by D218), then suspension. Every step is audit-logged and the owner is told by email and dashboard. The list is to be aligned with Stripe's restricted-business list (D51) and the wording reviewed by a lawyer |
| D216 | **Policies signed at signup** (extends D80, D81) | The signing step before payment covers **five policies**: **(1) Service Agreement** (build fee, installments still owed on cancel D181, decline window D214); **(2) Acceptable Use Policy** (D215); **(3) Terms of Service** (platform use, uptime, liability, cancellation, data export); **(4) Subscription terms** (month-to-month, annual discount, a lapse disables but never deletes, invariant 9); **(5) Data Processing Agreement** (CDS stores the tenant's customers' data on their behalf). **One signing screen**: each policy shows a **3-bullet plain-English summary** with the full text one tap away, **one checkbox per policy**, then **one signature**. When a policy's version changes, the tenant **re-accepts at next login**; the dashboard shows which version was signed and when. Final wording reviewed by a lawyer |
| D217 | **Template site policies for tenants, with a legal warning** | For **ease of use**, the platform supplies **templated Privacy Policy and Terms pages** for each tenant's site, written from the add-ons they have installed (e.g. Booking adds booking data, Newsletter adds email) and updated when add-ons change. They carry a **prominent warning**: **CDS is not a law firm and gives no legal advice**; the templates are a starting point and **the tenant must have them approved by their own legal counsel**. The tenant must **tick an acknowledgement** before the pages can be published |
| D218 | **Guideline breach: 3 days to fix** (**revises D215's 7 days**) | Tenants are warned up front, in signup questions and the signed policies, which sites CDS does not serve, so a **guideline breach notice gives 3 days to fix**, then suspension. Illegal content or a legal demand is still **immediate suspension**. Reviewing live, published content for compliance is its own design topic (Q16) |
| D219 | **Video item in the page builder** | A **`video` item in `columns`**, alongside `image`, so it can be full-width or in any split (invariant 6). **One input, two ways in:** **choose an MP4 from the media library**, or **paste a link from an allowed source only**: **YouTube, Vimeo, Wistia, Loom, Facebook, Instagram, X, TikTok**. Any other link is refused with *"Upload it as an MP4 instead."* **Shortcut:** the field accepts any link form people copy (`youtu.be`, `/shorts/`, `/watch?v=`, share links) **and pasted `<iframe>` embed code**, detects the source, and shows a **live preview** at once; for YouTube the thumbnail becomes the cover automatically. **Settings:** title (**required**, like alt text), cover image, aspect ratio (16:9 / 9:16 / 1:1), autoplay (**muted only**), loop, controls. **Built in:** a **click-to-play cover**, so no player loads until pressed (speed, D188); YouTube via **`youtube-nocookie.com`** and Vimeo with **`dnt=1`** (privacy, D189); **`VideoObject` JSON-LD** (D188); a **`.vtt` captions** file for uploaded videos |
| D220 | **Uploaded video: MP4 only, compressed automatically** | Uploads are **MP4 only, up to 250 MB per file**. Every upload is **compressed for the web** on our server, and the tenant sees *"We're optimizing your video for fast playback. This takes a minute or two."* A cover image is generated from the video. **The original is deleted once compression succeeds**; the upload screen says so, and the tenant keeps their own copy. Compressing cuts phone video about 5–10×, lowering both storage and delivery |
| D221 | **Site video storage and delivery** | Site videos live in Wasabi at **`tenants/<org-id>/media/video/`** (D171). Published media is delivered through a **CDN** (e.g. Bunny, ~$0.01/GB) that **pulls from the private bucket with origin credentials**, so repeat plays come from the CDN's copy instead of Wasabi. This keeps us within **Wasabi's free-download rule** (monthly downloads should not exceed what is stored) and keeps video traffic off the VPS. **Refines D187 for published media only**; versions, backups and exports stay platform-read-only. **2 GB of video is included per site**, plus **100 GB of delivery per month** under fair use. Above that, CDS staff are alerted and the tenant is shown *"This video is popular. Move it to YouTube to keep it fast."* **No surprise charges.** The staff console shows each tenant's video storage and monthly delivery |
| D222 | **Video storage packs** | Two packs, stackable, on the one monthly bill: **+5 GB for $5/mo** and **+25 GB for $15/mo**. Same pattern as page packs (D185): at the limit, the upload button is replaced by a one-click purchase. **Cost basis:** storage ~$0.007/GB/mo (Wasabi) + delivery ~$0.01/GB (CDN). A 1080p compressed minute is ~20–40 MB. A busy site (10 GB stored, 5,000 plays/mo) costs CDS ~$1/mo; a viral month (1 TB delivered) ~$10. Margins ~82–89%, and both packs cost less than a Vimeo plan (~$12/mo) |
| D223 | **Live media never expires** (**revises D171's retention**) | D171's **90-day retention applies to backups and exports only** (`platform/db/`, `tenants/<org-id>/exports/`, `backups/`, `versions/`). **`tenants/<org-id>/media/` is live content and is excluded**: a file stays while the tenant has it; deleting it from the media library, or deleting the organization, removes it |
| D224 | **Course (LMS) videos are separate and charged monthly** | Videos inside the LMS (D40, D91) are **not** site media: they are **not** counted in the D221 allowance, are **charged monthly** as part of the LMS add-on, and play **only for enrolled students**. Hosting, protection and pricing are designed with the LMS |
| D225 | **Images share the video CDN and allowance** (extends D221, D222; **confirms the D187 exception**) | Published **images and video go through the same CDN**, and the included **2 GB is one media allowance** covering both, so the tenant sees one storage bar. The D222 packs become **media storage packs** (+5 GB $5/mo, +25 GB $15/mo). The D221 exception to D187 is confirmed: **published media only** is CDN-delivered; versions, backups and exports stay platform-read-only |
| D226 | **Bunny is the media CDN; Bunny Optimizer handles images** (settles D221, fulfils D188 (3)) | **Bunny CDN** (standard network, ~$0.01/GB in North America/Europe) serves all published media, pulling from the private Wasabi bucket. **Bunny Optimizer** (~$9.50/mo flat) does the D188 image work: **automatic resizing, phone sizes and WebP/AVIF**, so no image processing load lands on the VPS. Video compression (D220) still runs on our server. Estimated **~$22/mo at 50 tenants (~$0.44 per tenant)**, versus ~$55 for Cloudflare, whose free CDN may not serve video without paid Stream. **Fallback:** if Bunny is down, the platform serves media through short-lived signed Wasabi links (slower, unresized) until it recovers. Prices re-checked before launch |
| D227 | **Video in newsletters, pop-ups and the media library** (extends D219, D118, D131) | **(1) Newsletter:** email cannot play video, so a video dropped into a campaign **automatically becomes its cover image with a play button**, linking to the page it sits on (or to the source link for YouTube, Vimeo and the others). No setup by the tenant. **(2) Pop-ups:** the video item is allowed in pop-ups (e.g. a promo on exit intent); it **plays muted when the pop-up opens and stops when it closes**. **(3) Media library:** no folders or tags; a **filter of All / Images / Videos** is enough |
| D228 | **Gallery block: Grid / Mosaic / Slider switch** | One block, one set of images, three displays: **Grid** (equal tiles), **Mosaic** (**Flickr-style justified rows**: images keep their shape, rows stay even) and **Slider** (uses D229's settings). Tenant sets **images per page** (default 12); overflow goes to **numbered pages with Next / Previous**, never infinite scroll. Click opens a **lightbox** (swipe, arrows, Esc). 2–6 columns, phones drop to 2. Optional captions. **Shortcuts:** drag in or pick many images at once, drag to reorder, **alt text pre-filled from the file name** and flagged amber in the D188 checklist until reviewed |
| D229 | **Slider block: slides built from columns** | Each **slide is a row built with the columns system**, so it can hold any column item (text, image, button, video, testimonial…). Direction **left→right, right→left, or up/down**; navigation **arrows, dots, auto-play**, in any combination; speed 3/5/8 s; slide or fade. **Auto-play pauses on hover and focus, always has a pause button**, and respects reduce-motion. Swipe on phones; **up/down sliders turn sideways on phones**. Shortcut: **"Duplicate slide"** |
| D230 | **Map block** | Type an address or business name, or **paste any Google Maps link**; preview appears at once. **Pre-filled with the business address** from D188, so most tenants do nothing. Height, zoom and a **"Get directions"** button. Google Maps **Embed API: free, unlimited**. Before cookie consent (D189) it shows a **placeholder with the address and a "Show map" button** |
| D231 | **Form builder is core and free; no health data** (Forms Pro scope in a later decision) | Every site gets the form builder free. A **form is a reusable record** (like pop-ups, D118) placed on any page or pop-up. **1 or 2 columns**, any field full width; standard fields; **templates** (Contact, Quote, Intake, Feedback, Job application); **submissions inbox** with CSV export, **email notification** via SES, **newsletter checkbox** (double opt-in, D139); honeypot + rate-limit spam protection. **Blocked:** card numbers, passwords, SSNs. **No HIPAA:** forms are **not for protected health information**. Health practitioners use an **"External form" button/link** to their own HIPAA-compliant service (IntakeQ, Jane, SimplePractice…); the builder shows that tip when a form looks medical, and the Terms (D216) say forms are not for health records |
| D232 | **Table block (free)** | Tenant sets **rows × columns** and types into cells like a spreadsheet: **text, bold, italic, links only, no formulas**. Header row, first column as header, striped rows, per-column alignment; **+ buttons** add rows/columns anywhere, drag to reorder rows. Phones: sideways scroll with a fade hint, or rows as stacked cards. **Shortcuts:** **paste straight from Excel or Google Sheets** (the grid fills and resizes), CSV import/export (D120). **Limit 10 columns × 200 rows** |
| D233 | **Builder Pro: one add-on, $12/mo** (Forms Pro + Pro table; extends D231, D232) | **Forms Pro:** show/hide rules, multi-step with progress bar, **file upload**, auto-reply to the submitter, **route to different recipients by answer**, save and finish later. **Pro table:** **20 columns × 1,000 rows**, header row and first column **stay in place while scrolling**, visitors **sort by column**, **search**, **25 rows per page**, **✓ / ✗ / – icons**, **highlight a column** ("Most popular"), **section heading rows**, set column widths. Priced against Typeform/Jotform/Tally Pro (~$25–35/mo). Setup fee rules follow D186. Unlocked by entitlement (invariant 9: dropping it disables Pro features and retains the data) |
| D234 | **Builder Pro on Studio; form uploads have their own limit** (extends D180, D233) | **Studio includes Builder Pro at no charge**, alongside Newsletter and landing pages (D180); it is not shown as an add-on on the Studio path. **Form file uploads** are private (`tenants/<org-id>/forms/`, never the CDN) and **do not count toward the media allowance (D225)**. Limits: **10 MB per file, 1 GB per site**; types **PDF, JPG, PNG, HEIC, DOC/DOCX**; every file is **virus-scanned** before it reaches the inbox. The tenant is **warned at 80%**; at 100% upload fields are hidden (the form still submits) until files are deleted. Files are kept until the tenant deletes the submission |
| D235 | **Fifteen more free core blocks and settings** (from the Wix gap analysis, `.planning/design/WIX-GAP-ANALYSIS.md`) | Free on every site: **(1) FAQ accordion** (promoted from "later"; feeds FAQ JSON-LD, D188) · **(2) Tabs** (each tab holds column items) · **(3) Icon list** (curated, theme-colored icons) · **(4) Business hours**, data-bound from the hours already entered, with an **"Open now"** badge · **(5) Logo strip** · **(6) Stats counters** (respect reduce-motion) · **(7) Social icons and share buttons**, fed from D198 · **(8) Audio player**: MP3 upload (counts toward the media allowance, D225) or a Spotify / SoundCloud / Apple Podcasts link · **(9) Curated embeds**, allowlist only, never raw HTML or script · **(10) Site search**, over the published JSON (D187) · **(11) Custom 404 page**, editable, suggests popular pages · **(12) Password-protected page**, one shared password per page (full logins stay in the Member portal, D90) · **(13) Favicon and default share image**, generated from the logo · **(14) Free stock photos** (Unsplash/Pexels) searchable in the media picker, credit added automatically · **(15) Accessibility checker** added to the D188 checklist (contrast, alt text, heading order, link text) |
| D236 | **Contacts is free core** | One **Contacts** list in the dashboard of everyone the site touched: bookers, newsletter subscribers, form senders, event registrants, buyers. **Tags, notes and a history** per person, merged by email. Search, filter and CSV import/export (D120). Tenant-owned (D163); behind the repository layer (invariant 1); marketing sends still require consent (D132) |
| D237 | **Language: English platform, tenant content in any language, optional Translate button** | The **platform, dashboard, how-tos and training are English only**; CDS does not translate its own instructions. Tenants **may write their site content in any language**, and a site-language setting sets the page `lang` for SEO. A per-site toggle **"Show Translate button"** adds a small button that opens the visitor's chosen language through Google Translate. It loads **no Google script until clicked** (speed D188, consent D189); Google's embeddable translate widget is legacy/unsupported, so the button links to Google's translation of the page instead. **Site search matches the site's written language** (English by default); no multilingual site add-on |
| D238 | **Commerce features wait for the store discussion** | **Gift cards, packages and memberships, coupons, invoices and quotes, loyalty points and donations** are all shop-shaped and are designed **together with the online store (D89)** in one dedicated session (**Q17**), not piecemeal. Automations (birthday, win-back) are revisited there or with Growth |
| D239 | **Store add-on: $29/mo, Studio half price ($14.50)** (refines D89; spec `.planning/design/STORE-PROPOSAL.md`) | Any tenant can add it; Studio salons get it at **50% off**, matching Growth (D191). Sells **physical products** (variants with own price/SKU, weight), **digital downloads** (private Wasabi `tenants/<org-id>/store/`, expiring links, download limit), **services** (redeemed at a booking), **gift cards** (set or custom amount, **email on a chosen date**, balance usable **in the store and in Booking**), **packages** (prepaid bundles **auto-deducted when the client books**) and **memberships at multiple levels** (recurring through the tenant's Stripe, perks auto-applied). **Nested categories and tags**, WooCommerce-style, many per product, filterable by visitors. Store blocks: product grid, single product, category list, featured. Checkout is **Stripe Checkout on the tenant's own account** (cards, Apple Pay, Google Pay, Link), guest by default, **no CDS fee** (D51, D52). Orders: statuses, packing slips, one-click Stripe refunds, emails at each step, history in Contacts (D236). **Event hosts do not need the store**: paid registration stays inside Events — *revised by D250: gift cards and packages live in core stored value; included in the Shop plan's base fee by D300; timing moved from v2.1+ to v1.1 by D302* |
| D240 | **Store shipping: tenant picks Shippo, Pirate Ship or manual; plus an owner fee schedule** | **Live carrier rates** (USPS, UPS, FedEx, DHL) via **Shippo**, cheapest shown at checkout; **owner fee schedule** (flat, by order total, by weight, free over $X, per zone); **local pickup** and **local delivery radius**. Labels bought and printed from the order screen, tracking emailed. The tenant **connects their own Shippo account**, so label money never passes through CDS (same principle as D51). **Label source is a tenant choice:** **(a) Shippo** (connected): live rates at checkout, labels from the order screen, tracking automatic; **(b) Pirate Ship**, which has no public API: checkout uses the owner fee schedule, **"Export for Pirate Ship"** downloads a ready spreadsheet of **unshipped orders only** (each file dated, so nothing ships twice), and uploading Pirate Ship's **tracking file back** marks the orders shipped and emails customers; **(c) Manual** (post office, any carrier): fee schedule at checkout, tracking typed or pasted into the order |
| D241 | **Sales tax and the tenant-responsibility statement** | Tax: tenant picks **Stripe Tax** (automatic; Stripe bills the tenant 0.5% per order) or **their own rate table** (free); registration and filing are the tenant's job. **CDS verifies nothing** (no license uploads, no CDS review), unlike Shopify's onboarding; **Stripe still verifies identity by law** before paying out. Statement on the store setup screen, the hub and in the agreement (D80, D216): *"CDS provides the software only. You are responsible for any business licenses, permits, sales-tax registration and filing, product regulations and labeling, and age or legal restrictions on what you sell. CDS does not track or verify these."* — *tax choice superseded by D261 (org-level tax setting for every checkout); the responsibility statement stands* |
| D242 | **One discount engine; store tied into Booking** | **Coupons** are one engine shared by **Store, Booking and Events**: codes, automatic sales, % or $ off, first order, minimum spend, expiry, usage limits. **Shortcuts:** import products from **Shopify, WooCommerce or Square CSV**; **"Recommended by your stylist"** (staff add products to a client's visit; the client gets a one-click buy email); abandoned-cart email **with consent only** (D132); automatic **Google Shopping free-listings feed**; duplicate product, bulk price edit. **The store is web-only** (D247) — *revised by D251: the engine is core* |
| D243 | **The Store includes the Member portal** (revises D90's separate add-on) | Memberships (D239) need members-only pages and products, so the **Member portal ships inside the Store add-on** at no extra charge: tenant end-user logins (D53), membership levels, and gating of pages, products and downloads by level. The LMS still builds on the same portal (D91) — *revised by D252: the portal is a shared core package* |
| D244 | **The Store is a premium service** (D154, D156) | The Store takes real money, so it ships with the **full premium standard**: per-tenant health checks, early warnings, staff alerts, a staff-console health view, off-server backups with rehearsed restore, a recovery runbook. **Fallbacks (D156):** **Shippo down** → checkout falls back to the owner fee schedule; **our server or DB down** → payments completed in Stripe Checkout are **reconciled from Stripe** when we recover, so no paid order is lost; **missed Stripe webhooks** → a reconciliation job re-reads Stripe; **store unreachable** → the off-server fail-safe (D155) shows *"Our shop is briefly unavailable; leave your email and we'll let you know"* and captures the request. Added to the monitor brief |
| D245 | **Dropped for now: invoices and quotes, loyalty points, donations** | Not built in the Store or as add-ons. Revisit only if tenants ask. Closes Q17 except inventory |
| D246 | **Store inventory: web shop only, retail stock, one location, barcode or manual** (closes Q17) | Stock tracked **per product and variant**, for **retail products only** (digital, services, gift cards, packages, memberships never tracked; products used during services are not tracked). **Decreases when an order is paid**; items in checkout are **held 30 minutes** to prevent overselling. Per product: **show "Sold out", hide, or allow backorder**. Refunds offer **"Put back in stock?"**. **Every change is logged with a reason** (received, sold online, sold in store, damaged, returned, counted). **Back-office tools that keep the web stock right:** scan with the **phone camera** or a **USB scanner**; **Receive** mode (+1 per scan; unknown barcode opens "New product" pre-filled); **Sold in store** mode (−1 per scan, for tenants whose own POS sells the same items); **Stock count** mode (scan the shelf, see differences, confirm); **generate and print barcode labels**; **CSV import/export**, so stock can be synced from the tenant's own POS export. **Shortcuts:** low-stock alert (tenant threshold, email + badge) and **"Notify me when it's back"** for visitors. One location now; the stock record carries a location so a second one needs no migration |
| D247 | **The store is web-only; a POS is a separate project** | Online orders and in-store sales are **never mixed**: the Store (D239) sells on the website only. Tenants may run **their own POS** in their shop; the D246 back-office tools keep web stock in line with it. A point-of-sale app may be designed **in the future as a completely separate project**; it is **not part of this platform**, and nothing here is built to anticipate it. Revises D242's "order channel" note |
| D248 | **Live-site content checks: scan on publish, staff spot checks, one review queue** (resolves Q16) | **(1) Automatic scan on every publish:** text checked by AI against the acceptable-use list (D215), images by nudity/violence detection (AWS), links by **Google Safe Browsing** (free); roughly **< $0.01 per publish** plus ~$0.001 per image. **Clean** → publishes. **Unsure** → publishes **and is flagged** for staff. **Clearly "never hosted"** → the page is **held**, and the tenant sees *"This page is being reviewed, usually within 2 business days."* **CDS commits to reviewing held pages within 2 business days.** If the scanner itself is down, pages publish and are **queued for scanning** when it recovers (it never blocks a tenant). **(2) Staff spot checks:** **5 sites per week** from a queue weighted to **new sites and recently changed pages**, plus a random sample. **(3) One review queue** in the staff console for scan flags, held pages, spot checks and public reports. Outcomes follow the takedown steps (D215, D218); every action is audit-logged — *revised by D295 (Web Risk, not Safe Browsing) and D270 (scan every public record)* |
| D249 | **DMCA agent, report page and a minimal "Report" link** | CDS **registers a DMCA designated agent** with the US Copyright Office ($6, renewed every 3 years) so it keeps safe-harbor protection for tenant content. A **Report page on the CDS hub** plus an **abuse@ email** receive reports (copyright, scams, illegal content). Every tenant site carries a **minimal "Report" text link** in the footer, the lowest-impact possible (small, theme-muted, beside the copyright line), linking to the hub page with the site pre-filled; it is there **because CDS is the DMCA agent**. The process: notice → content removed or disabled promptly → tenant notified and may send a **counter-notice** → content restored after 10–14 business days unless the claimant sues; **repeat infringers lose their site**. **The signup agreement (D216) outlines all of this**: CDS is the DMCA agent, the takedown and counter-notice steps, the repeat-infringer policy, and the footer Report link that cannot be removed |
| D250 | **Stored value is core: gift cards, packages and credits** (gap A1) | One core stored-value layer holds gift cards, packages and credits. The **Store sells** them; **Studio Booking, Appointments and the Store redeem** them. Replaces the split ownership in D149 (packages in Booking) and D239 (packages and gift cards in the Store), and keeps invariant 4, because no add-on imports another. A Booking-only tenant can sell packages without the Store |
| D251 | **The discount engine is core** (gap A2) | Coupons and discounts are a **core engine**, like Payments (D38), used by the Store, Studio Booking, Appointments and Events. Supersedes "coupons live in Booking" (D147) and gives D242's "one engine" a home that ships before the Store |
| D252 | **The member portal is a shared core package** (gap A3) | The member portal (D243) moves out of the Store into a **core/shared package** that the Store and the LMS each switch on. A course seller does not have to buy the Store |
| D253 | **Published JSON holds block settings; data-bound blocks resolve at render** (gap A4) | The JSON published under D187 stores **block configuration only**. Data-bound blocks (hours / "Open now", Our Team, product grids, events, countdowns, JSON-LD) fetch **live at render with a short cache**. Changes to records and site-wide settings (theme, nav, banner, address) **invalidate the affected pages and ping IndexNow**, the same as a publish (D188, D190) |
| D254 | **A `pages` collection; one publish flow; versions saved on publish** (gap A5) | New **`pages`** collection (organization, slug, title, SEO, password, status); `page_sections` relates to it. **One state machine: draft → publish**, and publish runs the scan (D248) → JSON (D187) → IndexNow. The 10-version history (D184) is written **on publish, not on save or autosave**. Page count (D185), 301s (D188) and password pages (D235) hang off the page record |
| D255 | **Public media gets its own bucket behind Bunny** (gap A6) | **Public media lives in a separate bucket**, and that bucket is the only origin behind the Bunny pull zone. Versions, exports, backups, `forms/` and `store/` stay in the private bucket and are **never reachable through the CDN**. Media on held or password-protected pages uses **tokenized URLs**. Deleting media or a DMCA takedown (D249) **purges the CDN** |
| D256 | **Stripe Connect Standard accounts** (gap A7) | Tenants connect **Standard** accounts: they own the account and dashboard, CDS pays no per-account fee, and leaving CDS (gap D1) needs no migration. Core **PAY-\*** requirements to add: webhook idempotency, reconciliation, and handling of a disconnected or restricted account (`charges_enabled`) |
| D257 | **Business hours and team list live in core** (gap A8) | Hours and the team list are **core settings**. Studio Booking reads them and extends them (shop hours, staff); GBP sync (D193) pushes the core hours; "Our Team" binds to the core team list, so a Standard tenant's team intake has a home |
| D258 | **Chair renters: the salon credits redemptions; only the salon sells retail** (gap B1) | When a salon-issued gift card, package or membership perk (D250) is redeemed on a renter's service, **the renter is paid in full** and the salon's statement (D162) carries a **redemption credit owed to the renter**. A coupon's cost is **borne by whoever issued it**; renters may run their own coupons in the core engine (D251), and those apply only to their services. **Renters do not sell retail**: the Store belongs to the salon, and "Recommended by your stylist" is a recommendation, not the renter's sale |
| D259 | **Core money-safety standard for anything that takes money** (gap B2) | Appointments and paid Events stay **non-premium**, but every checkout gets the core standard: **reconciliation** against Stripe, and the "payments down → booking held unpaid" behaviour from D156 as a requirement. Premium (D244) stays reserved for the Store |
| D260 | **One core refund and cancellation policy model** (gap B3) | A core policy model that each add-on configures (Studio Booking, Appointments, Events, Store, memberships). Defaults: refunds of **gift-card-paid** purchases go **back to the balance**; a **cancelled event refunds everyone in full**; a **membership cancels at period end, with no proration** |
| D261 | **Tenant sales tax is an org-level setting used by every checkout** (gap B4) | Each tenant has one tax setting (**Stripe Tax on their Connect account**, D256), and every item carries a tax category, covering services, appointments, events, memberships and products. **Gift cards are not taxed at sale.** Supersedes Store-only tax (D241) |
| D262 | **CDS charges its own sales tax through Stripe Tax** (gap B5) | **Stripe Tax is enabled on CDS's own Stripe account**, and CDS **registers in Texas** (which taxes SaaS/data processing) for the build fee, Care Plan and add-ons. Add a BILL requirement. **Confirm the treatment with an accountant** before launch |
| D263 | **Billing: one Stripe subscription per tenant with an item per plan and add-on** (gap B6) | Each tenant has **one subscription**, with an item for the plan and each add-on; this supersedes the separate Booking subscription (D180) in favour of "one monthly bill" (D181). **Metered usage** (newsletter, chatbot overage) bills **monthly, even on annual plans**. Changes are **prorated**. Cancelling an annual plan gets **no refund**; it runs to term. A billing-model spec and BILL requirements cover discounts (D161, D167, D168, D207) |
| D264 | **One price catalog keyed by add-on and path** (gap B7) | A single catalog keyed by **(add-on, path)** (Standard / Studio) is the only source of prices. It feeds the add-on picker, billing (D263) and the hub, replacing the manifest / console (STAFF-07) / settings (D142) split and the hand-coded hub prices (D104). Unset prices are filled in a later pricing pass |
| D265 | **SMS is deferred to v2** (gap B8) | SMS (D160) comes **out of v1.1**. Reminders and notifications are **email-only** until v2, when the provider, rates, allowance and 10DLC/TCPA compliance are specified |
| D266 | **Contacts: one record, renter-scoped lists and notes** (gap B9) | A contact is **one record merged by email**. Visibility comes from **list membership, not record ownership**: the salon sees its list, and each **renter sees only the contacts on their own list**, with **private notes** (D162, D166). Renters own their list; D236 applies per list |
| D267 | **Core email classes, suppression list and one post-visit sequence** (gap B10) | A core table classes every automated email as **transactional or marketing**. There is **one core suppression list** for all add-ons, so a Store-only tenant without Newsletter still honours consent. A visit triggers **one post-visit sequence**, and the review request goes **either** to Google (D194) **or** to Testimonials (D149), never both |
| D268 | **Events are allowed on the Studio path** (gap B11) | Studio tenants may add Events under "See all", which supersedes ONB-11's bar. Studio Booking and Appointments stay separate (D177) |
| D269 | **Store loose ends** (gap B12) | Digital downloads get a **quota and retention period**. **Product listings join the D248 publish scan** and are checked against Stripe's prohibited goods. The fail-safe (D155) **captures intent only** and never validates gift cards or packages |
| D270 | **The content scan covers every public record** (gap C1) | The D248 scan runs **on save for every public-facing record**: pages, products, events, testimonials, media, pop-ups, forms, banner, landing pages, blog posts and chatbot answers. **Newsletter campaigns are scanned on send**, which protects the shared SES reputation. Everything lands in the **one review queue** |
| D271 | **D231 is the only form engine** (gap C2) | The signup-form section, the capture, notify and waitlist bands, landing-page QR sign-ups (D134), event forms (D135) and pop-up forms are **all D231 forms**. D231's free newsletter checkbox **stores a consented Contact** even when the Newsletter add-on isn't installed. Supersedes D121's "a sign-up form needs Newsletter" |
| D272 | **Pricing rule restated: capture and display are free; workflow is paid** (gap C3, **revises D121**) | **Free:** capturing and displaying data (forms, Contacts, tables). **Paid:** workflow, anything with a per-use cost, or Pro limits. Replaces D121's "stores business data = paid" |
| D273 | **Only builder-authored pages count toward the 10** (gap C4) | The limit in D185 counts **builder pages only**. Product, category, blog, event, 404, policy, password and other generated pages do not count, and **neither do landing pages**, which are priced separately (D274) |
| D274 | **Landing pages are ordinary pages sold as an add-on** (gap C5) | A landing page is a **`pages` record (D254) flagged as a landing page**: it has the same sections, versions and SEO panel, and it is kept out of the navigation. It is a **priced add-on on Standard**, with the price set in the catalog (D264) |
| D275 | **Items a saved version still uses are soft-deleted; site chrome gets a small history** (gap C6) | A form, pop-up or media file that **any saved page version still references is soft-deleted** (hidden but kept), so restoring that version never breaks. **Nav, footer, banner and settings** each get their own small version history |
| D276 | **CDS builds the home page plus one page** (gap C7) | TMPL-02 and §10 are restated to match **D183**: from intake, CDS builds the home page and one more page, and the tenant builds the rest (or buys build help) |
| D277 | **Search indexes public records; protected pages are excluded everywhere** (gap C8) | Site search, the sitemap, llms.txt and the chatbot (D188, D201) index **public records** (events, products, services, blog) **as well as pages**. **Password-protected and held pages are excluded from all four** |
| D278 | **Media allowance and the Bunny outage fallback** (gap C9) | **Everything a tenant uploads counts** toward the 2 GB media allowance (D225): images, video, audio, Store product images and downloads. Stock photos inserted from Unsplash or Pexels by URL do not count. **Bunny stays the CDN** (D226, reading the media bucket per D255). If Bunny is down, the signed-Wasabi fallback runs **for up to 72 hours**. Staff are alerted when it starts and again at the cap. **After 72 hours, video pauses and shows its poster image while images keep serving**, which protects Wasabi's free-download budget (D221) |
| D279 | **One consent rule for every third-party frame** (gap C10) | **Every third-party embed** (maps, video, audio, curated embeds) waits for consent behind a **click-to-load placeholder**. The **cookie banner always comes before pop-ups**, and there are **no mobile interstitials**. The **Translate link is hidden on checkout and booking pages** |
| D280 | **Heading rules per block and a wider accessibility checker** (gap C11) | Each block declares its heading rules, and **only the hero may emit the H1**, so sliders, tabs and pop-ups never add a second one. The D229 checker adds **autoplay, animated counters and text-on-image contrast**. **Alt text is required on upload**, and a bulk tool handles backfill |
| D281 | **No `custom` section type; core blocks ship how-tos** (gaps C12, C13) | The **`custom` section type is dropped**, so there is no raw HTML (invariant 7, D235 #9). A **core `training/` location** holds a how-to for each core block, tied to its CONT requirement, the core counterpart of add-on training (D87) |
| D282 | **Leaving CDS: one offboarding checklist** (gap D1) | A single process with a **per-add-on checklist** and a **30-day notice period**. **Step one is DNS handback**: the zone is copied back (D58 in reverse) and nameservers are returned **before anything else changes**, so the tenant's email never breaks. A full export (D284) is offered. Gift-card and package balances and future bookings are **honoured through the notice period, then refunded**. Open orders are fulfilled or refunded. Memberships billed on the tenant's own Stripe are **cancelled at period end**. Connect, SES, GBP and Shippo are disconnected, the CDN is purged, and download links expire. An annual prepay gets **no refund** (D263), and a launch rate lock (D161) is lost |
| D283 | **One retention table** (gap D2) | **Cancelled, declined and taken-down tenants are deleted 30 days after the event.** Backups then **age out over the next 90 days**, and this is stated plainly. **A lapsed tenant is held, never deleted** (invariant 9). **Signed agreements are kept for 7 years** (AGR-05). Live media follows D223. The table is cited in the DPA (D216) |
| D284 | **Export field lists per collection; logins restored through disaster recovery** (gap D3) | Every tenant collection gets a **documented export field list**, including Contacts, orders, inventory logs, the gift-card ledger (D250), `forms/`, `store/`, tickets and chat. **Member and client logins**, which D187 excludes from export, are **restored through the disaster-recovery path**, so TEN-12 holds. The tenant gets a **"Download my data" button** (CSV per collection plus a media zip) |
| D285 | **Permission matrix with Staff and Renter base roles** (gap D4) | One **per-feature permission matrix** covering Contacts and form PII, orders, refunds, exports, campaigns, chatbot caps and stock. New base roles: **Staff** and **Renter** (renters see only their own list, D266). **Owner-only:** purchases, refunds, exports, legal acknowledgements, launch approval, Connect changes and DMCA counter-notices |
| D286 | **One owned org per user; staff and renter grants elsewhere are allowed** (gap D5, **relaxes D69**) | A user **owns at most one organization** but may also hold **Staff or Renter grants in other organizations**, so a renter can own their own CDS site, or someone can work at two salons. The dashboard gets an **org switcher**. D69's join table makes this a constraint change, not a migration |
| D287 | **Impersonation deny-list and staff MFA** (gap D6) | While impersonating (D10), staff **cannot** sign agreements, accept policies, approve a launch, buy, refund or change Connect. **MFA is required for every staff account.** Tenants can **see impersonation entries in their own audit log**, and the audit log is **kept for 2 years** |
| D288 | **Domain moves include nameserver delegation and the zone-copy gate** (gap D7) | D169's sequence gains two steps at the start: **copy the existing zone** under the D58 checklist (MX, SPF, DKIM, DMARC and TXT verified), then **the tenant changes nameservers**, then verify, then cut over |
| D289 | **Cloudflare is the DNS provider (free plan)** (gap D8, confirms D55) | Platform and tenant zones live on **Cloudflare DNS (free plan)** and are managed through its API. The preview subdomain (D57) uses a **DNS-01 wildcard certificate**, and Turnstile (D203) fits. **Hostinger DNS is for existing client sites and dev only.** No added cost |
| D290 | **Monitor brief completed before its fields freeze** (gap D9) | The monitor brief (D174, D175) §3/§4 adds: scanner providers and held-page age against the 2-day promise, virus scan, the compression worker, Stripe and Stripe Tax, Connect `charges_enabled`, membership renewal failures, the GA4 Data API, the DNS API, the Wasabi fallback (D278), Unsplash/Pexels, Blotato, and **heartbeats for every scheduled job** (auto-close, reminders, demo reset, 30-day deletion, dated gift-card emails). `addon: "booking"` becomes `studio-booking` / `appointments` **before the fields freeze**. SMS is v2 (D265) |
| D291 | **Fail-safe design note; it stays on the monitor VPS for now** (gap D10) | A short design note will cover **how traffic fails over** (health check → booking page switches to the D155 form), **syncing owner email routing** (personal data, encrypted at rest) to the fail-safe host, and **deleting captured requests 30 days after they are reconciled**. The fail-safe and the monitor **keep sharing one VPS**, so there is no added cost. A separate host is a future cost decision for the user |
| D292 | **One queue map** (gap D11) | Tenant help requests and change requests (D92, D172) go to the **ticket inbox**. Scan holds, fit-check holds and spot checks (D215, D248) go to the **review queue**. **DMCA and public reports go to the review queue as cases**, and they **never open a tenant ticket automatically**; the tenant is notified by email per D249. The polish queue stays in staff tooling |
| D293 | **Demo-mode flag list** (gap D12) | The demo tenant (D209) carries a demo flag that **blocks SES and SMS sends, forces Stripe test mode, and skips IndexNow, scans and the monitor's alerting**. The preview strip (D170) shows in every recorded video |
| D294 | **Tenant Google reviews go to that tenant's Testimonials, not CDS's social pen** (gap D13, **narrows D106**) | Reviews collected for a tenant (D194) go to **that tenant's Testimonials**. CDS's social holding pen (D106) holds only **reviews of CDS itself**, which keeps D168's "CDS never uses tenant data" |
| D295 | **Link checks use Google Web Risk with a budget cap; the metaphysical niche is confirmed with Stripe** (gap D14, **user decision: cost**) | The D248 scan checks links with **Google Web Risk**, because Safe Browsing is non-commercial only. Pricing: **free up to 100,000 lookups a month, then $0.50 per 1,000**. Checks run only on save, so the expected cost is **$0**. The Google Cloud account carries a **budget alert and a hard cap (~$5/mo)**. Separately, **before launch, CDS confirms with Stripe** that metaphysical and psychic businesses (a flagship niche) are acceptable on Connect, and D215's list follows the answer |
| D296 | **CDS is never a payment processor; every website owner brings their own gateway** (**user direction 2026-09-26**; restates D51, D52, D146, D256) | CDS **processes no payments** for tenants' customers, takes **no cut or platform fee**, and never holds tenant funds or chargeback liability. **Each website owner sets up and owns their own payment gateway** (Stripe, Square or another), is the merchant of record, and pays that gateway's fees directly. CDS may **help a tenant set up their own Stripe account** during onboarding. "Stripe Connect Standard" (D256) is only the mechanism that **links the tenant's own account** to their site (direct charges on their account). It never makes CDS a processor, and no `application_fee` is ever set. **Gateways:** Stripe is supported first (v1.0); a **Square adapter follows in v1.1**, behind a core gateway interface so others can be added on demand; until then, other gateways use pay-in-person (D146). **CDS's own Stripe account bills tenants only for CDS's own services** (plans, add-ons, build fees). All sales copy, including the D182 processing calculator, must say the tenant pays their own gateway's fees (e.g. Stripe 2.9% + 30¢ online), and must never imply that processing is free |
| D297 | **Commissioned custom work: four tiers, maintenance and a catalog credit** (**user decision: pricing**; builds on D20, D21, D67, ADDON-09) | Custom work is built **only in the one shared codebase**, never as a per-tenant fork (D15, D16). Tiers: **(1) Design polish** (theme override or block styling): **$110–135/hr**, sold in 3-hour blocks. **(2) Custom block** (a new display-only section type): **$750–2,000 fixed**. **(3) Private add-on** (its own collections, admin, CSV import, training, meeting the full add-on contract): **$3,000–10,000 quoted, 50% deposit**, plus **$25–75/mo maintenance**. **(4) Premium private add-on** (takes money or runs a business workflow, so the D154/D156 standard applies): **$10,000+**, plus **$75–150/mo maintenance**. **CDS keeps the IP.** If CDS generalises the feature into the public catalog, the tenant who commissioned it gets **12 months of that add-on free** and its maintenance fee is dropped. Handled as a **`custom_feature` work order** (D67): quote → deposit → build → acceptance. A dashboard **"Suggest a feature"** ticket type (D92) with upvotes feeds the catalog roadmap. Guardrail: CDS refuses work that could never become generic, and keeps private add-ons to about 1 per 10 tenants. The agreement (D216) gains IP, generalisation, maintenance and end-of-life clauses |
| D298 | **What the $99/mo Care Plan includes** (**user decision**) | Hosting, security, backups, platform updates and monitoring; **support tickets answered within 2 business days**; and **1 hour a month of done-for-you edits**, which does not roll over. Edits beyond the hour are billed at the D297 design-polish rate — *revised by D299: the Care Plan is an optional upgrade* |
| D299 | **Owners do the work; support is built into every plan; the Care Plan is optional** (**user decision 2026-09-26**; revises D25, D181, D298) | CDS is a **do-it-yourself platform with human help available**. Owners build pages, write newsletters and run their store themselves. **The rule: if it can be done in the dashboard, it is the owner's work; if it needs CDS access or something is broken, it is CDS's.** **Support included in every plan:** **(1) platform upkeep**: hosting, uptime, security, backups, updates and monitoring, with anything CDS built fixed free; **(2) how-to help**: tickets answered **within 2 business days** that explain how rather than doing the work, plus the how-to library and training (D87, D281); **(3) technical setup** the owner can't do in the dashboard: domain and DNS, email routing, linking their own payment gateway (D296), sender verification, Google Business Profile connection; **(4) recovery**: page version restore (self-serve) and a restore from backup after a serious mistake; **(5) account and billing**; **(6) safety**: content holds, DMCA, security incidents. **Paid services, not support:** copywriting, design changes, building pages, entering products, writing newsletters, photos, logos, SEO work and custom work, at the D297 rates. **The Care Plan ($99/mo) becomes an optional upgrade** that adds **1 hour a month of done-for-you edits** (not rolled over) on top of the included support |
| D300 | **New monthly base fees; a store-first Shop plan** (**user decision: pricing**; revises D25, D181) | Every site pays a **base platform fee** that includes hosting, support (D299) and 10 pages (D185). Add-ons are priced on top as before. **Standard: $39/mo.** **Studio: $49/mo**, which still includes Newsletter, landing pages and Builder Pro (D180, D234), plus the Booking seat tier. **Shop (new, store-first): $59/mo**, including the Store (D239), Newsletter (10,000 emails, with the D142 overage) and **basic SEO (SEO Pro, D192)**; the rest of Growth stays an add-on. **Upfront:** Shop starts at **$0 on a template** (the owner adds products) or **$499** for CDS to set up the theme and the first 20 products; a full custom build is still $1,500. **Standard ($1,500) and Studio ($3,500) keep their custom build fees.** Worked examples: coach with Appointments + Newsletter = **$83/mo** (was $118); 3-stylist salon on Team Booking = **$148/mo** (was $198); store owner = **$59/mo** (was $128) vs Shopify Basic plus apps at ~$40–115. **Cost to run one site is about $5–8/mo (est.)**, so the margin holds without included labor. Positioning: **"no platform cut on your own gateway"** (D296); Shopify adds 2% when the owner doesn't use Shopify Payments |
| D301 | **Shop templates: one shop layout with a library of ready-made themes the owner picks** (extends D60, D44–D47; decided by Claude under the user's standing rule, no added cost) | **Layout:** one **Shop template** on the D60 slot contract, with: **Home** (hero, featured products, categories, story, testimonials, newsletter sign-up), **Shop / all products**, **category**, **product**, **cart → checkout on the owner's own gateway** (D296), **About**, **Contact**, **FAQ / shipping and returns**, and the policy pages (D217). Pages generated from Store data don't count toward the 10 (D273). **Look:** a **theme library** of **8 ready-made design systems at launch**, authored once by CDS with `impeccable` in the D44 format and grouped by style (e.g. minimal, bold, boutique, natural, luxury, playful). The owner **picks one and previews it live**, then adjusts **tokens only**: logo, brand colour (auto-suggested from the logo by D47's colour extraction), and a font pairing from a short list. **Switching themes never touches content.** **Self-serve start ($0):** a wizard covering business name → logo → pick theme → import products (CSV from Shopify, WooCommerce or Square, D242) → connect their gateway → shipping and tax (D261) → publish, live first on the preview address (D57, D170). **$499 setup:** CDS picks and tunes the theme to the owner's brand and enters the first 20 products. **Upgrade path:** the **$1,500 custom mood-board build** (D45) replaces the library theme **without losing content**. The library is the Shop path's starting point; Standard and Studio keep the custom build (D300). **More themes are added over time, and each one serves every Shop tenant**, which is the §8 "build once" principle applied to design |
| D302 | **The Store and the Shop plan move to v1.1** (decided by Claude under the user's standing rule; the user wants to compete with Shopify) | The Store (D239–D247, STORE-01…11) and the Shop plan (D300, D301) move from **v2.1+ to v1.1**, planned alongside Studio Booking and the Square adapter (D296). **v1.0 is unchanged**, so the first launch is not delayed. The v1.1 Store must ship with the theme library (8 themes), the self-serve wizard, and CSV product import. Shopify-parity gaps stay out of scope: **POS (D247), multiple locations (D246) and an app marketplace (D74)** |
| D303 | **Shop Outreach: automations that run themselves, the "human touch"** (user direction 2026-09-26; decided by Claude, no added cost; extends D242, D251, D267) | A shop should reach out **like an attentive shopkeeper, without the owner configuring anything**. Every automation is **on by default at launch** with pre-written templates in the shop's brand; **the owner edits only the templates**, or switches one off. **Automations:** welcome (optional first-order coupon), abandoned cart (1 h and 24 h), abandoned checkout, thank-you, **"Complete the set"**, review request, back-in-stock, win-back at 90 days, birthday. **Sale alerts:** creating a sale or coupon (D251) **schedules an announcement when the sale starts and a "last day" reminder**, drafted from the sale's products; the owner can edit or cancel them. **"Complete the set":** after a purchase, the customer gets suggestions that go with what they bought. The suggestions come from owner-tagged pairings, then products **bought together** in that shop's orders, the same collection, then bestsellers, and never include items already bought or out of stock. The same logic powers **"Pairs well with"** on product and cart pages. It is **rule-based, with no AI cost**. **Guardrails:** marketing sends go only to opted-in customers (D267); abandoned cart needs consent (D242); a customer gets **at most one automated marketing email every 3 days**. Each automation reports **sent, opened, clicked and revenue brought in**. **Outreach is not the Newsletter.** It is **part of the Store itself** and works whether or not Newsletter is installed. The Newsletter stays the owner's own hand-written campaigns (D131). **Allowance:** Outreach (automations and sale alerts) has **its own 10,000 emails a month included with the Store**, separate from any Newsletter allowance. Beyond that, the D142 rate applies ($0.002 per email; CDS's SES cost is $0.0001). |
| D304 | **Shop Outreach email templates** (user-approved 2026-09-26; no added cost; extends D303, D301, D131) | **CDS writes the default emails once for each shop type** (e.g. candles and home goods, beauty retail, apparel, merch for service businesses). The owner picks their shop type in the wizard (D301) and gets copy that already fits. Templates **inherit the shop's theme tokens** (logo, colours, fonts; D44), so emails always match the site. Each set comes in **two tones, warm or polished**, chosen by the owner. Owners edit in the **same email-safe editor as the Newsletter** (D131), with live preview and "send me a test". **Dynamic blocks fill themselves**: product images, cart contents, sale items and "Complete the set" picks; the owner edits only the words around them. **Updates:** an improved CDS default reaches every owner who **never edited** that template; **edited templates are never overwritten** |
| D305 | **Outreach for salons and practitioners** (user direction 2026-09-26; no added cost; extends D303, D304, unifies D149's retention set and D194) | The D303 model (**on by default, owner edits only templates, D304 templates**) extends beyond the Store, so **"Outreach" is the umbrella name**, and Shop Outreach is its store part. It comes with **Studio Booking, Appointments and Events**. A site has **one Outreach allowance of 10,000 emails a month** however many add-ons use it, then the D142 rate. **Studio (salons):** new-client welcome; **rebook reminder** timed to each service's usual interval (owner sets a default per service, e.g. colour every 6 weeks), a one-tap rebook with the same stylist; thank-you with **"Complete the look"** (products the stylist recommended, plus Store pairings when installed); review request; **openings alert** when cancellations free up slots (opted-in clients, at most one a week); package and gift-card balance reminders (D250); win-back at twice the client's usual interval (or 90 days); birthday offer; sale and special alerts from the discount engine (D251). **Chair renters:** their clients' outreach is **signed by the renter** under the salon brand, uses only the renter's list (D266), and **each renter can switch their own off**. **Standard (practitioners):** welcome after the first appointment; **follow-up with next-session suggestion** at an owner-set rhythm (e.g. monthly reading, 4-week coaching); package balance reminders; openings alert; review request; win-back; birthday; special alerts. **Events:** thank-you after the event with the next one; **"new event" alert to past attendees** of similar events when one is published; waitlist spot opened. **Review requests:** one per visit; they go to **Google when Growth is installed, otherwise to Testimonials** (D194, D267). **Sensitive-practice mode:** for therapy, counseling and health businesses it is **on by default** (set from the business type, and the owner can change it). It switches off **all marketing automations and review requests** (professional ethics codes bar soliciting reviews from therapy clients) and keeps **only transactional reminders**. **Guardrails as D303:** marketing only to opted-in clients, **at most one automated marketing email every 3 days** (transactional excluded), and per-automation results. SMS is v2 (D265) |
| D306 | **Remaining prices set** (**user decision: pricing, 2026-09-26**; completes D181, D297, D300; closes the unset-price list) | **Hourly rate: $125/hr** for every paid service: design changes, edits beyond the Care hour, done-for-you work, and **building pages for an owner ("build help")**, which is hourly rather than per page. D297's polish tier becomes $125/hr. **Copywriting: $150 per page**, with the home page counting as 2 ($300). **Logo design: $600**: 3 concepts, 2 revision rounds, web and print files. **Sourced photos: $15 per photo**, chosen and placed from free-licence sources (Unsplash, Pexels), so there is no licence cost to CDS. **Rush launch** (live in 1 week instead of 3–4): **+25% of the build fee**, i.e. Standard +$375, Studio +$875, Shop setup +$125. **Landing pages on Standard: $10/mo, unlimited**, not counted toward the 10 pages (included on Studio, D180). **Growth on the Shop plan: $25/mo**, because SEO Pro is already in Shop. **Page count stays as D185**: 10 included, then **blocks of 5 pages at $10/mo each** (15, 20, 25…). **Testimonials and Credentials are free core blocks** (D272's capture-and-display rule) |
| D307 | **Three kinds of event: hosted elsewhere, my event in person, my event online** (user direction 2026-09-26; no added cost to CDS; extends D127, D135, D296, D305) | When creating an event, the owner first picks **"Where is it and who runs it?"**. **(1) Hosted elsewhere** ("Appearing at"): the owner is a guest at someone else's event (a reading at a shop's psychic fair, a talk at a studio). **Listing only**: host name and link, venue, date and time, the price shown for information, and a button **"Get tickets from [host]"** linking to the host's page, or a **"Pay at the door"** note. **No registration or payment on the owner's site**, since the host handles it. Visitors can tap **"Remind me"** (email only) to get a reminder the day before, and the event still appears on the events page and calendar, in countdowns (D116), in "Add to calendar", and in the Outreach **"new event" alert** (D305). **(2) My event, in person**: registration free or paid on **the owner's own gateway** (D296), capacity, waitlist, venue with map (D230) and a printable check-in list. **(3) My event, online** (Zoom, Google Meet, Teams, or any link): the same registration and payment. **The meeting link is private**: it never appears on the public page and is sent **only after registration or payment**, in the confirmation, the reminders and the attendee's confirmation page. The owner can **connect their own Zoom account** (optional; Zoom's own plan limits and costs are the owner's) so a meeting is **created automatically** for each event or session, or **paste any link**. Times show in **each visitor's own time zone**. After the event, an optional **replay link** goes to registrants only. **Teaching series:** a multi-session class ("6-week Tarot Foundations, Tuesdays on Zoom") is a recurring event (D127) sold as **one ticket for all sessions**, with every session's link and reminder sent automatically; full courses with videos remain the LMS (v2.1+). **Ticket types:** an event may have several (e.g. early bird, VIP, **in person / online** for **hybrid** events), each with its own price and capacity. Refunds and cancellation follow D260; a cancelled event refunds everyone in full — *revised by D308: Events is free and handles no payments* |
| D308 | **Events is a free add-on with no payment handling; 10 events a month; archive; duplicate** (**user direction and pricing decision 2026-09-26**; revises D179, D307, D305's event part) | **Events is free** and offered to every path during onboarding. **The platform handles no event payments or registrations**, so it costs CDS nothing beyond hosting. Each event has one optional **link** that the owner fills with **their own Stripe payment link or product URL**, **the host's ticket page** (for events hosted elsewhere), or **nothing** (free / just show up). The button label follows the link: "Buy a ticket", "Get tickets from [host]", or no button. **Online events** (Zoom, etc.): the meeting link is delivered by the owner's own checkout (e.g. the Stripe payment link's confirmation message) or by the owner, **never by the platform**. What stays from D307: the **three kinds** (hosted elsewhere, in person, online) as labels and layout; venue with map; time shown in the visitor's time zone for online events; the email-only **"Remind me"** (a reminder the day before); recurring series (D127); countdowns; add to calendar. **Dropped from D307:** paid registration, capacity, waitlist, ticket types, check-in list, automatic Zoom meetings, private-link delivery and replays. **Limit:** **10 published events a month**, counted by event date. Past and archived events don't count. At the limit, a one-click **+10 events for $5/mo** (repeatable, like page packs). **Archive:** past events **archive automatically** the day after they end, can also be archived by hand, and **restore** in one click. Owners can show an optional **"Past events" page**. **Duplicate:** **"Duplicate with a new date"** copies the title, venue, description, image and link, and asks only for the new date and time (extends D127). **Outreach for events** (revises D305): the **"Remind me" reminder** and a **"new event" alert** to opted-in subscribers and people who used "Remind me" for similar events. The post-event thank-you and waitlist emails are dropped, since there is no attendee list. **Appointments stays $19/mo**; the "both $29" price is gone |
| D309 | **Blog is free, 60 posts a month, with duplicate** (**user direction and pricing decision 2026-09-26**; mirrors D308; **Blog moves from v2.1+ to v1.1, shipping with Events**) | **Blog is a free add-on.** **Limit: 60 published posts a month**, counted by publish date. **Drafts and scheduled-but-unpublished posts are unlimited**, and earlier months' posts never count. At the limit, a one-click **+30 posts for $5/mo** (repeatable, like page and event packs). **Duplicate:** "Duplicate post" copies the body, images, category, tags and SEO settings into a **new draft**, asks only for the new title (and optional publish date), and gives it a fresh URL slug so it never clashes with the original. Blog posts don't count toward the 10 pages (D273), go through the content scan (D270), and are indexed by search (D277) | Matches Shopify Messaging's built-in automations and adds zero-setup defaults, sale alerts and purchase-based suggestions out of the box; **SMS stays v2 (D265)** |
| D310 | **The owner's hub opens on a "Today" screen** (user direction 2026-09-26; decided by Claude under the user's standing rule, no added cost; extends D82, D84, D87, D189, D285) | The website owner's hub always opens on **Today**: one screen, five parts, top to bottom. **(1) Status line:** greeting, whether the site is live, and "View site". **(2) Needs you:** only things the owner must act on, most urgent first, each with **one button that finishes it** (reply to a form message, confirm a booking request, ship an order, answer a CDS message, fix a failed card, finish Stripe setup, confirm a bouncing email address). When empty it reads **"You're all caught up."** **(3) Today cards:** each installed add-on contributes one card (Booking: today's appointments and who is next; Store: orders to ship and low stock; Events: the next event; Blog and Newsletter: what is scheduled; Outreach: what it sent on the owner's behalf this week, so the owner sees it working). **(4) This week:** three or four numbers against last week, from the Site Report (visitors, inquiries, bookings or sales), linking to the full report. **(5) From CDS:** **at most one card at a time**: an announcement, a tip, training for a newly installed add-on, or one suggested add-on. Always dismissible, never in Needs you. **Same layout on every path**; card order defaults by path (Studio: bookings first; Shop: orders first; Standard: inquiries first). The owner can **hide and reorder cards**, saved per person. **Role-aware** (D285): each person sees only the cards and Needs-you items their grants allow, filtered on the server; billing items go to Owners only; a Viewer sees the numbers only. "Today" uses the **business's time zone**. **Phone-first:** one column on a phone, two on desktop. The add-on contract (D35, D87) gains **`today/`**: the add-on's Today card and its Needs-you items. An add-on with nothing daily (e.g. Testimonials) ships no card |
| D311 | **Hub navigation follows the DCR-Website admin: a short flat sidebar, tabs inside each item** (user direction 2026-09-26: "use DCR-Website's navigation as the guideline"; details decided by Claude under the user's standing rule, no added cost; extends D310, D82, D83, D285, D286) | **Pattern taken from DCR-Website** (`components/admin/Sidebar.tsx`, `views/admin/SiteContent.tsx`): the business **logo** at the top with a **"View site"** button under it; **one flat list of items, no nesting**, ordered by how often the work happens (daily work first, things consulted rather than edited last); **each item opens a page with a tab bar** of its sub-sections, the first tab is the default, and every tab has its own link (`?tab=`); **on a phone the same sidebar opens as a slide-out drawer** from the header menu button. The tab list is derived from one source so tabs and deep links never drift. **Items, in order:** **Today** (D310, DCR's "Dashboard"). **Inbox**: every message sent through the site's forms. **Website** (DCR's "Site Content"), tabs: Pages, Services, Media, plus Blog, Events, Testimonials, Credentials, Landing pages when installed. **Big add-ons get their own item** when installed, as DCR does: **Scheduling** (Calendar, Availability, Bookings; Studio Booking adds Staff), **Store** (Orders, Products, Customers), later **Courses**. **Marketing**, tabs: Contacts, Social (D198–D200), plus Newsletter, Outreach, Growth when installed. **Reports** (DCR's "Analytics"): the Site Report. **Settings**, tabs: Business info, Team & hours (D257), Email (D173), Domain, People & roles, Payments, Billing (Owners only), Integrations, Legal. Pinned below the list: **Get add-ons**, **Help** (D208) and **CDS Support** (messages, tickets, documents; CDS-branded, D83). **The header** holds the phone menu button, the org switcher (D286), a **"Jump to"** search over screens, tabs and help articles (record search is later, not v1.0), the bell (D84) and the profile menu. **Badges** on items and tabs use the same source as Needs you, so counts never disagree. **Role-aware on the server** (D285): an item or tab a person has no grant for is not shown, so a receptionist with only Bookings sees Today, Scheduling, Help and CDS Support. Each add-on's manifest (D35) declares **either a tab in an existing item or its own sidebar item**, with label, icon and badge source, so installing it places it with no platform change. **Chrome is neutral** (D63): DCR's dark brand sidebar becomes the tenant's own logo on neutral hub colors |
| D312 | **One hub before and after launch; only Today's top changes** (user direction 2026-09-26; decided by Claude under the user's standing rule, no added cost; extends D29, D170, D172, D303, D310, D311) | There is **no separate build portal**. From the moment the site is provisioned (after Pay) the owner uses the **same hub and the same sidebar** as after launch, so they learn the real tools while CDS works. The site moves through three stages, shown in the Today status line: **Being built → Ready for your review → Live**. **Being built:** the top of Today is a **progress tracker** (Received → Site assembled → CDS polishing → Your review → Live) with the current step and what CDS is doing now; this is DASH-02. **Needs you** holds the owner's build work: missing intake items (each marked optional when it has a fallback), CDS messages and change-request replies, Stripe setup, email confirmations. The owner **can edit everything**; pages CDS is working on are locked by service mode (D99), not by a separate rule. Everything shows on the **preview address** (D170). **Held until launch:** anything that reaches the public or customers. **Outreach automations, newsletters and review requests do not send** from a preview site (D303's "on at launch"); their tabs show "Starts when you go live". **Reports** shows "Your first numbers appear a day after launch" instead of empty charts. The **Inbox works**, so the launch test form (D172) lands there. **Ready for your review:** the tracker gives way to the **launch review** (D172) as a checklist with its count ("4 of 6 done") and **Continue review**. **Live:** the first visit after launch shows a **one-time "You're live at yourbusiness.com"** screen with three first-week steps: share the site with the bio links (D199), check the Google Business Profile, and see what Outreach will send. Today then switches to its normal form (D310). **After launch**, anything CDS still has to build (e.g. an add-on bought later that needs setup) shows as a **small progress card on Today** until done, using the same tracker |
| D313 | **Owner alerts: bell, email and phone push; three levels; each person chooses** (user direction 2026-09-26; decided by Claude under the user's standing rule, **no added cost**: web push is free and SMS stays out until v2, D265; extends D84, D97, D174, D205, D285, D305, D310) | **Channels.** **Bell** in the hub header: every alert, always. **Email** through SES as transactional mail (EMAIL-01), sent to each person's own login address, linking back to the item (no reply-by-email, D97). **Phone push**: the hub is an **installable web app** (home-screen icon is the business's logo, D63) using standard web push, the same approach as the CDS monitor app (D174); it is **opt-in per device**, and a one-time card on Today offers "Get alerts on your phone" with steps for iPhone (Add to Home Screen first) and Android. **No SMS** until v2 (D265). No native app (D74). **Three levels, with defaults:** **(1) Urgent** — bell, email and push at once: a booking, change or cancellation **for today or tomorrow**, the owner's CDS payment failing, Stripe payouts paused or needing information, a site-wide service notice. **(2) Normal** — bell and push at once, email on: new booking further out, new order, new form message, a CDS reply or ticket change (D97), a staff member's own bookings (D205). **(3) Summary** — bell, plus **one daily digest email** at 7am business time, skipped when empty: low stock, new contacts and subscribers, what Outreach sent, newsletter results, posts and events that went live. The monthly "Your site this month" email (D189) stays separate. **Each person chooses** per alert type which channels they get, in their profile, starting from these defaults; a person only ever receives alerts their grants cover (D285), so a receptionist gets bookings only and billing alerts reach Owners only. **Quiet hours** per person (default 9pm–7am, business time) hold push until morning as one summary; bell and email are unaffected. **Bursts collapse**: several of the same alert within 10 minutes become one push ("3 new orders"). **Every alert opens its item** (the tab link, D311), and a bell entry **clears itself** when its Needs-you item is done, since both come from one source (D310). **Sensitive-practice mode** (D305): push and email subjects never show a client's name or service ("New booking for Thursday"), only the hub does. Nothing sends from a preview site except alerts to the owner and CDS (D312) |
| D314 | **Last open numbers: Lighthouse CI threshold and annual prepay of metered items** (decided by Claude under the user's standing rule, no added cost; completes D188, D180) | **Lighthouse CI** runs on mobile against the demo tenant's key pages and **fails the build below: Performance 90, Accessibility 95, Best Practices 95, SEO 95.** **Annual prepay** (2 months free, D180) covers the **base plan fee and flat monthly add-ons only**. Metered items (email allowances, packs, overages) keep their **monthly allowance** and bill **monthly as used**; they are never prepaid |


### Support tickets and service mode (D92–D103)

Two linked features. **Tickets** are how a tenant asks CDS for help; **service mode** is
how CDS tells tenants something is being worked on and keeps them from editing it
meanwhile.

```
Tenant dashboard                          CDS staff console
────────────────                          ─────────────────
File ticket ──────────────────────────▶   Ticket inbox (assign · priority · canned)
  type · target · files · context           │  public reply ──▶ bell + email
                                            │  internal note (staff only)
Ticket thread ◀── status changes ──────     │  link to incident (many tenants)
                                            ▼
Service notice + read-only editor ◀─────  Service mode
                                            Agent:       org · page · component
                                            Super Admin: platform · add-on
```

Three things that are easy to get wrong:

- **Internal notes must never reach the browser.** They share a thread with public
  replies, so filtering is a repository concern, under the same deny-by-default column
  allowlist as billing data — not a UI `if`.
- **The lock is a write rule, not a banner.** A banner without server-side rejection lets
  a stale browser tab overwrite the fix.
- **Incidents are the one cross-tenant object tenants see.** Linking must never reveal
  which other organizations are affected.

### What D87 changes about the add-on contract
`packages/addons/<slug>/` gains one element:

```
  training/          title, video reference, written steps — shown in the dashboard
                     only when this add-on is installed
```

This is a genuine addition to D35, not a detail. It means **an add-on is not complete
until someone can be taught to use it**, which raises the bar for every add-on in the
catalog — including the five in the first catalog (D36).

### Why online store and member portal fit without new architecture
Both looked like large additions and are not, because earlier decisions already carry
them:
- **Store payments** are tenant-to-customer, which is exactly what Connect was chosen for
  (D51). No platform fee applies (D52), and CDS never touches the funds. The tenant's own
  gateway (Stripe, or Square from v1.1) sits behind the core gateway interface (D296).
- **Member accounts** are tenant end users, whose auth collection was already decided
  (D53) and ships in v1.0 — so the portal consumes an existing primitive rather than
  introducing one.

What remains genuinely large is the **product and order model** for the store, and
**access rules** for the portal. Both are **v1.1** work (moved from v2.1+ by D302), shipped
with the Shop plan and the Square adapter.

### Verified dependency facts (DCR-Website `package.json`)
Worth recording because they settle several "what do we use" questions:
- **Rich text is TipTap** (`@tiptap/*` v3.30) — not a bespoke editor
- **Drag-and-drop is dnd-kit** (core 6.3, sortable 10.0)
- **PDF is `@react-pdf/renderer`** v4.5 — used for certificates
- **Stripe** `stripe` v20.4 + `@stripe/react-stripe-js` v5.6
- **PocketBase JS SDK** v0.26
- Next 15.3, React 19.2, Tailwind 4.1
- ⚠️ A `postgres` v3.4 package is also present alongside `pocketbase` — worth checking
  what it is doing there before assuming the data layer is PocketBase-only

### Why the three-pillar scope is less machinery than it looks (D65–D67)
Print and automation are **CDS selling to the tenant**, not the tenant selling to their
customers. They ride the billing side that already exists for the build fee and Care
Plan — no new payment topology. And because all three pillars are "a piece of work CDS
does for a tenant, quoted and tracked," one work-order model with a `work_type` serves
all of them. Proof approval is the one genuinely new state machine.

### Hosting risk to manage (D61)
The platform's blast radius is every tenant, not one site, and it shares CPU, memory and
disk with unrelated client containers. Two mitigations, cheap to do at P1:
- **Container resource limits**, so an unrelated client deploy cannot starve the platform.
- **A documented move-out trigger** — sustained CPU pressure, or SQLite write contention
  visible as booking latency. Ties back to the "measured, not assumed" note in §3.

### Why the preview URL matters (D57)
Custom-domain-from-day-one removes **instant provisioning** — each domain needs
verification and a certificate before anything is visible, so onboarding would stall at
"verify your domain." The wildcard preview subdomain restores it: the tenant reviews
their assembled site during Build, and the real domain is attached only at Launch. It
also doubles as the staging surface that pairs with draft/publish (D22).

---

## 12. Phase sequence (v1.0)

Matches `.planning/ROADMAP.md` (15 phases; renumbered 2026-09-26 when the old P3 was
split). Ordered so nothing built early gets torn out later.

| Phase | Scope |
|---|---|
| **P1** | **Foundations** — monorepo, Next.js + PocketBase setup, CI, deploy target, `CLAUDE.md`, how-to template |
| **P2** | **Tenant core** — organizations, memberships, roles + permission matrix, hostname resolution, the repository chokepoint **plus its cross-tenant isolation tests**, impersonation, export/restore |
| **P3** | **Core page builder** — `pages` + `page_sections` + `organization`, RowRenderer, columns, primitives, one draft → publish flow, hostname → tenant site |
| **P4** | **Theming** — `organization.design`, token resolution, `impeccable` import, CI detector |
| **P5** | **Add-on registry & installer** — extensible `section_type`, recipe runner, proven by Testimonials + Credentials end to end |
| **P6** | **Onboarding intake** — staged, resumable, file upload, mood board, color preview, core hours/team, email classes |
| **P7** | **Blocks and media** — the free block library, SEO, forms, Contacts, public media bucket behind Bunny, compression, consent |
| **P8** | **Templates & auto-assembly** — named slots; CDS builds home + one page from intake (D276) |
| **P9** | **Agreements & e-signature** — versioned agreements, five signup policies, retention table |
| **P10** | **Billing & entitlements** — build fee, one subscription, price catalog, Stripe Tax, Connect Standard + PAY plumbing |
| **P11** | **Owner dashboard** — page builder for every page, versions, add-on management, Site Report, help |
| **P12** | **Communication hub** — messages, notes, tickets, service notices |
| **P13** | **CDS staff console** — pipeline, approvals, review-and-polish, ticket inbox, scan/review queue, health views |
| **P14** | **Domains & launch ops** — Cloudflare DNS, on-demand TLS, one-click domain move (D169, D288), launch review (D172), offboarding (D282) |
| **P15** | **CDS hub site** — the storefront front door, then cutover |

v1.0 sells the Standard ($39/mo) and Studio ($49/mo) paths with support included and the
Care Plan optional (D299, D300). P10 puts every checkout behind the core gateway interface
(D296); P12 carries included support and "Suggest a feature" (D297, D299).

**After v1.0:** v1.1 first catalog (Studio Booking, Appointments, Events, Landing pages,
Newsletter, Growth, plus core stored value, discounts, money safety, refunds, tax) and —
by D302 — the **Store**, shared member portal, **Shop plan** (template, 8-theme library,
self-serve wizard; D300, D301) and the **Square adapter** (D296); v2.0 Print, AI/automation,
chatbot, SMS, and `custom_feature` work orders (D297); v2.1+ LMS and catalog buildout.

---

## 13. Still open

The original five questions here are all settled: templates (D60), white-label (D63),
the three pillars (D65), hosting (D61) and the out-of-scope list (D70, D73, D74, D247).
Live open items are tracked in `.planning/OPEN-QUESTIONS.md`: **Q7** (platform-admin
track), **Q10** (Studio Booking details beyond the decided core) and **Q15** (print
details). None blocks a v1.0 phase.

## 14. Out of scope

- **Free-canvas** visual page builder and raw HTML. The predefined-block page builder with
  drag-and-drop reordering **is** in scope (D70, D183, D281)
- Third-party plugin marketplace (add-ons are CDS-authored)
- In-store point of sale (POS): a possible future, completely separate project (D247)
- Native mobile app
- Migrating existing PocketBase client sites into the platform

The client-facing AI chatbot is **in scope** (D73, D201), in v2.0 as part of Growth.

---

## 15. Working preferences — now carried in `CLAUDE.md`

These are standing instructions from the user. They live in memory today, but memory is
per-machine and invisible to collaborators, so **`CLAUDE.md` must carry them** once it
exists.

- **Keep answers short and scannable.** The user has ADHD. Lead with the answer; cut
  justification to a line or omit it. Bullets and tables over paragraphs. Long-form
  content goes in files, not chat.
- **Use the Write tool for file content, never bash heredocs.** Large heredocs also fail
  outright on Windows (`ENAMETOOLONG: uv_spawn`).
- **During design and planning, keep asking questions until the user says they are
  finished.** Never end a planning session for them.
- **No code until the design is fully thought out and reviewed.**

---

## 16. Tooling

**`impeccable` v0.1.5 — INSTALLED** to `~/.claude/skills/impeccable/` and
`~/.claude/agents/` (56 files, verified byte-exact). 4 agents + 4 degraded fallbacks,
`SKILL.md`, 35 reference flows, `font-index.json` (1.1 MB), `live-browser.js` (523 KB).

Also available: the GSD suite, `design`, `design-system`, `brand`, `banner-design`,
`ui-styling`, `ui-ux-pro-max`, `dataviz`.

---

## Next steps

**No code yet.** Updated 2026-09-26.

Done: design review, GSD conversion (`.planning/`), repo archive and reset, Coolify
repointed at the archive (2026-09-24), integration-gap review with rulings D250–D295,
and D296–D302 (own gateways, custom work, included support, base fees, Shop plan, Store in
v1.1) folded into `.planning/`.

1. **Plan Phase 1** — `/gsd:discuss-phase 1` (Foundations).
2. Work the pre-build items in `.planning/COLLECT-LIST.md` as their phases approach
   (lawyer packet before P9, Stripe/accountant before P10).
3. Deep-inventory the donor components for each phase at its planning step, so the
   add-on contract fits real code.
