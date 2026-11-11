---
feature: Website quote
phase: 06
route: /start
---

# How to: Build and save your website quote

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The quote page is public. The visitor picks a path, a business type and add-ons, watches the receipt update, and can save the quote to their email before they submit. Prices come from the price catalog. Staff set them with `npm run prices:set`, and anything unpriced reads **Price coming soon**.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any browser, `/start` on the platform domain | Open the page. There is nothing to install and no sign-in | The page reads **Build your website**. The two path cards **Standard** and **Studio** show their prices, and the receipt on the right reads **Your quote** with "Pick a path to see your price. Every figure here is the real price, before you commit." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start`, **Which sounds like you?** | Click the **Standard** card | The card shows a check. **What kind of business?** appears and takes focus. The receipt fills in: **Website build** $1,500 with "or 6 × $250 with no surcharge", **Standard plan** $39/mo, **Due at checkout** $1,539, "With 6 build payments: $289 at checkout", **First-year total** $1,968 |
| 2 | `/start`, **What kind of business?** | Click the **Therapist** chip | The chip shows a check. **Recommended for therapists** appears with the add-on rows. The receipt's **Review and submit** button turns on |
| 3 | `/start`, add-on rows | Tick **Testimonials** | The receipt adds "Testimonials" under **Monthly** with "Added now, setup is free". **Due at checkout** fades to the new total and briefly highlights. An unpriced add-on shows **Price coming soon** and the note "+ 1 item priced soon" |
| 4 | `/start`, **Want help with any of these?** | Tick **Logo design** | The receipt adds "Logo design" under **One-time** with its price, or **Price coming soon** |
| 5 | Receipt, **Billing** | Click **Yearly, 2 months free** | The receipt reads "Yearly covers the plan and add-ons. The build fee is the same." For Standard with no add-ons, **Due at checkout** and **First-year total** both read $1,890 |
| 6 | Receipt, Care Plan switch | Turn on **Add the Care Plan · $99/mo** | The Care Plan is added to the monthly total. Turn it off again to remove it |
| 7 | Phone (narrower than 1024 px), `/start` | Tap **View quote** in the bar at the bottom (it shows "$39/mo" over "$1,500 build") | The full receipt slides up in a sheet. **Close quote** or Esc closes it, and focus returns to **View quote** |
| 8 | `/start`, **Save your quote? Just your email.** card under the add-ons | Type an email, click **Save quote** | The button reads "Saving…". Then the card becomes one line: "Quote saved. We sent a link to maria@example.com." The receipt shows "Saved to maria@example.com". The email arrives (logged-not-sent in dev: `dev/mail/`) |
| 9 | `/start`, save card | Click **No thanks** instead | The card goes away for this visit. The receipt's **Save this quote** link brings it back |
| 10 | The **quote saved** email | Click its link (`/start/q/<token>`, 06-16) | `/start` opens with every choice restored and the toast "Welcome back. Your quote is just as you left it." Opening `/start` again later in the same visit shows "Your quote is just as you left it." once |
| 11 | The **quote saved** or reminder email | Click **Unsubscribe**, then the **Unsubscribe** button on `/start/unsubscribe` (06-16) | The page reads "You're unsubscribed. We won't send more reminders about this quote." |
| 12 | Receipt | Click **Review and submit** | `/start/submit` opens to create the account (Submit how-to, 06-17). Before a path and business type are chosen, the button is dimmed with "Choose your path and business type first." |
| 13 | Browser with JavaScript turned off, `/start` | Pick a path, click **Update my quote**, then pick a type, tick add-ons, choose billing and click **Update my quote** again | The page reloads after each click with your choices kept and the receipt priced on the server. Everything works except the live updates |
