---
feature: Connect your domain
phase: 14
route: /hub/settings?tab=domain
---

# How to: Connect your domain

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Connect your own web address, like riverabakery.com, while Support builds your site, so launch day takes minutes. Support copies every DNS record you have, email first, before anything changes, and your current website and email keep working until launch. Your domain stays registered in your name. Support never buys or transfers domains.

Example values below (riverabakery.com, GoDaddy, Google Workspace, 7 records, dates) are filled from your own domain on screen.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub, signed in as the site's **Owner** | Open **Settings**, then the **Domain** tab (`/hub/settings?tab=domain`) | The status line reads "Your site is on its preview address, **rivera.sites.connectionsdesignstudios.com**." and the heading **Connect your domain** shows, with the line "Connect it now while Support builds your site, so launch day takes minutes. Your current website and email keep working until launch." |
| 2 | The same tab, signed in as an **Admin** | Read the tab | Everything shows, without buttons, and the line reads "Only the owner can change the domain." Editors and Viewers don't see the tab |
| 3 | The same tab, when connecting isn't open yet | Read the tab | It reads "Domain connection opens soon. Support will email you when you can connect yours." There is nothing to do yet; Support emails you |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Domain, field **Your domain** | Type `riverabakery.com` (a pasted `https://www.riverabakery.com/` is fine), then click **Check my domain** | The button shows **Checking…**, then the status line reads "Checking **riverabakery.com**." with the heading **Reading your records** and "We're reading every DNS record on riverabakery.com, email first. This usually takes a minute or two. You can leave this page; we'll email you." |
| 2 | The same screen, a minute or two later | Read the summary under **What we'll copy** | It reads "We found your email at **Google Workspace**. We'll copy these **7** records exactly before anything changes." and "Your email keeps working the whole time. Support never changes your records at GoDaddy." The records are listed in groups: **Your email** first, then **Verification**, **Your site** and **Other** |
| 3 | **Before you switch** (shown only when something needs you) | Follow each item: for "Turn off DNSSEC at GoDaddy first", turn it off at your registrar and click **Check again**; for forwarding, tick **I understand my email forwarding stops** | Each item clears once it is done. "This step can't be skipped." items stay until fixed; Support items read "We'll email you when it's done." |
| 4 | **Add your zone file (most complete)** (optional; opens by itself when we couldn't see every email record) | Pick your registrar under **Where is your domain registered?**, follow the steps to export the zone file, then drop the file on the box | A toast reads "Zone file added. We found 3 more records and added them to the copy." and the list shows the new records |
| 5 | The same screen, all items cleared | Wait for the check to finish | A toast reads "Every record matches. Your email keeps working when you switch." and the status line reads "Every record is copied. Next: change your nameservers." |
| 6 | **Change your nameservers** | Click **Copy** beside **Nameserver 1** and **Nameserver 2**; at GoDaddy, replace every nameserver with these two and remove any others, then save | The copy button shows "Copied". The line reads "Your current website and email keep working while the change spreads." |
| 7 | The same section, if someone else manages your domain | Click **Send these steps to someone**, enter **Their email**, an optional note, then **Send steps** | A toast reads "Steps sent to sam@example.com." (up to 5 sends a day) |
| 8 | The same section | Click **I've changed them** | The button shows **Checking…**, then the status line reads "Waiting for your nameservers to change." with "Usually under an hour, sometimes up to 48. We'll email you when it's done." If the change isn't seen yet: "We don't see the change yet. That's normal: it can take a while to spread. We'll keep checking and email you." |
| 9 | **Waiting for your nameservers** | Click **Check now** (once a minute at most) | "Last checked just now" updates. **Show the nameservers again** opens the two nameservers and the steps |
| 10 | Settings › Domain, once the change is seen | Read the status line | It reads "Ready. Goes live at **riverabakery.com** when Support approves your launch." and Today's Needs you item is gone |
| 11 | **Your main address** | Pick **riverabakery.com** (recommended) or **www.riverabakery.com** | "Saved" shows; the other address sends visitors to your main one after launch |
| 12 | Settings › Domain, after Support approves your launch | Read the status line | It reads "We're finishing your launch. Your site stays on its preview address until it's done." with **Launch steps**: Records copied · Nameservers changed · Pointing your domain to your new site · Setting up the secure connection · Switching to riverabakery.com · Telling search engines |
| 13 | Settings › Domain, when launch is done | Read the status line | It reads "Your site is live at **riverabakery.com**." with **View site**, **Secure connection** "On · renews automatically" and **DNS** "With us" |
| 14 | The live tab | Click **Change main address**, pick the other address, click **Save main address** | The dialog closes; visitors and search engines are sent to the new main address and links to the old one keep working |
| 15 | Settings › **Integrations** (`/hub/settings?tab=integrations`) | Read the tab | Before launch: "Search engines hear about your site once it's live on riverabakery.com. Your preview address is hidden from them on purpose." After launch: **Search engines and analytics** lists Google Analytics, Google Search Console, Bing Webmaster Tools and Instant updates, which Support sets up |

## Get a domain

If you don't have a domain yet ("Don't have one yet?" under the field), buy one from any registrar you like, such as GoDaddy, Namecheap, Hostinger, Squarespace, IONOS or Porkbun, in your own name. Support never buys or transfers domains, so it stays yours. Then come back and enter it under **Your domain**.

Cloudflare's registrar doesn't allow its nameservers to change. If your domain is there, the screen reads "riverabakery.com is registered at Cloudflare, which doesn't allow its nameservers to change. Support will set it up with you." and **Ask Support** opens a question ticket.

## Keep forwarding

Registrar email forwarding (and web forwarding) only works on the registrar's own DNS, so it stops when your nameservers move to Support. To keep receiving that email, set up a mailbox with an email provider first (see **Get an email address at your own domain**), or set the forwarding up with your email provider instead. Then tick **I understand my email forwarding stops**.

## Renew

Your domain is still registered at your registrar, in your name, and you renew it there. Settings › Domain shows "Renew riverabakery.com at GoDaddy before 3 Mar, or your site and email stop." 30 days ahead, and the urgent version 7 days ahead. Sign in at your registrar, renew the domain (turn on auto-renew if offered), and the warning clears at the next daily check. Support never renews or buys it for you.

## If something goes wrong

- "Switch your nameservers back to GoDaddy's": an email record didn't match after the switch. Your email keeps working at GoDaddy. Copy **Your old nameservers** back at your registrar, then click **I've switched them back**. Support has been alerted and contacts you the same day.
- "riverabakery.com no longer points to us": someone changed the nameservers. Change them back to the two shown, or click **Ask Support**.
- Moving to a different domain after launch: click **Ask Support**. Support moves it for you, and your old domain keeps sending visitors to the new one.
