---
feature: Add an add-on after launch
phase: 10
route: /hub/add-ons
---

# How to: Add an add-on after launch

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every add-on card on **Get add-ons** shows its price for your plan: "$9/mo", "Included" when your plan already covers it, or "Price coming soon" while CDS is still setting it (that add-on can't be added yet). Before you add anything, the confirm dialog shows exactly what is charged today and what goes on your monthly bill. The figures come from CDS's billing system, not from the page. The add-on goes on your site only after the payment goes through. You are only ever charged the figure the dialog showed: if the price changes while the dialog is open, nothing is charged, the dialog shows the new figure with "The price changed since you opened this. Check the new figure, then confirm again.", and you confirm again. Clicking twice, or retrying after a lost connection, never charges twice.

What you pay depends on where your site is:

| Your site | What the dialog shows | Button |
|---|---|---|
| Not paid for yet (before checkout) | "It joins your order: $9/mo from checkout, no setup fee." | **Add to site** |
| Paid for, not launched yet | "Today · $3.48 for the rest of October", "Then · $9/mo", "No setup fee before your site launches." | **Add and pay $3.48** |
| Launched | "Setup · $25.00", "Rest of October · $3.48", "Today · $28.48", "Then · $9/mo on your monthly bill" | **Add and pay $28.48** |

Only the site owner can add or remove add-ons. An admin sees the prices but the add buttons are off with "Only the site owner can add or remove add-ons." Staff viewing as the owner can't add one either.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` → `/hub/checkout` | Make sure your site has launched and a card is on file (you pay at checkout; see the Checkout how-to) | Settings › Billing shows your plan and "Visa ending 4242" (or your card) |
| 2 | Sidebar | Click **Get add-ons** | `/hub/add-ons` opens with a grid of add-on cards, each with its price on the right of the grey line under the summary ("$9/mo", "Included" or "Price coming soon") |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Click the name of an add-on (for example **Testimonials**) | Its detail page opens with the price under the name ("$9/mo"), **What it adds**, **How it works** and **Add to site** at the top right |
| 2 | `/hub/add-ons/testimonials` | Click **Add to site** | The dialog "Add Testimonials to your site?" opens. Grey placeholder lines show for a moment while the price loads; the add button stays off until then |
| 3 | The dialog | Read the money block | It lists **Setup · $25.00**, **Rest of October · $3.48**, **Today · $28.48** and **Then · $9/mo on your monthly bill**, then "Plus sales tax. Charged to Visa ending 4242." The button reads **Add and pay $28.48** |
| 4 | The dialog | Click **Add and pay $28.48** | The button reads "Charging your card…" and the dialog can't be closed until it finishes |
| 5 | After the charge | Wait a moment | The hub opens the new **Testimonials** tab under **Website**, and a toast reads "Testimonials is on your site. Receipt emailed." with **View on site**. The add-on's card on **Get add-ons** now shows **On your site** |

### If your card is declined

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | The add dialog | Click **Add and pay {amount}** with a card that fails (in test mode, use the failing test card on the card page) | A red alert inside the dialog reads "Your card was declined. Update it in Settings › Billing." and "Nothing was added." with an **Update card** button. The add-on is not on your site and nothing was charged |
| 2 | The dialog | Click **Update card** | Your card page opens. Save a working card; you come back to Settings › Billing |
| 3 | `/hub/add-ons` | Add the add-on again | The charge goes through and the add-on is on your site |

### If your add-ons are paused

When a payment stops, paid add-ons pause: their cards show **Paused** with only **Details**, and nothing is deleted.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons` | Click a paused add-on's **Details** | Its page shows a yellow alert "Testimonials is paused because payment stopped. Your testimonials are kept and come back when you pay." and the button **Update card and pay** |
| 2 | Any add dialog while paused | Click **Add to site** on another add-on | The dialog shows "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones." with **Update card and pay**, and no add button |
| 3 | The detail page | Click **Update card and pay** and pay the overdue bill | On your next hub visit a toast reads "Payment received. Your add-ons are back on." and the add-on shows **On your site** again |

### Removing an add-on and the credit

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/add-ons/testimonials` | Scroll to **Remove from site** and click **Remove from site** | The dialog "Remove Testimonials from your site?" opens with **Keep it** focused. It says your testimonials are kept and "Your monthly bill drops by $9. You get credit for the rest of the month." |
| 2 | The dialog | Click **Remove from site** | A toast reads "Testimonials was removed. Your testimonials are kept." with **Add it back** for 8 seconds. Your next bill is lower and shows the credit |
| 3 | The toast | Click **Add it back** | The add dialog opens again with its money block, so you see the charge before anything is paid. Click **Add and pay {amount}** to bring it back with everything restored, or **Not now** to leave it off |
