---
feature: My social accounts and Grow your social
phase: 11
route: /hub/marketing?tab=social
---

# How to: My social accounts and Grow your social

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Social accounts are part of every site (no add-on to buy). They show as icons in the site's footer, feed the Social block, and each one gets a short **bio link** (`/ig`, `/fb`, `/go/<name>`) that sends visitors to your home page and counts the visit as social in **Reports › Social**. Support never posts for you and never shows follower counts.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar | Click **Marketing** | The **Marketing** screen opens with the tabs **Contacts · Social** (Editors and Viewers see **Social** only) |
| 2 | `/hub/marketing` | Click the **Social** tab | `/hub/marketing?tab=social` shows **My social accounts**, **Add an account** and **Grow your social** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/marketing?tab=social` › **Add an account** | Click **Instagram** | A form row opens at the end of **Your accounts** with the field **Instagram profile address** |
| 2 | Same form row | Type `https://instagram.com/riverabakery`, click **Save account** | A toast reads "Instagram added. It shows in your site's footer." and Instagram is listed with **Bio link: <your site>/ig**; the Instagram button leaves **Add an account** |
| 3 | Same form row (try a mistake) | Type `http://instagram.com/x` or a Facebook address, click **Save account** | Under the field: "Enter the full address, starting with https://." or "That isn't an Instagram address. It should start with https://instagram.com/." Nothing is saved |
| 4 | **Add an account** | Click **Add another**, type **Name** `Etsy` and the address `https://etsy.com/shop/riverabakery`, click **Save account** | Etsy is listed with a globe icon and **Bio link: <your site>/go/etsy** |
| 5 | Instagram row | Click **Copy link for your Instagram bio** | The button shows a check and **Copied** for 2 seconds; paste the link into your Instagram bio. If the browser blocks copying, the link appears selected in a box labelled **Copy this link.** |
| 6 | Instagram row | Click **More for Instagram** (three dots), then **Move down** | Instagram moves one place down; the footer icons follow this order |
| 7 | Instagram row | Click **More for Instagram**, then **Edit**, change the address, click **Save account** | The row shows the new address; the bio link stays the same |
| 8 | Etsy row | Click **More for Etsy**, then **Remove** | Etsy leaves the list and a toast reads "Etsy removed." with **Undo** for 8 seconds; **Undo** puts it back in the same place |
| 9 | **Grow your social** | Tick **Put your bio link from this page in your Instagram bio** | The tick saves straight away ("Saved" is announced) and the count beside the heading goes up, e.g. "2 of 14 done"; everyone on the site sees the same ticks |
| 10 | Site footer (open your site) | Reload any page | The footer shows the Instagram and Etsy icons in list order |

## Good to know

- **Bio link uses /go/ instead:** if one of your pages already uses the address `/ig`, the page wins and the account's link becomes `/go/ig`. The row says so under the bio link.
- **Before launch:** bio links use your preview address. The list says "These links use your preview address until your site moves to its own domain. Copy them again after launch."
- **Who can edit:** Owners and Admins add, edit, reorder and remove accounts and tick tips. Editors and Viewers see the list and can copy bio links.
- **Visits from bio links** appear the next day in **Reports › Social**.
- **The Grow your social checklist** has its own how-to: [Grow your social](grow-your-social.md).
