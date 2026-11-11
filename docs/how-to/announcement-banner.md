---
feature: Announcement banner
phase: 03
route: /hub/website?tab=banner
---

# How to: Announcement banner

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

One short line in a strip above every page of the site, with an optional link and an optional schedule (CONT-11).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click the **Banner** tab | The address becomes `/hub/website?tab=banner`. A preview strip reads "Your announcement shows here." and the status line under it reads **Off. Visitors don't see a banner.** |
| 3 | `/hub/website?tab=banner` | Turn on **Show banner** | The switch is on. **Save banner** becomes clickable |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=banner` | Type the **Message**, for example "Spring open house this Saturday" | The preview strip shows your words as you type and the counter under the field reads like **32 / 140**. It stops at 140 |
| 2 | `/hub/website?tab=banner` | Optionally fill **Link text (optional)**, for example "Book now", and **Link URL**, for example `/events` | The link shows after the message in the preview. Link text with no address shows "Add the address this link goes to." |
| 3 | **Schedule (optional)** | Leave **Starts** and **Ends** empty, click **Save banner** | A toast reads **Banner saved.** The status line reads **Showing on every page now.** |
| 4 | **Schedule (optional)** | Pick a future **Starts** and a later **Ends** (the helper names your time zone), click **Save banner** | The status line reads like **Starts 12 Oct, 9:00 am. Ends 19 Oct, 11:59 pm.** |
| 5 | **Schedule (optional)** | Pick an **Ends** earlier than **Starts** | The error reads like "The end time is before the start time. Pick an end after 12 Oct, 9:00 am." |
| 6 | `/hub/website?tab=banner` | When the start time has passed, reload the tab | The status line reads like **Showing now until 19 Oct, 11:59 pm.** After the end it reads **Ended 3 Oct, 5:00 pm. Turn it off or pick new dates.** |
| 7 | Your site, any page | Open the site in a new tab (sidebar **View site**) within about a minute of saving | The banner strip shows above the page. It has no close button |
| 8 | `/hub/website?tab=banner` | Turn off **Show banner**, click **Save banner** | The status line reads **Off. Visitors don't see a banner.** and the strip is gone from the site within about a minute |
