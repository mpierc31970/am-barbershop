---
feature: Your profile and alerts
phase: 11
route: /hub/profile
---

# How to: Your profile and alerts

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Each person on a site chooses how their own alerts reach them. Nobody else, CDS staff included, can change them. The list only shows alerts your role covers: billing alerts are the owner's, and viewers get the monthly summary only. The sensitive-practice switch is in Settings (owner or admin).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any hub screen | Click your initials in the top bar (the **Your profile and sign out** button), then **Your profile and alerts** | `/hub/profile` opens with the heading **Your profile and alerts** and the sections **You**, **Alerts**, **Quiet hours**, **Phones and computers** and **Tours** |
| 2 | Any hub screen | Click the bell, then **Alert settings** at the bottom of the panel | The same page opens, scrolled to **Alerts** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/profile` › **You** | Read the section | Your sign-in email, "Your role at {business} · {role}", and "To change your sign-in email, ask CDS Support." |
| 2 | `/hub/profile` › **Alerts** | Find **New form message** in the **Normal** group and switch **Email** off | "Saving…" then **Saved** shows next to the **Alerts** heading; new form messages still appear in the bell but no longer email you |
| 3 | `/hub/profile` › **Alerts** | Look at the **Bell** column | Every Bell switch is on and greyed out: the bell always shows everything |
| 4 | `/hub/profile` › **Alerts** | Look at a **Summary** row such as **New contacts and subscribers** | Its **Phone** cell shows "—": summaries arrive as one email at 7am, never as a phone alert |
| 5 | `/hub/profile` › **Alerts** | Click **Reset to defaults** | Every switch goes back to its default and a toast reads "Alerts reset to the defaults." with **Undo**; clicking **Undo** within 8 seconds puts your choices back |
| 6 | `/hub/profile` › **Quiet hours** | Change **From** to **10:00 pm** | **Saved** shows next to **Quiet hours**; phone alerts that arrive between 10:00 pm and the **Until** time wait until morning and come as one summary. The note under the selects names your business's time zone |
| 7 | `/hub/profile` › **Quiet hours** | Switch **Hold phone alerts at night** off | The **From** and **Until** selects grey out; phone alerts now arrive at any hour |
| 8 | `/hub/profile` › **Phones and computers** (on a phone or computer that can show alerts) | Click **Turn on alerts on this device**, then allow notifications in the browser prompt | A toast reads "Alerts are on for this device." and the device is listed first, marked **This device** (on iPhone, add the hub to your home screen and open it from there first) |
| 9 | `/hub/profile` › **Phones and computers** | Click **Turn off** next to a device, for example "iPhone · turned on 9 Oct" | The device leaves the list and a toast reads "Alerts turned off for that device." |
| 10 | `/hub/profile` › **Tours** | Click **Show the tours again** | A toast reads "Tours will show again the next time you open each screen." |
| 11 | `/hub/settings?tab=business` (owner or admin) | Under **Your business**, switch **Keep client names out of phone and email alerts** on or off | **Saved** shows under the Settings heading. When it is on, phone and email alerts never show a client's name or service (the hub still does), and `/hub/profile` shows "Sensitive-practice mode is on for {business}…". It starts on for therapy, counseling and health businesses |
