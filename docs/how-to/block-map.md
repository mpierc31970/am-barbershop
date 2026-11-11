---
feature: Map block
phase: 07
route: /hub/website/pages/[pageId]
---

# How to: Map block

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A map of where to find you, with a Get directions link (CONT-24, D230). It uses your business address unless you type another one or paste a Google Maps link. Google loads only after the visitor clicks **Show map** or accepts cookies (D279).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Map** | A Map row is added after the selected block and selected, and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Map** form | Keep or change **Heading** (it starts as "Find us") | The heading shows your text |
| 2 | **Map** form | Leave **Address** empty | The box shows your business address in grey, and the line under it reads "Leave blank to use your business address: 12 Main St, Austin, TX 78701" |
| 3 | **Map** form | Or paste a Google Maps link, for example from **Share › Copy link** on a place in Google Maps, then click outside the box | The box changes to the place name and the line reads "Found: Rivera Bakery" |
| 4 | **Map** form | Paste a short `maps.app.goo.gl` link | A red line reads "Short map links can't be read here. Type the address instead." Nothing changes |
| 5 | **Map** form, no business address | Read the grey note | "Add your address in Settings › Business info, or type one here." with an **Edit business info** link to `/hub/settings?tab=business` |
| 6 | **Map** form | Leave **Show "Get directions"** on, or turn it off | The switch keeps your choice |
| 7 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 8 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 9 | Page header | Click **Preview page**, then **Publish changes** | A toast reads **Published. Your changes are live.** |
| 10 | The live page | Scroll to the map | A grey box with a pin, your address, a **Show map** button and "Loads Google Maps, which may set cookies." The cookie banner appears at the bottom of the site |
| 11 | The live page | Click **Show map** | The Google map loads in the box, centred on your address |
| 12 | The live page | Click **Get directions** | Google Maps opens in a new tab with directions to your address |
