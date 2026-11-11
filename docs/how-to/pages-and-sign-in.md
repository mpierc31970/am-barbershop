---
feature: Sign in and manage pages
phase: 03
route: /hub/website?tab=pages
---

# How to: Sign in and manage pages

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Sign in to your hub, see every page with its status, and add pages (CONT-08). Ten pages are included.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** (for example `owner@example.com`) and **Password**. Click **Show password** to check it | The password shows as text; **Hide password** hides it again |
| 2 | `/sign-in` | Click **Sign in** | The button reads **Signing in…**, then the **Website** screen opens at `/hub/website` on the **Pages** tab |
| 3 | `/sign-in` | Sign in with a wrong password | A notice reads "That email and password don't match. Check both and try again." After too many tries: "Too many attempts. Wait 15 minutes, then try again." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | Read the list | Each page shows Title, URL, status badges and Last published. Home is first, carries a **Home** badge and its URL is `/`. The count reads like **4 of 10 pages** |
| 2 | `/hub/website?tab=pages` | Check the status badges | **Draft** (never published), **Published**, **Unpublished changes** (saved edits not live yet) or **In review** (held by the publish check) |
| 3 | `/hub/website?tab=pages` | Click **Add page** | A form row opens at the top of the list with **Title** and **URL** |
| 4 | New page row | Type **Title** "About Us" | **URL** fills in as `/about-us`. You can edit it until you create the page |
| 5 | New page row, **URL** | Type `About_Us!` | The error reads "Use lowercase letters, numbers and hyphens, like /our-story." |
| 6 | New page row, **URL** | Type `hub` | The error reads "/hub is used by the system. Pick another address." |
| 7 | New page row, **URL** | Type the address of a page you already have, like `about` | The error reads "Another page already uses /about. Try /about-2." |
| 8 | New page row | Fix the URL, click **Create page** | A toast reads **Page created.** and the new page's builder opens, reading **This page is empty** |
| 9 | New page row | Instead click **Discard new page** | The row closes and nothing is saved |
| 10 | Your site | Open the site's address with no path | The published **Home** page is served at `/` |
