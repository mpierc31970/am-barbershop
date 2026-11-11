---
feature: Mood board
phase: 06
route: /hub/setup/look
---

# How to: Your mood board

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The mood board is part of setup step 6, **Photos & look**. The owner adds up to three photos that feel like the brand: a flyer, a shop photo, a screenshot of a site they love. The hub pulls colours from the **first** one the moment it is picked and shows a first look of the site in those colours. It is a first look only: Support designs the real theme from all the mood boards, and nothing here changes the live site. There is no button to apply these colours.

The same step also takes the **Main photo** (the big photo at the top of the home page) and **More photos** (a gallery of up to 12). Each of those needs a short description for people who can't see it.

## Activate

Nothing to switch on: every site in setup has the step.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` | Click the row **Photos & look** | The step opens with the heading **Photos & look**, then **Your photos** (**Main photo** and **More photos**, each with an **Optional** badge) and **Your mood board** with the line "Add a photo to see a first look." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup/look`, **Your mood board** | Drop a photo on the **Mood board photos** box (or click **choose a photo**) | Within a moment, before the upload finishes, a strip of up to six colour blocks appears under the box, wider blocks for colours the photo uses more, each hex code under its block on a wide screen. On the right (below on a phone) a card shows the business name as a heading, the tagline (or "Welcome in"), a **Book a visit** button and a band of section colour, all in the photo's colours. Under the card: "This is a first look. Support designs your full theme from your mood board." |
| 2 | `/hub/setup/look`, **Your mood board** | Wait for the upload to finish | The photo appears as a tile labelled **Colours come from this one**. The strip and card may shift very slightly as the server's reading replaces the browser's; usually nothing changes |
| 3 | `/hub/setup/look`, under the card | Read the colour list | Eight rows, each a small swatch, a name and its hex code: **Page background**, **Section background**, **Text**, **Soft text**, **Buttons and links**, **Button text**, **Highlight**, **Lines**. If a colour had to change to stay readable, a line says so in words, like "We darkened your highlight colour a little so it's easy to read." |
| 4 | `/hub/setup/look`, **Your mood board** | Add a second and a third photo | Each appears as another tile; the strip and card stay the same, because colours come from the first photo only. After three, the box is replaced by "You've added 3 mood boards, the most for now. Remove one to add another." |
| 5 | `/hub/setup/look`, **Your mood board** | On the second tile click **Move photo 2 earlier** (or drag it to the front) | The second photo becomes first and takes the **Colours come from this one** label; the strip, card and colour list change to its colours |
| 6 | `/hub/setup/look`, **Your mood board** | On a tile click **Remove** | The tile goes and a message reads "Photo removed." with **Undo** for 8 seconds. Removing the first photo moves the colours to the next one; removing the last hides the card and shows "Add a photo to see a first look." again |
| 7 | `/hub/setup/look`, **Your mood board** | Pick a file the browser can't read colours from | A yellow note reads "We couldn't read colours from this image. Try another one; Support will still see it." The photo still uploads |
| 8 | `/hub/setup/look`, **Main photo** | Upload a wide photo, then type a description like "Loaves cooling on a rack" in **Photo description** and press Tab | The photo shows with its size; the status top right reads "Saving…", then "Saved". A photo under 1,600 px wide gets a yellow note that it may look soft; it is still kept |
| 9 | `/hub/setup/look`, **More photos** | Upload several photos, describe each, and use **Move photo 2 earlier** / **Move photo 2 later** to order them | Photos appear as a grid in the chosen order, each with its own **Photo description** |
| 10 | `/hub/setup` | Leave a main or gallery photo without a description and open the overview | **What's still needed** lists **Photo descriptions · Photos & look** as a must-have. Back on the step, the empty field shows "Add a short description of the photo for people who can't see it." |
