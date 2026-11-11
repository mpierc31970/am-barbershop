---
feature: Password pages
phase: 07
route: /hub/website/pages/<id>?settings=1
---

# How to: Password pages

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Any page except **Page not found** can have one shared password (CONT-28, D235 #12). The password works the moment you save, without publishing (D-UI-P7-14). Visitors see your site's menu and a small, on-brand box asking for the password; nothing of the page shows until they enter it. Search engines and your site search skip the page, and its photos and videos use private links (CONT-33, D255). A visitor who gets it right stays let in for 12 hours on that browser.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=pages` | Click the title of the page you want to protect | The page builder opens |
| 2 | `/hub/website/pages/<id>` | Click the **Page settings** button (gear icon) in the header | The **Page settings** drawer opens on the right; the URL ends in `?settings=1` |
| 3 | Page settings drawer | Turn on **Protect this page with a password** | A **Password** field appears with the helper "Share it with the people who should see this page. Search engines and site search skip it." |
| 4 | Page settings drawer | Type a password of at least 6 characters (click **Show** to check it) | **Save page settings** turns on |
| 5 | Page settings drawer | Click **Save page settings** | A toast reads "Page settings saved." and a **Password** badge (lock icon) appears next to the status badge in the header |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | The page's address on your site, in a private browser window | Open it | Your site's menu and footer, then a box with a lock icon, the page title, "This page is private. Enter the password to see it.", a **Password** field and **View page** |
| 2 | The password box | Type a wrong password and click **View page** | "That password isn't right. Check it and try again." shows under the field |
| 3 | The password box | Type the right password and click **View page** | The page itself shows |
| 4 | `/hub/website/pages/<id>?settings=1` | Type a new password in the empty field ("Leave blank to keep the current password"), then click **Save page settings** | The helper adds "Anyone already let in will need the new password."; a toast reads "Page settings saved." |
| 5 | The page in the other browser window | Reload | The password box shows again: the old password no longer works |
| 6 | The password box | Get the password wrong 10 times in 15 minutes | "Too many tries. Wait 15 minutes, then try again." with a countdown; **View page** stays off until it ends |
| 7 | `/hub/website/pages/<id>?settings=1` | Turn off **Protect this page with a password**, then click **Save page settings** | A toast reads "Page settings saved."; the **Password** badge goes away and the page is public again at once |
| 8 | `/hub/website?tab=pages` | Look at the page's row | Protected pages show a **Password** badge next to their status |
| 9 | `/hub/website/pages/<id>?settings=1` | Untick **Show this page in the site menu**, then click **Save page settings** | The page's links leave your site menu (the menu button is not changed). Click **Arrange your menu in Website › Navigation** to reorder the rest |
