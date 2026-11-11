---
feature: Team and opening hours
phase: 06
route: /hub/settings?tab=team-hours
---

# How to: Manage your team and opening hours

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Settings › Team & hours** holds the people customers will meet and your opening hours. They are the same records as setup steps **People & proof** (team) and **Contact & hours** (hours), so anything added during setup is already here. Team members can show on an Our Team section of your site; the site says "Contact us for hours" while every day is closed. The owner and admins can change them; an editor sees them read-only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar | Click **Settings**, then the **Team & hours** tab | The address ends in `/hub/settings?tab=team-hours`. **Team** comes first, then **Opening hours** |
| 2 | `/hub/settings?tab=team-hours`, empty team | Read the empty state | "No team members yet" with **Add a team member** and **Import from a spreadsheet**, and "Just you? Add yourself, or leave this empty and your site won't show a team section." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Team** | Click **Add a team member** | A drawer titled **Add a team member** opens on the right with **Name**, **Role or title**, **Bio**, **Photo** and **Show on site** (on) |
| 2 | **Add a team member** drawer | Type **Name** "Maria Lopez" and **Role or title** "Owner", add a photo, click **Save team member** | The drawer closes and a toast reads "Team member saved." The row shows the photo (or "ML" initials without one), the name over the role, and a **Show on site** switch |
| 3 | **Team** | Open the **More** menu and click **Download the template** | A CSV with the columns name, role, bio, show_on_site downloads. Photos are added in the drawer |
| 4 | **Team** | Fill in the template, then click **Import** and drop the file | The **Import team members** dialog checks the file and lists new and updated rows. Click **Import N changes**: a toast reads like "Imported. 3 added, 0 updated." |
| 5 | A team row | Open its **More actions for Maria Lopez** menu and click **Move down** (or drag the row by its handle) | The row moves; the order is the order on your site |
| 6 | A team row | Turn off **Show on site** | A grey **Hidden** badge appears. The person stays in your list but not on your site |
| 7 | A team row | Open its menu and click **Remove from team** | A dialog asks "Remove Maria Lopez from your team?" with "They won't show on your site. This doesn't affect anyone's sign-in." **Keep team member** has the focus; **Remove from team** removes them |
| 8 | **Opening hours** | Turn on **Open** for Monday and pick 9:00 am to 5:00 pm | Top right under the page heading, the status reads "Saving…", then "Saved". "Times are in America/Chicago." sits above the days, with **Change time zone** linking to Business info |
| 9 | **Opening hours** | Click **Copy Monday to weekdays** | Tuesday to Friday take Monday's hours and a toast reads "Copied Monday's hours to Tuesday to Friday." |
| 10 | **Opening hours**, Saturday | Turn on **Open**, set 9:00 am to 12:00 pm, click **Add hours** and set 2:00 pm to 5:00 pm | Saturday shows two ranges (a split day), each with its own remove button |
| 11 | **Opening hours**, a range | Pick a closing time before the opening time | Red text under the row: "Monday's closing time is before its opening time. Pick a later closing time." Nothing is saved until it's fixed |
| 12 | **Opening hours** | Turn off **Open** on every day | The helper reads "Leave all days closed and your site says 'Contact us for hours'." |
