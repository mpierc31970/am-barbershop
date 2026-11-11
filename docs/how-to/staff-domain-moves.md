---
feature: Domain moves and the zone gate
phase: 14
route: /staff/sites/<org>?tab=domain
---

# How to: Domain moves and the zone gate

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Site › Domain** is where CDS staff follow a site's domain move (D169, D288). A move has ten steps: **1 Snapshot** (every record on the owner's current DNS) · **2 Zone** (a CDS zone at the DNS provider) · **3 Gate** · **4 Nameservers** (the owner changes them at their registrar) · **5 Delegation verified**, then _Prepared (waits for launch approval)_, then **6 Site records** · **7 Edge** · **8 HTTPS** · **9 Cutover** · **10 Search**. The `domains:run` job advances it every 5 minutes; a launch move stops at Prepared until a Super Admin clicks **Approve launch** in the pipeline ([Pipeline and launch approval](staff-pipeline.md)).

The **zone gate** decides whether the owner may change their nameservers. It compares the snapshot with the copy CDS reads back from its own nameservers:

| Rule | Checks | Override |
|---|---|---|
| G1 Exact copy | Every record is copied exactly | **No override** for email records (a hard block); other records may be overridden |
| G2 Mail provider complete | The mail provider's whole record set is there | Super Admin may override |
| G3 DNSSEC off | DNSSEC is off at the registrar (unknown counts as on) | **No override** (hard block) |
| G4 CAA allows Let's Encrypt | Any CAA record lets the certificate be issued | Super Admin may override |
| G5 Registrar-only services | No registrar forwarding or parking that would stop working | Super Admin may override |
| G6 One SPF | Exactly one SPF record | **No override** (hard block) |
| G7 Fresh (≤ 24 h) | The snapshot is less than a day old | Super Admin may override |

CDS **never edits the old zone** at the owner's registrar or DNS host: it only reads it. Everything CDS writes goes into its own zone, so switching the nameservers back always restores the site and email exactly as they were.

