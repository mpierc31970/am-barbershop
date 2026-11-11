---
feature: Offboarding a site
phase: 14
route: /staff/sites/<org>?tab=offboarding
---

# How to: Offboarding a site

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Site › Offboarding** follows a site that is leaving CDS (LIFE-01, D282). Leaving is a 30-day notice: the site keeps running until the notice ends, and the owner works through the **Leaving CDS** checklist in their hub: **Move your DNS** · **Download your data** · **Add-ons** · **Connected services** · **Billing** · **Your site closes**. DNS comes first, so their email keeps working: while a CDS zone serves their domain, the later steps stay locked until the DNS handback is done. CDS then runs the system steps **Hosts removed**, **Site closed** and **Zone deleted** (after the delegation moved and the reverse check passed, or 30 days).

The owner usually starts it from their hub. Staff start it only when the owner asks CDS to (or CDS ends the service). If the notice ends while the DNS is still at CDS, nothing closes: the site and zone keep serving, staff get one alert and the owner is emailed, then reminded after 7 days. The CDS subscription still ends at the notice end.

**Start offboarding** and **Cancel offboarding** are Super Admin only and ask for a fresh emailed code; **Re-run handback check** is open to both console roles. The demo site is never offboarded. The terminal equivalent is `npm run org:offboard` ([Domain staff CLIs](domain-staff-clis.md)).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**. "3 sites leaving CDS" lists sites under notice; with one site it opens that site's Offboarding tab |
| 2 | `/staff/sites` | Pick **Status** › **Leaving** (`/staff/sites?status=leaving`), then click the business name and the **Offboarding** tab | `/staff/sites/<org>?tab=offboarding` opens. Leaving sites carry the badge "Leaving · 23d" (days left in the notice). A site with no notice reads "Rivera Bakery isn't leaving." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `?tab=offboarding` with no notice (Super Admin), or `?tab=actions` › **Leaving CDS** › **Start offboarding** ("Starts the 30-day notice and emails the owner the checklist.") | Click **Start offboarding**; at **Confirm it's you** enter the emailed code | "Start offboarding for Rivera Bakery?" opens: "A 30-day notice starts now. The site keeps running until it ends; the owner works through the Leaving CDS checklist." with Notice ends (14 Nov 2026) · DNS handback needed ("Yes, CDS zone active" or "No") · Billing ("Annual prepay is not refunded; the launch rate lock is removed.") · Owner ("Emailed the checklist") |
| 2 | Same dialog | Type a **Reason** (3 to 500 characters; audited), click **Start offboarding** (or **Not now**) | The toast reads "Offboarding started. The owner was emailed the checklist." The tab now shows the **Leaving CDS** timeline and the site lists as Leaving |
| 3 | `?tab=offboarding` | Read the timeline and **Offboarding details** | Each owner step with its badge (Done, Waiting on owner, Not applicable, Locked: "Opens once the DNS handback is done.") and the system steps tagged **System**. Details: Requested by (Owner or CDS staff) · Requested · Notice ends ("23 days left") · Reason · Owner note |
| 4 | **Move your DNS** step | Expand **Handback check · riverabakery.com** | The gate report in reverse: Original is the CDS zone, Copy is what the owner's destination DNS answers, with the same Match / Missing results as a move. Its state reads Not started, Checking, Ready to switch, "Waiting for the switch", "Moved back" or "Records missing". Before the owner picks where the DNS goes: "The owner hasn't chosen where the DNS goes yet." With no CDS zone: "No CDS zone: nothing to hand back." |
| 5 | Same step, after the owner copied their records to the new DNS | Click **Re-run handback check** ("Runs the destination check again for every zone in the handback.") | The toast reads "Handback check re-run for 1 domain." Missing email records are listed; when every record matches and the nameservers moved, the step turns Done and the locked steps open. Before the owner chose a destination the action is refused with the "hasn't chosen" line |
| 6 | **Connected services** step, a site with CDS-owned GA4 or Search Console | Follow [the GA4 and Search Console runbook, §4 Transfer on cancellation](../ops/ga4-search-console.md) | The owner's Google account becomes Administrator in GA4 and Owner in Search Console, CDS's accounts are removed, and `npm run analytics:set -- --org <id> --clear` clears the ids |
| 7 | `?tab=offboarding` (Super Admin) | Click **Cancel offboarding**, enter the emailed code; in "Cancel Rivera Bakery's offboarding?" ("Their plan and price carry on.") type a **Reason** (3 to 500 characters), click **Cancel offboarding** (or **Keep offboarding**) | The toast reads "Offboarding cancelled. Their plan and price carry on." The site leaves the Leaving filter and the owner's hub drops the checklist |
| 8 | Notice end, DNS handed back | Nothing to click: the next `domains:run` acts | Hosts removed, Site closed and Zone deleted turn Done; the site lists as Closed and its data is deleted 30 days later by the retention job |
| 9 | Notice end, DNS still at CDS | Read the staff alert, then contact the owner | Nothing closes and the site keeps serving; "Handback overdue" shows in `npm run org:offboard -- --org <id> status` ("nothing closes until the DNS moves"). Help the owner finish **Move your DNS**, then use step 5 |
