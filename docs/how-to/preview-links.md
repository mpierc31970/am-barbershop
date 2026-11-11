---
feature: Preview links
phase: 14
route: /hub/website/pages/<id>/preview
---

# How to: Preview links

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A preview link shows a page's unpublished changes on your site's preview address, so you (or anyone you send it to) can see them as visitors will, on any device. Each link works for 60 minutes; after that it shows the published version.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Website › Pages (`/hub/website/pages`) | Open a page, make a change, then click **Preview** | The preview opens (`/hub/website/pages/<id>/preview`) with **Open on your preview address** and **Copy preview link** in its header |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | The page preview | Click **Open on your preview address** | A new tab opens the page on your preview address (like rivera.sites.connectionsdesignstudios.com) with the strip "Preview: showing unpublished changes." The first time each session the line "Anyone with this link can see your unpublished changes for 60 minutes." shows |
| 2 | The page preview | Click **Copy preview link** | The button shows "Copied" and a toast reads "Preview link copied." Paste it into a message to share it |
| 3 | The link, opened after 60 minutes | Open it | The strip reads "Preview link expired. Showing the published version." Make a new link from the preview |
| 4 | Your preview address with no link | Open it | The published site shows with the strip "Preview: this site is in development and not live yet." (search engines never list it) |
