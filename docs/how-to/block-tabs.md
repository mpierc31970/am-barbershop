---
feature: Tabs block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Tabs block

Final steps against the built tabs editor and the live tabs (07-20).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Content split under 2 to 6 tabs, each tab a row of columns (CONT-27).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Tabs** | A Tabs row is added and selected, and its form opens with "First tab" and "Second tab" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Tabs** form | Type a **Heading** (optional) | The heading names the tab row for visitors and screen readers |
| 2 | **Tabs** form, **Tabs** | In a row's **Tab label** field, type a new label, for example "Lunch" | The counter shows up to 30 characters and the row title changes |
| 3 | **Tabs** | Click the tab's row title | Its panel opens below in the Columns editor, with the layout picker and **Add item** |
| 4 | Open panel | Click **Add item**, pick an item (for example **Text**), fill it in and click **Save item** | The item shows in that tab's panel. Opening another tab saves an open item form first |
| 5 | **Tabs** form | Click **Add tab** | A tab labelled "Tab 3" is added and opens. At 6 tabs **Add tab** is off and reads "Tabs hold up to 6 tabs." |
| 6 | **Tabs** | Drag a row by its grip, or click **Move up** / **Move down** | The tab moves and its new position is announced |
| 7 | **Tabs** | Click **More actions for Lunch**, then **Delete tab** | A toast reads "Lunch removed." with **Undo**; **Undo** (within 8 seconds) brings it back. With 2 tabs, **Delete tab** is off: "Tabs need at least 2 tabs." |
| 8 | Form footer | Click **Save block** | Labels and panels are saved, including an item form still open. **Saved** shows for 3 seconds and the header reads **Draft saved · Unpublished changes** |
| 9 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 10 | The live page | Click a tab, then press the Right and Left arrow keys, **Home** and **End** | The tab's panel shows; the arrows move between tabs (wrapping), Home and End go to the first and last |
| 11 | The live page, JavaScript off | Open the page | Every panel shows in order under its label, with no tab row |

Tabs with empty panels are left out of the live page; with one tab left, its panel shows without a tab row.
