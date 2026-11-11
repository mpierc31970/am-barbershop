---
feature: Site menu
phase: 07
route: /hub/website?tab=navigation
---

# How to: Site menu

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The menu at the top of every page of your site: up to 8 links, one level of dropdowns, and an optional button at the end (CONT-13). Changes are live on your site as soon as you save.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click the **Navigation** tab | The address becomes `/hub/website?tab=navigation`. The heading reads **Navigation** with "Changes show on your site as soon as you save." under it, and a **Preview** shows your site's header. Every site already has a menu; an empty one reads "Your menu is empty, so visitors only see your logo. Add your main pages." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=navigation` | Click **Add link**. Under **Links to** keep **A page** and choose **About** in **Page** | An inline row opens below the list (not a pop-up). **Label** fills itself with "About" |
| 2 | New link row | Click **Add to menu** | The row closes, **About** is the last row in **Menu links** with "Page: About" under it, and the preview header shows **About** |
| 3 | `/hub/website?tab=navigation` | Click **Add link**, type **Label** "Shop", choose **A web address**, type `https://shop.example.com`, turn on **Open in a new tab**, click **Add to menu** | A **Shop** row shows "shop.example.com" with a small open-in-new-tab icon. A web address without `https://` shows "Choose a page or enter a web address starting with https://." |
| 4 | **Menu links** | On a row, click the **…** button (**More actions for About**), then **Move up** or **Move down** | The row moves one place and the preview follows. Dragging the grip on the left does the same |
| 5 | **Menu links** | On **Team**, click **…**, then **Put under "About"** | **Team** indents under **About** with a thin line on its left, and the preview shows **About** with a small down arrow (a dropdown). Dragging a row to the right also puts it under the row above |
| 6 | **Menu links** | On **Team**, click **…**, then **Move out of "About"** | **Team** is a top-level link again, right after the **About** group |
| 7 | **Menu links** | On **Shop**, click **…**, then **Remove from menu** | The row disappears and a toast reads "Shop removed from the menu." with **Undo**. Clicking **Undo** within 8 seconds puts it back |
| 8 | **Menu button** | Turn on **Show a button at the end of the menu**, keep **Button text** "Book now", keep **Opens: A page** and choose **Book** | The preview header ends with a **Book now** button |
| 9 | **Menu button** | Choose **Opens: A pop-up** and pick a pop-up | Under the list: "The button shows on pages where this pop-up is set to appear." |
| 10 | **Preview** | Click **Phone**, then **Computer** | The preview narrows to a phone width with a **Menu** button, then returns to the full header |
| 11 | `/hub/website?tab=navigation` | Click **Save navigation** | A toast reads "Menu saved. It's live on your site." Reload your site: the menu is there |
| 12 | Your site, any page | Click **About** in the menu | The dropdown opens below it (a click, not a hover). **Esc** closes it and returns focus to **About**. The page you're on is underlined |
| 13 | Your site on a phone | Tap **Menu** | The menu opens below the header and pushes the page down; dropdown links are listed indented under their parent. **Esc** closes it |
| 14 | `/hub/website` (Pages tab) | Click **Add page**, type a **Title**, keep **Show this page in the site menu** ticked, click **Create page** | The page is created and added to the end of your menu. "It shows in the menu once the page is published." The box starts unticked when your menu already has 6 links |
| 15 | `/hub/website?tab=testimonials` | On the line "Your Testimonials page: /testimonials", click **Add to navigation** | A toast reads "Testimonials page added to your menu." and the line now reads **In your menu · Arrange** (Arrange opens the Navigation tab) |
| 16 | `/hub/website?tab=navigation` | With 8 top-level links, look at **Add link** | **Add link** is greyed out with "Menus hold up to 8 links. Put some under another link, or remove one." |
| 17 | `/hub/website?tab=navigation` | Under **Search**, turn on **Show a search button in the menu**, then click **Save navigation** | The preview shows a magnifier at the end of the header. After the save the site header shows the magnifier (its name is "Search this site") and it opens the search page, `/search` |
