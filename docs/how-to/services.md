---
feature: Services
phase: 06
route: /hub/website?tab=services
---

# How to: Manage your services

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Website › Services** lists what you offer and what it costs. Visitors see the services on your site, and you choose which to show. It is the same list as setup step **Your words & services**, so services added during setup are already here. The owner and admins can change it; an editor sees it read-only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar | Click **Website**, then the **Services** tab (second, after **Pages**) | The address ends in `/hub/website?tab=services` |
| 2 | `/hub/website?tab=services`, empty list | Read the empty state | "No services yet" with "List what you offer and what it costs. Visitors see them on your site, and you choose which to show.", **Add your first service** and **Import from a spreadsheet** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=services` | Click **Add your first service** (later: **Add a service**) | A drawer titled **Add a service** opens on the right with **Name**, **Description**, **Price**, **Duration** and **Show on site** |
| 2 | **Add a service** drawer | Type **Name** "Haircut", pick **Price** **Fixed price**, type **Amount** 45, pick **Duration** "60 minutes", click **Save service** | The drawer closes and a toast reads "Service saved." The row reads "Haircut" over "$45 · 60 min" |
| 3 | **Add a service** drawer | Add "Color" with **Starting at** and Amount 80 | The row reads "From $80" |
| 4 | **Add a service** drawer | Add "Consultation" with **Free** | There is no Amount field; the row reads "Free" |
| 5 | **Add a service** drawer | Add "Wedding hair" with **Ask for a price** | There is no Amount field; the row reads "Ask for a price" |
| 6 | **Add a service** drawer | Pick **Fixed price** and leave **Amount** empty, then click **Save service** | Red text: "Add a price, like 45 or 45.00." Nothing is saved |
| 7 | `/hub/website?tab=services` | Open the **More** menu and click **Download the template** | A CSV downloads with the columns name, description, price_type, price, duration_minutes, show_on_site |
| 8 | Excel or Google Sheets, then **Import** | Type your price list into the template (price_type is Fixed, Starting at, Free or Ask), save it as CSV, click **Import** and drop the file | The **Import services** dialog lists the rows. A bad row reads like "Row 6: Price type must be Fixed, Starting at, Free or Ask." With no errors, click **Import N changes**: a toast reads like "Imported. 12 added, 0 updated." |
| 9 | A service row | Turn off **Show on site** | A grey **Hidden** badge appears; the service stays in your list but not on your site |
| 10 | A service row | Open its **More actions for Haircut** menu and click **Move up** (or drag the row by its handle) | The row moves; the order is the order on your site |
| 11 | A service row | Open its menu and click **Delete service** | A dialog asks "Delete Haircut?" with "It disappears from your site right away. To keep it but stop showing it, turn off Show on site instead." **Keep service** has the focus; **Delete service** deletes it |
| 12 | `/hub/website?tab=services` | Open the **More** menu and click **Export CSV** | A CSV of your services downloads and a toast reads like "Exported 12 services." |
