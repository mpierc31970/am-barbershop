---
feature: Download your signed agreement
phase: 09
route: /hub/settings?tab=legal
---

# How to: Download your signed agreement

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every time the owner signs the agreement, the platform stores an exact copy: each policy's wording and version, the signer, the time and a proof code. The owner and admins can download that copy straight after signing and any time later from Settings › Legal. The file is a web page (`.html`) that opens in any browser and prints to PDF. Editors and viewers can't download it: the links take them to the hub.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/agreement` | As the owner, sign the agreement (see the Sign your agreement how-to): tick every policy and the consent box, type your full legal name, click **Sign and accept** | `/hub/agreement/signed/{id}` opens with a green shield and the heading **Your agreement is signed** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/agreement/signed/{id}` | Read the page | "Signed by {name} for {business} on {date} at {time} ({time zone}). Your copy records each policy's exact wording and version.", then one row per signed policy reading "Version 1", the button **Download your signed copy** and, beside it, **Back to setting up your site** |
| 2 | `/hub/agreement/signed/{id}` | Click **Download your signed copy** | The browser downloads `Support-agreement-{business}-{yyyy-mm-dd}.html`; the page stays where it is |
| 3 | Your downloads folder | Open the downloaded file | It opens in the browser: the full text of every policy you signed, with your name, the date and time, and the proof code |
| 4 | The opened file | Press **Ctrl+P** (**Cmd+P** on a Mac), choose **Save as PDF**, click **Save** | A PDF copy of the agreement is saved |
| 5 | `/hub/agreement/signed/{id}` | Read the line under the buttons | "We've emailed a link to {your email}. You can download your copy any time from Settings › Legal." |
| 6 | `/hub/agreement/signed/{id}` | Click **Proof code** | It opens: "If you ever need to show this agreement wasn't changed, Support can check it against this code." and a long code of letters and numbers |
| 7 | `/hub/agreement/signed/{id}`, **Proof code** | Click **Copy** | A toast reads **Copied**; the code is on your clipboard |
| 8 | `/hub/agreement/signed/{id}` | Click **Back to setting up your site** | `/hub/setup` opens. (Coming from checkout the button reads **Continue to checkout**; after re-accepting updated terms it reads **Continue to your hub**) |
| 9 | `/hub/settings?tab=legal` | Later, open **Settings**, then the **Legal** tab | Every signed agreement is listed, newest first, each with a **Download** button |
| 10 | `/hub/settings?tab=legal` | Click **Download** on any row | The same `Support-agreement-….html` file for that signing downloads |
| 11 | Link in the "agreement signed" email | Click the link while signed in to the hub | The same copy downloads. Signed out, the sign-in page opens first; the link never expires |
