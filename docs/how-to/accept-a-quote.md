---
feature: Accept a quote from CDS
phase: 10
route: /hub/settings/quotes/<id>
---

# How to: Accept a quote from CDS

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every paid job (a design polish block, a custom block, a private or premium add-on) is quoted and accepted in your dashboard before any work starts (D297, D299). Polish and custom blocks are paid in full when you accept. Add-ons are paid as a 50% deposit when you accept and the balance when CDS delivers; their monthly maintenance then joins your one monthly bill.

Only the site owner can accept or decline a quote, and only after checkout (quotes are paid on the same account as your monthly bill). CDS staff viewing the hub as the owner see the quote read-only.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support/tickets/new` | Click **Get help** on CDS Support and file a **Change request** for the paid work you want (for example "polish my homepage design" or "build me a custom add-on") (see [Get help](get-help.md)) | CDS marks the ticket as a paid service. On the ticket, click **Get a quote** (see [Paid services and your Care hour](paid-services-and-care-hour.md)); CDS writes the scope and price and sends you a quote |
| 2 | `/hub/support/tickets/<number>` | When the quote is sent | The ticket's paid-service box shows **View quote** with "Sent {date} · {total}"; clicking it opens the same quote page as Settings › Billing. Accepting the quote moves the ticket to **In progress** |
| 3 | Your email inbox | Open the email "CDS sent you a quote: {title}" | It names the quote, the price and the date it is valid until, with a link to the quote in your dashboard |
| 4 | `/hub/settings?tab=billing` | Open Settings, then the Billing tab, and scroll to **Quotes from CDS** | The quote is listed first with the badge **Waiting for you**, "Sent {date} · {total}" and a **Review quote** link. The tab label reads "Billing · 1" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Billing, Quotes from CDS | Click **Review quote** | The quote page opens at `/hub/settings/quotes/<id>` with the Billing tab still selected and a **← Billing** link at the top. The heading is the quote title with the badge **Waiting for you**, under it "Quote from CDS · Sent {date} · Valid until {date}" |
| 2 | The quote page | Read **What CDS will do** and the **Price** box | The scope lists the work. The price box shows the rows for this kind of job (for example "Design polish, 3-hour block · 3 h × $120 · $360", or "Build price", "Deposit today (50%)", "Balance when delivered" and "Maintenance after delivery · $50/mo on your monthly bill" for an add-on), then **Pay now** with the amount due today and "Plus sales tax where applicable." |
| 3 | The quote page | Look at **Accept and pay {amount}** before ticking anything | The button is dimmed and the line under it reads "Tick the box above to accept." Clicking it does nothing |
| 4 | The quote page | Tick "I accept this quote and its scope. I understand work starts once the invoice is paid." | The box is ticked, the reason line goes away and **Accept and pay {amount}** is ready |
| 5 | The quote page | Click **Accept and pay {amount}** | The button reads "Opening your invoice…", then the hosted invoice page opens in the same tab for the full price (polish, custom block) or the 50% deposit (add-ons). If it can't open, the page says "We couldn't open your invoice. Your acceptance is saved; try again in a minute." and clicking the button again re-opens the same invoice |
| 6 | The invoice page | Pay the invoice with your card | The invoice shows as paid. Back on the quote page the badge reads **Paid** (or **Deposit paid**) and the line reads "Paid on {date}. CDS has started the work and will message you when it's ready." (after a deposit it reads "CDS has started the work and will message you when it's ready.") |
| 7 | The quote page, accepted but not yet paid | Come back before paying | The line reads "Accepted on {date}. Pay the invoice to start the work." with a **Pay {amount}** button that opens the same invoice |
| 8 | The quote page, after CDS delivers an add-on | Open the quote from Settings › Billing (**View quote**) | The line reads "CDS delivered this work on {date}. Pay the balance to finish; your monthly maintenance starts with your next bill." Click **Pay the balance {amount}** and pay the invoice that opens |
| 9 | Settings › Billing, What you pay for | Check your next bill after delivery | The add-on's maintenance is listed on your one monthly bill from the next billing date; no separate subscription is created |
| 10 | The quote page, quote waiting | Click **Decline this quote** | A dialog titled "Decline this quote?" says "CDS is told, and no work starts. You can ask for a new quote any time." **Keep quote** has the focus |
| 11 | The dialog | Click **Decline quote** | The button reads "Declining…", the dialog closes and the page reads "You declined this quote on {date}." CDS gets an alert; nothing is invoiced |
| 12 | The quote page, past its valid-until date | Open an old quote | The page reads "This quote expired on {date}. Ask CDS Support for a new one." and there is nothing to accept |
