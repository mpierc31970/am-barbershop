---
feature: Set up your site
phase: 06
route: /hub/setup
---

# How to: Set up your site

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

After Submit, the owner tells CDS about the business in seven short steps: **Your business**, **Contact & hours**, **Email**, **Your words & services**, **People & proof**, **Photos & look** and **Domain & the rest**. Every field saves itself as you go, so the owner can stop and come back any time. **What's still needed** lists the must-haves (they block sending) and the optional items (each says what CDS does if it stays empty). When the must-haves are in, the owner presses **Send to CDS**; editing continues after that, and CDS always sees the latest answers.

Only the site owner can send. An admin can fill in every step but not send; an editor sees every step read-only. Staff viewing the hub as the owner can't send either.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start/submit` | Submit a quote with the emailed code (see the Submit how-to) | The hub opens on `/hub/setup` with **Set up your site** as the first sidebar item, a count of must-haves next to it (for example "2"), and the green note "Your account is ready. Start with Your business; each step takes a few minutes." |
| 2 | `/sign-in` (any later visit) | Sign in | While the site is being set up, `/hub` opens `/hub/setup`. Once the site is built, it opens **Website** instead |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` | Read the page top to bottom | The heading **Set up your site**, the intro "Tell us about your business, in as many sittings as you like…", the line "**0 of 7** steps done" with a thin progress bar, and seven step rows. Each row shows a status icon, the step name, a summary ("Not started") and a badge such as "2 needed". On a wide screen, **What's still needed** sits on the right; on a phone it comes first |
| 2 | `/hub/setup`, **What's still needed** | Read the two groups | **Must-haves** rows, like "Business phone or email · Contact & hours", each with a yellow **Needed** badge. **Optional** rows, each with what happens if it stays empty, like "Leave empty and we'll use your business name." More than five optional rows fold behind **Show N more** |
| 3 | `/hub/setup` | Click **Business phone or email · Contact & hours** in the panel | The **Contact & hours** step opens and the cursor lands in that field |
| 4 | `/hub/setup` | Click the row **Domain & the rest** | The step opens. On a wide screen the left rail lists the seven steps with **Domain & the rest** highlighted; on a phone a line reads "Step 7 of 7 · All steps". The first-visit note on the overview is gone from now on |
| 5 | `/hub/setup/the-rest`, **Your web address** | Pick **I have a domain** | Two fields appear: **Domain** and **Where did you buy it?**. Top right, the status reads "Saving…", then "Saved", then after 3 seconds "All changes saved" |
| 6 | `/hub/setup/the-rest`, **Domain** | Type `https://www.RiveraBakery.com`, then press Tab | The field shows `riverabakery.com` as you type (the https:// and www. drop away). On Tab it saves: "Saved" |
| 7 | `/hub/setup/the-rest`, **Where did you buy it?** | Pick **Namecheap** | It saves at once: "Saved" |
| 8 | `/hub/setup/the-rest`, **Google Analytics ID** | Type `UA-123`, then press Tab | Red text under the field: "A Google Analytics ID looks like G-XXXXXXXXXX. Check it and try again." The status reads "1 field needs attention". Nothing is saved |
| 9 | `/hub/setup/the-rest`, any sidebar link | Click **Website** while the field is still wrong | A dialog asks "Leave without saving this field?" with **Leave** and **Keep editing** (focused). Click **Keep editing** |
| 10 | `/hub/setup/the-rest`, **Google Analytics ID** | Change it to `g-abc1234`, then press Tab | The field shows `G-ABC1234`, the red text goes away and the status reads "Saved" |
| 11 | `/hub/setup/the-rest`, **Do you have a Google Business Profile?** | Pick **Yes** | "Saved" |
| 12 | `/hub/setup/the-rest`, **Legal details** | Fill **Legal business name** ("Rivera Bakery LLC"), **Privacy contact email** and **State / country** (the first option offers the state from your address) | Each field saves when you leave it: "Saved" |
| 13 | `/hub/setup/the-rest` (offline) | Turn the network off, change a field, press Tab | The status reads "Not saved." with **Try again**. Turn the network on and click **Try again**: "Saved" |
| 14 | `/hub/setup/the-rest`, footer | Click **Review what's still needed** (on other steps the button reads **Next: {next step}**) | The overview opens. The step row now shows its summary (for example "riverabakery.com · Analytics added") and a **Done** badge or "N optional left" |
| 15 | `/hub/setup` | Fill the other steps until **What's still needed** has no Must-haves | The panel's button changes from **Continue setup** (with "Send to CDS unlocks when the must-haves are in.") to **Send to CDS**, with a note like "3 optional items are empty. CDS will use the defaults shown above, and you can add them later." |
| 16 | `/hub/setup` (as the owner) | Click **Send to CDS** | The button reads "Sending…". Then a toast reads "Sent to CDS. We'll email you when your site is ready to review.", the panel reads "Sent to CDS on 28 Sep. We'll email you when your site is ready to review." and "You can keep editing. CDS always sees your latest answers.", and a **Sent to CDS** badge sits next to the heading |
| 17 | `/hub/setup` (as an admin, or staff viewing as the owner) | Look at the panel | **Send to CDS** is greyed out with "Only the site owner can send this to CDS." (admin) or "Sending to CDS is the owner's step." (staff) |
| 18 | `/hub/setup` (a site held for review) | Open the overview | A note at the very top reads "We're checking a couple of details about your business, usually within 2 business days. Keep setting up your site in the meantime; we'll email you when it's done." and an **In review** badge sits next to the heading. Every step still opens and saves |
| 19 | `/hub/setup` (as an editor) | Open any step | A note reads "Only the owner or an admin can change settings." and every field is greyed out |
| 20 | `/hub/setup/business`, **Business name** | Change it to "Rivera Bakery & Cafe", then press Tab | "Saved". The name also changes for the whole account (the sidebar and emails use it). Clearing the name and pressing Tab shows "Add your business name." and nothing is saved |
| 21 | `/hub/setup/business`, **Tagline** | Type "Sourdough baked daily in Austin." and press Tab | The counter reads "32 / 80" while you type; on Tab: "Saved" |
| 22 | `/hub/setup/business`, **What kind of business** | Open the list | Only the types for your path are listed, with your quote's type selected. Pick another: "Saved". Picking **Something else** shows **Your kind of business** |
| 23 | `/hub/setup/business`, **Logo** | Drop a transparent PNG on the box (or click **choose a photo**) | A small preview, the file name and a bar "Uploading… 42%" with **Stop upload**; then "Making web-ready copies…"; then the logo twice, **On light** and **On dark**, with its size ("1200 × 600 · 88 KB") and **Photo description** already filled with your business name. A logo under 400 px wide gets a yellow note that it may look soft; it is still kept |
| 24 | `/hub/setup/business`, **Logo** | Click **Remove**, then **Undo** in the toast "Photo removed." | The logo disappears, then comes back. **Replace** picks a new file and swaps it in |
| 25 | `/hub/setup/business`, **Your site's style** | Scroll to the seven cards and click **Warm and classic** | Each card shows your business name and "Fresh bread every morning. Order ahead for weekends." in that style's fonts. The status reads "Saving…", then "Saved". **Let CDS choose** is picked until you choose |
| 26 | `/hub/setup/contact`, **How customers reach you** | Type a phone number, press Tab | "Saved". **Public email** already shows the email you signed up with |
| 27 | `/hub/setup/contact`, **Phone** and **Public email** | Clear both and press Tab | Red text: "Add a phone number or an email so customers can reach you." Nothing is saved until one is back |
| 28 | `/hub/setup/contact`, **Where you are** | Fill the street, city, state and ZIP, and **Service area** ("Austin and Round Rock") | Each saves when you leave it. **Time zone** is already set from your device (for example "Central time (America/Chicago)"); change it if the business is elsewhere |
| 29 | `/hub/setup/contact`, **Opening hours** | Switch **Open** on for Monday | Monday shows "9:00 am to 5:00 pm". About a second later: "Saved". All days closed means your site says "Contact us for hours" |
| 30 | `/hub/setup/contact`, **Opening hours** | On Monday set 9:00 am to 12:00 pm, click **Add hours**, set 1:00 pm to 5:00 pm | Monday has two ranges (a split day), each with a remove button |
| 31 | `/hub/setup/contact`, **Opening hours** | Click **Copy Monday to weekdays** | Tuesday to Friday get Monday's hours; a toast reads "Copied Monday's hours to Tuesday to Friday." with **Undo** |
| 32 | `/hub/setup/contact`, **Opening hours** | Set a closing time before the opening time | Red text under that day: "Monday's closing time is before its opening time. Pick a later closing time." The status reads "1 field needs attention" and nothing is saved until it is fixed |
| 33 | `/hub/setup/contact`, **Social links** | Click **Add a social link**, keep **Instagram**, paste `https://instagram.com/riverabakery`, press Tab | "Saved". The **Remove Instagram link** button removes the row and saves at once |
| 34 | `/hub/setup/words`, **About your business** | Type two paragraphs in **About**, then press Tab | The counter reads "412 / 2,000" while you type; on Tab: "Saved". **Mission** and **The first line visitors should read** save the same way. Each is optional and says what happens if it stays empty |
| 35 | `/hub/setup/words`, **Services** | Read the empty list | "No services yet" with **Add your first service**, **Import from a spreadsheet** and the tip "Have a price list in Excel or on paper? Type it into our template and import it all at once." |
| 36 | `/hub/setup/words`, **Services** | Click **Add your first service**, type "Haircut", pick **Starting at**, type `45` in **Amount**, pick **60 minutes**, click **Save service** | A drawer opens on the right. **Amount** shows only for **Fixed price** and **Starting at**. On save the drawer closes, a toast reads "Service saved." and the row reads "Haircut" over "From $45 · 60 min" |
| 37 | `/hub/setup/words`, **Services** | Click **Import**, then **Download the template**, fill it in Excel, and drop it on the dialog | The preview lists each row as **New**, **Updated** or **Error** (like "Row 6: Price type must be Fixed, Starting at, Free or Ask."). Click **Import**: a toast reads "Imported. 5 added, 0 updated." |
| 38 | `/hub/setup/words`, a service row | Turn **Show on site** off | A grey **Hidden** badge appears and the change saves at once |
| 39 | `/hub/setup/words`, a service row | Open **More actions for Haircut**, click **Delete service** | A dialog asks "Delete Haircut?" with **Delete service** and **Keep service** (focused). Delete: the toast reads "Service deleted." |
| 40 | `/hub/setup/people`, **Your team** | Click **Add a team member**, type "Maria Lopez" and "Owner", drop a photo, click **Save team member** | The photo's **Photo description** is already "Photo of Maria Lopez". On save: "Team member saved." and the row shows her photo (or "ML" without one), her name over "Owner" and a **Show on site** switch |
| 41 | `/hub/setup/people`, a team row | Open **More actions for Maria Lopez**, click **Remove from team** | A dialog asks "Remove Maria Lopez from your team?" with **Remove from team** and **Keep team member** (focused) |
| 42 | `/hub/setup/people`, **Your add-ons** (Testimonials on the quote) | Click **Paste or import your testimonials** and import a spreadsheet of reviews | The line "12 testimonials ready for your site" appears with the list of names. Nothing is added to the site yet: they wait until Testimonials is added |
| 43 | `/hub/setup/people`, **Testimonials** | Click **Add one by one**, fill **Quote** and **Name**, click **Save testimonial** | "Testimonial saved." and the count goes up by one. Each row has **Edit** and **Remove** (with **Undo**) |
| 44 | `/hub/setup/people`, **Your add-ons** (Testimonials not on the quote) | Read the line | "Have reviews from customers? **Add Testimonials** to show them." The link opens the Testimonials add-on page |
| 45 | `/hub/setup` (after **Send to CDS**, within the hour) | Reload the overview | A grey **Being built** badge replaces **Sent to CDS**, and the panel reads "Your site is assembled. CDS is polishing it now." with **See your site's preview**. See the [Your first site, assembled](site-assembly.md) how-to |
