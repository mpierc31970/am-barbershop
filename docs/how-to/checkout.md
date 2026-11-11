---
feature: Checkout
phase: 10
route: /hub/checkout
---

# How to: Checkout

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Checkout is where the site owner pays for the website build and starts the monthly plan. The order shows the build fee (paid in full, or in 6 monthly payments with no surcharge), the plan, the add-ons and extras chosen during setup, and an optional Care Plan. Every figure on the page is worked out by CDS: the **Due today** amount is exactly what is charged. Payment happens on a secure payment page (Stripe, or a CDS test page while CDS is in test mode); CDS never sees the card number and takes no cut of the owner's own payment fees.

Only the site owner can pay, and only after signing the agreement. An admin sees the order read-only with "Only the site owner can pay. {Owner name} can do it from Set up your site." Staff viewing the hub as the owner see it read-only with "You're viewing as CDS staff, so payment is turned off. Only the owner can pay." Editors and viewers are taken to the hub.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` | As the owner, click **Send to CDS** once the must-haves are in (see the Set up your site how-to) | **What's still needed** gains **Review and sign your agreement** and, under it, **Pay and start your build** with "After you sign your agreement." |
| 2 | `/hub/agreement` | Sign the agreement (see the Sign your agreement how-to) | Back on `/hub/setup`, the agreement row reads "Agreement signed on {date}" |
| 3 | `/hub/setup` (CDS confirms the site) | Wait for CDS to check your details if the site was held | The row **Pay and start your build** reads "Your build fee and first month. About 2 minutes." and the panel's button is **Go to checkout**. While held it reads "Checkout opens once CDS has checked your details, usually within 2 business days." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` | Click **Go to checkout** | `/hub/checkout` opens with the heading **Pay and start your build**, the intro "Check your order, choose how to pay for the build…", and the **Your order** summary on the right (below the choices on a phone) |
| 2 | `/hub/checkout`, **Your website build** | Look at the two cards | **Pay in full** is first and selected ("$1,500 today", "One payment."); **6 monthly payments** shows "6 × $250" and "No surcharge. The first is today and the rest come with your monthly bill…" |
| 3 | `/hub/checkout`, **Your website build** | Click **6 monthly payments** | The summary's first Today line becomes "Build payment 1 of 6 · $250", **Due today** drops, and **Then** reads "$289 a month from {date} to {date}" followed by "$39 a month after that" |
| 4 | `/hub/checkout`, **Your plan** | Click **Remove** on an add-on row (for example **Testimonials · $9/mo**) | The row disappears, the summary updates, and a toast reads "Testimonials removed from your order." with **Undo** |
| 5 | `/hub/checkout`, the toast | Click **Undo** within 8 seconds | The add-on row comes back in the same place and the summary goes back to the old total |
| 6 | `/hub/checkout`, **Extras** | Click **Remove** on an extra (for example **Copywriting · $400 once**) | The row disappears, its line leaves the summary's Today list, and a toast reads "Copywriting removed from your order." with **Undo**. Extras can only be removed here, never added |
| 7 | `/hub/checkout`, an item marked **Price coming soon** | Read the yellow note under it | "We're finalising this price; remove it to continue now, or we'll email you when it's set." **Continue to payment** is faded with "Remove {item} to continue, or wait until its price is set." Click **Remove** on that row to continue |
| 8 | `/hub/checkout`, **Your plan** | Turn on **Add the Care Plan · $99/mo** | The summary adds "Care Plan, first month · $99" and **Due today** goes up by $99. It is off by default |
| 9 | `/hub/checkout`, **How often to pay** | Click **Yearly, 2 months free** | The plan line becomes "Standard plan, first year · $390" and **Then** reads "$390 a year from {date next year}". The build fee does not change |
| 10 | `/hub/checkout`, **Your order** | Read the summary | The Today lines, **Due today** in large figures, the tax line, the **Then** lines with dates, "Have a promotion code? Enter it on the payment page." and "You pay your own payment processor's fees. We take no cut." |
| 11 | `/hub/checkout` | Click **Continue to payment** | The button reads **Opening secure payment…** with a spinner and the choices lock; the secure payment page opens (in test mode, the CDS test payment page with a "Test mode" strip) |
| 12 | Secure payment page | Pay (in test mode, click the test page's pay button; no card is needed) | You come back to `/hub/checkout/return`: "Confirming your payment…" with "This usually takes a few seconds." |
| 13 | `/hub/checkout/return` | Wait a few seconds | A green tick and **Payment received**, "Thank you. CDS starts building your site now…", then **Paid today** (for example "$1,539.00 plus $0.00 tax"), **Next bill** and **Receipt** "Emailed to {your email}", with **Go to your hub** and **See billing and invoices** |
| 14 | `/hub/setup`, after paying | Look at **What's still needed** | The row reads "Paid on {date}" with a green tick and the link **Settings › Billing**; the sidebar number drops by one |
| 15 | Secure payment page | Click the back link instead of paying | `/hub/checkout` shows "You left the payment page, so nothing was charged. Your choices are kept." with your choices as you left them |
| 16 | `/hub/checkout` (a price changed while the page was open) | Click **Continue to payment** | Nothing is charged; a blue note reads "A price changed since you opened this page. We've updated your order; check the new total before you pay." and the summary shows the new figures. Click **Continue to payment** again |
| 17 | `/hub/checkout`, owner who has not signed | Open the page | The order is shown read-only with "Sign your agreement before you buy anything. It takes about 3 minutes." and a **Review and sign** button that returns here after signing |
| 18 | `/hub/checkout`, after paying | Open the page again | You are taken to **Settings › Billing** with "You've already paid. Your billing is here." |