Retry step, Re-take snapshot, Add zone file and Re-run post-switch check are open to both console roles. **Cancel move**, **Override** and **Move domain** are Super Admin only (a Support agent sees them greyed out with "Super Admin only") and ask for a fresh emailed code and a **Reason** of 10 to 500 characters. The terminal equivalents are in [Domain staff CLIs](domain-staff-clis.md).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**. Domain rows ("1 domain move failed", "1 gate waiting for an override") link straight to the site's Domain tab when one site is affected |
| 2 | `/staff/sites` | Click the business name, then the **Domain** tab | `/staff/sites/<org>?tab=domain` opens. The tab reads "Domain · 1" when a step failed or a gate waits for an override. A site with no move reads "No domain move yet." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `?tab=domain`, **Domain details** (right rail; on a narrow screen an open "Domain details" section on top) | Read the summary | Domain · Registrar ("GoDaddy · expires 3 Mar 2027") · DNSSEC ("Off", "On at parent", "Unknown") · CDS zone (zone id with a copy button, and `pending`, `active` or `moved`) · Assigned nameservers · Delegation seen ("10 Oct 09:14" or "Not seen yet") · Primary host · Last health check ("HTTPS ok · email records unchanged"). Below it **Hosts for this site**: Host · Kind (`preview`, `custom`, "redirect → riverabakery.com") · Primary · Verified · HTTPS / cert days |
| 2 | Same tab, the timeline | Read the heading and the steps | "Move · launch · rivera.sites.connectionsdesignstudios.com → riverabakery.com" with the move's status badge (Running, Waiting on owner, Prepared, Cutover running, Done, Failed, Cancelled). Each step shows its badge, started/finished time (Central) and a detail like "Waiting for 1.1.1.1 and 8.8.8.8 to answer the edge address (try 3)". The failed step is expanded with its **Error detail** |
| 3 | Below the timeline, **Gate report** | Read the rule table | Rule · Result (**Pass**, **Fail**, "Overridden by Lee" with the reason on hover, **Acknowledged by owner**) · Hard block ("No override" on G1 for email, G3, G6) · Action |
| 4 | **Gate report**, records table | Pick **Show records** › **Problems** or **All** | Records grouped Email · Verification · Site · Other: Type · Name · Original · Copy (read from assigned NS) · Source (zone file, scan, sweep) · Result (Match, "Match · TTL differs", Mismatch, Missing, "Added by CDS", Acknowledged). With nothing wrong: "No problems. Every record matches." Footer: "Snapshot 10 Oct 09:02 · 49 records · read back from ada.ns.cloudflare.com" |
| 5 | A step shows **Failed** | Click **Retry step** | "Retrying…", then the toast "Step retried." and the step runs again (or shows its new failure). The button shows only while a step has failed |
| 6 | Before step 4 (the owner has not changed nameservers yet) | Click **Re-take snapshot** | The toast reads "Snapshot re-taken. The copy and gate run again." The gate report refreshes with the new snapshot time |
| 7 | Before step 4, when the sweep missed records (custom subdomains) | Click **Add zone file**, drop the zone file exported from the owner's DNS host into the drawer (or choose it; 256 KB at most) | "Reading the zone file…", then "Zone file added. The copy and gate run again." A file over the cap reads "Zone files must be 256 KB or smaller." The same upload is `POST /staff/api/domain/zone-file` |
| 8 | **Gate report**, a failing rule with **Override** (Super Admin) | Click **Override**; at **Confirm it's you** enter the emailed code; in "Override G2 for riverabakery.com?" ("The owner's nameserver step unlocks. Their email depends on this record set being complete.") type a **Reason** (10 to 500 characters) and click **Override** (or **Keep the block**) | The toast reads "G2 overridden." The rule shows "Overridden by <you>" and the owner's nameserver step unlocks. Hard blocks (G1 email, G3, G6) never show the button |
| 9 | A red banner "Post-switch check failed · 1 email-critical record differs at 1.1.1.1 and 8.8.8.8 · owner told to switch back 10:42" | Read the table of differing records (Type · Name · Copy · Public answer), fix the copy, then click **Re-run post-switch check** | "Post-switch check re-run." The banner clears once 1.1.1.1 and 8.8.8.8 answer the copy. The owner was already emailed to switch their nameservers back |
| 10 | Timeline (Super Admin) | Click **Cancel move**, enter the emailed code, type a **Reason** (10 to 500 characters), click **Cancel move** (or **Keep the move**) | Before delegation the dialog reads "Cancel the move to riverabakery.com? The CDS zone is deleted. The site stays on rivera.sites… The owner sees "Connect your domain" again." After delegation it warns "Their DNS now lives at CDS. Hand it back first. The zone is kept; cancelling only stops the site steps." The toast reads "Move cancelled." (or the hand-back warning). The zone is kept whenever the provider or public DNS shows the domain may already point at it, even before step 5 is done. A launch move still waiting on the owner's nameserver change after 30 days is cancelled by the domains job the same way, with a "move failed" staff email |
| 11 | A live site on its own domain (Super Admin) | Click **Move domain**, type the **New domain**, click **Next**, enter the emailed code, read "Move Rivera Bakery to riverabakery.net?", type a **Reason**, click **Start move** (or **Not now**) | The dialog explains "The site stays on riverabakery.com until the move finishes. The old domain then sends visitors to the new one, for as long as it stays on CDS DNS." The toast reads "Move started. Rivera Bakery's owner was asked to connect riverabakery.net." A new timeline starts at step 1 |
| 12 | Terminal at the repo root | Run `npm run domains:check -- --domain riverabakery.com` before or during a move | A read-only gate preview ending "Read-only: nothing was written." (see [Domain staff CLIs](domain-staff-clis.md)) |
