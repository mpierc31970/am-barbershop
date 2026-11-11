---
feature: Button item
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Button item

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A button inside a column. It either goes to a link or opens one of the site's pop-ups (CONT-12).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Button** | A new Button item is added and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Button item form | Fill **Button text**, for example "Book a visit" | — |
| 2 | Button item form, **Style** | Choose **Primary** (filled) or **Secondary** (outlined) | The chosen card is selected |
| 3 | **When someone clicks it** | Choose **Go to a link**, then fill **Link** with a page path like `/about` or a full address like `https://example.com` | A link that is not a page path or a web, email or phone address shows an error under the field |
| 4 | **When someone clicks it** | Instead choose **Open a pop-up**, then pick one in **Pop-up** | If the site has no pop-ups yet, the form says "This site has no pop-ups yet." and a **Create a pop-up first** link to `/hub/website?tab=popups`. Saving with no pop-up chosen shows "Choose which pop-up this button opens." |
| 5 | Button item form | Click **Save item** | The item row reads `Button · "Book a visit"`. The header reads **Draft saved · Unpublished changes** |
| 6 | Page header | Click **Publish changes**, then open the page on your site and click the button | The link opens, or the chosen pop-up opens as a dialog |
