---
feature: Call to action block
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Call to action block

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A short centered message with one button, to move visitors to the next step (CONT-03).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Blocks**, click **Call to action** | A Call to action row is added and selected, and the **Call to action block** form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Call to action block** form | Fill **Heading** and **Description** | **Save block** becomes clickable |
| 2 | **Call to action block** form | Fill **Button text**, for example "Book a visit", and **Button link**, for example `/contact` | A link that is not a page path or a web, email or phone address shows an error under the field |
| 3 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 4 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 5 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
