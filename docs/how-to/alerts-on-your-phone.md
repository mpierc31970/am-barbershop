---
feature: Alerts on your phone
phase: 11
route: /hub/today
---

# How to: Alerts on your phone

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Phone alerts tell you about new messages and urgent problems straight away, even when the hub is closed. Each person turns them on for their own phone. On iPhone the hub has to be added to the home screen first; on Android it works in Chrome straight away. Which alerts reach your phone, and quiet hours, are set in [Your profile and alerts](profile-and-alerts.md).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/today` › side rail (below **This week**) | Find the card | **Get alerts on your phone** with "Hear about new messages and urgent problems straight away, even when the hub is closed. You choose which alerts reach your phone." and an **iPhone · Android** switch (already set to your phone's kind) |
| 2 | **Get alerts on your phone** | Click **iPhone** or **Android** | The three steps for that phone show as a numbered list |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | iPhone: Safari, `/hub/today` | Open the hub in Safari on your iPhone | Step 1, "Open this page in Safari on your iPhone.", is done. The card reads "This browser can't show phone alerts. On iPhone, add the hub to your home screen first." and has no **Turn on alerts** button yet |
| 2 | iPhone: Safari | Tap **Share**, then **Add to Home Screen**, then **Add** | The hub icon is on your home screen |
| 3 | iPhone: home screen | Open the hub from its home-screen icon, go to Today and tap **Turn on alerts** | The iPhone asks to allow notifications. Tap **Allow**: a toast reads "Alerts are on for this device." and the card leaves Today |
| 4 | Android: Chrome, `/hub/today` | Open the hub in Chrome on your phone and tap **Turn on alerts** | Chrome asks to allow notifications. Tap **Allow**: a toast reads "Alerts are on for this device." and the card leaves Today. Optional: tap the menu, then **Add to Home screen** |
| 5 | **Get alerts on your phone** | Tap **Turn on alerts**, then **Block** in the prompt | The card reads "Alerts are blocked for this site in your browser settings. Allow notifications there, then tap Turn on alerts again." |
| 6 | **Get alerts on your phone** | Tap **Not now** | The card leaves Today for you only. You can still turn alerts on from `/hub/profile` › **Phones and computers** › **Turn on alerts on this device** |
| 7 | `/hub/profile` › **Phones and computers** | Read the list | Your phone shows as "iPhone · turned on 9 Oct" (or "Android phone"), marked **This device** on that phone |
| 8 | `/hub/profile` › **Phones and computers** | Click **Turn off** next to a phone | The phone leaves the list and a toast reads "Alerts turned off for that device." It gets no more phone alerts |
| 9 | Any hub screen on a shared computer or tablet | Click your initials, then **Sign out** | You are signed out, and this browser stops getting your alerts: it leaves your **Phones and computers** list for every site you belong to. The next person who signs in and taps **Turn on alerts** gets only their own alerts here |
| 10 | Any phone where alerts stopped after Support changed its alert keys | Tap **Turn on alerts** again (Today or `/hub/profile`) | A toast reads "Alerts are on for this device." The phone is subscribed again with the new keys and alerts arrive again |
