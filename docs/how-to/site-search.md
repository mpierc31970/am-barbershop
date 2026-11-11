---
feature: Site search
phase: 07
route: /hub/website?tab=navigation
---

# How to: Site search

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every site gets a search page, a sitemap, a robots file and an AI summary file with no setup (CONT-28, CONT-13, CONT-15, CONT-37). All four read one list of your public pages, rebuilt each time you publish or save. A page with a password, a page held for review and the "page not found" page are never in that list, so visitors and search engines cannot find them.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=navigation` | Under **Search**, turn on **Show a search button in the menu** | The preview header shows a magnifier button |
| 2 | **Navigation** | Click **Save navigation** | A toast confirms the save. Your site header shows the magnifier named "Search this site" after the menu links (on a phone, inside the **Menu** panel) |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Your site, any page | Click the magnifier in the header | `/search` opens with the heading **Search**, a **Search this site** box with the cursor in it, a **Search** button and "Type a word or two to search this site." |
| 2 | `/search` | Type `sourdough` and click **Search** | The address becomes `/search?q=sourdough`. A line reads "4 results for “sourdough”" (your count). Each result shows the page title as a link, its address in grey, and a short extract with the matching words in bold. A service shows "· Service" after its address |
| 3 | `/search?q=sourdough` | Click a result title | That page of your site opens |
| 4 | `/search` | Search a word that appears on more than 10 pages or services | Ten results show, then **Previous**, numbered pages and **Next** under them ("Search results pages"). Clicking **2** shows results 11 to 20 |
| 5 | `/search` | Search `xyzzy` (a word that is nowhere on your site) | "No results for “xyzzy”. Try a shorter word, or one of these pages:" and a list of the pages in your menu |
| 6 | `/search` | Search a word that only appears on a password-protected page | "No results for …": protected pages never show up in search |
| 7 | `/hub/website` | Publish a new page with the word `croissant`, wait one minute, then search `croissant` on your site | The new page is in the results |
| 8 | `/hub/website?tab=site` | Under **Search engines and AI**, click **Your sitemap: yoursite.com/sitemap.xml** | A new tab shows your sitemap: one `<loc>` line per public page with the date it was last published. Password pages and the "page not found" page are not listed |
| 9 | Your site | Open `yoursite.com/robots.txt` | It reads `User-agent: *`, `Allow: /` and ends with `Sitemap: https://yoursite.com/sitemap.xml` |
| 10 | Your site | Open `yoursite.com/llms.txt` | A plain-text summary for AI assistants: `# Your business name`, your home page description, then **## Pages** and **## Services** with links |
| 11 | `/hub/website?tab=site` | Turn off **Let AI assistants read your site**, click **Save settings**, then reopen `yoursite.com/robots.txt` and `yoursite.com/llms.txt` | robots.txt now also lists GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot and Applebot-Extended with `Disallow: /`, and llms.txt shows "not found". It is a request to those companies, not a block |
| 12 | Your preview address (`<name>.sites.connectionsdesignstudios.com`) | Open `/robots.txt` and `/llms.txt` | robots.txt reads only `User-agent: *` and `Disallow: /`, and llms.txt is "not found": search engines and AI tools are invited only on your own domain (D170). Search and the sitemap link still work for you |
