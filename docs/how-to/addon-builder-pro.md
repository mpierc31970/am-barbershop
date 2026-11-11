---
feature: Builder Pro
phase: 10
route: /hub/add-ons/builder-pro
---

# How to: Builder Pro

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Builder Pro is an add-on with no screen of its own: it unlocks Pro features in Forms (show/hide rules, multi-step, file upload, auto-reply, answer-based routing, save and resume) and the Pro table. Only the site owner can add it. On the Studio path it is already included, so Studio owners skip **Activate**. If Builder Pro is removed or payment stops, the Pro features turn off and everything you set up is kept.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Find the **Builder Pro** card ("Website · Unlocks Pro features in Forms") and click **Details** | The Builder Pro page opens at `/hub/add-ons/builder-pro`. Under what it adds it reads "No new screen; it unlocks Pro features in Forms" |
| 2 | `/hub/add-ons/builder-pro` | Click **Add to site** | A dialog asks "Add Builder Pro to your site?" and reads "It adds Builder Pro to your site." |
| 3 | **Add Builder Pro to your site?** dialog | Click **Add to site** | The dialog closes and a toast reads "Builder Pro is on your site." The page now shows the **On your site** badge |
| 4 | Studio path only, `/hub/add-ons` | Look at the **Builder Pro** card | It already shows **On your site**: Builder Pro is included on Studio, nothing to add |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=forms` | Open a form, then click **Add field** | The field menu lists **File upload** with no **Part of Builder Pro** lock and no "Ask your site owner" line |
| 2 | Form editor, **Add field** menu | Click **File upload**, type a **Label** (for example "Photos of the room") and click **Save** | A toast reads "Form saved. It's live on your site." and the form on your site shows a file picker |
| 3 | Form editor, a field | Open the field's settings, under **Show or hide this field** set **Rule** to **Show this field only when**, then pick the **Field** and the **Answer** | The field shows a rule line such as "Shows when Service is Wedding." and a branch icon in the field list. On your site the field appears only after that answer is picked. All Forms Pro steps are in the Forms Pro how-to |
| 4 | Form editor, any Pro option | Before adding Builder Pro (or after it is removed), look at the same option | The control is turned off and shows the **Part of Builder Pro** badge. Owners see **Add Builder Pro**; everyone else reads "Ask your site owner to add Builder Pro." Your saved Pro settings are kept |
| 5 | `/hub/website?tab=forms` | Click the **?** button labelled **How Builder Pro works** | A drawer titled **How Builder Pro works** lists these steps |
