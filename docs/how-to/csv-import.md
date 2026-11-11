---
feature: CSV import and backups
phase: 05
route: /hub/website?tab=testimonials
---

# How to: CSV import and backups

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every list add-on (Testimonials, Credentials, and each later one) shares the same **Import**, **Export CSV**, **Download the template** and **Backups** controls. The steps below use Testimonials; on the Credentials tab (`/hub/website?tab=credentials`) every step is the same with "credentials" in place of "testimonials". Anyone who can edit the add-on can import; a backup is always saved before an import changes anything, and the last 3 backups are kept.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website` | Click the **Testimonials** tab (it is there once Testimonials is on your site; add it from **Get add-ons** if it isn't) | The address ends in `?tab=testimonials`, and the header shows **Import** next to **Add testimonial**, plus a **More** menu at the top right |
| 2 | `/hub/website?tab=testimonials` | Click **Import** (on an empty list: **Import from a spreadsheet**) | A dialog titled **Import testimonials** opens at "Step 1 of 3 · Choose a file", with a drop box reading "Drop a CSV file here, or choose a file" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Import testimonials** dialog, Step 1 | Click **Download the template** (also in the tab's **More** menu) | A file named `testimonials-template.csv` downloads: a header row (Quote, Name, About them, Rating, Photo link, Photo description, Featured, Show on site) and one example row |
| 2 | Excel or Google Sheets | Replace the example row with your own rows, one testimonial per row, and save the file as **CSV** | A `.csv` file with your rows under the same header |
| 3 | **Import testimonials** dialog, Step 1 | Drop the CSV file on the box, or click **choose a file** and pick it | The dialog briefly reads "Checking N rows…", then moves to "Step 2 of 3 · Check" |
| 4 | **Import testimonials** dialog, Step 2 | Read the counts line and the table | The counts read like "5 new · 2 updated · 10 unchanged · 1 duplicate removed · 0 errors". Each count is a filter over the table; **All** shows every row. Columns the add-on doesn't use are listed in "We ignored 1 column we don't use: Notes." |
| 5 | **Import testimonials** dialog, Step 2, with errors | Read the error rows at the top of the table, fix them in your file, then click **Choose another file** and pick the fixed file | Each error row reads like "Row 4: Rating must be a number from 1 to 5." The alert reads "2 rows need fixing. Nothing is imported until every row is fixed." and the import button stays off until the new file has 0 errors |
| 6 | **Import testimonials** dialog, Step 2 | Under **How to import**, keep **Update only what changed** and click **Import 7 changes** (the number is new + updated) | The button reads "Importing…", the dialog closes and the list refreshes. A toast reads "Imported. 5 added, 2 updated. A backup was saved first." with **Undo import** |
| 7 | The import toast | Click **Undo import** | A toast reads "Import undone. Your list is back to how it was." and the list shows exactly what it held before the import |
| 8 | **Import testimonials** dialog, Step 2 | Choose **Replace all** instead ("Your list becomes exactly this file. 3 testimonials not in the file will be removed.") and click **Replace all…** | The dialog asks "Remove 3 testimonials?" and lists each one that will go, then "A backup of your current list is saved first, so you can undo this from Backups." **Go back** has the focus |
| 9 | **Remove 3 testimonials?** | Click **Replace all and remove 3** | The dialog closes; your list now matches the file exactly. The toast offers **Undo import**, and the before-import backup is in **Backups** |
| 10 | `/hub/website?tab=testimonials` | Open the **More** menu and click **Export CSV** | A file named like `testimonials-2026-09-28.csv` downloads with an `id` column plus the template's columns, and a toast reads "Exported 12 testimonials." |
| 11 | Excel or Google Sheets, then the **Import testimonials** dialog | Edit rows in the exported file (keep the `id` column so rows match), save it as CSV and import it with **Update only what changed** | Step 2 shows your edited rows as **updated** (changed cells in bold) and the rest as **unchanged**; importing changes only those rows |
| 12 | `/hub/website?tab=testimonials` | Open the **More** menu and click **Backups** | A drawer titled **Backups** reads "A backup is saved before every import. We keep your last 3; older ones are removed automatically." and lists up to 3 backups, newest first, like "Before import · 27 Sep, 2:14 pm · 17 testimonials" |
| 13 | **Backups** drawer | Click **Save a backup now** | A toast reads "Backup saved." and a **Saved by you** row appears at the top. With 3 already kept, the oldest one is removed |
| 14 | **Backups** drawer | Click **Restore** on a backup | A dialog asks "Restore the backup from 27 Sep, 2:14 pm?" and says "Your testimonials go back to how they were then (17 testimonials). Your current list is backed up first." **Keep current list** has the focus |
| 15 | **Restore the backup from …?** dialog | Click **Restore backup** | A toast reads "Restored. Your list matches the backup from 27 Sep, 2:14 pm." and the list shows exactly what the backup held. A **Before restore** backup of the list you replaced is now in **Backups** |
