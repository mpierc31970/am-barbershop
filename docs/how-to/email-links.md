---
feature: Email links (reopen, unsubscribe, confirm address)
phase: 06
route: /start/q/<token>, /start/unsubscribe, /start/confirm-email
---

# How to: Use the links in Support emails

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Support emails carry three kinds of link. A **reopen** link brings a saved quote back. An **unsubscribe** link stops quote reminders. A **confirm** link confirms where a site's email should go. Opening a link never changes anything by itself, because email scanners open links too. The page always asks first, and the button does the work.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start` on the platform domain | Pick a path and a business type, then save the quote with your email (see the Website quote how-to) | The **quote saved** email arrives (logged-not-sent in dev: `dev/mail/`) with a link to `/start/q/<token>` and an **Unsubscribe** link. There is nothing to install |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | The **quote saved** email | Click the quote link (`/start/q/<token>`) | `/start` opens with every choice restored and the toast "Welcome back. Your quote is just as you left it." |
| 2 | A **reminder** email (day 1 or day 3) | Click its quote link (`/start/q/s/<signed>`), then **Open my quote** | The link first opens **Your quote is ready** with "Open it to pick up where you left off. Every choice you made is saved." Nothing has changed yet, so a mail scanner opening the link changes nothing. The button opens the same `/start` with the welcome toast. Any older quote link or cookie for this quote stops working |
| 3 | A quote link more than 30 days after the last change, or a mistyped one | Open it | The page reads **This quote has expired** with "Quotes last 30 days after the last change. Start a fresh one; it takes a few minutes." Click **Start a new quote** to open an empty `/start` |
| 4 | A quote link for a quote that was already submitted | Open it | The page reads **You've already submitted this quote** with "Sign in to keep setting up your site." Click **Sign in** to open `/sign-in` |
| 5 | A reminder email's footer | Click **Unsubscribe** | `/start/unsubscribe` reads **Stop quote reminders?** with "We'll stop emailing you about this quote. Your link keeps working until 28 Oct." Nothing has changed yet |
| 6 | `/start/unsubscribe` | Click **Unsubscribe** | The button reads "Unsubscribing…", then the page reads **You're unsubscribed** with "We won't send more reminders about this quote." Click **Open my quote** to go to `/start`: the quote opens in the browser you built it in; anywhere else, use the quote link in your email |
| 7 | Your mail app's own **Unsubscribe** button (Gmail, Apple Mail) on a reminder | Click it | The mail app unsubscribes you in one click (RFC 8058, `POST /api/email/unsubscribe`). No page opens. The next reminder is not sent |
| 8 | Hub, **Where should your email go?**, after adding an address | Open the **confirm your address** email and click its link (`/start/confirm-email?t=…`) | The page reads **Confirm this email address?** with, for example, "Rivera Bakery's website inquiries will go to **orders@riverabakery.com**." Nothing is confirmed yet |
| 9 | `/start/confirm-email` | Click **Confirm this address** | The button reads "Confirming…", then the page reads **Address confirmed** with "Website inquiries for Rivera Bakery will go to orders@riverabakery.com." Click **Back to your site's settings** to open `/hub/settings?tab=email` (you sign in first if needed) |
| 10 | A confirm link that was already used, or is more than its time limit old | Open it | The page reads **This link has expired** with "Send a new confirmation from Settings › Email." Click **Open Settings** to send a new one |
