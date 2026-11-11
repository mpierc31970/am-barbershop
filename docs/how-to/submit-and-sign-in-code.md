---
feature: Submit and sign in with a code
phase: 06
route: /start/submit
---

# How to: Submit your quote and sign in with a code

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Submit turns a quote into an account and a site. The visitor gives the business name, one sentence about the business and an email. We email a 6-digit code, and the code creates the account, so there is no password. Nothing is charged and no agreement is accepted here: the agreement and payment come at checkout, after Support has confirmed the site. Owners sign in again later with **Email me a sign-in code** on `/sign-in`.

In dev, email is logged, not sent. The code appears in the dev PocketBase log when `CDS_OTP_STANDIN=1` is set on the `pocketbase-cdsp` container: run `ssh pocketbase-cds "docker logs --tail 20 pocketbase-cdsp"` and read the six digits on the last `OTP_STANDIN` line. Never set it in production.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start` on the platform domain | Pick a path and a business type (see the website quote how-to), then click **Review and submit** in the receipt | `/start/submit` opens with the heading **Almost there** and "Tell us who you are. We'll email you a code to create your account. Nothing is charged today." Without a quote, `/start/submit` sends you back to `/start` |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/start/submit`, wide screen (1024 px or more) | Look at the right-hand column | The receipt shows the quote read-only, with **Change your quote** (back to `/start`) in place of Review and submit. On a phone, the receipt is folded into "Your quote: $1,539 at checkout" below the form; tap it to open |
| 2 | `/start/submit`, **Business name** | Type "Rivera Bakery" | The field fills. The browser may offer your organization name |
| 3 | `/start/submit`, **What does your business do?** | Type "Family bakery in Austin, known for sourdough." | The counter counts up to "45 / 200". The helper reads "One sentence, like 'Family bakery in Austin, known for sourdough.'" |
| 4 | `/start/submit`, **Email** | Check the address (it is filled in if you saved the quote) | The helper reads "This is how you'll sign in. No password needed." Under the button: "Next you'll set up your site's details. You'll see the agreement and pay only at checkout, after Support has confirmed your site." There is no terms checkbox |
| 5 | `/start/submit` | Click **Email me a code** | The button reads "Sending code…". Then the form is replaced by **Check your email** and "We sent a 6-digit code to maria@example.com. It expires in 5 minutes." The same words show whether or not the address already has an account. A quiet bot check runs with the button (it only asks for a click when unsure); if it fails, "We couldn't confirm you're a person. Try again, or refresh the page." shows above the button. An address that bounced before gets "Emails to this address bounced before. Check the spelling, or use another address." under the Email field |
| 6 | Your inbox (dev: the `docker logs` line above) | Find the 6-digit code | The email holds a 6-digit code that works for 5 minutes |
| 7 | `/start/submit`, **6-digit code** | Paste or type the code (a pasted "123 456" becomes "123456") | On the sixth digit the form submits by itself. The button reads "Creating your account…" and the field is locked. You can also click **Create my account** |
| 8 | After the code | Wait for the page to change | A clear site opens the setup overview at `/hub/setup`. A site we review first opens the same page with an "In review" note. If you already own a site with us, you are signed in to it at `/hub` with a note that we kept your new quote |
| 9 | `/start/submit`, code step, wrong code | Type a wrong code | An alert above the button reads "That code didn't match. Check the six digits and try again, or request a new one." and takes focus. An old code reads "That code has expired. Codes last 5 minutes. Request a new one." Too many tries read "We've sent several codes to this address. Wait a minute, then try again." |
| 10 | `/start/submit`, code step | Wait for **Resend code (0:24)** to count down, then click **Resend code** | A new code is emailed and "Code sent" shows under the buttons. The button counts down again from 0:30 |
| 11 | `/start/submit`, code step | Click **Use a different email** | The details form comes back with your answers kept. Change the email and click **Email me a code** again |
| 12 | `/start/submit`, a type of site we don't host | Enter the code | The page reads **We can't host this site** and "Your answers match a type of site we don't host: {category}." **See what we host and why** is open with both lists. **Contact Support** opens an email to Support. No account was created |
| 13 | `/sign-in`, later | Click **Email me a sign-in code** under the password form | The card shows an **Email** field and **Email me a code**. **Use a password instead** goes back |
| 14 | `/sign-in`, code path | Type your email, click **Email me a code** | **Check your email** appears with the same wording as Submit. An address without an account sees the same screen, and no account is created |
| 15 | `/sign-in`, **6-digit code** | Type the code from the email | The form submits on the sixth digit (or click **Sign in**) and opens your hub. A wrong code shows the same "That code didn't match…" alert |
