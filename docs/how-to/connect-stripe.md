---
feature: Connect your Stripe account
phase: 10
route: /hub/settings?tab=payments
---

# How to: Connect your Stripe account

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Connecting Stripe lets your customers pay you online for bookings, events and orders. It is your own Stripe account: you own it, you are the seller, and money goes straight from your customers to you, never through Support. You pay Stripe's fees directly (for example 2.9% + 30¢ online). Support takes no cut.

Only the site owner can connect or change Stripe. An admin sees the Payments tab read-only with "Only the site owner can connect or change Stripe." support staff viewing the hub as the owner see it read-only with "You're viewing as support staff, so Stripe changes are turned off. Only the owner can connect Stripe." Editors and viewers do not see the tab. Without Stripe your site still works: customers can book and pay you in person.

While Support is in test mode, the button opens a test page instead of Stripe ("Test mode: this connects a pretend Stripe account."). Pick **Connect test account** there to finish.

The **Help me set up Stripe** link on the tab opens these same steps beside the page.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar | Click Settings, then the Payments tab | Settings › Payments opens with the heading "Take payments on your site", a Not connected badge, and a grey box: "You own this account, you are the seller, and you pay Stripe's fees directly (for example 2.9% + 30¢ online). Support takes no cut." |
| 2 | Settings › Payments | Click Connect your Stripe account | The button reads "Opening Stripe…" with a spinner, then Stripe's own setup page opens (in test mode, the "Connect a test Stripe account" page) |
| 3 | Stripe's setup page | Sign in to the Stripe account you already have, or create a free one, and answer Stripe's questions about your business and bank account (about 10 minutes) | Stripe shows that your details are submitted and sends you back to Support (in test mode, click Connect test account) |
| 4 | Settings › Payments | Wait a moment after you come back | "Checking your Stripe account…" shows with a spinner, then the badge turns to Connected and a toast reads "Stripe connected. Your site can take payments online." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Payments | Look at the Connected section | It lists Account (your business name and "acct ending" with the last 4 characters), Online payments On, and Last checked (for example "2 minutes ago") |
| 2 | Settings › Payments | Click Check again next to Last checked | Support asks Stripe for the latest status; Last checked changes to "just now" |
| 3 | Settings › Payments | Click Open your Stripe dashboard | Your Stripe dashboard opens in a new tab, where you see payments, payouts and receipts |
| 4 | Settings › Payments, badge Setup not finished | Read the yellow note, then click Finish Stripe setup | The note reads "Your Stripe account isn't finished yet, so online payments are off. Pick up where you left off; Stripe saves your progress." The button opens Stripe where you left off; finish it to see Connected and the toast |
| 5 | Settings › Payments, badge Needs attention (the tab label reads "Payments · 1") | Read the yellow note, then click Finish Stripe setup | The note explains Stripe paused payments, usually for a missing detail or document, and that customers can still book and pay in person. Finish what Stripe asks for; back on the tab the badge returns to Connected |
| 6 | Settings › Payments, badge Not connected after a disconnect | Read the yellow note, then click Connect your Stripe account | The note reads "Your Stripe account was disconnected, so online payments are off." Connecting again turns payments back on |
| 7 | Your Stripe dashboard | To disconnect, remove A&M Barber Studio under Settings › Connected accounts | Online payments on your site stop straight away. There is no Disconnect button in the hub; the tab shows the Not connected state |
| 8 | Your site, while payments are paused | Open a booking or event page that takes payment | Customers see "Online payment is paused; you can still book and pay in person." and can still book |
| 9 | Settings › Payments | Read the grey fees box | It always reads "You own this account, you are the seller, and you pay Stripe's fees directly (for example 2.9% + 30¢ online). Support takes no cut." Stripe charges its fees from your own account; Support never adds a fee |
