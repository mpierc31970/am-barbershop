---
feature: Ticket inbox and canned replies
phase: 13
route: /staff/tickets
---

# How to: Ticket inbox and canned replies

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

One inbox holds every site's support tickets, most urgent first. Staff answer from the ticket page: a **Public reply** goes to the site (hub and email), an **Internal note** is seen only by CDS (D96). Canned replies insert a saved answer with the owner's name, business, ticket number and your name filled in. The same work is available in the terminal (`support:list`, `support:show`, `support:reply`, `support:open`; see [Support staff tools](support-staff-clis.md)). Incidents and planned-work windows have their own how-to: [Incidents and service windows](staff-incidents-and-service-windows.md).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**; the sidebar shows **Tickets** with a count when tickets need attention |
| 2 | Sidebar | Click **Tickets** | `/staff/tickets` opens on the **Inbox** tab, with tabs **Inbox · Incidents · Service windows · Ideas · Canned replies · Ratings & SLA** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/tickets` (Inbox) | Read the list | Rows sorted by SLA urgency (missed, then at risk, then on track), then priority, then age. Columns # · Site · Type · Subject · Status · Priority · Assignee · Age · SLA. A subject in bold with a **New** badge has an unread owner reply. The line above the table reads like "12 tickets · 2 at risk · 1 missed" |
| 2 | `/staff/tickets` toolbar | Click a quick filter: **Mine**, **Unassigned**, **At risk**, **Waiting on CDS** or **All open** (default) | The list narrows. "Waiting on CDS" shows open tickets whose last public message is the owner's. The filter is in the URL, so the view can be shared as a link |
| 3 | `/staff/tickets` toolbar | Choose **Type**, **Status** (pick "All, Closed included" to see closed ones), **Priority**, **Assignee** or **Site**; type a number like `1042` or `#1042` in **Search** and press Enter | The list filters as you choose; a number jumps straight to that ticket. **Clear filters** resets them. No match shows "No tickets match these filters." With no open tickets at all: "No open tickets. New tickets from sites land here." |
| 4 | `/staff/tickets`, wide screen (1024 px or more) | Click a row (or press `j` / `k` to move and Enter to open) | The ticket opens on the right without leaving the list (URL `?tab=inbox&open=1042`); the list becomes compact rows. Browser Back closes it. On a narrow screen the row opens `/staff/tickets/1042` |
| 5 | `/staff/tickets`, bulk | Tick the boxes of several rows, then choose **Assign to**, **Priority** or **Status** in the bar that appears ("3 selected") | Assign and priority apply at once with a toast like "3 tickets assigned to Mara." and **Undo** ("Undone. Each ticket is back as it was."). A status that alerts owners first asks "Set 3 tickets to Resolved?" with **Set status** or **Keep as is** |
| 6 | `/staff/tickets/1042` header | Read the header line | **#1042**, the status badge, the type, what it is about ("Page · About us"), the site link, "Opened by Maria 9 Oct" (or "Opened by CDS") and the SLA. Linked to a known problem: the incident box and **Open I-3** |
| 7 | `/staff/tickets/1042` thread | Read the thread | Every message in time order. Owner messages and CDS replies look exactly as the owner sees them. Internal notes sit on a hatched surface marked "Internal note · Only CDS sees this." Staff-only lines ("Assigned to Mara by Lee") carry a crossed-eye icon |
| 8 | `/staff/tickets/1042` details rail | Change **Status**, **Assignee** (or click **Assign to me**, key `a`), **Priority**, **Paid service** (Change requests only) or **Link to incident** | Each saves on change and shows "Saved" for 2 seconds. Moving to Waiting on owner or Resolved first asks to confirm: "The site's Owners and Admins get an alert." |
| 9 | `/staff/tickets/1042` composer | Keep **Public reply** selected (key `r`), type the answer in **Reply to Maria**, optionally choose **Then set** (for example **Waiting on owner**) and **Attach files**, then click **Send reply** (or Ctrl Enter) | A preview opens above the buttons: "Maria will see" the message signed "Mara · CDS", the status line it causes and who is alerted. Click **Send reply** again (or **Edit reply** to change it) |
| 10 | Same composer, after the second **Send reply** | Wait for the toast | The reply appends to the thread, the composer clears and the toast reads "Sent. Rivera Bakery sees it in the hub; 2 alerts raised." Turning on **Skip preview next time** removes the preview step for you |
| 11 | Same composer | Click **Internal note** (key `n`), type the note and click **Save note** | The field turns hatched with "Only CDS sees this."; the note appends to the thread and the toast reads "Saved as an internal note. The owner never sees it." Nobody is alerted |
| 12 | Same composer | Click **Canned reply** (or press `/`), type in **Search replies**, pick one with the arrows and press Enter | The reply is inserted with placeholders filled (`{first_name}` becomes "Maria", `{business}` "Rivera Bakery", `{ticket}` "#1042", `{agent}` your first name). It stays editable; on send the thread notes "Canned reply used: Need more detail" for staff only |
| 13 | Same composer, a mistyped placeholder | Send a reply that still contains `{frist_name}` | Sending is refused: "{frist_name} isn't a placeholder. Use {first_name}, {business}, {ticket} or {agent}." |
| 14 | `/staff/tickets?tab=canned` | Click **New canned reply**, fill **Title** (up to 60) and **Reply** (up to 5,000; use the chips **{first_name} {business} {ticket} {agent}** to insert placeholders), check the preview, click **Save reply** | The reply is listed with its first line and "Updated" date and is offered in every composer's picker |
| 15 | `/staff/tickets?tab=canned` | Open a reply and click **Archive reply** | It leaves the Active list with a toast "Archived “Need more detail”." and **Undo**. Under **Archived**, click **Restore reply** to bring it back. Replies are never deleted |
| 16 | `/staff/sites/<org>?tab=actions` | Click **Open ticket**, choose **Type**, fill **Subject** and **Message**, check the "As Rivera Bakery sees it" preview, click **Open ticket** | The toast reads "Ticket #1043 opened for Rivera Bakery (Opened by CDS)." The ticket counts as answered for the SLA, and the site's Owners and Admins are alerted |
| 17 | Any ticket page, keyboard | Press `?` | The shortcut sheet lists j/k, r, n, /, a, e and Esc; **Turn off single-key shortcuts** switches them off in this browser |
