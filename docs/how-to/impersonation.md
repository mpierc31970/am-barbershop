---
feature: Staff impersonation
phase: 13
route: /staff/sites/<org>?tab=actions
---

# How to: Staff impersonation

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

CDS staff never have direct access to a tenant. The only way in is a view of the site's hub as CDS staff: it needs a reason, it is written to the tenant's own audit log, it ends after 60 minutes, and some owner-only actions stay blocked for the whole session (TEN-08, TEN-15, STAFF-06). The console screens are **Site › Actions › Open as admin** (`/staff/sites/<org>?tab=actions`) and **Open as admin** on a ticket (`/staff/tickets/<number>`). The `@cds/db` API steps at the end are the same session without the console.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/settings?tab=staff` (Super Admin) | Give the staff member the **Super Admin** or **Support agent** role (**Change role**). For the very first Super Admin, set **staff_role** to `super_admin` on the user record in the PocketBase admin UI (`/_/`, collection **users**) | The role takes effect on their next click. Only a Super Admin may open a site **As owner** |
| 2 | `/staff/sign-in` | Sign in with email, password and the emailed 6-digit code (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sites` | Search for the business, click it, then click the **Actions** tab | `/staff/sites/<org>?tab=actions` opens; **View as CDS** lists **Open as admin** ("See the hub as an Admin of this site. Ends after 60 minutes.") and **Open as owner** |
| 2 | Site › Actions | Click **Open as admin** (or, from a ticket, **Open as admin** in the ticket header or details rail) | The dialog **View Rivera Bakery as CDS staff** opens: **As admin · As owner** (As owner is greyed out with "Super Admin only" for agents), **Reason** (prefilled "Ticket #1042" from a ticket; helper "The owner sees this in their audit log.") and "Ends after 60 minutes. Everything you change is logged with your name." |
| 3 | Same dialog | Keep or edit the **Reason** (3 to 500 characters), click **Start viewing** (or **Don't open**) | The button reads "Opening…", then the site's hub (`/hub`) opens in the same tab. An `impersonation.start` row with the reason, the view and your IP is written to the site's audit log |
| 4 | `/hub` (any screen) | Look at the top of the page | A sticky strip above the hub top bar reads "Viewing Rivera Bakery as CDS staff · as admin · Ticket #1042 · 52 min left" with **End**. At 5 minutes left the time turns bold and is announced once |
| 5 | `/hub` (any screen) | Make a change on the owner's behalf (for example edit a page and publish it) | The change saves. The site's audit log records it with you as impersonator |
| 6 | `/hub` (any screen) | Try an owner-only action: pay an invoice, change the plan, sign an agreement, connect Stripe, a refund or a DMCA counter-notice | It is turned off with a line like "You're viewing as CDS staff, so payment is turned off. Only the owner can pay." Nothing changes |
| 7 | Impersonation strip | Click **End** | The view ends, an `impersonation.end` row is written, and the console opens on the site's page (`/staff/sites/<org>`) |
| 8 | `/hub`, 60 minutes after **Start viewing** | Click anything | The view has expired: the console opens on `/staff/sites` and the hub no longer shows the site |
| 9 | `/staff/sites/<org>?tab=audit` | Open the **Audit** tab | The start, every change made during the view and the end are listed with you as impersonator. Another site's audit log shows none of them |
| 10 | API (alternative, no console): `startImpersonation(ctx, orgId, "support ticket 42")` with a staff context from `signInStaff` + `completeStaffSignIn` | Start a session with the organization id and a reason (3 to 500 characters); add `{ view: "owner" }` for the owner view (super admin only) | Returns an organization context with role `admin` (or `owner`) and writes `impersonation.start`. `requirePermission(impCtx, "refunds", "run")` (and `purchases`, `legal_ack`, `policy_accept`, `launch_approval`, `dmca_counter`, `connect:write`, `billing:write`) throws `impersonation_denied`. `endImpersonation(impCtx)` writes `impersonation.end` |
