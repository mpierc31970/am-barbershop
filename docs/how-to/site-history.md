---
feature: Site history
phase: 07
route: /hub/website?tab=navigation
---

# How to: Site history

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Your menu, footer, banner and site settings each keep their last 10 versions (CONT-36, D184). Every save keeps the version before it, so you can undo a bad change in two clicks without asking Support. Each part has its own history: restoring the menu never changes the footer, the banner or your settings.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=navigation` | History is on for every site. Click **Save navigation** once, then click **History** at the right of the **Navigation** heading | A drawer opens from the right titled **Navigation history**, with "We keep the last 10 versions." under it and one row marked **Current** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=navigation`, **History** | Click **History** and read a row | Each row shows when it was saved, like "28 Sep, 2:14 pm", and who saved it: "Saved by Maria Lopez", "Saved by a former team member", "Saved by Support" or "Saved before history was turned on". The newest live version has a shaded row with **Current**; with no older versions the drawer reads "No earlier versions yet. Each time you save, the previous version is kept here." |
| 2 | **Navigation history** | Click **Restore** on an older row, then **Keep current** | A dialog asks "Restore your menu from 27 Sep, 9:05 am?" with **Keep current** already focused. **Keep current** (or **Esc**) closes it and nothing changes |
| 3 | **Navigation history** | Click **Restore** on the same row again, then **Restore this version** | A toast reads "Restored. Your site shows the menu from 27 Sep, 9:05 am." The editor and preview show that menu, the live site's menu changes at once, and a new row marked **Current** is at the top. If you had unsaved edits, the dialog warned "Your unsaved changes on this screen will be lost." first |
| 4 | **Navigation history** | Click **Restore** on the row that was **Current** before step 3, then **Restore this version** | The menu switches back to how it was before step 3 |
| 5 | `/hub/website?tab=footer`, **History** | Click **History**, then **Restore** and **Restore this version** on an older row | The drawer is titled **Footer history**. A toast reads "Restored. Your site shows the footer from …" and only the footer changes |
| 6 | `/hub/website?tab=banner`, **History** | Click **History** at the right of the **Banner** heading, then **Restore** and **Restore this version** on an older row | The drawer is titled **Banner history**. A toast reads "Restored. Your site shows the banner from …". A banner that was switched off comes back switched off |
| 7 | `/hub/website?tab=site`, **History** | Click **History**, then **Restore** and **Restore this version** on an older row | The drawer is titled **Site settings history**. The dialog reads "Your site's settings go back to how they were then." and the toast reads "Restored. Your site uses the settings from …". Language, the Translate link, the search button and the AI setting go back together |
| 8 | `/hub/website?tab=navigation` | Look for the **Show a search button in the menu** switch's history | The Search switch is part of your site settings, so it is restored from **Site settings history** (step 7), not from Navigation history |
| 9 | **Navigation history** | Restore a version whose menu button opened a pop-up you have since deleted | The pop-up comes back in **Website › Pop-ups** and the button opens it again. If the pop-up (or a page the button pointed to) is gone for good, the button is left out and the drawer reads "A button to a pop-up or page you've since deleted was left out." Menu links to deleted pages stay in the editor marked as deleted, and visitors never see them |
