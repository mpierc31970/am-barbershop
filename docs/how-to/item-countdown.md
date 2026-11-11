---
feature: Countdown item
phase: 03
route: /hub/website/pages/[pageId]
---

# How to: Countdown item

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A live countdown (days, hours, minutes, seconds) to a date and time, which shows your message when it reaches zero (CONT-10).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website?tab=pages` | Click the page title | The page builder opens at `/hub/website/pages/[pageId]` |
| 3 | `/hub/website/pages/[pageId]` | Click a **Columns** row in the block list | The Columns form opens |
| 4 | Columns form, a column | Click **Add item**, then **Countdown** | A new Countdown item is added and its form opens |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Countdown item form, **Counts down to** | Pick the date and time | The helper under the field names your time zone, for example **Your time zone: America/Chicago**. The time is taken in that zone |
| 2 | Countdown item form | Fill **Message when it reaches zero**, for example "Doors are open." | — |
| 3 | Countdown item form | Click **Save item** with the message empty | The error reads 'Write what visitors see when the countdown ends, like "Doors are open."' |
| 4 | Countdown item form | Fill the message, click **Save item** | The item row reads `Countdown · 12 Oct, 9:00 am`. The header reads **Draft saved · Unpublished changes** |
| 5 | Page header | Click **Preview page** | The countdown ticks once a second (once a minute, without seconds, when the device asks for reduced motion) |
| 6 | Preview strip | Click **Publish changes**, then open the page on your site after the target time | The numbers are replaced by your message in the same box |
