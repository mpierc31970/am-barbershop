---
feature: Incidents and service windows
phase: 13
route: /staff/tickets?tab=incidents
---

# How to: Incidents and service windows

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

An **incident** is one known problem that many sites report (D103). Link every related ticket to it; each owner sees "Linked to a known problem" with your public text, and resolving the incident resolves every linked ticket at once. A **service window** is planned work: it pauses editing on a page, a site part, a whole site, an add-on or the platform and shows owners a notice (D99-D102). Your own edits as staff are never blocked (STAFF-11). The same work runs in the terminal with `npm run incident:run` and `npm run service:window` ([Support staff tools](support-staff-clis.md)).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |
| 2 | `/staff/tickets` | Click the **Incidents** tab, or the **Service windows** tab | The incidents list (`?tab=incidents`) or the windows list (`?tab=windows`) opens. Add-on and platform windows need a Super Admin; a Support agent sees those two scopes greyed out with "Super Admin only" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/tickets?tab=incidents` | Read the list; switch **Open · Resolved · All** | Columns Ref ("I-3") · Title · Status ("Being fixed" or "Fixed") · Linked tickets · Sites · Opened. With none open: "No open incidents." |
| 2 | `/staff/tickets?tab=incidents` | Click **Open incident**, fill **Title** (staff only) and **What owners see** (up to 500 characters; the "Owners see" box previews it), click **Open incident** | The toast reads "Opened I-3." and the incident is first in the Open list |
| 3 | Incident drawer (click the incident's row) | Type a ticket number in **Link a ticket** (for example `1042`) and click **Link ticket** | The toast reads "Linked #1042 (Rivera Bakery) to I-3. The owner sees "Linked to a known problem" and the public text." The ticket joins **Linked tickets** (# · Site · Status · Age) |
| 4 | `/staff/tickets/1042` details rail (alternative) | Choose the incident in **Link to incident** | The same link is made from the ticket; the thread shows the incident box and **Open I-3** |
| 5 | Incident drawer | Click **Unlink ticket** on a row | The ticket leaves the list. Its earlier "Linked to a known problem" line stays in the thread as history |
| 6 | Incident drawer | Click **Resolve incident**, optionally write a **Closing message** (owners see it on each linked ticket), then click **Resolve incident** in "Resolve I-3? 4 linked tickets will move to Resolved." (or **Keep open**) | The toast reads "Resolved I-3. 4 linked tickets moved to Resolved, 4 alerts raised." Every linked open ticket is now Resolved and its people are alerted |
| 7 | `/staff/tickets?tab=windows` | Read the list; switch **Active and scheduled · Ended** | Columns Ref ("W-12") · Scope ("Page · About us · Rivera Bakery", "Platform") · When ("now → 4:00 pm") · State (Active, Scheduled, Ended) · Message · Incident · By. With none: "No windows now or coming up." |
| 8 | `/staff/tickets?tab=windows` | Click **New window** | The **New service window** form opens |
| 9 | New service window form, **Scope** | Pick **Page**, **Site part or add-on area**, **Whole site**, **Add-on (every site)** or **Platform (every site)** | The **Target** fields change to match: a site, then its page or part (Header, Footer, Menus or an installed add-on); for Add-on scope, the add-on |
| 10 | Same form, **When** | Click a quick time (**Now**, **+1 hour**, **+4 hours**, **Tonight 10 pm–2 am**) or set **Starts** and **Ends** ("All times Central") | The times fill in. An end before the start or more than 7 days out shows "The end must be after the start, and within 7 days." |
| 11 | Same form | Type the **Message** (up to 160 characters; counter "42 / 160"), optionally **Link to incident**, and check the **Owners see** preview | The preview shows the owner's notice strip as it will look "On the About us page editor" (or the part's screens, or every hub screen). A future window notes "The notice shows from 24 hours before the start." |
| 12 | Same form | Click **Create window** (or **Discard window**) | The toast reads like "W-12 · Rivera Bakery · page "About us" · now → 4:00 pm Central · editing paused for the owner." The owner sees the notice and that target is locked for editing until the end time |
| 13 | `/staff/tickets?tab=windows` | Click **End now** on an active window, then **End now** in "End W-12 now? Editing reopens for Rivera Bakery." (or **Keep it**) | The window moves to Ended and the owner can edit again. The hourly support job also clears windows when they end |
