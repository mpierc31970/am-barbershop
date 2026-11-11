---
feature: Care Plan
phase: 10
route: /hub/settings?tab=billing
---

# How to: Care Plan

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Care Plan is 1 hour a month of changes made for you by CDS, on top of the support every plan includes. It costs $99 a month, goes on your one monthly bill, and you can add or remove it any time. Unused time doesn't carry over: the hour resets on the 1st of each month (Central time).

Only the site owner can add or remove the Care Plan, and only after checkout (before checkout, add it on the checkout page instead). CDS staff viewing the hub as the owner see the Care Plan read-only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings?tab=billing` | Open Settings, then the Billing tab, and scroll to **Care Plan** | The Care Plan panel reads "1 hour a month of changes made for you by CDS, on top of the support every plan includes. Unused time doesn't carry over." with the button **Add the Care Plan, $99/mo** |
| 2 | Settings › Billing, Care Plan | Click **Add the Care Plan, $99/mo** | A dialog titled "Add the Care Plan?" opens and fills in the price: "Today · {amount}" for the rest of this month, "Then · $99/mo on your monthly bill from {date}", and "Plus sales tax. Charged to {card}." |
| 3 | The dialog | Click **Add and pay {amount}** | The button reads "Charging your card…", then the dialog closes and a toast reads "Care Plan added. Receipt emailed." The panel now shows the minutes meter and the Care Plan is listed in What you pay for at $99/mo. If your card is declined, the dialog says "Your card was declined. Update it in Settings › Billing." with an **Update card** link, and nothing is added |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support/tickets/new` | Click **Get help** on CDS Support and file a **Change request** for what you want (new photos, a price list update, a new section) (see [Get help](get-help.md)) | If CDS marks it a paid service, the ticket shows **Use my Care hour** with the minutes you have left; choose it and confirm (see [Paid services and your Care hour](paid-services-and-care-hour.md)). CDS makes the change and logs the minutes it took against your Care Plan, linked to the ticket |
| 2 | `/hub/support?tab=tickets` | Read **Your support** under the ticket list | The Care Plan row reads "On · 25 of 60 minutes used in October" with **Settings › Billing** |
| 3 | Settings › Billing, Care Plan | Read the meter | It reads e.g. "25 of 60 minutes used in October", then "Resets on 1 Nov. Need more than the hour? Ask CDS Support; extra time is quoted before any work starts." Below it, up to 5 recent entries (date · minutes · what was done), newest first, with **Show all {n}** for the rest. A new month with no time yet reads "No time used yet this month." |
| 4 | Settings › Billing, Care Plan | When the hour is used up | The meter is full at 60 minutes. CDS sends you a quote for anything more; it shows under Quotes from CDS for you to accept or decline, and no extra work starts until you accept |
| 5 | Settings › Billing, Care Plan | Click **Remove the Care Plan** | A dialog titled "Remove the Care Plan?" explains that CDS stops making changes for you today and your next bill is credited for the rest of the month; **Keep Care Plan** has the focus |
| 6 | The dialog | Click **Remove Care Plan** | The dialog closes, a toast reads "Care Plan removed.", the panel shows the **Add the Care Plan, $99/mo** button again, and the Care Plan row leaves What you pay for |
