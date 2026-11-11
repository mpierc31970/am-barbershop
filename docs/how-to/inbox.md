---
feature: Inbox
phase: 07
route: /hub/inbox
---

# How to: Receive form messages in the Inbox

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every form on your site (on a page or inside a pop-up) sends its messages to **Inbox**. A visitor fills the form, presses its button and sees your thank-you message; you get an email copy, and the message waits in the Inbox with every answer. The sender is saved in **Marketing › Contacts**, merged by email (D236). Messages that look like spam go to **Filtered** instead, so nothing is lost (D231). The form works with JavaScript off too.

Inbox is part of every site and free. The owner, admins, editors and viewers can read messages; the owner, admins and editors can also delete them and move them out of Filtered. Export is one form at a time.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Click **Inbox** in the sidebar | The Inbox opens at `/hub/inbox` on the **Messages** tab. It is always on, with nothing to install. With no messages yet it reads "No messages yet" with **Go to Forms** |
| 2 | `/hub/website/pages/[pageId]` | Add a **Form** item to a column, choose your form and publish the page (see [Form item](item-form.md)) | The published page shows the form in your site's colours and fonts, with its button |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Your published page | Fill in the form (for example Name "Maria Lopez", Email "maria@example.com", a message) and click the form's button | The button reads "Sending…", then the form is replaced by your thank-you message with a green tick |
| 2 | Hub sidebar | Look at Inbox in the sidebar | Inbox shows a count of unread messages, for example 1 |
| 3 | Inbox, Messages tab | Look at the newest row | Maria Lopez is at the top in bold with an Unread badge, the form name, the first words of her message and "Today" with the time |
| 4 | Inbox, Messages tab | Click Maria Lopez | A drawer titled "Message from Maria Lopez" opens on the right with the form, page and time, then every answer. The Unread badge goes and the sidebar count drops |
| 5 | Message drawer | Click Reply by email | Your mail app opens a new email to maria@example.com with the subject "Re: your message to" and your site's name |
| 6 | Message drawer | Click View contact | Marketing › Contacts opens on Maria Lopez. If she ticked the newsletter box, the drawer showed "Newsletter: Agreed" and her contact reads "Not confirmed" until she confirms by email |
| 7 | Inbox toolbar | Choose one form in the Form list, then type "cake" in the search box ("Search messages") and pause | Only that form's messages containing "cake" are listed, and the address bar keeps form= and q=cake |
| 8 | Inbox toolbar | With one form chosen, click Export CSV | A file named after the form, like contact-messages-2026-09-12.csv, downloads with one row per message and one column per question. With All forms chosen the button is greyed out and says "Choose a form to export its messages." |
| 9 | Inbox, Filtered tab | Click Filtered, open a message, then click Not spam | A toast reads "Moved to Messages.", the drawer closes and the message now shows on the Messages tab |
| 10 | Message drawer | Open More actions for the message and click Mark as unread | A toast reads "Marked as unread.", the drawer closes and the row is bold with Unread again |
| 11 | Message drawer | Open More actions, click Delete message, then Delete message in the dialog | The dialog reads "Delete this message from Maria Lopez?" and "It's removed from your Inbox for good. The contact stays in Contacts." with Keep message focused. After deleting, the drawer closes and a toast reads "Message deleted." |
| 12 | Your published page, JavaScript off | Turn JavaScript off in the browser, fill in the form and click its button | The page reloads at the form and shows the same thank-you message. A missing answer comes back as a box listing what to fix, linked to each field |
