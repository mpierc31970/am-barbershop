---
feature: Follow a ticket
phase: 12
route: /hub/support?tab=tickets
---

# How to: Follow a ticket

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every ticket your site sends Support has a number (#1042) and a status: **Open**, **In progress**, **Waiting on you**, **Resolved** or **Closed**. You follow it, reply to it and mark it solved on its own page. Support replies within 2 business days to problems and questions, and you get a bell alert and an email each time Support replies or the status changes.

## Activate

Nothing to turn on: a ticket appears here as soon as you or Support opens one (see [Get help](get-help.md)).

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support` | Click the **Tickets** tab | **Your tickets** lists them with **Open · Closed · All** on the right (Open shows everything but Closed). With none yet: "No tickets", "Need help?" and a **Get help** link |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support?tab=tickets` | Read a row | "#1042", the subject and the status badge; under it "Problem · Whole site · Updated 2 hours ago" (plus "· Opened by Support" when Support opened it for you). **New reply** marks an unread Support reply. **Waiting on you** tickets come first |
| 2 | `/hub/support?tab=tickets` | Click **Closed** or **All** | The list filters in place |
| 3 | `/hub/support?tab=tickets` | Click a ticket | `/hub/support/tickets/<number>` opens: **← Tickets**, the subject as the heading, and "#1042 · status · Problem · Whole site". The side panel (above the thread on a phone) shows Status, About, Type, Opened and Last update, then "Support replies within 2 business days." until Support first replies, and "Support first replied 10 Oct." after |
| 4 | `/hub/support/tickets/<number>` | Read the thread | Your messages and Support replies in order, with status lines between them such as "Status changed to **Waiting on you** · Support · 2:14 pm". Opening the page marks Support's replies read and clears them from the bell and Needs you |
| 5 | `/hub/support/tickets/<number>`, Waiting on you | Type in **Your reply** and click **Send reply** | "Support is waiting for your reply." shows above the box. Your reply posts and the ticket moves to **In progress** ("Back to Support") |
| 6 | `/hub/support/tickets/<number>` | Attach files to a reply with **Attach files**, a paste or a drop | Same as on Messages: up to 5 files, 10 MB each, **Checking file** until the safety check passes |
| 7 | `/hub/support/tickets/<number>`, Open, In progress or Waiting on you | Click **This is solved** | The ticket is **Resolved** at once and a toast "Marked as solved." offers **Undo** for 8 seconds, which puts it back |
| 8 | `/hub/support/tickets/<number>`, Resolved | Read under the thread, then reply if it isn't fixed | "Support marked this resolved. If it isn't, reply and it reopens. It closes by itself after 7 days." A reply moves it back to **In progress** |
| 9 | `/hub/support/tickets/<number>`, Closed | Click **Open a new ticket** | "This ticket is closed. Open a new one." The Get help form opens with the same type and About, and Tell us more starts with "Follows up on ticket #1042." |
| 10 | `/hub/support/tickets/<number>`, linked to a known problem | Read the box at the top | "Known problem: {title}" with **Being fixed** or **Fixed** and what Support has said about it. When it is fixed, your ticket is marked resolved |
| 11 | `/hub/support/tickets/<number>`, marked as a paid service | Read the **This is a paid service** box | Choose how to handle it (see [Paid services and your Care hour](paid-services-and-care-hour.md)) |
| 12 | Any hub screen | When Support replies or changes the status | The bell shows "Support replied to ticket #1042" or "Ticket #1042 is now Waiting on you" with the Support mark, Needs you shows **Read reply** or **Reply**, and the Tickets tab label reads "Tickets · 1" |
