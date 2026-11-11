---
feature: People & roles (invite someone, change role, add-on access, remove)
phase: 11
route: /hub/settings?tab=people
---

# How to: People & roles

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Settings › **People & roles** lists everyone who can use the hub and the invites still waiting. Each person signs in with their own email and sees only what their role allows (D285):

| Role | Can do |
|---|---|
| **Owner** | Everything, including paying, buying and downloading the site's data. Only the Owner manages people |
| **Admin** | Runs the site day to day: pages, messages, settings and add-ons. Reads this tab but can't change it |
| **Editor** | Edits pages and content and reads messages. Can't change settings. Sees no People & roles tab |
| **Viewer** | Sees pages, messages and reports. Can't change anything. Sees no People & roles tab |

Editors and Viewers can also be given **Add-on access**: each ticked add-on (for example Testimonials) they can open and edit, nothing more. Owners and Admins reach every add-on already. Staff and Renter roles appear only once an add-on that uses them is on the site.

Until real email is connected (SES), invite emails are logged, not sent (GO-LIVE).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings` (signed in as the Owner) | Click the **People & roles** tab (between **Email** and **Payments**) | The heading **People who can use this hub** shows with an **Invite someone** button. Your own row reads **Owner** and **You**, with no actions. With nobody else yet, the line "Just you so far. Invite someone to help with your site." shows under the table |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings?tab=people` | Click **Invite someone** | The **Invite someone** dialog opens with **Email**, the **Role** cards (Admin, Editor, Viewer, each with one line on what it can do) and the buttons **Send invite** and **Not now** |
| 2 | Invite dialog | Type `sam@example.com` in **Email**, click the **Editor** card, tick **Testimonials** under **Add-on access**, click **Send invite** | The button reads "Sending invite…", the dialog closes, a toast reads "Invite sent to sam@example.com." and a row for sam@example.com shows **Editor**, **Testimonials** and **Invited · sent 12 Oct** |
| 3 | Invite dialog | Try an address that is already on the team | "sam@example.com already has access to this site." shows under **Email**; nothing is sent |
| 4 | Sam's inbox (the logged email, until SES) | Open the invite email and click the link | `/invite/<token>` opens: "Join Rivera Bakery". Sam types **Your name** and a **Password** and clicks **Join Rivera Bakery** (or **Sign in and join** if Sam already has an account) and lands on **Today** for that site, where a toast reads "Welcome to Rivera Bakery." The link works once and for 7 days. If Sam's account has no password (owners who signed up by emailed code), Sam clicks **Sign in with an emailed code** under the form, signs in with the code and comes straight back to the invite, which now shows **Join Rivera Bakery** |
| 5 | `/hub/settings?tab=people` | Refresh the page | Sam's row now shows Sam's name and email, **Editor** and **Testimonials**, with no **Invited** status |
| 6 | Sam's row | Click the **…** button (**More actions for Sam Lee**), then **Change role** | A panel opens from the right with the same **Role** cards and **Add-on access** ticks, set to Sam's current access |
| 7 | Change role panel | Click **Admin**, then **Save role** | The panel closes and a toast reads "Sam is now an Admin." The **Add-on access** column reads **All add-ons** |
| 8 | Change role panel (open it again) | Click **Viewer**, then **Save role** | A warning asks "Change Sam from Admin to Viewer?" with **Keep Admin** (focused) and **Make Viewer**. Click **Make Viewer**: the toast reads "Sam is now a Viewer." |
| 9 | An invite row's **…** menu | Click **Resend invite** | A toast reads "New invite sent to kim@example.com. The old link no longer works." |
| 10 | An invite row's **…** menu | Click **Cancel invite** | The row leaves the table and a toast reads "Invite to kim@example.com cancelled." with **Undo** for 8 seconds. **Undo** sends a fresh invite with the same role and access |
| 11 | Sam's **…** menu | Click **Remove from this site** | A dialog asks "Remove Sam from Rivera Bakery?" with **Keep Sam** focused. Click **Remove from this site**: the row leaves, a toast reads "Sam no longer has access." Anything Sam made stays on the site |
| 12 | `/hub/settings?tab=people` (signed in as an Admin) | Open the tab | The same table, no buttons, and the line "Only the site owner can invite people or change roles." |
