---
feature: Business hours block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Business hours block

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Your opening hours with an "Open now" note, always read live from your settings so they never go stale (CONT-27, D257). Change your hours once in Settings and every hours block on your site follows.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Business hours** | A Business hours row is added after the selected block and selected, and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Business hours** form | Read the grey note "Hours come from Settings › Team & hours." | The note has an **Edit your hours** link. With no hours set it adds "No hours yet. Visitors will see 'Contact us for hours.'" |
| 2 | **Business hours** form | Click **Edit your hours** | `/hub/settings?tab=team-hours` opens. Set each day's times, click **Save**, then go back to the page builder |
| 3 | **Business hours** form | Keep or change **Heading** (it starts as "Opening hours") | The heading shows your text. Clear it to show no heading |
| 4 | **Business hours** form | Leave **Show "Open now"** on, or turn it off | The switch keeps your choice |
| 5 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 6 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 7 | Page header | Click **Preview page** | The preview shows the hours table for this week |
| 8 | Page header | Click **Publish changes** | A toast reads **Published. Your changes are live.** |
| 9 | The live page | Scroll to the hours | A table of the week, Monday first. Today's day is bold, closed days are grey and read "Closed", and "Times are in Central Time" (your zone) sits under it |
| 10 | The live page | Look above the table | A pill reads "Open now · Closes at 5:00 pm" or "Closed now · Opens Monday at 9:00 am", worked out on the visitor's device and refreshed every minute |
| 11 | The live page, with no hours set | Scroll to the block | "Contact us for hours." with your phone and email as tap-to-call and email links |
