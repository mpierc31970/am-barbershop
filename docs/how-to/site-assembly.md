---
feature: Your first site, assembled
phase: 08
route: /hub/setup
---

# How to: Your first site, assembled

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When the owner sends their setup answers to CDS, CDS builds the first version of the site from them: a **Home** page and an **About** page in the site's own style, with the owner's services, team, hours and photos already in place. The owner doesn't have to do anything while it happens. When it's ready, **Set up your site** shows a **Being built** badge and a link to the preview. CDS then polishes the site before it goes live.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` (as the owner) | Fill the steps until **What's still needed** has no Must-haves (see the Set up your site how-to) | The panel's button changes from **Continue setup** to **Send to CDS** |
| 2 | `/hub/setup` | Click **Send to CDS** | A toast reads "Sent to CDS. We'll email you when your site is ready to review.", the panel reads "Sent to CDS on 28 Sep. We'll email you when your site is ready to review." and a green **Sent to CDS** badge sits next to the heading. Nothing else changes yet |
| 3 | `/hub/setup` (within the hour) | Reload the page | The badge next to the heading now reads **Being built** (grey). The panel shows the green line "Your site is assembled. CDS is polishing it now." with the link **See your site's preview**. **Set up your site** stays in the sidebar |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup`, **What's still needed** | Read the panel | The green line "Your site is assembled. CDS is polishing it now.", the link **See your site's preview** (with a small open-in-new-tab icon), and under it: "Services, team and hours update on your site as you change them. Your other answers were used to write your pages; to change those words, edit the pages in Website › Pages." There is no button to press. Any optional items still empty are listed as before |
| 2 | `/hub/setup` | Click **See your site's preview** | The preview address (for example `rivera.sites.connectionsdesignstudios.com`) opens in a new tab on the **Home** page, with a thin "in development" strip at the top. Search engines are told not to list it. The menu has **About**, which opens the About page |
| 3 | `/hub/website?tab=services` | Change the price of a service (for example "Haircut" from $45 to $50) and click **Save service** | A toast reads "Service saved." Reload the preview tab: the service list on the site shows the new price. No need to ask CDS |
| 4 | `/hub/settings` (team or hours) | Switch a team member's **Show on site** off, or change Monday's hours | It saves at once. Reload the preview tab: the team list and the hours on the site match |
| 5 | `/hub/setup`, the helper line | Click **Website › Pages** | The **Pages** tab opens with **Home** and **About** in the list. Open either page to change its words or blocks; your setup answers aren't read again, so the pages keep your edits |
| 6 | `/hub/website?tab=pages` | Read the page count | **Home** and **About** count toward the 10 pages your site includes, like any page you add |
| 7 | `/hub/setup` (a site still being prepared) | Open the overview right after **Send to CDS** | The panel still shows the **Sent to CDS** state. If anything holds up the build, CDS fixes it; you see nothing alarming and nothing is needed from you |
