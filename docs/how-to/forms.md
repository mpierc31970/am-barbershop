---
feature: Forms
phase: 07
route: /hub/website?tab=forms
---

# How to: Forms

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Build your own contact, quote, intake, feedback and job forms from a template, then place them on any page with a Form item (CONT-25). Every message lands in your Inbox and we email you a copy.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab. Forms is part of every site and always on |
| 2 | `/hub/website` | Click the **Forms** tab | The address becomes `/hub/website?tab=forms`. With none yet, the pane reads **No forms yet** and "Every message lands in your Inbox and we email you a copy." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=forms` | Click **Create form**, choose **Contact**, click **Create form** | A toast reads "Form created." and the form editor opens with Name, Email, Phone and Message |
| 2 | Form editor, header | Click the form name, type "Contact us", press **Enter** | The name changes. The helper under it reads "Only you see this name" |
| 3 | Form editor, field list | Click **Add field**, then **Multiple choice**. In its settings click **Paste a list**, paste one option per line, click **Use this list** | A new field is selected with its options replaced by your list; blank and repeated lines are dropped |
| 4 | Field settings | Turn on **Required** | The field row reads the type name followed by "· Required" and the preview drops "(optional)" |
| 5 | Field list | Click **Move up** on a field (or drag it by its grip) | The field moves up one place and a screen reader hears "… dropped at position N of N." |
| 6 | Field settings | Type "Card number" as the **Label** | The field shows "Forms can't ask for card numbers, passwords or Social Security numbers. Change or remove this field." and **Save form** is disabled until you change it |
| 7 | **Form settings** | Choose **Two columns**, then open a long field and turn on **Full width** | The preview shows two columns on wide screens and the field spans both |
| 8 | **Form settings** | Change **Button text**, for example to "Ask a question" | The preview's button reads "Ask a question" |
| 9 | **Form settings**, **After sending** | Choose **Go to a page** and pick a page | Visitors go to that page after sending instead of seeing a message |
| 10 | **Form settings**, **Send a copy to** | Choose **Website inquiries**, **Newsletter** or **Your main address** | Each option shows the address it sends to. "Change addresses in Settings › Email" opens Settings |
| 11 | **Form settings**, **Newsletter sign-up** | Turn on **Add a newsletter checkbox** | The wording field appears with "Send me news and offers by email. I can unsubscribe any time." and the helper says nothing is sent until you have the Newsletter add-on |
| 12 | Form editor, header | Below 1280 px wide, click **Preview form** | The themed form shows with "Preview: sending is off"; wider screens always show it beside the settings |
| 13 | Form editor, header | Click **Save form** | A toast reads "Form saved. It's live on your site." |
| 14 | Form editor, header | Save a form whose wording needs a check | A toast reads "Saved. The form shows on your site once it's reviewed, usually within 2 business days." and **In review** shows under the name |
| 15 | Field settings | Type "Medication" as a label, then open **Form settings** and click **Add an External form button** | A tip reads "Forms aren't for health records. Use an External form button to your HIPAA service (IntakeQ, Jane, SimplePractice)." and a drawer explains how to add a Button item that links to your HIPAA form |
| 16 | `/hub/website?tab=forms`, row menu | Click **Duplicate form** | A toast reads "Form duplicated." and the copy, named "Copy of …", opens |
| 17 | `/hub/website?tab=forms`, row menu | Click **View messages** (or the "N unread" link) | The Inbox opens at `/hub/inbox?form=<id>` showing that form's messages |
| 18 | `/hub/website?tab=forms`, row menu | Click **Delete form**, then **Delete form** in the dialog | The dialog asks "Delete the Contact us form?". A toast reads "Form deleted." and the form leaves the list. A form a page or pop-up uses keeps working there and keeps taking messages; a form nothing uses is deleted for good. Either way its messages stay in your Inbox |
