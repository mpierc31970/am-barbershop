---
feature: Today and Find
phase: 13
route: /staff
---

# How to: Today and Find

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Today** is the console's first screen: one list of everything that needs a person, most urgent first, and a status line for the platform. Each row is a count with a link straight to the screen that fixes it. **Find** (Ctrl K, or ⌘ K on a Mac) jumps to any ticket, site, case or screen from anywhere in the console. Both console roles see Today; rows for work a role can't open are not shown to it.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** (`/staff`). The browser tab reads "(3) Today" when 3 rows need attention |
| 2 | Sidebar | Read the counts next to **Tickets**, **Pipeline**, **Review queue** and **Health** | Each shows how many items wait there. No badge means nothing waits, or the count could not be read |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff` | Read **Needs attention** | Rows sorted by severity (critical, then warning, then info), then in a fixed order, for example "2 tickets missed SLA", "3 tickets at SLA risk", "1 held page past 1 business day", "1 health warning", "4 unassigned tickets", "2 fit holds", "1 build ready to approve", "2 sites in the polish queue", "1 report or DMCA case open", "2 thumbs-down ratings to follow up", "1 open incident · 0 active windows", "1 site with a notice to fix". A row with an age adds "oldest 2d" |
| 2 | A row | Click it | The matching screen opens already filtered: SLA rows → `/staff/tickets?sla=missed` or `?sla=at-risk`; held pages → `/staff/review`; health → `/staff/health`; fail-safe → `/staff/health?tab=failsafe`; unassigned → `/staff/tickets?assignee=none`; fit holds → `/staff/pipeline?tab=fit`; builds ready → `?tab=launch`; polish → `?tab=polish`; reports → `/staff/review?tab=reports`; ratings → `/staff/tickets?tab=ratings`; incidents → `/staff/tickets?tab=incidents`; notices → `/staff/sites?status=notice` |
| 3 | `/staff` with nothing waiting | Read the page | "Nothing needs you." and "Go do something nice." |
| 4 | A row whose source failed | Read it | The row shows its name with "Couldn't count" instead of a number; the rest of Today still loads |
| 5 | **Platform status** line | Read it | "14 live · 3 building · 7 open tickets · Jobs OK" (or "2 jobs late": see Health › Jobs). **See all open tickets** opens the Inbox |
| 6 | `/staff`, left open | Wait a minute | The counts refresh by themselves every 60 seconds, silently |
| 7 | Anywhere in the console | Press **Ctrl K** (⌘ K on a Mac) or click **Find a site or ticket** in the top bar | The **Find** dialog opens with the cursor in the field |
| 8 | **Find** | Type `1042`, `#1042`, a business name, a host (`riverabakery.com`), a case code (`R-32`, `I-3`, `W-12`) or a screen name (`Ratings`) | Results in groups **Tickets** ("#1042 Contact form not sending"), **Sites**, **Cases** and **Screens** ("Tickets › Ratings & SLA"), with "3 results". No match: "No match for “xyz”. Try a ticket number, a business name or a host." |
| 9 | **Find** results | Press the arrow keys, then **Enter** (or click a result) | That ticket, site, case or screen opens |
| 10 | Anywhere in the console | Press **?** | **Keyboard shortcuts** lists every key: Ctrl K Find, `g t` Today, `g i` Tickets inbox, `g p` Pipeline, `g r` Review queue, `g s` Sites, `j / k` next / previous row, Enter open row, and the ticket keys. **Turn off single-key shortcuts** switches them off; shortcuts never fire while you type in a field, except Ctrl Enter and Esc |
| 11 | `/staff` | Click **?** in the screen header | This article opens in the help drawer |
