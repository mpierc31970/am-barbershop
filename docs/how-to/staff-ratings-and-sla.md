---
feature: Ratings and SLA
phase: 13
route: /staff/tickets?tab=ratings
---

# How to: Ratings and SLA

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When CDS resolves a ticket, the site's people can answer "Was this resolved well?" with **Yes** or **No**, in the hub or from the email (STAFF-21, D212). Ratings & SLA shows a month of those answers, per agent and overall, lists every thumbs down until someone follows it up, and gives the month's first-reply SLA line (the same line as `npm run support:sla`). Each thumbs down also emails staff once. Owners never see who rated or the per-agent figures.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, app `cds-platform-dev` (and `cds-platform-prod` at launch), **Environment Variables** | Make sure `CDS_STAFF_ALERT_EMAIL` is the staff inbox | Thumbs-down emails reach staff (dev: logged in `.storage/dev/mail/` until SES) |
| 2 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**. A "thumbs down to follow up" row shows there when any are waiting |
| 3 | Sidebar | Click **Tickets**, then the **Ratings & SLA** tab | `/staff/tickets?tab=ratings` opens on the current business month |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/tickets?tab=ratings` | Pick a **Month** (the last 12) | The address gains `&month=2026-10` and both cards reload for that month |
| 2 | **First replies** card | Read the line | "October 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)". **Missed first replies** lists each one ("#1031 · 3h late") linking to the ticket. Problem and Question tickets created that month count; tickets CDS opened are left out |
| 3 | **Ratings** card | Read the overall line | "23 rated · 21 thumbs up · 2 thumbs down (91%)". An empty month: "No ratings in October yet." |
| 4 | "Ratings by agent" table | Read it; click an agent | Agent (or "Unassigned") · Thumbs up · Thumbs down · Rate. The agent link opens the Inbox filtered to that agent's tickets |
| 5 | **Show** · **Needs follow-up** | Read "Thumbs down to follow up, oldest first" | # (link) · Site · Agent · Comment (or "No comment") · Rated · **Followed up**. Every thumbs down that is not followed up stays here, whatever the month. None: "Every thumbs down is followed up." |
| 6 | A thumbs-down row | Open the ticket (#), read the thread, contact the owner (a reply on the ticket, or a call), then turn on **Followed up** | "#1031 marked followed up." The row leaves the list and the Today count drops by one. The switch is shown only to roles that may reply to tickets |
| 7 | **Show** · **All comments** | Read "Rating comments, newest first" | # · Site · Rating (**Thumbs up** / **Thumbs down** badge) · Comment · Agent · Rated. "No comments this month." when none |
| 8 | Staff inbox | Open the newest "Thumbs down on #1031 · Rivera Bakery" email | Ticket · Site · Agent · Comment ("No comment" when none) · Resolved, and **Open ticket #1031**. One email each time a rating becomes No (new, or changed from Yes); saving a comment on it does not send another |
| 9 | Terminal at the repo root | Run `npm run support:sla -- --month 2026-10` | Prints the same first-reply line as the **First replies** card |
