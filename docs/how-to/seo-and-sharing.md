---
feature: SEO & sharing
phase: 07
route: /hub/website/pages/<id>?seo=1
---

# How to: SEO & sharing

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every page already has a search title, a description and a share image, suggested from what you wrote (CONT-13, CONT-14, D188). **SEO & sharing** lets you change them, shows how the page looks in search results and lists simple checks for search and accessibility (CONT-35). The checks are suggestions: you can always publish. Your site icon (the little picture in a browser tab) and your site's share image are made from your logo automatically (CONT-28).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click a page's title, for example **About us** | The page builder opens at `/hub/website/pages/<id>`. The header shows **SEO & sharing** (a magnifier icon) before **Preview page**, with an amber badge such as **3 to check** when a check needs a look |
| 3 | Page builder header | Click **SEO & sharing** | A panel slides in from the right titled **SEO & sharing** and the address ends in `?seo=1`. It has three parts: **How it looks in search**, **Details** and **Checks**. Empty fields show a **Suggested:** line with a **Use this** button |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **How it looks in search** | Read the preview | A grey card shows your address (for example "riverabakery.com › about-us"), the title in bold (cut with "…" after 60 characters, like Google) and two lines of description. It uses the suggestions until you type your own |
| 2 | **Details** › **Title in search results** | Click **Use this** under "Suggested: About us \| Rivera Bakery" | The title fills in and its counter reads "26 / 60". **Save SEO settings** turns on |
| 3 | **Details** › **Description** | Type a sentence about the page and watch the counter | The counter counts up to "/ 160" and turns red past 160. The search preview updates as you type |
| 4 | **Details** › **Page address** | Change `about-us` to `our-story` | The line "Visitors using /about-us are sent here automatically." appears under the field. After you publish, the old address forwards to the new one |
| 5 | **Details** › **Share image** | Click **Choose a photo**, pick a photo on **Your media**, click **Use this photo** | The photo shows in the field with **Replace** and **Remove**. This is the picture people see when they share the page on Facebook, LinkedIn or in a text message |
| 6 | **Share image** picker | Click the **Free photos** tab (only there when free photos are switched on for Support), search "bakery", click a photo, check its **Description**, click **Use this photo** | The free photo is used by its link; it never counts toward your 2 GB. Each result shows "Photo by <name>" |
| 7 | **Share image** | Click **Remove** | The field is empty and a preview of your site's share image shows with "Uses your site's share image. Choose one for this page if you like." |
| 8 | Drawer footer | Click **Save SEO settings** | A toast reads "SEO settings saved. They go live when you publish." **Discard changes** goes away |
| 9 | **Checks** | Read the list | "These are suggestions. You can publish anytime." heads two groups, **Search** and **Accessibility**. Amber rows have a warning icon and a **Fix** link; the rest fold under "7 checks look good" |
| 10 | **Checks** › "Add a description so search results say what this page is about." | Click **Fix** | The **Description** field gets the cursor |
| 11 | **Checks** › "2 photos don't have a description yet." | Click **Fix** | The panel closes and the builder opens the first block with that photo, with the photo's item in focus |
| 12 | **Checks** › "This page isn't in your menu. Visitors can only reach it by a link." | Click **Fix** | The **Navigation** tab opens at `/hub/website?tab=navigation` (if you have unsaved SEO changes you are asked first) |
| 13 | Page builder header | Click **Publish** | The page publishes even if checks are amber. Your title, description, address and share image are now live |
| 14 | `/hub/website?tab=site` | Scroll to **Sharing** | Your **Site icon** shows at two sizes on a light and on a dark background, and the **Share image** (1200 × 630) shows your logo on your theme colour. "Made from your logo." links to **Change your logo in Settings › Business info** |
| 15 | **Sharing** › **Use a different share image** | Click **Choose a photo**, pick a photo, click **Use this photo**, then **Save settings** | A toast reads "Settings saved. It's live on your site." Pages without their own share image now use this photo |
| 16 | `/hub/settings?tab=business` | Upload a new logo | The next time you open **Site settings**, the site icon and share image show the new logo. Browsers pick up the new icon on their next visit |
