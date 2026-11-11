---
feature: Image item
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Image item

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

An image inside a column (CONT-03). Since 07-17 the photo comes from your media library (**Website › Media**) through the picker, and every photo carries a description (CONT-14). A photo address (for example a stock photo) can still be pasted under **Paste a link instead**.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Image** | A new Image item is added and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Image item form | Click **Choose a photo** under **Photo** | The **Choose a photo** window opens on **Your media** with your photos, a search field and an **Upload** tab |
| 2 | Choose a photo | Click a photo, then **Use this photo** | The window closes and the item shows the photo's thumbnail and name with **Replace** and **Remove**. **Description** is filled from the library. A photo without a description first shows a **Description** field in the window, and **Use this photo** stays off until you click **Save description** |
| 3 | Image item form | Edit **Description** ("Describe the photo for people who can't see it.") | The description is used on this page only; the library keeps its own |
| 4 | Image item form | Clear **Description** and click **Save item** | The error reads "Add a short description of the image for people who can't see it." and the field is focused |
| 5 | Image item form | Open **Paste a link instead** and paste an **Image address** | The library photo is cleared and the address is used instead (for stock photos); choosing a photo again clears the address |
| 6 | Image item form | Fill **Description**, click **Save item** | The item row reads `Image · "<your description>"`. The header reads **Draft saved · Unpublished changes** |
| 7 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 8 | Choose a photo | Click the **Free photos** tab (shown only when free photos are switched on for Support), type "bakery" in **Search free photos, like 'bakery'**, press Enter, click a photo, check its **Description**, click **Use this photo** | The item shows the photo with "Photo by <name>" and **Replace** · **Remove**; it never counts toward your 2 GB. On your site the photo has a small line under it, "Photo by <name> on Unsplash" (or Pexels), with both names linked. Choosing a photo from **Your media** or pasting a link removes the credit |
