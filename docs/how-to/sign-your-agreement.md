---
feature: Sign your agreement
phase: 09
route: /hub/agreement
---

# How to: Sign your agreement

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Before Support takes any payment, the site owner signs the agreement once, on one screen: five short policies (Service Agreement, Acceptable Use Policy, Terms of Service, Subscription terms, Data Processing Agreement), one box to tick for each, a box agreeing to sign electronically, and the owner's typed full legal name. The time, the IP address and the exact version of every policy are recorded with the signature, and the owner gets a copy to keep.

Only the site owner can sign. An admin sees the same screen read-only, with the note "Only the site owner can sign this agreement. {Owner name} will see it when they next sign in." Staff viewing the hub as the owner see it read-only too, with "You're viewing as support staff, so signing is turned off. Only the owner can sign." Editors and viewers don't see the screen: `/hub/agreement` takes them to the hub.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/setup` | As the owner, click **Send to Support** once the must-haves are in (see the Set up your site how-to) | The setup checklist gains the required item **Review and sign your agreement**, with a **Review and sign** button |
| 2 | `/hub/setup` | Click **Review and sign** | `/hub/agreement` opens with the heading **Review and sign your agreement**, inside the normal hub (sidebar visible) |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/agreement` | Read the top of the page | The intro "Five short policies cover how Support builds and hosts your site…", a yellow **Draft wording** note (while the texts are drafts), and a bar reading "0 of 5 accepted" that stays at the top of the screen as you scroll |
| 2 | `/hub/agreement`, **Service Agreement** card | Read the card | The title, "Version 1 · Effective {date}", three short bullet points, **Read the full text**, and the unticked box "I have read and agree to the Service Agreement." |
| 3 | `/hub/agreement`, **Service Agreement** card | Click **Read the full text** | The full text opens inside the card (no pop-up); the link now reads **Hide the full text**. At the end of the text: **Open in a new tab** and **Hide the full text**. The box is still unticked |
| 4 | `/hub/agreement`, end of the open text | Click **Hide the full text** | The text closes and the focus returns to **Read the full text** |
| 5 | `/hub/agreement`, **Service Agreement** card | Tick "I have read and agree to the Service Agreement." | The bar reads "1 of 5 accepted" and its green fill grows |
| 6 | `/hub/agreement`, the other four cards | Tick "I have read and agree to the …" on **Acceptable Use Policy**, **Terms of Service**, **Subscription terms** and **Data Processing Agreement** | The bar reads "5 of 5 accepted". There is no "tick all" button: each box is ticked on its own |
| 7 | `/hub/agreement`, **Sign your agreement** | Scroll down to the section | The progress bar stops following the page. The card "Electronic signature consent · Version 1" with the box "I agree to sign electronically and to receive these agreements and notices electronically…", the empty field **Your full legal name**, the line "You're signing for {business} on {today}. The time and your IP address are recorded with your signature.", a faded **Sign and accept** button and the line "Tick 1 more box and type your name to sign." |
| 8 | `/hub/agreement`, **Sign and accept** | Click the faded button | Nothing is sent; the focus jumps to the unticked consent box |
| 9 | `/hub/agreement`, consent card | Tick the consent box | The line under the button reads "Type your name to sign." |
| 10 | `/hub/agreement`, **Your full legal name** | Type `Ana Rivera` | The line above reads "Ana Rivera, you're signing for {business} on {today}…" and **Sign and accept** is no longer faded |
| 11 | `/hub/agreement` | Click **Sign and accept** | The button reads **Signing…** with a spinner and every box and the name field lock. A moment later `/hub/agreement/signed/{id}` opens: "Your agreement is signed", with **Download your signed copy** |
| 12 | `/hub/agreement` (later visit) | Open the page again | A green note "Your agreement is up to date." with **See your signed agreement** and **Settings › Legal** |
| 13 | `/hub/agreement` (a policy changed while the page was open) | Click **Sign and accept** | Red note: "One of these policies was updated while you were reading. We've loaded the new version; please review it and tick it again." The changed card shows its new version unticked; the other ticks and your typed name stay. Tick it again and sign |
| 14 | Sidebar, before signing | Look at **Set up your site** | Its number counts the agreement as one item still needed, the same as the **What's still needed** panel |
| 15 | `/hub/setup`, after signing | Look at **What's still needed** | The row reads "Agreement signed on {date}" with a green tick and the link **Settings › Legal**; there is no **Review and sign** button, and the sidebar number drops by one |
| 16 | `/hub/setup`, signed in as an admin before the owner signs | Look at **What's still needed** | The row **Review and sign your agreement** with "Only the site owner can sign the agreement." and no button |
| 17 | `/hub`, signed in as an admin after Support updates a policy | Sign in | The landing screen opens with the blue note "Support updated its terms. Your site owner needs to accept them; nothing changes for you or your site meanwhile." Everything keeps working. Editors and viewers see no note |
