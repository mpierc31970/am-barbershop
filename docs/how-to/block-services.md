---
feature: Services block
phase: 08
route: /hub/website?tab=pages
---

# How to: Services block

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Your services and prices, always read live from Website › Services (D37, D253). The block stores only how to show them, so a change to a service shows on every page that has this block. Change a price once and the site follows.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Services** ("Your services and prices, always up to date") | A Services row is added after the selected block and selected, its form opens, and the preview shows your published services as cards under the heading "Services" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Services** form | Read the blue note at the top | It reads "Services come from Website › Services, so changes there show here right away." with an **Edit services** link. Under it: "Showing 6 of 12 services on your site." (or "Showing all 4 services on your site.", or "No services are showing yet.") |
| 2 | **Services** form | Keep or change **Heading** (it starts as "Services") | The preview heading shows your text. Clear it to show no heading |
| 3 | **Services** form | Under **Display**, click **List** | The preview shows one service per row: name and price on the first line, how long it takes and the description under it |
| 4 | **Services** form | Under **Display**, click **Cards** | The preview shows a grid of cards: name, price · duration, then the description |
| 5 | **Services** form | Open **How many to show** and pick **6** (choices: All, 3, 6, 9, 12) | The preview shows only your first 6 services, and the count line reads "Showing 6 of 12 services on your site." |
| 6 | **Services** form | Turn **Show descriptions** off | Descriptions disappear from the preview. Turn it back on to show them |
| 7 | **Services** form | Turn **Show how long each takes** off | Durations ("45 minutes", "1 hour") disappear from the preview |
| 8 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 9 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 10 | **Services** form | Click **Edit services** | `/hub/website?tab=services` opens. Hide one service with its **Show on site** switch, then go back to the page builder |
| 11 | Page header | Click **Publish changes** | A toast reads **Published. Your changes are live.** The hidden service no longer shows in the block on the live page |
| 12 | The live page | Scroll to the block | Prices read like "$45", "$45.50", "From $45", "Free" or "Ask for a price"; durations like "45 minutes", "1 hour", "90 minutes" |
| 13 | Page builder, no published services | Look at the block in the preview | An editor-only card reads "No services showing yet" and "Add services in Website › Services and they show here." On the live page the block shows nothing at all |
