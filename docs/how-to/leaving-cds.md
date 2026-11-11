---
feature: Moving away
phase: 14
route: /hub/leaving
---

# How to: Moving away

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Moving away gives 30 days' notice. First your DNS moves back to you, so your email keeps working; then you download your data, and your site closes at the end of the notice. Your domain was always yours. No discount offers, no extra steps.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Billing (`/hub/settings?tab=billing`), signed in as the **Owner** | On the last row **Move away**, click **Move away…** | **Moving away** (`/hub/leaving`) opens: "We're sorry to see you go. Here's exactly what happens, in order." and the ordered list (DNS first, site up 30 days, download, billing, site closes) |
| 2 | The same row while support staff view your site | Read the row | The button is off: "You're viewing as support staff, so this is turned off. Only the owner can start leaving. Staff use the console." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/leaving` | Optionally pick **Why are you leaving? (optional)** and write **Anything we should know? (optional)** | The fields are filled |
| 2 | The same page | Enter the code from the email ("To confirm, we emailed a code to m•••@gmail.com.") and click **Start the 30-day notice** | The button shows **Starting…**, then a toast reads "Your 30-day notice has started. Next: move your DNS." Every hub screen shows "Moving away · 30 days left · Next: move your DNS" with **Open checklist** |
| 3 | Checklist step **Move your DNS** | Click **Download zone file** | A file of your DNS records downloads. "Your email records are in Copy exactly. Copy them first." |
| 4 | **Where should your DNS go?** | Pick **Back to GoDaddy's DNS** (most people) or **Another DNS host** and enter **New nameserver 1** and **New nameserver 2** | The steps for that choice show |
| 5 | **Add your records there** | Add the records from the file at the new DNS, then click **Check my new DNS** | Each record shows **Found at your new DNS** or **Not found yet**, email first. Registrar DNS that only answers after the switch reads "GoDaddy's DNS only answers after the switch. We'll check through public DNS straight after you change." |
| 6 | **Now change your nameservers to …** | Change the nameservers at your registrar to the ones shown, then click **I've changed them** | "Usually under an hour, sometimes up to 48. We'll email you when it's done." When done: "Your DNS is back with you. Your email keeps working." The other steps unlock (before that they read "Opens once your DNS has moved back.") |
| 7 | **Download your data** | Click **Download your data** | Your site's data downloads as a zip, including your DNS records ("Available until 14 Nov 2026.") |
| 8 | **Add-ons**, **Connected services**, **Billing**, **Your site closes** | Read each | "Nothing to settle for your add-ons.", what disconnects on the notice end, your plan's end date and "Deleted 30 days later" |
| 9 | The checklist footer, if you change your mind | Click **Stay with us**, then **Stay with us** in the dialog | A toast reads "Your notice is cancelled." Everything carries on as before, including your price |

If an email record is missing after the switch: "1 email record is missing at your new DNS. Switch your nameservers back to ours until it's added: your email keeps working there." If your domain never moved to us, step 1 reads "Your domain never moved to us, so there's nothing to hand back."
