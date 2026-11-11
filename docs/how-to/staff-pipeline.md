---
feature: Pipeline and launch approval
phase: 13
route: /staff/pipeline
---

# How to: Pipeline and launch approval

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Pipeline takes a site from its first saved quote to live: **Leads** (saved quotes, sites still in setup and hub `/contact` inquiries, see `staff-contact-inquiries.md`), **Fit holds** (signups the fit screen held for a person, D26), **Building** (paid sites being assembled), **Polish queue** (assembled sites CDS finishes by hand) and **Launch** (sites the owner has reviewed, waiting for CDS to make them live, STAFF-03). Stages only move forward, and **live is final**. Since P14 a launch is the last half of a domain move: the owner reviews the site and clicks **Ready to launch**, their domain move reaches **Prepared** (records copied, nameservers changed, delegation verified), and **Approve launch** runs the final steps that switch the site to its domain (D26, D169). The terminal equivalents are `npm run leads:list`, `fit:review`, `site:assemble` and `org:stage` (`org:stage --to live` is refused while a launch move is open: launch with Approve launch).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**; **Pipeline** in the sidebar shows a count when sites are waiting |
| 2 | Sidebar | Click **Pipeline** | `/staff/pipeline` opens with tabs **Leads · Fit holds · Building · Polish queue · Launch**. Approve and decline fit, Move to polish and Approve launch are Super Admin only; a Support agent sees them greyed out with "Super Admin only" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/pipeline` (Leads) | Choose **7 days · 30 days · All**, click a stage chip (Saved quote, Intake started, Submitted, Fit review, Paid, Building, Review, Live), and turn on **Only abandoned** | The table filters: Business (or "Unnamed quote") · Stage · Path · Last activity · Owner email (masked "m•••@gmail.com") · Status. A lead with no activity for 7 days and no checkout shows "Abandoned · 9d". The footer reads like "12 leads · 3 abandoned" |
| 2 | Leads row | Click **Reveal email** | The full address shows. The reveal is written to the audit log with your name |
| 3 | Leads row | Click **Open lead** | The site's detail page opens (`/staff/sites/<org>`). A quote with no site yet shows "Quote only" |
| 4 | `/staff/pipeline?tab=fit` | Expand a held signup | The case shows the business, its type and description, the screening verdict (Clear, Needs review or Blocked), "Why it was held" with the matched words highlighted, and "Held since". **Open the site** goes to its detail page. With none: "No fit holds." |
| 5 | Fit hold | Click **Approve fit**, type a **Reason** (3 to 500 characters), click **Approve fit** in "Approve Rivera Bakery? The owner is emailed and can continue to checkout." (or **Keep holding**) | If your sign-in is older than 15 minutes, **Confirm it's you** asks for a fresh code first. Then: "Approved. The owner can go to checkout when it opens." (plus "Assembly runs within the hour." when the intake was already sent) |
| 6 | Fit hold with a **Blocked** verdict | Read "Blocked by screening. Override needs a reason.", turn on **Override the block**, then approve as in step 5 | **Approve fit** is enabled only after the switch is on; the override is audited |
| 7 | Fit hold | Click **Decline fit**, pick a **Reason** (Fit, Capacity, Scope or Other; Other needs a **Note to the owner**), then click **Decline** (unpaid: "The owner is emailed. Nothing has been paid.") or **Decline and refund** (paid: "Full refund of $1,500. The site closes.") | Unpaid: "Declined. The owner was emailed and the site is held." Paid: "Declined and refunded $1,500.00. Owner emailed. Site data deletes on …" |
| 8 | `/staff/pipeline?tab=building` | Read the table | Business · Stage (Ready for build, Being built) · Assembly ("Assembled 2h ago · 3 unfilled slots", "Not assembled", "Assembling…", "Failed") · Build note · Paid · Age in stage |
| 9 | Building row | Click **Edit note**, type the note (up to 280 characters), click **Save note** | "Build note saved." The owner sees it on their Today as "What CDS is doing now". An empty note clears it ("Build note cleared.") |
| 10 | Building row | Click **Re-run assembly**, then **Re-run assembly** in "Re-run assembly for Rivera Bakery?" (or **Not now**) | The assembly report opens ("Assembly report · Rivera Bakery"). Pages the owner edited are left alone and deleted pages are not recreated |
| 11 | Building row (Ready for build) | Click **Move to polish** | The stage moves to Being built and the site appears in the Polish queue |
| 12 | `/staff/pipeline?tab=polish` | Expand a site; click **View preview** | The slot report lists Slot · Page · Filled from (Intake, Default, Empty) · Status, unfilled first. **View preview** opens the site's preview host in a new tab. To fix a slot, use Site › Actions › **Open as admin** ([Staff impersonation](impersonation.md)) |
| 13 | Polish queue site | Click **Mark ready for owner review**, then **Send to review** in "Send Rivera Bakery to review? Today switches to the launch review and the owner is alerted." (or **Not yet**) | "Rivera Bakery is ready for review." The owner's Today switches to the launch review |
| 14 | `/staff/pipeline?tab=launch` | Read a row's **Domain** column, then expand the site | Domain shows the launch move: "Prepared", "Waiting on nameservers", "Gate: needs review", "In progress", "Launching", "Failed · step 8" or "No domain". Expanded: the owner's launch review checklist ("4 of 6", each item ticked or empty), "Owner review: Sent" or "Not sent yet", the line "Domain: Prepared · riverabakery.com", the open change requests (ticket links) and "In review since". With none: "No sites waiting for launch." |
| 15 | Launch row, not ready | Read why **Approve launch** is unavailable | It stays disabled until the owner clicked **Ready to launch** and the domain move is Prepared (steps 1-5 done, [Domain moves and the zone gate](staff-domain-moves.md)). The reason shows beside it: "The owner hasn't sent the review yet.", "Connect a domain first: the site has no domain." or "Domain not prepared: waiting on nameservers." There is no override for the owner's review. A site with no domain can't launch from the console |
| 16 | Launch row, Prepared | Click **Approve launch** (Super Admin; **Confirm it's you** if the sign-in is older than 15 minutes) | The dialog "Make Rivera Bakery live?" reads "Make Rivera Bakery live at riverabakery.com? CDS runs the last five domain steps (records, edge, HTTPS, switch, search). It takes a few minutes. Live is final once the switch finishes." and "The owner sees “You're live” on their next visit.", with Business · Domain ("Prepared · riverabakery.com") · Launch checklist |
| 17 | Same dialog, change requests opened after the owner's review | Read the warning ("1 open change request"), tick **Launch anyway** | **Make it live** becomes available. Without the tick the launch is refused with "… Tick Launch anyway to go ahead." |
| 18 | Same dialog | Click **Make it live** (or **Not yet**) | The toast reads "Launching Rivera Bakery. Follow it on Site › Domain." (or "Rivera Bakery is live." when every step finished at once). Steps 6-10 run (site records, edge, HTTPS, cutover, search). When the cutover finishes the stage is Live (final), `launched_at` is set and the row leaves the tab. A failure keeps the site in review on its preview address, the toast reads "The launch of Rivera Bakery stopped at step 8 HTTPS. Open Site › Domain to retry.", the row shows "Failed · step 8" and Today shows "1 domain move failed": fix it with **Retry step** on Site › Domain |
