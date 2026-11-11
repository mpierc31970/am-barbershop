---
feature: Set up email for your domain
phase: 14
route: /hub/settings?tab=domain&view=email
---

# How to: Set up email for your domain

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When you sign up with an email provider for your domain, it gives you records to add. Once your DNS is with us, this three-step flow adds them for you: the mail (MX) records, one merged SPF record, DKIM and verification. Nothing changes until the last step.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Domain (`/hub/settings?tab=domain`), signed in as the **Owner**, after your nameservers changed (see **Connect your domain**) | Click **Set up email for my domain** (also in **DNS records**) | The flow opens at "Step 1 of 3" with **Who provides your email?** |
| 2 | The same view, signed in as an **Admin** | Read the view | The current email provider shows, read-only |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Step 1, **Who provides your email?** | Pick your provider: **Google Workspace**, **Microsoft 365**, **Zoho Mail**, **Hostinger Email**, **Proton Mail** or **Fastmail**, then click **Next** | "Step 2 of 3" opens: **Paste your values from Google Workspace**. The provider you use today is marked "Your current email" |
| 2 | Step 1, provider not listed | Pick **Another provider**, then click **Ask Support to set it up** | A Support change ticket opens. "Support adds the records for you, usually within 1 business day." |
| 3 | Step 2 | Copy the **Verification value** (and the **DKIM value**, if asked) from your provider's admin screen, following the hint under each field, then click **Next** | "Step 3 of 3" opens. A wrong value shows "That doesn't look like a Google verification value. It starts with google-site-verification=." "Don't have these yet? You can come back. Nothing changes until step 3." |
| 4 | Step 3, **Check and add** | Read the list | Each record shows **Add**, **Replace** or **Update**, and the line "Your one SPF record gains **include:_spf.google.com**" |
| 5 | Step 3, if you already have email elsewhere | Read the warning, then tick **Replace my current email** | "This replaces your current email at **Zoho Mail**. New email goes to Google Workspace once the records update, usually within an hour, and stops arriving at Zoho Mail." **Add email records** turns on only after the tick |
| 6 | Step 3 | Click **Add email records** | The button shows **Adding…**, then "Email records added for Google Workspace" with "Finish in Google Admin: click Verify. It can take up to an hour to work." |
| 7 | Your provider's admin screen | Click **Verify** | The provider confirms the domain within about an hour |
| 8 | The success screen | Click **Back to DNS records** | The new records show under **Your email** |

If adding fails: "We couldn't add the records, so nothing changed. Try again in a minute."
