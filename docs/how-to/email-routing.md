---
feature: Where your email goes
phase: 06
route: /hub/settings?tab=email
---

# How to: Choose where your email goes

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Where should your email go?** decides which address gets each kind of email from your site and from CDS. One address gets everything by default: the one you signed up with, already confirmed by your sign-up code. You can send website inquiries (up to 5 addresses), newsletter replies, billing from CDS, and account and support messages somewhere else. Every new address gets a one-click confirmation email, and nothing goes to it until it's confirmed. Addresses save only when you click **Save and send confirmation**, because saving sends an email. The same form is setup step **Email** (`/hub/setup/email`) and **Settings › Email**.

The owner and admins can change it. An editor sees it read-only. On dev, emails are logged, not sent: each one is written to `dev/mail/`.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar | Click **Settings**, then the **Email** tab | The address ends in `/hub/settings?tab=email`. The heading **Where should your email go?** sits under the tabs, with "One address for everything is the simplest. You can send some messages elsewhere." |
| 2 | `/hub/settings?tab=email`, **Everything goes to** | Read the row | Your sign-up address with a green **Confirmed** badge and a **Change address** button. There is no remove button: the main address can be changed, never removed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Everything goes to** | Click **Change address** | A field **New address** opens with **Save and send confirmation** and **Keep current**, and the helper "Your current address keeps getting email until you confirm the new one." |
| 2 | **New address** field | Type `maria@` and click **Save and send confirmation** | Red text: "That doesn't look like an email address. Check it and try again." Nothing is sent |
| 3 | **New address** field | Type `orders@riverabakery.com`, click in another field (nothing happens), then click **Save and send confirmation** | Leaving the field saves nothing. The button saves: a toast reads "We sent a confirmation to orders@riverabakery.com." A second row shows the new address with a yellow **Waiting for confirmation** badge and "New address. Your current one keeps getting email until this one is confirmed." The old address still reads **Confirmed** |
| 4 | The waiting row | Click **Resend confirmation** | A toast repeats "We sent a confirmation to orders@riverabakery.com." The button reads "Sent. Check that inbox." and stays off for a minute |
| 5 | The waiting row (changed your mind) | Click **Keep current** | The new address disappears and the old one keeps getting everything |
| 6 | `/hub/settings?tab=email` | Click **Use a different address for…** | Four choices open, each a checkbox: **Website inquiries**, **Newsletter**, **Billing from CDS**, **Account and support** |
| 7 | **Website inquiries** | Tick the box, type `orders@riverabakery.com`, click **Save and send confirmation** | A toast reads "We sent a confirmation to orders@riverabakery.com." The address shows **Waiting for confirmation**, and **Add another address** appears below it |
| 8 | **Website inquiries** | Click **Add another address**, type the same address again and click **Save and send confirmation** | Red text: "This address is already on the list." With 5 addresses on the list, **Add another address** is gone |
| 9 | The inbox (on dev: the newest file in `dev/mail/`) | Open the **confirm your address** email and click its link | The page reads **Confirm this email address?** and names the address and what it will get. Nothing is confirmed yet |
| 10 | `/start/confirm-email` | Click **Confirm this address** | The page reads **Address confirmed**. Back on `/hub/settings?tab=email`, the address shows a green **Confirmed** badge |
| 11 | **Newsletter** | Tick the box, add a reply-to address and save it, then change **Sender name** (it starts as your business name) and click outside the field | The sender name saves by itself ("Saved" next to the page heading). "The name people see in their inbox." sits under it |
| 12 | **Website inquiries**, a row | Click the **X** (**Remove orders@riverabakery.com**) | The row disappears at once. A toast reads "orders@riverabakery.com removed." with **Undo** for 8 seconds |
| 13 | The toast | Click **Undo** | The address is back on the list, and a fresh confirmation is sent to it ("We sent a confirmation to …") |
| 14 | **How your emails look to customers** (the grey block) | Read it | "From: **Rivera Bakery** <rivera-bakery@send.…>" and "Replies go to: **maria@riverabakery.com**". Emails always go out under your business name from your site's sending address; replies come to your main address |
| 15 | The same block, with a Gmail main address | Read the extra line | "Using Gmail is fine: replies come straight to you. For a more professional look, **get an address at your own domain**." The link opens the steps in a drawer (see the professional email address how-to). Gmail is never shown as the From |
| 16 | A row with a red **Bouncing** badge | Read the alert under it, then click **Change address** | The alert reads "Emails to orders@riverabakery.com are bouncing, so you may be missing messages. Check the address or use another one." The Settings tab reads **Email · 1** while it bounces. **Change address** opens a field to replace it |
