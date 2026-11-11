---
feature: Page allowance and Add 5 more pages
phase: 11
route: /hub/website?tab=pages
---

# How to: Page allowance and Add 5 more pages

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every site includes 10 pages (D185). Only pages you build count: policy pages, the "Page not found" page, password pages and landing pages don't (D273). When you need more, add 5 more pages for $10 a month. Packs go on your one monthly bill and they stack (one pack gives you 15 pages, two give you 20). Before checkout the pack joins your order and is charged at checkout. Remove a pack any time and you're credited for the rest of the month.

Only the site owner can add or remove pages packs. Admins and Editors see "You've used all 10 pages included with your site. Ask your site owner to add more pages." support staff viewing the hub as the owner see "You're viewing as support staff, so buying is turned off. Only the owner can add pages."

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Sign in as the site **Owner** (not an Admin or Editor) | The hub opens on your dashboard |
| 2 | `/hub/website?tab=pages` | Open Website, then the Pages tab | Next to the **Pages** heading the count reads like **7 of 10 pages**, and under it "Policy, 404, password and landing pages don't count." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | Look at the URL column | Pages that don't use the allowance (the **Page not found** row, password pages) read "Doesn't count" under their address. At 8 or 9 of 10 there is no warning |
| 2 | Website › Pages, 10 of 10 pages | Look at the top of the list | **Add page** is replaced by a panel: "You've used all 10 pages included with your site. Add 5 more pages for $10/mo." (the price is the catalog's current one) with the button **Add 5 more pages, $10/mo** |
| 3 | Website › Pages, at the limit | Click **Add 5 more pages, $10/mo** | A dialog titled "Add 5 more pages?" opens: "Your site can have 15 pages." After checkout it shows "Today · {amount}" with "For the rest of {month}", "Then · $10/mo on your monthly bill from {date}" and "Plus sales tax. Charged to {card}.", with **Add and pay {amount}** and **Not now**. Before checkout it shows "It joins your order: $10/mo from checkout." with **Add 5 pages** |
| 4 | Add 5 more pages? | Click the primary button | It reads "Charging your card…", then the dialog closes and a toast reads "5 pages added. You can now have 15." The count reads "10 of 15 pages" and **Add page** is back. A double click or a retry never adds a second pack |
| 5 | Add 5 more pages?, card declined | Click the primary button with a card that is declined | The dialog stays open with "Your card was declined. Update it in Settings › Billing." and the link **Update card**. Nothing is added |
| 6 | Website › Pages, another tab used the last page | Type a title, then click **Create page** | The row stays open with your title kept and a warning: "You've used all 10 pages included with your site. Add 5 more pages for $10/mo." (the price is the catalog's current one) with the link **Add 5 more pages** (it opens the same dialog) |
| 7 | Website › Pages, billing paused | Look at the top of the list at the limit | The panel reads "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones." with the link **Update card and pay** |
| 8 | `/hub/settings?tab=billing` | Scroll to **What you pay for** | The row reads "+5 pages × 1" with "$10/mo", and **Remove one** under it |
| 9 | Settings › Billing, What you pay for | Click **Remove one** while your pages fit 10 | A dialog titled "Remove a 5-page pack?" reads "You go from 15 pages to 10 and your bill drops by $10 a month, credited for the rest of this month." with **Keep pack** focused. Click **Remove pack**: a toast reads "5-page pack removed. You can now have 10." |
| 10 | Settings › Billing, more pages than would be left | Click **Remove one** | No dialog opens. The row reads like "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack." |
