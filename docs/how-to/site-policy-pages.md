---
feature: Publish your site's policy pages
phase: 09
route: /hub/settings?tab=legal
---

# How to: Publish your site's policy pages

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Support writes a Privacy policy and Terms for your site from what your site collects: contact forms, newsletter sign-ups, analytics and the add-ons you have. We are not a law firm, so the owner reads the warning, previews both pages, ticks one box and publishes. Only the owner can publish. Admins can preview and see the status; support staff viewing your site can't publish. Once published, the pages live at `/privacy` and `/terms` on your site, and your footer links to them.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup/the-rest` | Fill **Legal business name** and **Privacy contact email**, then leave the field | The autosave status in the step header reads **Saved** |
| 2 | `/hub/settings?tab=legal` | Scroll to **Your site's policy pages** | No "Add your legal business name and a privacy contact email first" notice; both pages show the grey badge **Not published** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings?tab=legal` | Read the yellow notice at the top of **Your site's policy pages** | It is titled **We are not a law firm** and reads "We give no legal advice. These pages are a starting point written from what your site collects. Have your own lawyer approve them before you rely on them." It has no close button |
| 2 | `/hub/settings?tab=legal` | Read the **Privacy policy** row | Under it: "Covers:" and the list of what your site collects, e.g. "Contact forms · Newsletter sign-ups · Analytics · Testimonials" |
| 3 | `/hub/settings?tab=legal` | Click **Preview page** on the **Privacy policy** row | A panel slides in from the right titled **Privacy policy preview**, with "This is how it reads today. Your site shows it in your theme." and the full policy text |
| 4 | **Privacy policy preview** | Click **Close** | The panel closes |
| 5 | `/hub/settings?tab=legal` | Click **Preview page** on the **Terms** row, read it, click **Close** | **Terms preview** opens with the full terms, then closes |
| 6 | `/hub/settings?tab=legal` | Click **Publish policy pages** without ticking the box | Nothing is published; the line under the button reads "Tick the box above to publish." |
| 7 | `/hub/settings?tab=legal` | Tick "I understand this site gives no legal advice, and I'll have my own lawyer approve these pages." | The **Publish policy pages** button is no longer greyed out |
| 8 | `/hub/settings?tab=legal` | Click **Publish policy pages** | The button reads **Publishing…**, then a toast reads "Policy pages published. Links are in your site's footer."; both badges turn green **Published**; the box and button are replaced by "Published by {your name} on {date} (template version 1)." |
| 9 | `/hub/settings?tab=legal` | Click **View on your site** on the **Privacy policy** row | Your site's `/privacy` page opens in a new tab, in your site's colours and fonts, with "Last updated {date}" |
| 10 | Your site, any page | Scroll to the footer | The bottom row reads **Privacy · Terms · Report**; **Terms** opens `/terms` |
| 11 | `/hub/add-ons` | Add an add-on that collects data (e.g. **Testimonials**), then open `/hub/settings?tab=legal` | A blue notice reads "Your privacy policy changed because you added Testimonials. Review it."; **Settings** shows **Legal · 1** |
| 12 | `/hub/settings?tab=legal` | Click **Preview page** on the **Privacy policy** row, read the new section, click **Close**, then reload | The notice is gone; your live `/privacy` page already includes the new section |
| 13 | `/hub/settings?tab=legal` (when Support updates the template) | Read the notice "Support updated the policy page template. Your site keeps showing the version you approved until you review and publish the update." | Both badges read **Update waiting**; preview the pages, tick the box and click **Publish the update**; the toast confirms and the badges turn **Published** |
