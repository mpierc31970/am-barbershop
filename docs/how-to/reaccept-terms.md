---
feature: Re-accept updated terms
phase: 09
route: /hub/agreement?mode=reaccept
---

# How to: Re-accept updated terms

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

When CDS publishes a new version of a policy the owner has already signed, the owner is asked to accept it the next time they open the hub. Only the changed policies are shown, each with a one-line "What changed". The site stays live the whole time, and sign-out always works.

Only the owner is asked. Admins, editors and viewers keep working; an admin sees the note "CDS updated its terms. Your site owner needs to accept them; nothing changes for you or your site meanwhile." at the top of the hub. Staff viewing the hub as the owner are never redirected and can't sign.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | CDS repo (staff) | Publish a new version of a policy (for example Terms of Service v2, with a `changes` line) and deploy | Every org that signed version 1 now has an outdated agreement. Orgs that never signed are not affected |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Sign in as the owner of a site that signed version 1 | Instead of the hub, `/hub/agreement?mode=reaccept&next=/hub/...` opens in a focused frame: only the business name and **Sign out** at the top, no sidebar, no menu |
| 2 | `/hub/agreement?mode=reaccept` | Read the top of the page | The heading **We've updated our terms**, the intro "We changed 1 of the policies you signed. Here's what changed. Sign again to keep using your hub. Your site stays live the whole time." and a bar reading "0 of 1 accepted" |
| 3 | `/hub/agreement?mode=reaccept`, **Terms of Service** card | Read the card | "Version 2 · Effective {date} · You signed version 1 on {date}", then "**What changed:** {the change line}", three bullet points and **Read the full text** |
| 4 | `/hub/agreement?mode=reaccept` | Read the grey box under the card | "Still current, no need to sign again: Service Agreement v1 · Acceptable Use Policy v1 · Subscription terms v1 · Data Processing Agreement v1." |
| 5 | `/hub/agreement?mode=reaccept`, **Terms of Service** card | Tick "I have read and agree to the Terms of Service." | The bar reads "1 of 1 accepted" |
| 6 | `/hub/agreement?mode=reaccept`, **Sign your agreement** | Tick the electronic signature consent box (it is asked again every time) and type your full legal name | **Sign and accept** is no longer faded; the line reads "{Name}, you're signing for {business} on {today}…" |
| 7 | `/hub/agreement?mode=reaccept` | Click **Sign and accept** | **Signing…**, then `/hub/agreement/signed/{id}` opens: "Your agreement is signed" with **Download your signed copy** and **Continue to your hub** |
| 8 | `/hub/agreement/signed/{id}` | Click **Continue to your hub** | The page you were going to before the update opens, with the normal sidebar |
| 9 | `/hub` (as an admin, before the owner signs) | Sign in as an admin | The hub opens as usual with the note "CDS updated its terms. Your site owner needs to accept them…". Opening `/hub/agreement` shows the cards read-only with "Only the site owner can sign this agreement." and no **Sign and accept** button |
