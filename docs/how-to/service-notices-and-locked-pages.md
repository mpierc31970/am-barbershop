---
feature: Service notices and locked pages
phase: 12
route: /hub/today
---

# How to: Service notices and locked pages

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When Support is working on your site, a notice strip at the top of your hub says so, and the part Support is fixing pauses its editing so your changes and Support's fix never clash. Anything you were saving at that moment is kept, and you choose what to do with it when Support is done. Support, Billing, Settings, Inbox and Profile are never paused by site-wide work.

## Activate

Nothing to turn on: notices appear by themselves when Support schedules or starts work that reaches your site.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any hub screen, while Support is working | Look under the top bar | A strip with the Support mark reads e.g. "Support is working on your site until 4:00 pm." with Support's message. A page notice shows only on that page's builder; a Footer, Menus or Header notice only on that Website tab; an add-on notice on that add-on's screens |
| 2 | Any hub screen, work planned within 24 hours | Look under the top bar | A plain strip with a calendar icon reads e.g. "Planned work on your site Thu 16 Oct, 9:00–11:00 pm." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | A planned-work strip | Click the **X** ("Dismiss this notice") | The strip goes away for you only. Work that has started can't be dismissed |
| 2 | A strip with **What happened** | Click **What happened** | A dialog shows the known problem: "Known problem: {title}", **Being fixed** or **Fixed**, and what Support has said. Click **Close** |
| 3 | Any hub screen, more than two notices | Click **1 more notice** | The extra notice opens in place. Work under way is listed before planned work |
| 4 | `/hub/website/pages/<id>` (or the Footer, Navigation, Banner or Site settings tab, or an add-on tab) while Support works on it | Open the editor | A Support panel reads "Editing is paused while Support works on this page", "You can look around, but changes are paused so nothing clashes with Support's fix." and "Until 4:00 pm". Edit controls are greyed out; Preview, History (read only) and the rest of the hub keep working |
| 5 | The same editor, if the pause started while you were editing | Click **Save** | Nothing is lost: the panel adds "Your unsaved changes are kept. You can apply them when Support is done." and "Saved at 2:14 pm". Autosaving editors show "Editing paused" |
| 6 | The same editor, after Support finishes | Open it again (it refreshes by itself shortly after the end time) | A panel reads "Support has finished. Your changes from 2:14 pm are waiting." and "Applying puts them in your draft. Support's fix stays in this page's history, so you can switch back." with **Apply my changes** and **Discard my changes** |
| 7 | The held-changes panel | Click **Apply my changes** | A toast reads "Your changes are back in the draft. Publish when ready." (or "Your changes are saved." on a tab without a draft). The editor unlocks |
| 8 | The held-changes panel | Click **Discard my changes** | A toast reads "Your held changes were discarded." with **Undo** for 8 seconds, which brings the panel back |
| 9 | `/hub/today` › **Needs you** | Find "Your changes to {About us} are waiting" | Click **Review changes** to open that editor with the panel. Held changes are kept for 30 days |
| 10 | Any hub screen | When Support starts work or plans it | The bell shows "Support is working on your site until 4:00 pm" (urgent, with a warning icon), and you get an email and, if you turned it on, a phone alert (Profile › Alerts, row **Support service notices**) |
