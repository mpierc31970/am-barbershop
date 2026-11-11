---
feature: Stats block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Stats block

Owner-hub steps use the P7 page builder routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

2 to 6 numbers worth knowing, each with a label (CONT-27).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Stats** | A Stats row is added and selected, and its form opens with 3 number cards (**Number 1** to **Number 3**), each starting at 0 |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Stats** form | If you like, fill **Heading** | The heading shows your text |
| 2 | **Number 1** card | Fill **Number**, for example 250 or 1,200 | Anything other than digits, commas and up to two decimals shows "Use digits for the number, like 250, 1,200 or 4.9." under the field |
| 3 | **Number 1** card | If you like, fill **Before** (for example "$", up to 4 characters) and **After** (for example "+" or "%", up to 8) | The fields keep your text |
| 4 | **Number 1** card | Fill **Label**, for example "clients served" | A number shows on the site once it has a label |
| 5 | Under the numbers | Click **Add number** | A new card is added at the end with its **Number** ready to type in. At 6 numbers the button is greyed out with "Stats hold up to 6 numbers." |
| 6 | A number card | Drag the grip handle, or click **Move Number 2 up** / **Move Number 2 down** | The numbers change order |
| 7 | A number card | Click **Delete** | The card is removed and a toast reads "Number removed. Undo"; click **Undo** within 8 seconds to bring it back. With only 2 numbers left, **Delete** is greyed out and "Stats need at least 2 numbers." shows |
| 8 | **Stats** form | Leave **Count up when visible** on, or turn it off | The switch keeps your choice. Its note reads "Skipped for visitors who turn off animations." |
| 9 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 10 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 11 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 12 | The live page | Scroll to the stats | The final numbers are already on the page. With count up on, each number counts up from 0 once, when at least half of it is in view, without moving anything around. Visitors who turn off animations see the final numbers only. Numbers without a label or a valid number are not shown |
