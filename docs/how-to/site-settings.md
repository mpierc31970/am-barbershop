---
feature: Site settings
phase: 07
route: /hub/website?tab=site
---

# How to: Site settings

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Site-wide choices that are not page content: your site's language, a Translate link for visitors, whether AI assistants may read your site, and whether your site needs a cookie notice (CONT-29). Changes are live on your site as soon as you save.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click the **Site settings** tab | The address becomes `/hub/website?tab=site`. The heading reads **Site settings** with "Changes show on your site as soon as you save." under it, and a **Preview** shows your site's header. Every site already has settings: English, no Translate link, AI assistants allowed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=site` | Under **Language**, choose **Spanish** in **Your site's language**, then click **Save settings** | A toast reads "Settings saved. It's live on your site." Open your site and view the page source: it starts with `<html lang="es">`. The hub itself stays in English (`lang="en"`) |
| 2 | **Language** | Choose **Other…** | A **Language code** field appears under the list, with "Use a code like pt-BR or yue." Type `pt-BR` and click **Save settings**: the toast confirms and the page source shows `<html lang="pt-BR">` |
| 3 | **Language code** | Type `english` and click **Save settings** | The field shows "Enter a language code like pt-BR." in red and nothing is saved |
| 4 | **Language** | Turn on **Show a Translate link** | The preview header shows **Translate** with a small languages icon |
| 5 | `/hub/website?tab=site` | Click **Save settings**, then open your site | The header shows **Translate** after the menu links (on a phone, inside the **Menu** panel). Clicking it opens Google Translate in a new tab, already set to the visitor's browser language. Nothing from Google loads until the click |
| 6 | **Search engines and AI** | Turn off **Let AI assistants read your site**, click **Save settings** | The toast confirms. Your site's `robots.txt` asks AI crawlers (tools like ChatGPT and Claude) not to read your pages and `yoursite.com/llms.txt` shows "not found" (see the Site search how-to). It is a request, not a block |
| 7 | **Search engines and AI** | Click **Your sitemap: yoursite.com/sitemap.xml** | Your sitemap opens in a new tab: the list of pages search engines read, one `<loc>` line per public page with its last published date. Password pages are never listed |
| 8 | **Cookie notice** | Read the line | It says whether your site shows a cookie notice and why, for example "Your site shows a cookie notice because it has a YouTube video and a map." Adding a YouTube video or a map block to any published page turns the notice on; removing them turns it off. There is nothing to set here |
| 9 | **Preview** | Click **Phone**, then **Computer** | The preview narrows to a phone width with a **Menu** button, then returns to the full header |
| 10 | `/hub/website?tab=navigation` | Under **Search**, turn on **Show a search button in the menu**, click **Save navigation** | Your site header shows a magnifier named "Search this site" that opens `/search` (see the Site menu how-to) |
| 11 | **Sharing** | Read the section, then click **Choose a photo** under **Use a different share image**, pick a photo, click **Use this photo** and **Save settings** | **Site icon** shows your generated icon at two sizes on a light and a dark background and **Share image** shows the 1200 × 630 picture made from your logo ("Made from your logo." with a link to **Change your logo in Settings › Business info**). After saving, the toast reads "Settings saved. It's live on your site." and links to your pages shared on social media show the chosen photo unless a page picked its own (see the SEO & sharing how-to). Without a site address yet it reads "Your site icon appears once your site has an address." |
| 12 | `yoursite.com/robots.txt` | Open it in your browser | It ends with `Sitemap: https://yoursite.com/sitemap.xml`, the same address as **Your sitemap** above, so search engines find your page list on their own (see the Site search how-to) |
