---
feature: Columns block
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Columns block

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Columns block is the only block that splits a row. You pick one of 12 layouts, then fill each column with items (heading, text, list, image, button, countdown, spacer, divider). Requirements: CONT-05 (layouts and column order), CONT-06 (flip widths), CONT-07 (nothing is lost when a layout shrinks).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title, for example **Home** | The page builder opens at `/hub/website/pages/[pageId]` with the block list on the left |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** under the block list | The right pane shows **Add a block** and the address gains `?add=1` |
| 4 | **Add a block** | Under **Blocks**, click **Columns**. (Or under **Suggested**, pick a ready-made start: **Photo left, text right**, **Three features**, **Photo gallery**, **Questions and answers** or **Contact form and map**; see `block-presets.md`) | A Columns row is added after the selected block (or at the end), is selected, and its form opens with **Layout** at the top |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Columns form, **Layout** | Click one of the 12 layout pictures (Full width, 50/50, 25/75, 75/25, 40/60, 60/40, 30/70, 70/30, 33/33/33, 25/50/25, 25/25/25/25, 20/20/20/20/20). Arrow keys also move the choice | The picture is highlighted and the columns below redraw at the new widths. A **Saved** label flashes in the pane footer |
| 2 | Columns form, **Column 1** | Click **Add item**, pick **Heading**, type a heading, click **Save item** | The column shows a row like `Heading · "Meet Dana"` |
| 3 | Columns form | Add items to the other columns the same way | Each column lists its items. An empty column shows a dashed box reading **Empty column** |
| 4 | Columns form, column header | Drag a column by its grip handle, or click **Move left** / **Move right** (Move up / Move down on a phone) | The column's content moves to the new position. The widths stay where they were (CONT-05, CONT-06). **Saved** flashes |
| 5 | Columns form, **Layout** | Choose an uneven layout such as **40/60**, then click **Flip widths** | The helper reads "The wide and narrow sides swap. Your content stays where it is." The layout becomes 60/40 and every item stays in its column (CONT-06) |
| 6 | Columns form, **Layout** | On a three-column layout with items in column 3, choose a two-column layout such as **50/50** | An info notice reads **Column 3's items moved to the end of column 2.** No item is lost (CONT-07) |
| 7 | Columns form, an item row | Drag an item by its handle into another column, or open its menu and click **Move up** / **Move down** | The item moves and **Saved** flashes |
| 8 | Page header | Click **Preview page** | The draft opens full width under the strip **Preview · This is your draft, visitors can't see it** |
| 9 | Preview strip | Click **Publish changes** (a page never published shows **Publish** in the builder) | A toast reads **Published. Your changes are live.** with a **View page** link |
