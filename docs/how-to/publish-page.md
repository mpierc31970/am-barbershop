---
feature: Preview and publish a page
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Preview and publish a page

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Edits save as a draft. Visitors see nothing until you publish. Every publish is checked first, and the last 10 published versions of each page are kept (CONT-30). The restore screen for older versions arrives in P11.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The builder opens at `/hub/website/pages/[pageId]`. A page never published reads **Not published yet** with a **Draft** badge and a **Publish** button |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website/pages/[pageId]` | Edit any block and click **Save block** | The header reads **Draft saved · Unpublished changes** with an **Unpublished changes** badge and a **Publish changes** button (a never-published page keeps **Publish**) |
| 2 | Page header | Click **Preview page** | `/hub/website/pages/[pageId]/preview` opens with the strip **Preview · This is your draft, visitors can't see it**. Hidden blocks are left out, as on publish |
| 3 | Preview strip | Click **Back to editor** | The builder opens again |
| 4 | Page header | Click **Publish changes** (or **Publish**) | The status reads **Publishing…**, then a toast reads **Published. Your changes are live.** with a **View page** link. The header reads like **Published 12 Sep, 2:14 pm** with a **Published** badge |
| 5 | Page header | Hover or focus the disabled **Publish** button with no new changes | The tooltip reads **No changes to publish** |
| 6 | Page header | Publish a page whose text the check flags for review | The status line reads **This page is being reviewed, usually within 2 business days.** with an **In review** badge. The live page does not change. **Publish changes** runs the check again |
| 7 | Page header | If publishing fails | A notice reads "Publishing didn't finish. Your draft is safe and your live page hasn't changed. Try again in a minute." |
| 8 | Toast | Click **View page** | The live page opens on your site with the new content |
