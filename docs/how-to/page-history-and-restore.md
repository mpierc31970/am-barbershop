---
feature: Page history and restore
phase: 11
route: /hub/website/pages/[pageId] (History)
---

# How to: Page history and restore

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every page keeps its last 10 published versions (DASH-07, D184). Each time you publish, the version before it is kept. If a change goes wrong, open **History** in the page editor and put the page back the way it was. A restore publishes straight away and is itself a new version, so you can always switch back.

Saving a block or autosave never makes a version: only **Publish** does. Owners, Admins and Editors can restore. Viewers can open the list but see no **Restore**.

Your menu, footer, banner and site settings have their own history (see [Site history](site-history.md)). Page history only changes the page you are editing.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | History is on for every page. Click a page's title, for example **About us** | The page editor opens at `/hub/website/pages/<id>` with **History** (a clock icon) in the header, just before **Preview page** |
| 2 | Page editor | Edit a block, click **Save block**, then click **Publish changes** | A toast reads **Published. Your changes are live.** The version from before this publish is now kept in History |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Page editor header | Click **History** | A drawer opens from the right titled **Page history**, with "We keep the last 10 published versions of this page." under it. The newest live version has a shaded row with **Current** and no **Restore** |
| 2 | **Page history** | Read a row | Each row shows when it was published, like "Published 9 Oct, 2:14 pm", and who published it: "Published by Maria Rivera", "Set up by Support from your answers" (the first version Support built), "Published by Support", "Published by a former team member" or "Published before history was turned on" |
| 3 | **Page history**, a page published only once | Read the drawer | "No earlier versions yet. Each time you publish, the previous version is kept here." |
| 4 | **Page history** | Click **Restore** on an older row, then **Keep current** | A dialog asks "Restore this page from 9 Oct?" with "This page goes back to how it was then and is published straight away. The current version stays in this history, so you can switch back." **Keep current** is already focused. **Keep current** (or **Esc**) closes it and nothing changes |
| 5 | **Page history** | Click **Restore** on the same row again, then **Restore and publish** | The button reads "Restoring…", then the drawer closes and a toast reads "Restored. Your page shows the version from 9 Oct." The editor shows the old blocks, the live page changes at once, and a new row marked **Current** is at the top of History |
| 6 | **Page history** | Click **Restore** on the row that was **Current** before step 5, then **Restore and publish** | The page switches back to how it was before step 5 |
| 7 | Page editor with unsaved edits | Click **History**, **Restore**, read the dialog | The dialog also warns "Your unsaved changes on this screen will be lost." Click **Keep current** to go back and save first |
| 8 | **Page history** | Restore a version with a button to a pop-up or page you have since deleted for good | The dialog reads "A button to a pop-up or page you've since deleted was left out." and that button is left off the restored page |
| 9 | **Page history**, text flagged by the publish check | Click **Restore and publish** | A toast reads "Restored. It's being reviewed before it shows, usually within 2 business days." The header shows **In review**; the live page doesn't change until it is cleared |
| 10 | **Page history**, the restore fails | Click **Restore and publish** | The dialog shows "The restore didn't finish, so nothing changed. Try again in a minute." |
| 11 | Page editor as a **Viewer** | Click **History** | The same list, with no **Restore** buttons and the line "Only editors can restore a version." |
