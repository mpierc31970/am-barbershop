---
feature: Catalog editing
phase: 13
route: /staff/catalog
---

# How to: Catalog editing

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The Catalog is where CDS writes what owners and visitors read about each add-on, sets the one price catalog, and posts the From CDS announcement (STAFF-07). Three tabs: **Add-ons** (tagline, description, availability, order, screenshots), **Prices** (every price by kind, key and path) and **Announcement**. Copy, screenshots and availability only: what an add-on does comes from its package. Listing edits show on `/start` and the hub **Add-ons** page. The terminal equivalents are `npm run prices:set` and `npm run announce:set`.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |
| 2 | Sidebar | Click **Catalog** | `/staff/catalog` opens with tabs **Add-ons · Prices · Announcement**. Both roles edit listings. Prices and the announcement are Super Admin only; a Support agent sees them read-only with "Super Admin only" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/catalog` (Add-ons) | Read the table | "Add-on listings, in the order owners see them": Add-on · Availability (Available, Coming soon, Hidden; a private add-on reads "Always private") · Visibility (Public, Private) · Tagline · Screenshots · Updated ("16 Oct by Mara", or "Not edited") · Sort · Order. Above it: "Copy, screenshots and availability only. What the add-on does comes from its package." |
| 2 | Add-ons row | Click the up or down arrow in **Order** (**Move Testimonials up** / **down**) | The row moves one place. Owners see the add-ons in this order on `/start` and in the hub |
| 3 | Add-ons row | Click the add-on name | The listing editor opens at `/staff/catalog?tab=addons&edit=<slug>`, with **All add-ons** to go back and a live **Owners see** card on the side |
| 4 | Listing editor | Type a **Tagline** (up to 120 characters) and a **Description** (up to 2,000). An empty field shows "Default: …" from the package; **Reset to default** clears your text | The counter follows each field. Over the limit: "Keep it to 120 characters." and **Save listing** stays disabled. The **Owners see** card updates as you type |
| 5 | Listing editor, **Availability** | Pick **Available** ("Owners and visitors can pick it."), **Coming soon** ("Listed with a Coming soon badge; nobody can add it yet.") or **Hidden** ("Not listed anywhere. Sites that have it keep it.") | The card shows the choice. For a private add-on the choices are disabled and the editor reads "Private add-ons are never listed, whatever is set here."; private visibility always wins |
| 6 | Listing editor, **Screenshots** | Click **Choose image**, pick a PNG, JPEG or WebP up to 2 MB, type the **Alt text**, click **Upload** | "Uploading…", then the thumbnail joins the list. Missing alt text: "Describe the screenshot for people who can't see it." Too big: "Screenshots must be 2 MB or smaller." Wrong file: "Use a PNG, JPEG or WebP image." With 6 already: "This add-on has 6 screenshots. Remove one to add another." |
| 7 | Screenshot thumbnail | Click **Move screenshot 2 up** / **down**, or **Remove screenshot 2** | The order changes at once. Remove drops it with a "Screenshot removed." toast and **Undo**; the delete is only sent when the toast ends or you save |
| 8 | Listing editor | Click **Save listing** (or **Discard changes**) | "Saved. /start and the hub show the new listing." Screenshots load from `/_catalog/<slug>/…` on every host |
| 9 | `/start` and `/hub/add-ons/<slug>` | Reload | The new tagline, description, badge and screenshots show, in the new order |
| 10 | `/staff/catalog?tab=prices` | Read the grid | "Price catalog by kind, key and path", one block per kind (Base fee, Build fee, Add-ons, Page packs, Care Plan, Extras, Services, Setup fee): Key · Standard · Studio · Provider price (**Synced** or **Missing**). "—" means no price yet; Studio Booking shows "Not offered" on Standard |
| 11 | Prices cell (Super Admin) | Click **Edit testimonials standard price**, type an **Amount** ("Dollars and cents, like 19.00.") or turn on **Price coming soon**, click **Preview price** | If your sign-in is older than 15 minutes, **Confirm it's you** asks for a fresh code first. Then the dialog "Change testimonials standard?" shows "Old → new: $19.00/mo → $24.00/mo" and "A new provider price is created; the old one is archived." (or "No new provider price is needed.") |
| 12 | Same dialog, an add-on going to or from $0.00 | Read the **Sites** line, for example "This makes Testimonials included free for every Standard site (4 sites)." or "This ends Testimonials being included free for every Standard site (4 sites); sites that have not installed it lose it." Tick **I've checked these sites** | **Save price** stays disabled until the box is ticked (the same y/N the terminal asks) |
| 13 | Same dialog | Click **Save price** (or **Keep price**) | "Price saved. New quotes use $24.00/mo." (or "Price saved. New quotes show “Price coming soon”."). Quotes already sent keep their price |
| 14 | `/staff/catalog?tab=announcement` | Read the tab | **Showing now** with the current card, its paths ("Every path" or the list) and "Until Oct 30" (or "No end date"). None: "No announcement is showing." |
| 15 | Announcement form (Super Admin) | Fill **Title** (one line, up to 80), **Body** (up to 280), optional **Link** ("https://… or a /hub/ path."), tick **Paths** Standard and/or Studio ("Leave both unticked to show it on every path."), pick **Days** (7, 14 or 30) | The **Owners see** card previews it as owners will see it in From CDS |
| 16 | Same form | Click **Set announcement**; when one is already showing, confirm **Replace it** in "Replace the current announcement?" (or **Keep current**) | Step-up if needed, then "Announcement live. Owners see it in From CDS." Owners on those paths see it on Today |
| 17 | Same tab | Click **End announcement** | "Announcement ended. From CDS shows no announcement now." with **Undo** (sets it again with its old end date) |
| 18 | Any Catalog tab, as a Support agent | Try to change a price or the announcement | The controls are disabled with "Super Admin only"; a forced call answers "Your role can't do this. Ask a Super Admin." |
