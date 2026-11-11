---
feature: Logo strip block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Logo strip block

Owner-hub steps use the P7 page builder routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A row of up to 16 logos of clients, partners or press, each named and optionally linked (CONT-27).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Photos and video**, click **Logo strip** | A Logo strip row is added and selected, and its form opens with **Logos** reading "0 of 16" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Logo strip** form, **Logos** | Click **Add logos**. In **Choose photos**, select several logos, then click **Use 4 photos** | A row appears for each logo with a small preview, **Name** and **Link**. The name is filled from the logo's description in your media, or from a file name like `acme-logo.png` |
| 2 | **Logo strip** form, **Logos** | Drag logo files from your computer onto "Drop logos here, or **choose from your media**" | Each file shows "uploading N%", then becomes a logo row |
| 3 | A logo row | Type the **Name** (it is read out to people who can't see the logo) and, if you like, a **Link** such as `https://acme.com` | The row title changes to the name. Leaving a name blank shows "Give each logo a name. It is read out to people who can't see it." |
| 4 | A logo row | Drag the row by its grip, or click **Move Acme up** / **Move Acme down** | The logo moves to its new place |
| 5 | A logo row | Click **Delete** | The row goes and a toast reads **Logo removed.** Click **Undo** within 8 seconds to put it back |
| 6 | **Logo strip** form | Turn on **Show in grey** | The logos show in greyscale on the site |
| 7 | **Logo strip** form | Add logos until there are 16 | **Add logos** turns off and "A logo strip holds up to 16 logos." shows |
| 8 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 9 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 10 | The live page | Look at the logo strip, then click a linked logo | The logos sit centered in a row that wraps on phones, each at most 48px tall; a linked logo opens its address |
| 11 | The live page | Look at a logo strip with no logos | Nothing shows on the page until you add logos |
