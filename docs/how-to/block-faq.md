---
feature: FAQ block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: FAQ block

Owner-hub steps use the P7 page builder routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Questions visitors can open one at a time, also read by search engines as an FAQ (CONT-27).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **FAQ** | An FAQ row is added and selected, and the **FAQ block** form opens with one empty question card, **Question 1** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **FAQ block** form | Keep or change **Heading** (it starts as "Questions and answers") | The heading shows your text |
| 2 | **Question 1** card | Type the **Question**, for example "Do you open on Sundays?" | The question shows your text |
| 3 | **Question 1** card | Write the **Answer** in the text editor; use its toolbar for bold, italic, links and lists | The answer shows your formatting. An answer whose question is blank shows "Add the question for this answer." under **Question** |
| 4 | Under the questions | Click **Add question** | A new card, **Question 2**, is added at the end and its **Question** field is ready to type in. At 30 questions the button is greyed out with "Keep this to 30 questions or fewer." |
| 5 | A question card | Drag the grip handle, or click **Move Question 2 up** / **Move Question 2 down** (the arrow buttons) | The questions change order. With a keyboard, focus the grip, press Space, use the arrow keys and press Space again |
| 6 | A question card | Click **Delete** | The card is removed and a toast reads "Question removed. Undo"; click **Undo** within 8 seconds to bring it back in the same place |
| 7 | **FAQ block** form | Turn on **Open the first question** if you like (off by default) | The switch shows on |
| 8 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 9 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 10 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 11 | The live page | Click a question, or tab to it and press Enter | Its answer opens below it and the arrow turns over; click again to close. It works even with JavaScript off. Questions without an answer are not shown, and a block with no answered questions shows nothing |
