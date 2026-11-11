---
feature: Media storage packs
phase: 10
route: /hub/website?tab=media
---

# How to: Media storage packs

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every site includes 2 GB of media storage for photos, video and audio. When you need more, add a storage pack: 5 GB for $5 a month or 25 GB for $15 a month. Packs go on your one monthly bill, charged to the card you saved at checkout, and they stack (two 5 GB packs give you 12 GB). Remove a pack any time and you're credited for the rest of the month.

Only the site owner can buy or remove packs, and only after checkout. Admins and Editors see "Media storage is full. Ask your site owner to add more, or delete something to make room." support staff viewing the hub as the owner see the same line and no purchase buttons.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Sign in as the site **Owner** (not an Admin or Editor) | The hub opens on your dashboard |
| 2 | `/hub/settings?tab=billing` | Open Settings, then the Billing tab, and check the status strip | The strip shows your card on file (for example "Visa ending 4242"). Without a saved card, finish checkout first |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=media` | Look under the **Media** heading | The meter reads like "1.2 GB of 2 GB used". From 80% a warning reads "You've used 1.7 GB of your 2 GB of media. Delete files you no longer use, or add more storage." with the link **Add storage** (it opens Settings › Billing at **Media storage**) |
| 2 | Website › Media, meter full | Look at the top right, where **Upload files** usually is | **Upload files** is replaced by **Add 5 GB for $5/mo** (primary) and **Add 25 GB for $15/mo**. The prices on the buttons are the current catalog prices, so they follow any price change; a size whose price is not set yet is not offered. Under the meter: "You've used all 2 GB of your media storage. Add more, or delete something to make room." |
| 3 | Website › Media, meter full | Click **Add 5 GB for $5/mo** | A dialog titled "Add 5 GB of media storage?" opens and fills in the price: "Today · {amount}" with "For the rest of {month}", "Then · $5/mo on your monthly bill from {date}", and "Plus sales tax. Charged to {card}." The buttons are **Add 5 GB** (focused) and **Not now** |
| 4 | Add 5 GB of media storage? | Read **Today** and **Then**, then click **Add 5 GB** | The button reads "Charging your card…", then the dialog closes and a toast reads "5 GB added. You now have 7 GB." The meter reads "2 GB of 7 GB used" and **Upload files** is back |
| 5 | Add 5 GB of media storage?, card declined | Click **Add 5 GB** with a card that is declined | The dialog stays open with "Your card was declined. Update it in Settings › Billing." and the link **Update card**. Nothing is added. (If the pack price changed while the dialog was open, it shows "The price changed since you opened this. Check the new figure, then confirm again." with the new **Today** figure instead; nothing is charged until you confirm again. A double click or a retry never adds a second pack.) |
| 6 | Page builder, a photo, video or audio item, meter full | Click **Choose a photo**, then the **Upload** tab | The picker shows "You've used all 2 GB of your media storage…" with the link **Add storage**. Packs are never sold inside the picker |
| 7 | `/hub/settings?tab=billing` | Scroll to **Media storage** and click **Add 5 GB, $5/mo** (or **Add 25 GB, $15/mo**) | The same "Add 5 GB of media storage?" dialog opens. Confirm with **Add 5 GB**: the toast reads "5 GB added. You now have {total}." |
| 8 | Settings › Billing, Media storage | Add a second pack the same way | Packs stack: the row reads "+5 GB pack × 2 · $5/mo" and the meter reads "… of 12 GB used" |
| 9 | Settings › Billing, Media storage | Click **Remove one** on a pack row | A dialog titled "Remove a 5 GB pack?" reads "Your storage drops by 5 GB and your bill drops by $5 a month, credited for the rest of this month." with **Keep pack** focused. Click **Remove pack**: a toast reads "5 GB pack removed. You now have {total}." |
| 10 | Settings › Billing, Media storage, media over what would be left | Click **Remove one** | No dialog opens. The row reads like "You're using 6.5 GB, more than the 2 GB you'd have left. Delete 4.5 GB of media first, then remove the pack." Delete files in Website › Media, then try again |
