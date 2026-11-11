---
feature: Paid services and your Care hour
phase: 12
route: /hub/support?tab=tickets
---

# How to: Paid services and your Care hour

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Things you can do in your dashboard are yours; we'll show you how. Doing it for you is a paid service. When you ask Support for a change like that, Support marks the ticket as a paid service and you choose: do it yourself with a how-to, get a quote, or (on the Care Plan) use your monthly Care hour. No paid work starts until you choose. Only the site owner can choose a paid option; Admins and Editors see "Ask your site owner."

Paid services are copywriting, design changes, page building, product entry, newsletters, photos, logos, SEO and custom work (see [What support includes](what-support-includes.md)).

## Activate

Nothing to turn on: Support marks a Change request as a paid service when it is one.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support/tickets/new` | File a **Change request** (see [Get help](get-help.md)) | The form already warns "Some changes are a paid service" |
| 2 | Any hub screen (Owner) | When Support marks it paid | Today's **Needs you** shows "Choose how to handle ticket #1042" with **Choose an option**, and the ticket is **Waiting on you** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support/tickets/<number>` | Read the box at the top of the thread | A Support box **This is a paid service** with the category (e.g. "Design changes"), "Things you can do in your dashboard are yours; we'll show you how. Doing it for you is a paid service." and three options: **Do it yourself**, **Have Support do it** and (on the Care Plan) **Use my Care hour** |
| 2 | The paid-service box | Under **Do it yourself** ("Most changes like this take a few minutes in your dashboard."), click **Show me how** | The how-to for that kind of change opens in the help drawer. The ticket's status does not change |
| 3 | The paid-service box (Owner) | Under **Have Support do it** ("We'll send you a price first. Nothing starts until you accept."), click **Get a quote** | The line reads "Quote requested 12 Oct. Support will send it here." |
| 4 | The paid-service box, quote sent | Click **View quote** | The quote opens at `/hub/settings/quotes/<id>` ("Sent 13 Oct · $120"). Accept and pay it there (see [Accept a quote from Support](accept-a-quote.md)); the box then reads "You accepted the quote on 13 Oct. Support has started." |
| 5 | The paid-service box (Owner on the Care Plan) | Under **Use my Care hour** ("You have 35 of 60 minutes left in October."), click **Use my Care hour** | A dialog "Use your Care hour on this?" explains "Support works on it using this month's Care Plan time and tells you how many minutes it took." **Not now** has the focus |
| 6 | The dialog | Click **Use my Care hour** | The thread shows "{your name} chose the Care hour" and the box reads "You chose your Care hour on 12 Oct. Support has started." The minutes Support uses show on Settings › Billing (see [Care Plan](care-plan.md)) |
| 7 | The paid-service box, Care Plan with no minutes left | Read **Use my Care hour** | "No Care minutes left in October." and no button: get a quote instead |
| 8 | The paid-service box, not on the Care Plan (Owner) | Read under the options | "With the Care Plan, small jobs like this use your monthly Care hour." and **About the Care Plan** |
| 9 | The paid-service box (Admin or Editor) | Read the options | **Show me how** works; the other options read "Ask your site owner. Only they can choose a paid option." |
