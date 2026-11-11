---
feature: Hero block
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Hero block

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Hero is the big opening block at the top of a page: a heading, a subtitle, up to two buttons, a trust line and an image (CONT-03). A page can have only one Hero. Its heading is the page's main heading (H1); on a page without a Hero, the page title is the main heading.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title, for example **Home** | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** under the block list | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Blocks**, click **Hero**. **Hero** is listed only while the page has no Hero (one per page) | A Hero row is added and selected, and the form titled **Hero block** opens. The **Page title · H1** row disappears and the Hero row shows the **H1** badge |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Block list, page without a Hero | Look at the first row | A fixed row reads **Page title · H1**: your page title shows as the main heading. Add a Hero and the row disappears; the Hero row shows the **H1** badge |
| 2 | **Hero block** form | Fill **Heading**, then **Heading accent** (the words to show in the accent color) and **Subtitle** | **Save block** becomes clickable and **Discard changes** appears |
| 3 | **Hero block** form | Fill **Main button text** and **Main button link** (a page path like `/contact` or a full address). Optionally fill **Second button text** and **Second button link** | Fields accept the values. A link that is not a page path or a web, email or phone address shows an error under the field |
| 4 | **Hero block** form | Fill **Trust line**, for example "Trusted by 200 families" | — |
| 5 | **Hero block** form, **Image** | Click **Image**, choose a photo from your media library, then fill **Image description** (it is filled from the library description when empty) | The hero shows the photo (it wins over an image address). If the description is left empty, the error reads "Add a short description of the image for people who can't see it." |
| 5a | **Hero block** form | Or paste an **Image address** starting with `https://` and fill **Image description** | If the description is left empty, the error reads "Add a short description of the image for people who can't see it." |
| 6 | **Hero block** form, **Background** | Choose **Page color** or **Alternate color** | The chosen swatch card is selected. This is the only styling choice |
| 7 | Form footer | Click **Save block** | A **Saved** label with a check shows for 3 seconds. The page header reads **Draft saved · Unpublished changes** |
| 8 | Page header | Click **Preview page** | The draft opens under the strip **Preview · This is your draft, visitors can't see it** |
| 9 | Preview strip | Click **Publish changes** (or **Publish** in the builder for a page never published) | A toast reads **Published. Your changes are live.** |
| 10 | `/hub/website/pages/[pageId]` | Click **Add block** on a page that already has a Hero | **Hero** is not listed under **Blocks**. If a second Hero is ever sent anyway, it is refused with **This page already has a Hero block. A page can have only one.** |
