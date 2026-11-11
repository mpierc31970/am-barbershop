---
feature: Pro table
phase: 10
route: /hub/website/pages/<pageId>
---

# How to: Pro table

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Pro table is the Table part of **Builder Pro** (BILL-14, D233): bigger tables (up to 20 columns and 1,000 rows), a header row and first column that stay in place while scrolling, sorting and search for visitors, 25 rows per page, ✓ / ✗ / – icons, a highlighted column with a label, section heading rows and column widths. Everything lives in the Table block editor you already know (see the Table block how-to). If Builder Pro is removed or payment stops, your site shows the basic table and every Pro setting is kept; it all comes back as soon as Builder Pro is on again.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons/builder-pro` (Standard path) | As the site owner, click **Add to site**, then **Add to site** in the dialog | A toast reads "Builder Pro is on your site." and the page shows the **On your site** badge |
| 2 | `/hub/add-ons` (Studio path) | Look at the **Builder Pro** card | It already shows **On your site**: Builder Pro is included on Studio, nothing to add |
| 3 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/<pageId>` |
| 4 | `/hub/website/pages/<pageId>` | Click **Add block**, then under **Information** click **Table** | A Table row is added and selected, and the **Table block** form opens with a 3 by 3 grid |
| 5 | **Table block** form, **Options** | Scroll to the end of **Options** | A **Builder Pro** group shows four switches, **Highlight a column**, and no lock. Without Builder Pro the group reads "Part of Builder Pro"; owners see **Add Builder Pro**, others read "Ask your site owner to add Builder Pro." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Options** › **Builder Pro** | Turn on **Keep the header row and first column in place** | The switch shows on. On your site the header row and the first column stay put while the table scrolls inside its box |
| 2 | **Options** › **Builder Pro** | Turn on **Let visitors sort by column** | The switch shows on. On your site each header becomes a button with an up-and-down arrow (the table needs **Header row** on) |
| 3 | **Options** › **Builder Pro** | Turn on **Add a search box** | The switch shows on. On your site a **Search this table** box sits above the table |
| 4 | **Options** › **Builder Pro** | Turn on **Show 25 rows per page** | The switch shows on. On your site long tables show 25 rows with page numbers under them |
| 5 | Cell toolbar | Click a cell, then pick **✓ Yes**, **✗ No** or **– Not included** in the **Icon** menu beside **Link** | The icon shows in the cell before its text. Screen readers hear "Yes", "No" or "Not included"; pick **None** to remove it |
| 6 | **Options** › **Builder Pro** | Pick a column in **Highlight a column**, then type "Most popular" in **Label for the highlight** | On your site that column is tinted with a coloured line on each side and the label sits above its header. **Highlight this column** / **Remove highlight** in a column's **...** menu does the same |
| 7 | Row number gutter | Click **...** beside a row number (**Row 4 options**), then **Make section heading** | The row shows a **Heading** chip. On your site it becomes a full-width heading over the rows below it. **Remove section heading** turns it back into a normal row |
| 8 | Column strip above the grid | Click **...** beside a column (**Column 2 options**) and pick **Narrow**, **Medium** or **Wide** in **Column width** | On your site that column is at least 96, 180 or 320 pixels wide. **Auto** fits the content |
| 9 | **Cells** grid | Paste or import up to 20 columns and 1,000 rows (**Add row**, **Add column**, paste or **Import CSV**) | The grid takes them. Past that a red alert reads "Tables hold up to 20 columns and 1,000 rows. Split it into two tables." Above 50 rows, **Show all {n} rows** shows the rest |
| 10 | Page builder header | Click **Publish** | A toast confirms the page is published and the Pro table is live |
| 11 | The live page | Click a column header, then click it again | Rows sort A to Z (or smallest number first), then Z to A. Section headings keep their rows under them |
| 12 | The live page | Type a word in **Search this table** | Only matching rows show and the line under the box reads, for example, "3 of 40 rows" ("No rows match." when none). Clear the box to see every row |
| 13 | The live page | Click **Next** or a page number under the table | The next 25 rows show. Sorting or searching goes back to page 1 |
| 14 | Table block form, after Builder Pro is removed or payment stops | Open the same table, then look at the live page | The editor reads "Builder Pro is paused because payment stopped. This table shows as a basic table on your site, and its Pro settings are kept." Your site shows the first 10 columns and 200 rows with no Pro features; nothing is lost, and adding Builder Pro again brings the full table back |
