---
feature: Contacts
phase: 07
route: /hub/marketing?tab=contacts
---

# How to: Keep your contacts in one place

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Marketing › Contacts** lists everyone your site has touched: people who sent a form, people you added and people you imported. One person is one contact, merged by email, so a customer who writes twice is still one row. Each contact keeps tags, private notes and a history of what they did. Contacts is part of every site and free (D236). The owner and admins can change contacts; staff see the list read-only. Nothing here can sign someone up for your newsletter: only the person can, on a form or through the Newsletter add-on (D132).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Click **Marketing** in the sidebar | The Marketing page opens on the **Contacts** tab (`/hub/marketing?tab=contacts`). Contacts is always on, with nothing to install. With no contacts yet it reads "No contacts yet" with **Add contact** and **Import from a spreadsheet** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Marketing › Contacts | Type "maria" in the search box ("Search name, email or phone") and pause | After a moment the table shows only contacts whose name, email or phone contains "maria", and the address bar keeps q=maria |
| 2 | Marketing › Contacts | Choose Subscribed in the Newsletter filter | Only contacts with a green Subscribed badge are listed and Clear filters appears. Click Clear filters to see everyone again |
| 3 | Marketing › Contacts | Click a contact's name, for example Maria Lopez | A drawer titled "Maria Lopez" opens on the right with Name, Email, Phone and Tags, a Newsletter line, History (newest first) and Notes |
| 4 | Contact drawer | In Tags, type "VIP" and press Enter, then click Save contact | A VIP chip appears, a toast reads "Contact saved." and the row shows the tag |
| 5 | Contact drawer, Notes | Type "Prefers morning calls" in Add a note and click Add note | The note appears at the top of the notes with "You" and today's date, and a toast reads "Note added." |
| 6 | Contact drawer, Newsletter | On a contact whose line starts "Not confirmed" or "Subscribed", click Mark as unsubscribed, then Mark as unsubscribed in the dialog | The dialog closes, a toast reads "Marked as unsubscribed." and the line now starts "Unsubscribed" with the date. There is no button to subscribe someone |
| 7 | Marketing › Contacts | Click Add contact, type Email "ana@example.com" and Name "Ana Ruiz", click Save contact | The drawer titled "Add contact" shows the note "To add people to your newsletter, they need to agree themselves, on a form or through the Newsletter add-on." After saving, a toast reads "Contact saved." and Ana Ruiz is in the list |
| 8 | Marketing › Contacts | Click Import, drop a CSV exported from Mailchimp, Square or Google Contacts, match any unknown columns under Goes to (one must be Email), click Next: check rows, type "Spring fair 2026" in Tag everyone in this file, then click Import N contacts | The check step shows counts like "12 new · 30 updated" and "3 merged by email". The dialog closes and a toast reads "Imported. 12 added, 30 updated." Nobody is removed and no newsletter choice changes |
| 9 | Marketing › Contacts | Open the More actions for Contacts menu and click Export CSV | A file named contacts.csv downloads with Name, Email, Phone, Tags, Newsletter, Source, Last activity and Added columns |
| 10 | Contact drawer | Open More actions for Ana Ruiz, click Delete contact, then Delete contact in the dialog | The dialog reads "Delete Ana Ruiz?" and "Their details, notes and history are removed. Messages they sent stay in your Inbox." with Keep contact focused. After deleting, the drawer closes and a toast reads "Contact deleted." |
