# PRODUCT.md: the CDS owner hub

Product context for `impeccable` (D-UI-P11-1). It covers the **owner hub** (`/hub/*` on the
platform domain). Tenant sites are styled by each site's own theme (`organization.design`) and the
site vocabulary in `DESIGN.md`; this file does not change them.

## Who uses it

- **Small-business owners** whose website CDS builds and hosts: salons, spas, practitioners,
  coaches, shops, community groups. 10-50 sites, not a mass market. Most are not technical, many
  open the hub on a phone between clients, and few have time to learn software.
- **Their team**, invited by the Owner: Admins run the site day to day, Editors edit pages and
  content, Viewers read. Each sees only what their role allows (D285).
- **CDS staff** see a tenant's hub only by impersonation (audited). Staff tools live in the
  terminal until the staff console (P13).

## Register

- **Operate** for every hub screen: Today, Website, Inbox, Marketing, Reports, Settings, Profile,
  CDS Support. People come to get one thing done and leave.
- **Read** for Help articles (`/hub/help/<id>`): plain steps, one idea per line.
- Emails and push notifications follow the same voice, shorter.

## The goal: a calm desk, not a cockpit

The owner opens the hub, reads one line that says where their site stands, sees the short list of
things only they can do, each with the one button that finishes it, and leaves. Everything else
(numbers, tips, CDS news) sits to the side and never shouts. When the list is empty, the screen
says so plainly and lets them go.

Every component discussion starts from "what makes this person's job a little easier?" (D119):
curated choices, sensible defaults, small shortcuts (bulk CSV import, copy-a-link buttons), never
a Wix-style blank canvas.

## Anti-goals

- No hero metrics or big vanity numbers on arrival.
- No streaks, scores-as-games, confetti or "you're on fire" copy.
- No red badges or urgent colour for things that are not wrong. Red means something is broken
  or money is at risk.
- No growth-hacking nudges: no fake scarcity, no countdowns to upsell, no dark-pattern
  confirmations. Buying is always a clear, priced, cancellable choice (ChargeConfirmDialog).
- No follower counts, no posting on the owner's behalf, no asking for social passwords.
- No free-form styling for tenants: they build within their theme (D183).

## Voice and visual authority

- Voice: plain words, short sentences, sentence case, the owner addressed as "you", the site by
  its business name. No jargon ("CSV" is explained the first time).
- Visual authority: `.planning/phases/03-core-page-builder/03-UI-SPEC.md` (hub system, shell,
  builder, voice) plus `.planning/phases/11-owner-dashboard-and-editor/11-UI-SPEC.md` (finished
  hub, copy contract). Every surface uses the `--hub-*` tokens and `@cds/ui/hub` primitives.
- Accessibility floor: WCAG 2.2 AA, 44px touch targets on phones, every action reachable by
  keyboard.
