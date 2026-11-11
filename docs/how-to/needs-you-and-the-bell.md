---
feature: Needs you and the bell
phase: 11
route: /hub/today
---

# How to: Needs you and the bell

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Needs you** (on Today) lists the things only you can finish. The **bell** (top bar, every screen) keeps the last 30 days of alerts. Both read the same source: when you finish a Needs-you item, its alert clears itself in the bell. How each alert reaches your email or phone is set in [Your profile and alerts](profile-and-alerts.md) (see also [Alert settings](alert-settings.md)).

Rows from CDS (a reply to your ticket, a message, a note, a shared document) carry the small CDS mark, so you can tell CDS apart from your own site's forms and bookings. Urgent rows, such as CDS working on your site, keep the warning icon instead.

For the build record (COMM-03): the bell (`AlertBell`), its drawer (`AlertsPanel`) and the undo toast (`Toast`) shipped in P11 are this platform's equivalents of the donor `NotificationBell`, `AlertSlideout` and `UndoToast` (D84); P12 adds the support rows to them rather than a second bell.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/today` | Both are on for every member. Sign in and look under the status line, then at the bell icon in the top bar | **Needs you** with a count beside it (viewers don't see this section). The bell is named "Alerts", or "Alerts, 3 unread" when there are unread alerts, with the count on a small chip ("9+" above nine) |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/today` › **Needs you** | Read a row | The title in bold, a line such as "From the Contact form · 2 hours ago", and one button that finishes it (**Reply**, **Fix your card**, **Finish Stripe setup**, **Review quote**…). Urgent rows come first with a warning icon; optional setup items carry an **Optional** badge |
| 2 | `/hub/today` › **Needs you** | Click **Reply** on a message row | The message opens in the Inbox (see [Inbox](inbox.md)). Once it is handled, the row leaves Needs you |
| 3 | `/hub/today` › **Needs you** | Finish every item | The section reads "You're all caught up." |
| 4 | Any hub screen | Click the bell | A panel titled **Alerts** opens from the right, grouped **Today**, **Yesterday** and **Earlier**. Unread rows are bold; each row reads "{section} · 2 hours ago" |
| 5 | **Alerts** panel | Click a row | Its screen opens, the alert is marked read and the panel closes |
| 6 | **Alerts** panel | Click **Mark all as read** | Every row turns regular weight and the bell count goes away |
| 7 | **Alerts** panel, with an urgent unread alert | Look at the bell | The chip gains a warning icon and the bell is named "Alerts, 3 unread, 1 urgent" |
| 8 | **Alerts** panel, more than 30 alerts | Scroll down and click **Show more** | Older alerts (up to 30 days) load below |
| 9 | **Alerts** panel, no alerts | Open the bell | "No alerts yet" and "When something needs you, it shows here." |
| 10 | Any hub screen, the hub left open | Wait for a new alert | The count updates within a minute (or on your next click) and screen readers hear "1 new alert". No pop-up interrupts you |
| 11 | **Alerts** panel | Click **Alert settings** at the bottom | `/hub/profile` opens at **Alerts**, where you choose email and phone per alert |
| 12 | `/hub/today` › **Needs you** and the **Alerts** panel | Read a row from CDS | It shows the small CDS mark: "CDS replied to ticket #1042" (**Read reply**), "Ticket #1042 is waiting on you" (**Reply**), "New message from CDS" (**Read message**), "New note from CDS: {title}" (**Read note**), and for the owner "Choose how to handle ticket #1042" (**Choose an option**). Each opens CDS Support at the right place (see [Follow a ticket](follow-a-ticket.md), [Messages with CDS](messages-with-cds.md)) |
| 13 | `/hub/today` › **Needs you** | When CDS paused editing while you were saving | "Your changes to {About us} are waiting" with **Review changes** (see [Service notices and locked pages](service-notices-and-locked-pages.md)) |
| 14 | `/hub/today` › **Needs you** and the **Alerts** panel | When CDS is working on your site | The urgent row "CDS is working on your site until 4:00 pm" shows the warning icon, first in the list, with **See details** |
