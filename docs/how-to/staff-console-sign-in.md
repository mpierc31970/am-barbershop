---
feature: Staff console sign-in
phase: 13
route: /staff/sign-in
---

# How to: Staff console sign-in

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The staff console lives at `/staff` on the platform domain. Staff accounts are separate from site owners' accounts (Invariant 10): a member account that is not staff can never sign in here. Every sign-in needs the password **and** a 6-digit code emailed to the staff address. Dangerous actions ask for a fresh code if the sign-in is older than 15 minutes (step-up).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/settings?tab=staff` (Settings › Staff, Super Admin) | Find the person in the staff list, choose **Super Admin** or **Support agent** in the role control, then click **Change role** in the "Make Mara a Support agent?" dialog. For the very first Super Admin, set **staff_role** to `super_admin` on the user record in the PocketBase admin UI (`/_/`, collection **users**) instead | The list shows the new role. It takes effect on the person's next click |
| 2 | Staff member's email inbox | Make sure the account's email address receives mail (in dev, codes are logged: with `CDS_OTP_STANDIN=1` the code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>`) | Codes can reach the staff member |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Open the page | A centred card with the CDS mark, the heading **Staff sign-in** and the line "For CDS staff. Site owners sign in at /sign-in." The page is `noindex` |
| 2 | `/staff/sign-in`, step 1 | Type **Email** and **Password** (click **Show** to check the password), then click **Sign in** | The button reads "Checking…", then the code step opens: "We emailed a code to m•••@connectionsdesignstudios.com" with six digit boxes |
| 3 | `/staff/sign-in`, step 1 (wrong details) | Sign in with a wrong password, or with a site owner's account | An error above the fields reads "That email and password don't match a staff account." It never says which part was wrong. After too many tries: "Too many tries. Wait 15 minutes, then try again." |
| 4 | `/staff/sign-in`, step 2 | Type the 6-digit code from the email, then click **Confirm code** | The button reads "Confirming…", then the console opens on **Today** (`/staff`), or on the `/staff/...` page you were sent from (`?next=`) |
| 5 | `/staff/sign-in`, step 2 (code problems) | Type a wrong code, or wait until it expires; then click **Send a new code** | "That code isn't right. Check the latest email." or "That code has expired. Send a new one." **Send a new code** emails a fresh code and then waits 30 seconds ("You can ask again in 24s"). **Use a different account** goes back to step 1 |
| 6 | Any `/staff` page, Super Admin action (for example **Approve launch**) more than 15 minutes after sign-in | Click the action | The **Confirm it's you** dialog opens: "This action needs a fresh code. We emailed one to m•••@…" and a line naming the pending action ("Then: Approve launch for Rivera Bakery") |
| 7 | **Confirm it's you** dialog | Type the new code, click **Confirm and continue** (or **Stop this action** to cancel) | The dialog closes and the original action's dialog opens with your inputs still filled in. The 15-minute window starts again |
| 8 | Any `/staff` page after 2 hours idle or 12 hours since sign-in | Click anything | You land on `/staff/sign-in` with "Your staff session ended. Sign in again to continue." The page you were on is kept as `?next=`, so you return to it after signing in |
| 9 | Any `/staff` page, a control marked **Super Admin only** | Sign in as a Support agent and look at a Super Admin control (Approve launch, Suspend now, platform windows) | The control is greyed out with "Super Admin only" next to it. If your role changes mid-session, the action answers "Your role can't do this. Ask a Super Admin." |
| 10 | Console sidebar, bottom (your name and role badge) | Click **Sign out** | The staff session ends and `/staff/sign-in` opens |
