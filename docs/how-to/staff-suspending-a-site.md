---
feature: Suspending a site
phase: 13
route: /staff/sites/<org>?tab=actions
---

# How to: Suspending a site

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

A site that breaks the hosting rules first gets a **notice to fix**: 3 days, then it goes offline unless CDS marks it fixed (D215). **Suspend now** is only for illegal content or a legal demand and takes the public site offline at once (D218). While suspended, visitors see "This site is temporarily unavailable."; the owner's hub and CDS Support keep working, billing continues per the agreement, and nothing is deleted. Lifting restores the site as it was.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in (see [Staff console sign-in](staff-console-sign-in.md)). A Support agent may send and close notices; **Suspend now** and **Lift suspension** need a Super Admin and a fresh code when the sign-in is older than 15 minutes | The console opens on **Today** |
| 2 | `/staff/sites` | Search for the business and click it, then click the **Actions** tab | `/staff/sites/<org>?tab=actions` opens; **Hosting rules** reads "No notice. The site is online." with **Suspend or warn…** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Site › Actions, **Hosting rules** | Click **Suspend or warn…** | The dialog **Suspend or warn Rivera Bakery** opens with two choices: **Send a notice to fix** and **Suspend now** |
| 2 | Same dialog, **Send a notice to fix** | Choose a **Category**, write **What to fix** (the owner sees it; up to 1,000 characters), optionally a **Staff note** (only CDS sees it); check the "As Rivera Bakery sees it" preview and the "Fix by Thu 16 Oct, 5:00 pm Central" line | The preview shows the owner's email, the CDS note "Hosting rules notice" and the hub strip "CDS found something on your site that breaks the hosting rules. Fix it by … or your site goes offline." |
| 3 | Same dialog | Click **Send notice** (or **Don't send**) | "Notice sent to Rivera Bakery. Fix by Thu 16 Oct." Hosting rules now shows the **Notice** badge and "Under notice · Fix by Thu 16 Oct, 5:00 pm" |
| 4 | Site › Actions, site under notice | Once the owner has fixed it, click **Mark fixed**, then **Mark fixed** in "Mark fixed? The notice ends and the owner is told." (or **Keep the notice**) | "Notice closed for Rivera Bakery. The owner was told." The hub strip disappears. If nobody marks it fixed, the hourly review job suspends the site after the fix-by time |
| 5 | Site › Actions, **Suspend or warn…** (or **Suspend now…** on a site under notice) | Choose **Suspend now** (Super Admin; agents see "Super Admin only"), pick the **Reason** (Illegal content or Legal demand), write the **Staff note** (required, only CDS sees it), edit the **Message to the owner** if needed | The dialog lists what happens: "Public site answers “temporarily unavailable”", "The hub and CDS Support keep working", "Billing continues per the agreement" |
| 6 | Same dialog | Click **Suspend now** (or **Don't suspend**); type a fresh code in **Confirm it's you** if asked | "Rivera Bakery is offline. The owner was told." Hosting rules shows the **Suspended** badge and "Suspended 12 Oct · Illegal content". The public site answers "This site is temporarily unavailable." |
| 7 | Owner's hub (any screen) | Open the owner's hub, or Site › Actions › **Open as admin** ([Staff impersonation](impersonation.md)) | A red strip reads "Your site is offline. CDS suspended it on 12 Oct. Your hub and CDS Support still work." with **Read why**. It cannot be dismissed |
| 8 | Site › Actions, suspended site | Click **Lift suspension** (Super Admin, fresh code if asked), then **Lift suspension** in "Lift the suspension? The site is back online at once." (or **Keep suspended**) | "Rivera Bakery is back online. The owner was told." The site returns exactly as it was |
| 9 | `/staff/review/<case>` (alternative) | From a review case, click **Ask to fix** or **Suspend…** in the outcome bar | The same notice or suspension, linked to the case (see [Review queue, reports and DMCA](staff-review.md)) |
| 10 | `/staff/sites/<org>?tab=audit` | Open the **Audit** tab | The notice, mark fixed, suspension and lift rows are listed with your name |
