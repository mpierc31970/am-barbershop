---
feature: Page not found
phase: 07
route: /hub/website?tab=pages
---

# How to: Page not found

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When a visitor types a wrong address or follows an old link, your site shows a friendly "Page not found" page in your own design instead of a bare error (CONT-28, D235 #11). Under it there is always a list of **Popular pages** (the links in your menu) and, when site search is on, a search box (D-UI-P7-31). The page is ready from day one with a default title and line. You can edit it like any other page; it never counts toward your 10 pages, never shows in your menu and is never listed for search engines.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | Find the **Page not found** row right under **Home** | It shows "—" as its address, a **System page** badge and "Doesn't count" |
| 2 | `/hub/website?tab=pages` | Click **Page not found** | The page builder opens with the label "Page not found" above the title "We can't find that page" and one text block: "The page may have moved, or the address may have a typo." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any made-up address on your site, e.g. `/no-such-page` | Open it | Your site's menu and footer, the title "We can't find that page", the line "The page may have moved, or the address may have a typo.", then **Popular pages** with your menu links |
| 2 | `/hub/website/pages/<id>` (the Page not found builder) | Change the title, edit the text, or click **Add block** to add another block, then click **Publish** | The status reads Published |
| 3 | The made-up address | Reload | Your edited page shows, still followed by **Popular pages** |
| 4 | `/hub/website?tab=navigation` | Add, remove or reorder menu links and save | The **Popular pages** list on the made-up address follows your menu |
| 5 | `/hub/website?tab=navigation` | Turn on **Search** and save | A **Search this site** box appears above **Popular pages** on the made-up address |
| 6 | `/hub/website/pages/<id>` (the Page not found builder) | Open **SEO & sharing** | Only the search title and description show: this page has no address and no share image |
