---
feature: Report a problem
phase: 13
route: /report
---

# How to: Report a problem

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Anyone can tell CDS about content on a site CDS hosts: a copyright problem, a scam, illegal content or something else (STAFF-24, D249). Every site's footer carries a **Report** link that opens this page with the site already filled in; the page also works on its own at `/report` on the platform domain. No account is needed. CDS reviews every report, usually within 2 business days. The site owner is told that a page was reported and why, but never who reported it.

## Activate

Nothing to turn on: the **Report** link is in every site's footer and can't be removed.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any page of a site CDS hosts | Scroll to the footer and click **Report** | `/report?site=<the site's address>` opens on the platform domain: "Report a problem" and "Tell us about content on a site CDS hosts. We review every report." **Site** and **Page address** are already filled in |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/report` | Under **What are you reporting?** pick **Copyright** ("Someone used your work without permission."), **Scam or fraud**, **Illegal content** or **Something else** | The choice is marked. Picking **Copyright** adds the **Copyright notice** section (step 4) |
| 2 | Same page | Check **Site** (like example.com) and **Page address** (the full address, starting with https://) | Both stay as filled in from the footer link; change them if the problem is on another page |
| 3 | Same page | Type **What's wrong?** (20 to 2,000 characters), then under **Your contact** your **Email** (and **Name**) | The counter follows the text. CDS emails your copy of the report to this address |
| 4 | **Copyright notice** (Copyright only) | Read the line "DRAFT: this wording has not been reviewed by a lawyer yet.", fill **Your original work** ("Where is it? A link or a short description."), tick both statements (the good-faith statement and the accuracy statement), type your full name as the **Signature** | All four are needed for a copyright report. **Name** becomes required too |
| 5 | Same page | Complete the "are you a person" check if it shows, then click **Send report** | "Sending…", then **Report received**: "Your report number is R-32. We sent a copy to you@example.com. CDS reviews reports within 2 business days." **Report something else** opens a fresh form |
| 6 | Same page, a field left out | Click **Send report** | "Check these and send again:" lists each problem as a link to its field, for example "Pick what you're reporting.", "Enter the full page address, starting with https://" or "Tell us what's wrong in at least 20 characters." Your text is kept |
| 7 | Your email inbox | Open "We received your report R-32" | "CDS reviews every report, usually within 2 business days." with Report · Page · Reason (your own words are not repeated back) |
| 8 | `/report`, a sixth report within an hour from the same connection | Click **Send report** | "Too many reports from this connection. Try again in an hour, or email abuse@connectionsdesignstudios.com." Nothing is sent. A failed person check reads "We couldn't confirm you're a person. Try again, or refresh the page." |
