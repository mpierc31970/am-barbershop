---
feature: Rate a resolved ticket
phase: 13
route: /hub/support/tickets/<number>
---

# How to: Rate a resolved ticket

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When Support marks one of your tickets **Resolved**, you can tell Support whether it went well: **Yes** or **No**, with an optional comment. Owners, Admins and Editors can rate, and so can the person who filed the ticket. One rating per ticket; you can change it until the ticket is **Closed**. Rating never reopens or closes the ticket. Support reads every rating, and a **No** goes straight to the Support team so someone follows up.

## Activate

Nothing to turn on: the question appears on every ticket Support resolves, and in the "resolved" email.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support?tab=tickets` | Click a ticket with the **Resolved** badge | `/hub/support/tickets/<number>` opens. Under the thread: "Was this resolved well?" with **Yes** and **No** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support/tickets/<number>` (Resolved) | Under "Was this resolved well?" click **Yes** or **No** | The button stays pressed and the card reads "Thanks. Support reads every rating." |
| 2 | Same card | Type in **Anything to add?** (up to 500 characters) and click **Save comment** | "Saving…", then the toast "Comment saved." Over 500: "Keep it to 500 characters." |
| 3 | Same card, while the ticket is still Resolved | Click the other button | Your rating changes. Support sees the new one |
| 4 | Your email inbox | Open the email saying the ticket is resolved | At the bottom: "Was this resolved well? Yes · No", two plain links |
| 5 | The email | Click **Yes** or **No** (sign in to the hub if asked) | `/hub/support/tickets/<number>/rate` opens with your choice already pressed. Nothing is saved yet |
| 6 | The rate page | Click **Save rating** | You land on the ticket and the toast reads "Thanks. Your rating is saved." Add a comment there as in step 2 |
| 7 | The rate page, an old or altered link | Open it | "This rating link has expired. You can still rate on the ticket while it's resolved." with a link to open the ticket. If the ticket is already closed: "This ticket is closed, so ratings are finished." |
| 8 | `/hub/support/tickets/<number>` (Closed) | Read the card | "You rated this Yes." (or No) with no buttons: a closed ticket can't be rated. If nobody rated it, the card is gone |
| 9 | Same page, as a Viewer | Look under the thread | No rating card: Viewers can't rate. Opening a rating link from the email shows a line saying who can rate (Owners, Admins, Editors and the person who filed it) |
| 10 | Same page, while support staff view your hub | Read the card | "Ratings are turned off while viewing as support staff." Only your team can rate |
