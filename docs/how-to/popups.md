---
feature: Pop-ups
phase: 03
route: /hub/website?tab=popups
---

# How to: Pop-ups

Owner-hub steps use the P3 routes; re-record when P11 completes the hub shell.

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Reusable pop-ups: build one once, then choose when it appears on its own, or point a button at it (CONT-12).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click the **Pop-ups** tab | The address becomes `/hub/website?tab=popups`. With none yet, the pane reads **No pop-ups yet** |
| 3 | `/hub/website?tab=popups` | Click **Create pop-up** | The editor opens titled **New pop-up** with the sections Name, Content, When it appears, How often and Where |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Pop-up editor, **Name** | Fill **Pop-up name**, for example "Spring offer" | The helper reads "Only you see this. Screen readers hear it if the pop-up has no heading." |
| 2 | Pop-up editor, **Content** | Click **Add item** and add a **Heading**, a **Text** and a **Button** (Save item after each). Buttons here offer **Go to a link** only | The items are listed in order, as in a column |
| 3 | **When it appears** | Choose one: **When someone clicks a button**, **After a delay** (set **Seconds after the page opens**, 1 to 120, default 5), **When they scroll** (set **How far down the page (%)**, 10 to 100, default 50), **When they're about to leave**, or **As soon as the page opens** | The chosen card is selected. **When they're about to leave** reads "Computers only. Phones and tablets don't show it." |
| 4 | **How often** | Choose **Every visit**, **Once per session** or **Once per visitor** (the default) | The chosen card is selected. How often is hidden for **When someone clicks a button**, because every click opens it |
| 5 | **Where** | Choose **Every page**, or **Only these pages** and tick the pages | With **When someone clicks a button** chosen, Where is hidden and the line reads "It opens from any button set to this pop-up." |
| 6 | Editor footer | Click **Save pop-up** | A toast reads **Pop-up saved.** The list row shows the name, a summary like "After 5 seconds · Once per visitor · Every page" and the **Show pop-up** switch on |
| 7 | Editor footer | Click **Preview pop-up** | The real pop-up opens over the hub. **Esc** or the **Close** button closes it and focus returns to the button |
| 8 | `/hub/website?tab=popups`, list row | Turn off **Show pop-up** | The pop-up stops showing on the site; the pop-up is kept |
| 9 | `/hub/website/pages/[pageId]` | In a Columns block, add a **Button** item, choose **Open a pop-up**, pick "Spring offer" in **Pop-up**, click **Save item**, then **Publish changes** | Clicking that button on the site opens the pop-up |
| 10 | `/hub/website?tab=popups`, row menu | Click **Delete pop-up** on a pop-up a button uses, then **Delete pop-up** in the dialog | The dialog asks "Delete the Spring offer pop-up?" and reads "It leaves your pop-ups list. Buttons on Home keep opening it until you change them, so nothing breaks." with **Keep pop-up** focused. After **Delete pop-up** a toast reads "Spring offer pop-up deleted." and it leaves the list; the button on the live page still opens it, and it no longer pops up on its own |
| 11 | `/hub/website?tab=popups`, row menu | Click **Delete pop-up** on a pop-up nothing uses, then **Delete pop-up** in the dialog | The dialog asks "Delete the Spring offer pop-up?" and reads "It stops showing on your site right away. This can't be undone." **Delete pop-up** removes it for good |
| 12 | Published site, phone (narrower than 768 px) | Open a page with an automatic pop-up | Automatic pop-ups do not show on phones; a button set to open the pop-up still opens it |
| 13 | Published site with a cookie notice | Open a page with an automatic pop-up | The pop-up waits until the visitor answers the cookie notice (**Accept all** or **Only necessary**), then appears |
| 14 | `/hub/website?tab=navigation`, **History** | Click **History**, then **Restore** on a version from when the menu button opened a pop-up you have since deleted, then **Restore this version** | A toast reads "Restored. Your site shows the menu from …", the menu button opens the pop-up again and the pop-up is back in **Website › Pop-ups**. If the pop-up was deleted for good, the button is left out and the drawer reads "A button to a pop-up or page you've since deleted was left out." See [Site history](site-history.md) |
