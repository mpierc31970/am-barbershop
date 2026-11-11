---
feature: Forms Pro
phase: 10
route: /hub/website?tab=forms
---

# How to: Forms Pro

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Forms Pro is the Forms part of **Builder Pro** (BILL-14, D233): show or hide a field based on an earlier answer, split a long form into steps, send an automatic reply, send messages to a different address by answer, let visitors save and finish later, and add a File upload field. Everything lives in the form editor you already know. If Builder Pro is removed or payment stops, the Pro features turn off on your site and every setting is kept; they come back as soon as Builder Pro is on again.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons/builder-pro` (Standard path) | As the site owner, click **Add to site**, then **Add to site** in the dialog | A toast reads "Builder Pro is on your site." and the page shows the **On your site** badge |
| 2 | `/hub/add-ons` (Studio path) | Look at the **Builder Pro** card | It already shows **On your site**: Builder Pro is included on Studio, nothing to add |
| 3 | `/hub/website?tab=forms` | Open a form and click **Form settings** at the top of the field list | Below **Newsletter sign-up** a **Builder Pro** section shows **Split into steps**, **Send an automatic reply**, **Send to a different address when…** and **Let visitors save and finish later**, with no lock |
| 4 | Same screen, without Builder Pro | Look at the **Builder Pro** section | One panel reads "Part of Builder Pro" and "Add Builder Pro to use this. Everything you set up here is kept if you ever remove it." Owners see **Add Builder Pro**; admins read "Ask your site owner to add Builder Pro." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Form editor, field list | Click the **Details** field (any field below a question such as **Service**) | Its settings open. Under the usual settings a **Show or hide this field** section shows **Rule: Always show** |
| 2 | Field settings, **Show or hide this field** | Set **Rule** to **Show this field only when**, **Field** to **Service**, **Condition** to **is**, **Answer** to **Wedding** | The line under it reads "Shows when Service is Wedding." and the **Details** row in the field list shows a branch icon |
| 3 | Form editor, preview | In **Try an answer** above the preview, set **Service** to **Wedding**, then to **Birthday** | **Details** appears in the preview for Wedding and disappears for Birthday. On your site it works the same way, and a hidden field's answer is never sent |
| 4 | **Form settings**, **Builder Pro** | Turn on **Split into steps** | The field list shows a **Step 1 · Step 1** header above every field and the helper reads "Visitors see one step at a time, with a progress bar." |
| 5 | **Form settings**, **Builder Pro** | Click **Add step**, then type "Your contact details" in **Step 2 title** | The field list shows a second header **Step 2 · Your contact details** with "No fields in this step yet." |
| 6 | Field list | On the last field of Step 1, click **Move down** | The field moves under **Step 2 · Your contact details** and a screen reader hears "… moved to Step 2." Dragging a field onto a row in another step also moves it there |
| 7 | Form editor, preview | Look at the preview, then click **Next step** under it | The preview shows "Step 1 of 2", a progress bar and a **Next** button; after **Next step** it shows "Step 2 of 2" with your button text |
| 8 | **Form settings**, **Builder Pro** | Turn on **Send an automatic reply**, type a **Reply subject** such as "Thanks for your message" and a **Reply message** such as "Hi {name}, we got your message." | The switch is only available when the form has an **Email** field (otherwise it reads "Add an Email field so the auto-reply has somewhere to go."). After saving, each visitor gets your reply at the email they entered, with {name} in the message replaced by their name (links and line breaks are removed, and it is cut to 60 characters). {name} is never put in the subject. One address gets at most one automatic reply per form per day |
| 9 | **Form settings**, **Send to a different address when…** | Click **Add a routing rule**, pick **Rule 1: field** (for example **Service**), **Rule 1: answer is** **Wedding** and **Rule 1: send to** **Your main address** | Messages with that answer go to that address; all others go to the address in **Send a copy to** |
| 10 | **Form settings**, **Builder Pro** | Turn on **Let visitors save and finish later** | The helper reads "They get an email link to finish on any device. Unfinished forms are deleted after 30 days." On your site the form offers **Save and finish later**; the visitor gets an email with a **Finish your form** button that works for 30 days |
| 11 | Form editor, **Add field** menu | Click **File upload**, type a **Label** such as "Photos of the room" | The field is added with no **Part of Builder Pro** lock. On your site visitors can attach a PDF, JPG, PNG, HEIC or Word file up to 10 MB. Every file is virus-checked before it reaches your Inbox; while virus checking is off or your form uploads are full, the field is hidden and the form still sends |
| 12 | Form editor, header | Click **Save form** | A toast reads "Form saved. It's live on your site." and the rules, steps, reply, routing and save-later settings are stored with the form |
| 13 | Form editor, after a payment stops | Open the same form | **Builder Pro** shows "Builder Pro is paused because payment stopped. Your forms still work without the Pro features, and nothing was lost." Every Pro setting shows read-only with its value kept, and other changes still save |
| 14 | `/hub/inbox` | Click a message that came with a file | The message shows the field's label, then the file as "passport.pdf · 1.2 MB" with a **Download** link. Clicking **Download** saves the file to your computer (it never opens in the browser). Only members of your site can download it |
| 15 | `/hub/website?tab=forms`, when form uploads pass 80% of 1 GB | Open the Forms tab | A warning reads "Form uploads have used 870 MB of 1 GB. Delete old messages with files to free space." At 1 GB it reads "Form uploads are full, so upload fields are hidden until you delete messages with files. Your forms still work." Form uploads never count against your media storage |
| 16 | `/hub/inbox`, a message with a file | Open **More actions**, click **Delete message**, then **Delete message** in the dialog | The message and its files are deleted, and the space they used is free again |
| 17 | Your site, the page with the form (as a visitor) | Look at the form split into steps | Above the fields: "Step 1 of 2", the step title and a progress bar. Only Step 1's fields show, with a **Next** button |
| 18 | Your site, Step 1 | Leave a required field empty and click **Next**, then fill it and click **Next** again | First a summary lists the field to fix and the step stays; then Step 2 shows with "Step 2 of 2", a **Back** button and your form's button text |
| 19 | Your site, a field with a rule | Choose **Wedding** for **Service** | **Details** appears right away; choose another answer and it disappears again (its answer is not sent) |
| 20 | Your site, a File upload field | Click **Choose file** and pick a 12 MB photo, then a 2 MB PDF | The 12 MB file shows "This file is over 10 MB. Choose a smaller one." and the form won't send; the PDF shows its name and size with a **Remove** button and sends with the form |
| 21 | Your site, a form with save and finish later | Click **Save and finish later**, type an email in **Email for your link**, click **Send link** | The form is replaced by "We emailed you a link to finish this form. It works for 30 days." |
| 22 | The visitor's email, **Finish your form** | Click the button | The page opens with "Welcome back. Your answers are filled in; check them and send when ready." above the form, answers filled in. After sending, the link stops working; an old or used link shows "This link has expired. Start the form again." over an empty form |
| 23 | Your site with JavaScript turned off | Open the page with the form | Every step shows as one long form under its step titles, every field shows, and **Save and finish later** is not offered; sending still works and your rules are still applied to what is kept |
