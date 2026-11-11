---
feature: Credentials
phase: 05
route: /hub/website?tab=credentials
---

# How to: Credentials

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Credentials is an add-on: it adds a Credentials page, a Credentials block you can place on any page, and a Credentials tab under Website. Only the site owner can add it to the site.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Find the **Credentials** card ("List your licenses, certifications and memberships.") and click **Add to site** | A dialog asks "Add Credentials to your site?" and reads "It adds a Credentials page and a Credentials block you can place on any page." |
| 2 | **Add Credentials to your site?** dialog | Click **Add to site** | The button reads "Adding…", then the dialog closes and the hub opens `/hub/website?tab=credentials`. A toast reads "Credentials is on your site." with **View on site** |
| 3 | `/hub/website?tab=credentials` | Look at the tab | The heading reads **Credentials**, the line under it reads "Your Credentials page: /credentials", and the pane reads **No credentials yet** with **Add your first credential**, **Import from a spreadsheet** and **How this works** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=credentials` | Click **Add your first credential** (later: **Add credential** at the top right) | A drawer opens from the right titled **New credential**, and the address ends in `&record=new` |
| 2 | **New credential** drawer | Type **Title** (for example "Registered Nurse") and **Issued by** ("Texas Board of Nursing"). Type **Group** ("Licenses"), or pick a group you already use from the suggestions. Set **Issued** and **Expires** with the date pickers. Leave **Show on site** on | **Save credential** turns on once you type. The Group box suggests the groups you already have, so "Licenses" is never split into "License" and "Licenses" |
| 3 | **New credential** drawer | Type the license **Number** ("RN123456") and turn on **Show number on site** if you want visitors to see it | The number is kept either way. It only shows on your site while **Show number on site** is on |
| 4 | **New credential** drawer | Paste a **Verify link**, such as the board's license lookup page, then click **Save credential** | The drawer closes and a toast reads "Credential saved." The row sits under its group header, for example "Licenses · 1", and reads "Texas Board of Nursing · No. RN123456 · Valid through 14 Mar 2027" |
| 5 | `/hub/website?tab=credentials`, the list | Drag a row by its handle, or open the row's **More** menu and click **Move up** or **Move down** | The row moves inside its group and the new order saves right away. A row can't be dragged into another group; to move it, change its **Group** in the drawer |
| 6 | `/hub/website?tab=credentials` | Look at a credential that expires within 60 days | The row shows an **Expires soon · 12 Nov** badge, and a notice at the top reads like "1 credential expires in the next 60 days: RN License (12 Nov). Update the dates once you renew." Click the name in the notice to open it and change **Expires** |
| 7 | `/hub/website?tab=credentials` | Look at a credential whose **Expires** date has passed | The row shows **Expired · hidden on site**. Your site stops showing it on its own the day after it expires. Update **Expires** once you renew and it shows again |
| 8 | `/hub/website?tab=credentials`, a row | Turn off **Show on site** | The row fades and shows a **Hidden** badge. The credential is kept but no longer shows on your site |
| 9 | `/hub/website?tab=credentials` | Open the **More** menu at the top right and click **Download the template**. Fill it in Excel or Google Sheets and save it as CSV | A file named `credentials-template.csv` downloads with the columns Title, Issued by, Group, Number, Show number, Issued, Expires, Verify link and Show on site |
| 10 | `/hub/website?tab=credentials` | Click **Import**, then drop the CSV file on the box (or click **choose a file**) | The dialog shows "Step 2 of 3 · Check" with counts like "6 new · 0 updated · 0 unchanged". A row with a problem reads like "Row 15: Expires isn't a date. Use a date like 2027-03-14." and nothing imports until it is fixed |
| 11 | **Import credentials** dialog | Keep **Update only what changed** and click **Import 6 changes** | The dialog closes and a toast reads "Imported. 6 added, 0 updated. A backup was saved first." with **Undo import**. Click **Undo import** to put the list back |
| 12 | `/hub/website?tab=credentials` | Click the **?** button labelled **How Credentials works** | A drawer titled **How Credentials works** lists these steps |
| 13 | `/hub/website/pages/[pageId]` (any page) | Click **Add block**, choose **Credentials** under **From your add-ons**, set **Heading** and leave **Group by category** on, click **Save block**, then **Publish changes** | The block appears in the page's block list, and the preview shows your credentials under their group headings |
| 14 | Your site, `/credentials` | Open the page in a new tab | The page shows the heading "Credentials" and your shown credentials grouped under headings like "Licenses", each with its title, who issued it and "Valid through March 2027". **Verify** opens the check page in a new tab |
| 15 | `/hub/website?tab=credentials`, a row | Open the row's **More** menu and click **Delete credential**, then **Delete credential** in the dialog | The dialog asked "Delete RN License?". The row is gone and a toast reads "Credential deleted." To bring it back, restore a backup from **More** → **Backups** |
