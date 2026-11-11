---
feature: Our team block
phase: 08
route: /hub/website?tab=pages
---

# How to: Our team block

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The people customers will meet, always read live from Settings › Team & hours (D253, D257). The block stores only how to show them, so adding, hiding or editing a team member shows on every page that has this block.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click **Add block** | The right pane shows **Add a block** |
| 4 | **Add a block** | Under **Information**, click **Our team** ("The people customers will meet, from your team list") | An Our team row is added after the selected block and selected, its form opens, and the preview shows your published team members under the heading "Our team" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Our team** form | Read the blue note at the top | It reads "Team members come from Settings › Team & hours. Members you hide there don't show." with an **Edit your team** link |
| 2 | **Our team** form | Keep or change **Heading** (it starts as "Our team") | The preview heading shows your text. Clear it to show no heading |
| 3 | **Our team** form | Turn **Show roles** off | Roles disappear from under each name in the preview. Turn it back on to show them |
| 4 | **Our team** form | Turn **Show bios** off | Bios disappear from the preview |
| 5 | **Background** | Choose **Page color** or **Alternate color** | The chosen card is selected |
| 6 | Form footer | Click **Save block** | **Saved** shows for 3 seconds. The header reads **Draft saved · Unpublished changes** |
| 7 | **Our team** form | Click **Edit your team** | `/hub/settings?tab=team-hours` opens. Hide one member with **Show on site**, click **Save**, then go back to the page builder |
| 8 | Page header | Click **Publish changes** | A toast reads **Published. Your changes are live.** The hidden member no longer shows in the block on the live page |
| 9 | The live page, one member | Scroll to the block | A profile: the photo on the left, the name, role and bio on the right (photo above the text on a phone) |
| 10 | The live page, two or more members | Scroll to the block | Cards with a square photo on top and the name, role and bio under it. A member with no photo shows their initials in the frame; if nobody has a photo, each card starts with a round initials badge instead |
| 11 | Page builder, no published members | Look at the block in the preview | An editor-only card reads "No team members showing yet" and "Add team members in Settings › Team & hours and they show here." On the live page the block shows nothing at all |
