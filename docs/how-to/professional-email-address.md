---
feature: Get an email address at your own domain
phase: 06
route: /hub/settings?tab=email
---

# How to: Get an email address at your own domain

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Your site's emails always go out under your business name, from your site's own sending address (like `rivera-bakery@send.connectionsdesignstudios.com`). Customers' replies go to your main address. A Gmail, Outlook or Yahoo address works fine for replies, but it is never used as the sender (D112, D173), because inboxes treat a business email "from" a free-mail address as suspicious. An address at your own domain (like `orders@riverabakery.com`) looks more professional in replies. You pick the email provider and pay them directly; CDS never buys one for you. Once your domain is connected to CDS (see **Connect your domain**), your site's emails can also be sent from your own domain, like `hello@riverabakery.com`: steps 7 to 10 below (ONB-10). To add your provider's records for you, use **Set up email for your domain**. The steps in **Use** are also shown in the hub, under **get an address at your own domain**.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/settings?tab=email` (or setup step **Email**, `/hub/setup/email`) | Scroll to **How your emails look to customers** | The block reads "From: **Rivera Bakery** <rivera-bakery@send…>" and "Replies go to: **maria@gmail.com**" |
| 2 | The same block, with a Gmail (or other free-mail) main address | Read the line under it | It reads "Using Gmail is fine: replies come straight to you. For a more professional look, **get an address at your own domain**." |
| 3 | The same line | Click **get an address at your own domain** | A drawer opens on the right titled **Get an address at your own domain**, listing the steps below |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Your domain | Check you own a web address, like riverabakery.com. If you don't have one yet, choose "I need a domain" in setup step Domain & the rest | You know the domain your email address will use |
| 2 | An email provider of your choice (Google Workspace, Microsoft 365, Zoho Mail, Fastmail or your domain registrar's email) | Sign up for a mailbox on your domain and follow the provider's steps to connect it to the domain | The provider says your domain is verified, and you can send and receive at an address like orders@riverabakery.com |
| 3 | Your new mailbox | Send a test email to it from another address | The test arrives in the new mailbox |
| 4 | Settings, Email tab (/hub/settings?tab=email) | Under Everything goes to, click Change address, type the new address and click Save and send confirmation | A toast reads "We sent a confirmation to orders@riverabakery.com." The new address shows Waiting for confirmation, and your old address keeps getting email until you confirm |
| 5 | Your new mailbox | Open the email from CDS and click Confirm this address | The page reads "Address confirmed." Back in Settings, Email, the new address shows Confirmed and the old one is gone |
| 6 | Settings, Email tab, How your emails look to customers | Read the preview | "Replies go to" shows your new address, and the line about Gmail is gone. The From stays your business name at your site's sending address |
| 7 | Settings, Email tab, How your emails look to customers, once your domain is connected (see Connect your domain) | Read the sending line under the preview | It reads "Setting up sending from riverabakery.com. This usually takes under an hour." Emails keep going out under your business name meanwhile |
| 8 | The same line, usually within an hour | Read it again | It reads "Emails now send from hello@riverabakery.com." and the From line of the preview shows that address |
| 9 | The same row, field Send from (the part before @riverabakery.com) | Type another name, like bookings, and click Save sending address | A toast reads "Emails now send from bookings@riverabakery.com." Replies still go to your main address |
| 10 | The same row, if setup couldn't finish | Read the warning | It reads "We couldn't finish setting up sending from riverabakery.com. CDS is checking it. Emails still send under your business name." Nothing to do: CDS fixes it |
