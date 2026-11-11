---
feature: Testimonials
phase: 05
route: /hub/website?tab=testimonials
---

# How to: Testimonials

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Testimonials is an add-on: it adds a Testimonials page, a Testimonials block you can place on any page, and a Testimonials tab under Website. Only the site owner can add it to the site.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Find the **Testimonials** card ("Show the kind words customers send you.") and click **Add to site** | A dialog asks "Add Testimonials to your site?" and reads "It adds a Testimonials page and a Testimonials block you can place on any page." |
| 2 | **Add Testimonials to your site?** dialog | Click **Add to site** | The button reads "Adding…", then the dialog closes and the hub opens `/hub/website?tab=testimonials`. A toast reads "Testimonials is on your site." with **View on site** |
| 3 | `/hub/website?tab=testimonials` | Look at the tab | The heading reads **Testimonials**, the line under it reads "Your Testimonials page: /testimonials", and the pane reads **No testimonials yet** with **Add your first testimonial**, **Import from a spreadsheet** and **How this works** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=testimonials` | Click **Add your first testimonial** (later: **Add testimonial** at the top right) | A drawer opens from the right titled **New testimonial**, and the address ends in `&record=new` |
| 2 | **New testimonial** drawer | Paste the words into **Quote**, type **Name** (for example "Maria L.") and, if you like, **About them** ("Owner, Rivera Bakery") and a **Rating**. Leave **Show on site** on | The counter under Quote counts up, for example "240 / 1,000". **Save testimonial** turns on once you type |
| 3 | **New testimonial** drawer | Click **Save testimonial** | The drawer closes and a toast reads "Testimonial saved." The row shows the start of the quote over "Maria L. · Owner, Rivera Bakery · 5 of 5" |
| 4 | `/hub/website?tab=testimonials`, a row | Click the star labelled **Feature testimonial from Maria L.** | The star fills. Featured testimonials show first on your site, and a block can show only these |
| 5 | `/hub/website?tab=testimonials`, a row | Turn off **Show on site** | The row fades and shows a **Hidden** badge. The testimonial is kept but no longer shows on your site. Turn it back on to show it again |
| 6 | `/hub/website?tab=testimonials`, the list | Drag a row by its handle, or open the row's **More** menu and click **Move up** or **Move down** | The row moves and the new order saves right away. Your site shows them in this order, featured ones first |
| 7 | `/hub/website?tab=testimonials` | Open the **More** menu at the top right and click **Download the template**. Fill it in Excel or Google Sheets and save it as CSV | A file named `testimonials-template.csv` downloads with the columns Quote, Name, About them, Rating, Photo link, Photo description, Featured and Show on site |
| 8 | `/hub/website?tab=testimonials` | Click **Import**, then drop the CSV file on the box (or click **choose a file**) | The dialog shows "Step 2 of 3 · Check" with counts like "5 new · 0 updated · 0 unchanged". A row with a problem reads like "Row 4: Rating must be a number from 1 to 5." and nothing imports until it is fixed |
| 9 | **Import testimonials** dialog | Keep **Update only what changed** and click **Import 5 changes** | The dialog closes and a toast reads "Imported. 5 added, 0 updated. A backup was saved first." with **Undo import**. Click **Undo import** to put the list back |
| 10 | `/hub/website?tab=testimonials` | Open the **More** menu and click **Backups** | A drawer titled **Backups** lists up to 3 backups, newest first. **Restore** on one asks "Restore the backup from …?"; **Restore backup** puts the list back to that point |
| 11 | `/hub/website?tab=testimonials` | Click the **?** button labelled **How Testimonials works** | A drawer titled **How Testimonials works** lists these steps |
| 12 | `/hub/website/pages/[pageId]` (any page) | Click **Add block**, choose **Testimonials** under **From your add-ons**, set **Heading**, **Layout** (**Grid** or **One quote**), **Show** (**All shown testimonials** or **Featured only**) and **How many**, click **Save block**, then **Publish changes** | The block appears in the page's block list, and the preview shows your testimonials |
| 13 | Your site, `/testimonials` | Open the page in a new tab | The page shows the heading "What people say" and your shown testimonials, featured first, each with the quote, the name, the about line and the star rating |
| 14 | `/hub/website?tab=testimonials`, a row | Open the row's **More** menu and click **Delete testimonial**, then **Delete testimonial** in the dialog | The dialog asked "Delete the testimonial from Maria L.?". The row is gone and a toast reads "Testimonial deleted." To bring it back, restore a backup |
