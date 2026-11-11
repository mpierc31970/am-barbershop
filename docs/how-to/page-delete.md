---
feature: Delete and restore a page
phase: 11
route: /hub/website?tab=pages
---

# How to: Delete and restore a page

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Deleting a page takes it off your site straight away and frees a page from your allowance. It is not gone for good: it sits in **Recently deleted** for 30 days, and you can bring it back with its menu and footer links. Your home page and system pages (like "Page not found") can't be deleted.

Owners, Admins and Editors can delete and restore pages. Viewers only see **Open** in a page's menu.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub` | Sign in as the Owner, an Admin or an Editor | The hub opens on your dashboard |
| 2 | `/hub/website?tab=pages` | Open Website, then the Pages tab | Each page row ends with a **…** button named "More for {page}" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Website › Pages | Click **…** on the **About us** row | A menu opens with **Open**, **Page settings** and **Delete page** (in red). On the **Home** row the menu has no Delete page |
| 2 | Row menu | Click **Delete page** | A dialog titled "Delete About us?" opens: "It comes off your site straight away. You can restore it from Recently deleted for 30 days." **Keep page** is focused |
| 3 | Delete About us? | Read **Links to this page** | Each link that points at the page is listed, like "Menu: About us", "Footer: About" or "Button on Home: Learn more about us", then "These links are hidden while the page is deleted." |
| 4 | Delete About us? | Open **Send visitors who open /about-us to** | **Home** is chosen. You can pick another published page, or **Nobody (show your page-not-found page)**. Under it: "Search engines learn the new address." |
| 5 | Delete About us? | Click **Delete page** | The button reads "Deleting…", then the dialog closes, the row leaves the list and the count drops (for example "6 of 10 pages"). A toast reads "About us deleted." with **Undo** |
| 6 | Toast | Click **Undo** within 8 seconds | A toast reads "About us is back, with its menu and footer links." and the row is back |
| 7 | Your site, `/about-us` | Open the deleted page's old address | You land on the page you chose in step 4 (or your page-not-found page) |
| 8 | Website › Pages, below the table | Click **Recently deleted (1)** | It opens. Each row shows the title, its address, "Deleted 9 Oct by Maria · Gone for good on 8 Nov" and **Restore**. Under the list: "Deleted pages are removed for good after 30 days." |
| 9 | Recently deleted | Click **Restore** | A toast reads "About us is back, with its menu and footer links." The page moves back into the table and its old address works again |
| 10 | Recently deleted, all pages used | Click **Restore** | The row shows "You've used all 10 pages included with your site. Add 5 more pages for $10/mo." (the price is the catalog's current one). The Owner gets the link **Add 5 more pages**; others are asked to ask the site owner |
| 11 | Recently deleted, address now used | Click **Restore** | The row shows "Another page now uses /about-us. Change that page's address first, then restore this one." |
| 12 | Builder › **Page settings** | Scroll to the bottom and click **Delete this page** | The same dialog opens. After **Delete page** you land on Website › Pages with the "About us deleted." toast and **Undo**. On Home the drawer reads "Your home page can't be deleted." |
