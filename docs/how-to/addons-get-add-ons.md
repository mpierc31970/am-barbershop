---
feature: Get add-ons
phase: 05
route: /hub/add-ons
---

# How to: Get add-ons

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Get add-ons is where the site owner adds features to the site, removes them, and adds them back. Removing an add-on never deletes anything: its items are kept, and adding it back brings everything back. Only the site owner can add or remove add-ons.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Sign-in page | Sign in as the site **owner** | The hub opens on your dashboard |
| 2 | Any hub page | Click **Get add-ons** in the sidebar | `/hub/add-ons` opens. The line under the heading reads "Add features to your site. Each one adds its own tab here and blocks you can place on any page." Each card shows the add-on's name, a one-line description, a line like "Reviews · Adds a page, a block and a tab", and **Add to site** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Click the **Testimonials** card's name | `/hub/add-ons/testimonials` opens with **What it adds** ("A Testimonials page at /testimonials", "A Testimonials block you can place on any page", "A Testimonials tab under Website") and **How it works** (the first steps, with **Read all steps**) |
| 2 | `/hub/add-ons/testimonials` | Click **Add to site** | A dialog asks "Add Testimonials to your site?" and reads "It adds a Testimonials page and a Testimonials block you can place on any page." |
| 3 | **Add Testimonials to your site?** dialog | Click **Add to site** | The button reads "Adding…", then the hub opens `/hub/website?tab=testimonials`. A toast reads "Testimonials is on your site." with **View on site** |
| 4 | The toast | Click **View on site** | Your site opens at `/testimonials` in a new tab, with the heading "What people say". It shows within seconds, with no wait for a deploy |
| 5 | `/hub/add-ons/testimonials` | Scroll to **Remove from site** and click **Remove from site** | A dialog asks "Remove Testimonials from your site?" and reads "Its page and blocks stop showing on your site right away. Your testimonials are kept. Add it back any time and everything returns." **Keep it** is focused |
| 6 | **Remove Testimonials from your site?** dialog | Click **Remove from site** | A toast reads "Testimonials was removed. Your testimonials are kept." with **Add it back**. The Testimonials tab is gone from Website |
| 7 | Your site, `/testimonials` | Reload the page | The page shows **not found**. Any Testimonials block on your other pages no longer shows |
| 8 | The toast from step 6 | Click **Add it back** | A toast reads "Testimonials is on your site." Reload `/testimonials`: the same testimonials are back, in the same order. (If the toast has closed, open `/hub/add-ons/testimonials` and click **Add to site**; the dialog adds "Your 5 testimonials come back as they were.") |
| 9 | `/hub/add-ons/<slug>` of an add-on that needs another | Click **Add both** | This appears only when an add-on needs another one that is not on your site. The note reads "<Add-on> needs <Other>. Add both to your site? <Other> goes on first." The dialog adds both, the needed one first, and the toast reads "<Other> and <Add-on> are on your site." |
| 10 | `/hub/add-ons/<slug>` of an add-on that can't run alongside one you have | Read the warning | This appears only when two add-ons can't be used together. It reads "<Add-on> can't run alongside <Other>. Remove <Other> first." and **Add to site** is not offered until you remove the other one |
