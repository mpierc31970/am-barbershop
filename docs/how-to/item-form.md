---
feature: Form item
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Form item

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

One of your forms placed inside a column, a slide, a tab or a pop-up (CONT-25). The form itself is built in **Website › Forms**; the item only chooses which one shows.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Form** under **Actions** | A new Form item is added and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Form item form, no forms yet | Read the notice | It reads "You don't have a form yet. Start one from a template here, or build it in Forms (opens in a new tab)." The **build it in Forms** link opens **Website › Forms** in a new tab |
| 2 | Form item form | Choose a template in **New form from a template** (Contact is chosen first), click **Create and use** | A toast reads "Form created. Edit its fields in Forms." The new form is chosen in **Form** at once |
| 3 | Form item form | Choose a form in **Form** | An **Edit this form** link appears under the field |
| 4 | Form item form | Click **Edit this form** | The form editor opens in a new tab at `/hub/website?tab=forms&form=<id>` |
| 5 | Form item form | Click **Save item** with no form chosen | The error reads "Choose a form. You can create one in Website › Forms." and the Form field is focused |
| 6 | Form item form | Choose a form, click **Save item** | The item row reads `Form · Chosen`. The header reads **Draft saved · Unpublished changes** |
| 7 | Form item form, a deleted form | Open an item whose form was deleted | **Form** shows the name with "(deleted)" and a notice reads "This form was deleted. It still shows here so nothing breaks; choose another form or remove this item." **Choose another** moves focus to **Form** |
