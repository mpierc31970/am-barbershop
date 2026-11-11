---
feature: Contact inquiries from the hub
phase: 15
route: /staff/pipeline?tab=leads (terminal: npm run leads:list)
---

# How to: Contact inquiries from the hub

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A visitor who sends the hub's `/contact` form becomes a **lead** of kind **inquiry** (HUB-07, A3-Q2). Each inquiry is stored in the platform collection `hub_inquiries` (name, email, business, topic, phone for a call, message) and CDS staff get one email. Staff then find it in the **Leads** tab of the Pipeline and in `npm run leads:list`. CDS replies from its own mailbox: the staff email's Reply-To is the visitor's address.

| Topic the visitor picks | Shown to staff as |
|---|---|
| A question | Question |
| I'd like a call | Book a call (with the phone number, if given) |
| Press or partnership | Press |

- **Email is logged, not sent,** until SES is set up: the staff email shows as one `[email-standin] hub.inquiry …` line in the app log, with the recipient hashed. Once SES is on it goes to `CDS_STAFF_ALERT_EMAIL` (GO-LIVE).
- **Limits:** 5 messages an hour per connection, plus the Turnstile bot check.
- **Retention:** inquiries are deleted 2 years (730 days) after they arrive, by the daily retention job.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub `/contact` (dev: `https://cds.needtobeedgy.com/contact`) | Fill **Name**, **Email**, choose **What's this about?** › **A question**, write a **Message** of at least 10 characters, click **Send message** | "Sending…", then "Thanks, we've got it." and "We'll reply to <email> by email." |
| 2 | Same page, `/contact?topic=call` (the old `/book` address redirects here) | The **I'd like a call** radio is already chosen; fill **Phone**, the rest, and send | "Thanks, we've got it." and "We'll email <email> to set up a time." |
| 3 | `/staff/sign-in` | Sign in as a Super Admin or Support agent ([Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | App log (dev) or the staff mailbox (after SES) | Look for the inquiry email | Subject "Hub contact (Question): <name>" (or "Book a call", "Press") with the visitor's name, email, business, phone and message. Reply to it to answer the visitor |
| 2 | `/staff/pipeline?tab=leads` | Choose **7 days**, **30 days** or **All** | The inquiry is a row in the Leads table: Lead "Contact form", Stage "Contact form · Book a call", the email masked ("m•••@gmail.com"). The message body is never shown here. Inquiries carry no stage chip and are never abandoned, so a stage chip or **Only abandoned** hides them |
| 3 | Same row | Click **Reveal email** | The full address shows; the reveal is written to the audit log against `hub_inquiries` |
| 4 | Terminal at the repo root | Run `npm run leads:list -- --since 7d`, sign in (staff email, password, emailed code) | A table `KIND · EMAIL · PATH · TYPE · ITEMS · STATUS · ASSEMBLED · LAST CHANGE`: inquiries read `inquiry` in KIND, the business (or name) in TYPE and a STATUS like "Book a call · Salon owner". The footer adds ", 1 inquiry" (or ", N inquiries") to the lead count. `--dry-run` checks the arguments without signing in |
| 5 | Terminal | Run `npm run retention:run -- --dry-run` | The report includes "Hub inquiries past 2 years:" with how many would be deleted. Prod runs the real job daily via `POST /api/jobs/retention` |
| 6 | Hub `/contact`, a sixth message from the same connection within the hour | Send it | "Too many messages from this connection. Try again in an hour, or email hello@connectionsdesignstudios.com." Nothing is stored |
