---
feature: Add a DNS record
phase: 14
route: /hub/settings?tab=domain&view=records
---

# How to: Add a DNS record

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Once your domain's DNS is with us, you can add or remove the verification records services like Google ask for, yourself. Everything else is kept safe by Support: your email records change only through **Set up email for my domain**, and any other record through Support.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Settings › Domain (`/hub/settings?tab=domain`), signed in as the **Owner**, after you clicked **I've changed them** (see **Connect your domain**) | Click **DNS records** | The **DNS records** view opens with "You can add or remove verification records yourself. Everything else is kept safe by Support. To change one, ask Support." and the toolbar **Add a record** · **Set up email for my domain** |
| 2 | The same view, signed in as an **Admin** | Read the view | The records show without buttons, and the line reads "Only the owner can change the domain." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | DNS records (`/hub/settings?tab=domain&view=records`) | Read the groups | Records are grouped **Your email** · **Verification** · **Your site** · **Sending email from your domain** · **Other**, with **Who manages it** on each row. **Managed by Support** rows have no button |
| 2 | The toolbar | Click **Add a record** | A dialog **Add a record** opens: "Most services, like Google, ask you to add a TXT record to check you own the domain. Paste exactly what they gave you." |
| 3 | The dialog, **Type** | Pick **TXT** (most verification checks) or **CNAME** (if the service asked for one) | The choice is selected |
| 4 | The dialog, **Name** | Type `@` for riverabakery.com itself, or the part before it, like `em123` | The line under the field reads "Full name: em123.riverabakery.com" |
| 5 | The dialog, **Value** | Paste the value the service gave you, exactly (quotes are fine), then click **Add record** | The button shows **Adding…**, the dialog closes and a toast reads "TXT record added. It can take a few minutes to show everywhere." The record shows under **Verification** with **Checking** until it is read back |
| 6 | The service that asked for the record | Click its **Verify** button | The service confirms you own the domain (it can take a few minutes) |
| 7 | DNS records, a row under **Verification** you added | Click **Remove**, then **Remove record** | The dialog "Remove this TXT record?" warns "Services that use it to check you own riverabakery.com may stop working. You can add it again later." A toast reads "TXT record removed." |
| 8 | A row under **Other** | Click **Ask to change** | A Support change ticket opens, prefilled "Change a DNS record" with the record |
| 9 | The **Your email** group header | Click **Change email setup** | The **Set up email for your domain** flow opens (see that how-to) |

## If the record is refused

- "A record with that name already exists. Ask Support to change it."
- "That name is kept safe by Support. Use Set up email for my domain, or ask Support."
- "That's an SPF record, which belongs to your email. Use Set up email for my domain instead."
- "Use letters, numbers, dots, dashes or underscores, or @ for the domain itself."
