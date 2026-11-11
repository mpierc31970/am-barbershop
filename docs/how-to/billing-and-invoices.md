---
feature: Billing and invoices
phase: 10
route: /hub/settings?tab=billing
---

# How to: Billing and invoices

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Settings › Billing shows everything you pay CDS for on one screen: your plan, your next bill, your card, each item on your one monthly subscription, your Care Plan hours, your media storage, quotes from CDS and every invoice with its PDF. The page reads CDS's own copy of your billing records, so it opens fast and never waits on the card processor.

Only the site owner sees the Billing tab. Admins, editors and viewers do not. CDS staff viewing the hub as the owner see it read-only with "You're viewing as CDS staff, so billing changes are turned off. Only the owner can change billing."

While CDS is in test mode, **Update card** opens a CDS test card page instead of Stripe's, and invoice links open CDS test invoice pages.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings?tab=billing` | Before you have paid, open Settings, then the Billing tab | A blue strip reads "You haven't checked out yet. Your plan and invoices show here after you pay." with a **Go to checkout** button; under it "Your plan, card and invoices show here after checkout.", Quotes from CDS, and Invoices with "No invoices yet" |
| 2 | `/hub/checkout` | Click **Go to checkout**, then pay for your site (see the Checkout how-to) | You come back to the hub; the payment is confirmed |
| 3 | `/hub/settings?tab=billing` | Open Settings › Billing again | A green strip reads "You're all paid up. Next bill {date}, {amount}." and the Your plan, What you pay for, Care Plan, Media storage, Quotes from CDS and Invoices sections show |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Billing, Your plan | Read the Plan, Next bill and Card rows | Plan reads e.g. "Standard website, billed monthly"; Next bill reads e.g. "8 Nov 2026 · $39.00 plus sales tax"; Card reads e.g. "Visa ending 4242, expires 08/28". To switch between monthly and yearly, ask CDS Support (the line under the plan says so) |
| 2 | Settings › Billing, What you pay for | Read the list | One row per item with its price: your plan, each add-on ("$9/mo" or "Included"), storage packs ("+5 GB storage × 1 · $5/mo"), build payments ("Website build, payment 3 of 6 · $250/mo" with "Ends after {date}."), and the Care Plan when on. The last row reads "Monthly total · {amount} plus sales tax". Each amount is what you are billed for that item: with a price lock, your locked price, not today's list price. An item whose price CDS has not set yet reads "Price coming soon". **Manage add-ons** opens Get add-ons |
| 3 | Settings › Billing, Your plan | Click **Update card** | The secure card page opens in the same tab (in test mode, the CDS test card page) |
| 4 | The card page | Enter the new card and save, then follow the link back | You land on Settings › Billing and a toast reads "Card updated." |
| 5 | Settings › Billing, Invoices | Find the invoice you want (newest first; **Show more** loads older ones) and click **View invoice** | The invoice page opens (Stripe's opens in a new tab), with its PDF to download for your records. Each row shows the date, invoice number, what it was for, the amount with its tax, and a badge: Paid, Due, Unpaid, Refunded or Cancelled |
| 6 | Settings › Billing | If a card payment fails, read the yellow strip | It reads "Your last payment of {amount} didn't go through. Your site and add-ons are still on while Stripe tries again. Update your card to fix it now." with a primary **Update card** button. The tab label reads "Billing · 1" |
| 7 | Settings › Billing | If payment stopped after the retries, read the yellow strip | It reads "Your add-ons are paused because payment stopped. Your site's pages are still live and nothing was deleted. Pay {amount} to turn everything back on." In What you pay for, each paused add-on carries a **Paused** badge. Nothing new can be added while paused |
| 8 | Settings › Billing, strip | Click **Update card and pay**, save a working card on the card page and pay the open invoice | You come back to Settings › Billing; the strip turns green and your paused add-ons come back on with everything they held |
| 9 | Settings › Billing, Quotes from CDS | When CDS sends you a quote, click **Review quote** | The quote page opens; quotes waiting for you sit first, with a "Waiting for you" badge, and the strip shows "CDS sent you a quote: {title}." |
| 10 | Any hub screen except Settings › Billing | While a card payment has failed, look at the top of the page | A yellow banner reads "Your last card payment didn't go through. Update your card to keep your add-ons on." with an **Update card** button. It has no close button and only the owner sees it |
| 11 | Any hub screen except Settings › Billing | While add-ons are paused, look at the top of the page | The yellow banner (pause icon) reads "Your add-ons are paused because payment stopped. Your site's pages are still live and nothing was deleted. Pay {amount} to turn everything back on." with **Update card and pay** |
| 12 | `/hub/website?tab=testimonials` (a bookmark of a paused add-on's tab) | Open the bookmark while paused | You land on Pages with "Testimonials is paused because payment stopped. Pay from Settings › Billing to see your testimonials again." (the owner also gets **Update card and pay**) |
| 13 | Page builder, block list | Open a page that holds a paused add-on's block | The block keeps its place, dimmed, with a **Paused** badge and "Testimonials is paused, so this block doesn't show on your site. It comes back when payment does." |
| 14 | Any hub screen | After paying, open the hub | The banner is gone and a toast reads "Payment received. Your add-ons are back on." once; reloading does not show it again |

## If CDS declines your order

If CDS can't take on your build (within 5 business days of paying, before work starts), CDS refunds everything and your hub shows one screen instead of the dashboard, for every member of the site:

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any `/hub` address, or sign in | Open the hub | A plain screen with only your business name, email and **Sign out** at the top. It reads "We've refunded your order", why, "Refunded · $1,539.00 to Visa ending 4242 on 9 Oct 2026" and "Account and site details deleted on · 8 Nov 2026" |
| 2 | Same screen | Click **Download your signed agreement** (owner and admins) | The signed agreement downloads |
| 3 | Same screen | Click **View invoices** (owner) | A read-only list of your invoices opens below, each with **View invoice** |
| 4 | Same screen | Click **Contact CDS Support** | Your email app opens a message to CDS Support |
