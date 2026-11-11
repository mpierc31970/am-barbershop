---
feature: Gallery block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Gallery block

Owner-hub steps use the P7 page builder routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A grid, mosaic or slideshow of photos from your media, each with its own description and caption (CONT-22). A 30-photo gallery is one drop, not 30 single picks.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Photos and video**, click **Gallery** | A Gallery row is added and selected, and its form opens with **Photos** reading "0 of 200" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Gallery** form, **Photos** | Click **Add photos**. In **Choose photos**, select several photos, then click **Use 3 photos** | The picker closes and a 96px thumbnail appears for each photo, in the order you picked them. Photos with a camera name (like `IMG_2041.jpg`) are named "Photo 2" and show the amber **Needs description** badge; a name like `loaves-cooling.jpg` becomes "Loaves cooling" |
| 2 | **Gallery** form, **Photos** | Drag many files from your computer onto "Drop photos here, or **choose from your media**" | Each file shows "Uploading N%" in the grid, then turns into a thumbnail in the same order, with the same naming rule |
| 3 | **Gallery** form, **Photos** | Click **Describe them** in the line "3 photos need a description." | The photo panel opens under the grid on the first photo with **Needs description** |
| 4 | Photo panel | Type in **Description**, then optionally a **Caption** | The **Needs description** badge on that thumbnail clears. If the photo had no description in your media library, it is saved there too, so the next gallery that uses it is already described |
| 5 | Photo panel | Click **Next photo that needs a description** | The panel moves to the next photo with the amber badge. The button disappears when none are left |
| 6 | **Gallery** form, **Photos** | Drag a thumbnail by its grip, or click **Move photo 2 earlier** / **Move photo 2 later** under it | The photo moves to its new place in the grid, and a screen reader hears "Photo 2 moved to position 1." |
| 7 | Photo panel | Click **Remove from gallery** | The photo leaves the grid and a toast reads **Photo removed from the gallery.** Click **Undo** within 8 seconds to put it back where it was |
| 8 | **Gallery** form | Under **Display**, choose **Grid**, **Mosaic** or **Slider** | **Columns** (2 to 6) shows only for Grid; **Photos per page** (6, 9, 12, 18, 24 or 48; default 12) shows for Grid and Mosaic |
| 9 | **Gallery** form | Turn on **Show captions** if you want captions under the photos; leave **Open photos larger when clicked** on | The switches keep your choices |
| 10 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 11 | Page header | Click **Preview page** | The preview opens with the gallery; numbered page links work here too |
| 12 | Preview header | Click **Publish changes** | A toast reads **Published. Your changes are live.** |
| 13 | The live page | Look at a gallery with more photos than **Photos per page** | Numbered page links (**Previous**, 1, **2**, **Next**) show under the photos; clicking **2** reloads the page on the gallery's second page |
| 14 | The live page | Click a photo (or Tab to it and press Enter) | The photo opens full screen with its caption and a counter like "3 of 14". **Next photo** / **Previous photo**, the arrow keys or a swipe move between photos; **Close photo** or Esc closes it and returns you to the photo |
| 15 | The live page | Look at a gallery with no photos | Nothing shows on the page until you add photos |

A gallery holds up to 200 photos. Start a second gallery for more.
