---
feature: Table block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Table block

Owner-hub steps use the P7 page builder routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Rows and columns, typed or pasted from a spreadsheet, such as a price list (CONT-26).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Table** | A Table row is added and selected, and the **Table block** form opens with a 3 by 3 grid headed "Column 1", "Column 2", "Column 3" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Table block** form | Type a **Heading**, for example "Our prices" | The heading also names the table for screen readers |
| 2 | **Cells** grid | Click a cell and type | The cell shows your text. The toolbar above the grid names the cell, for example "Row 2, Column 1" |
| 3 | **Cells** grid | In Excel or Google Sheets, select some cells and copy them. Click a cell in the grid and paste | The grid fills from that cell, adding rows and columns as needed. A toast reads "Pasted 4 rows and 3 columns. Undo"; click **Undo** within 8 seconds to put the table back |
| 4 | **Cells** grid | Paste more than 10 columns or 200 rows | Nothing changes, and a red alert reads "Tables hold up to 10 columns and 200 rows. Split it into two tables." |
| 5 | Cell toolbar | Click a cell, then click **Bold** or **Italic** | The whole cell turns bold or italic and the button shows as pressed. Click it again to turn it off |
| 6 | Cell toolbar | Click a cell, click **Link**, type a link in **Link for this cell** (for example `/contact` or `https://example.com`), click **Apply** | The cell text turns into a link. A link that is not a page path or a web, email or phone address shows an error under the field. **Remove link** takes it off |
| 7 | Under the grid | Click **Add row** or **Add column** | A new empty row or column is added at the end. At 10 columns or 200 rows the button is greyed out with the limit message under it |
| 8 | Row number gutter | Click the **...** button beside a row number (**Row 2 options**), then **Insert above**, **Insert below** or **Delete row** | The row is added or removed |
| 9 | Column strip above the grid | Click the **...** button beside a column (**Column 2 options**), then **Insert left**, **Insert right** or **Delete column** | The column is added or removed |
| 10 | Column strip above the grid | Pick **Left**, **Center** or **Right** in a column's alignment menu | That column's cells line up that way, in the grid and on the site |
| 11 | Long tables | Above 50 rows, click **Show all 184 rows** under the grid | Every row shows |
| 12 | Under the grid | Click **Import CSV**, drop or choose a .csv file | The dialog shows the rows it found, for example "184 rows, 5 columns", with the note that bold, italic and links aren't kept in CSV files |
| 13 | **Import a table** dialog | Click **Replace table…** | The dialog asks "Replace this table?" and says "Your table becomes exactly this file: 184 rows, 5 columns." **Go back** is selected first |
| 14 | **Replace this table?** | Click **Replace table** | The dialog closes and the grid shows the file. A toast reads "Table replaced from your file. Save the block to keep it. Undo" |
| 15 | Under the grid | Click **Export CSV** | The table downloads as a .csv file named after the heading, for example `our-prices.csv`, ready to open in Excel |
| 16 | **Options** | Turn **Header row** (on), **First column as headers** (off) and **Striped rows** (off) on or off | The first row (or first column) becomes the table's labels; striped rows shade every other row |
| 17 | **On phones** | Choose **Scroll sideways** (default) or **Stack as cards** | The card is selected |
| 18 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 19 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 20 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 21 | The live page | Scroll to the table | The table shows with its heading. On a phone, **Scroll sideways** lets visitors swipe the table left and right with a soft fade at the edge; **Stack as cards** shows each row as a card with "Header: value" lines. A table whose cells are all empty shows nothing |
