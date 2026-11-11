---
feature: Help and tours
phase: 11
route: /hub/help
---

# How to: Help and tours

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Every screen explains itself: the **?** beside its title opens the how-to for that screen, the **Help** center lists every article you can use, and a short tour runs the first time you open Today, the page builder, **Get add-ons** and **Website › Media**. Help only shows add-ons you have and articles for what your role can do: billing, buying and **Download my data** articles are for the site owner, and **People & roles** and **Connect your Stripe account** for owners and admins.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Any hub screen | Help is on for everyone. Click the **?** right after the screen's title (named "How {screen} works", e.g. "How Social works" on **Marketing › Social**) | A panel slides in from the right with that screen's how-to steps; the screen stays where it was. On a tabbed screen it is the current tab's how-to: on **Marketing › Social** it is **My social accounts and bio links**. In the page builder the **?** sits beside the page title. Ctrl-click (or ⌘-click) opens the article in a new tab instead |
| 2 | Help panel | Click **Open in Help center**, or press **Esc** (or **Close**) | **Open in Help center** opens the full article at `/hub/help/<id>`; **Esc** closes the panel and leaves you on the same screen |
| 3 | Any hub screen | Click **Help** (pinned at the bottom of the sidebar) | `/hub/help` opens with the heading **Help**, a **Search help** field and a line such as "86 articles" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/help` | Type in **Search help**, e.g. `alerts` | The list narrows as you type, articles with the word in their title first, and the line reads "{n} articles". Articles are grouped **Your add-ons** (only add-ons you have), **Your site** and, before launch, **Getting set up**. Each row shows the title and one line about it |
| 2 | `/hub/help` | Type a word nothing matches, e.g. `zebra` | "No help articles match "zebra". Try another word, or ask CDS Support." **ask CDS Support** opens `/hub/support`. The page always ends with "Can't find it? **Ask CDS Support**." |
| 3 | `/hub/help` | Click an article title, e.g. **Today** | `/hub/help/today` opens with **← Help**, the title, **Turn it on** and **Use it** steps (numbered, each with its expected result under it) and **Go to Today**, which opens that screen. The **Go to** button shows only for a screen you can open |
| 4 | `/hub/help/<id>` | Click a linked article name inside a step, e.g. **Your profile and alerts** | That article opens. Names of articles your role can't read stay plain text |
| 5 | `/hub/help/<id>` | Click **← Help** | Back to `/hub/help` |
| 6 | Any hub screen | Press **Ctrl K** (**⌘ K** on a Mac), type `bill` | Under **Help articles**, **Billing and invoices** (owners only); press **Enter** to open it |
| 7 | `/hub/today` (first visit) | Wait for the page to load | A small panel opens beside part of the screen: "Step 1 of 4", a title (first **Where your site stands**) and one or two sentences, with **Skip tour** and **Next**. The part it explains has a ring around it. A part you don't have (for example **Needs you** for a Viewer) is skipped, so the count may read "Step 1 of 3" |
| 8 | Tour panel | Click **Next** (and **Back** from step 2) until the last step, then **Done** | Each step moves the ring and the panel to the next part: **Needs you**, **Your day**, **Customize**. **Done** ends the tour and it does not start again by itself. **Skip tour**, **Esc** or clicking anywhere on the page ends it the same way. The page builder, **Get add-ons** and **Website › Media** have their own short tours the first time you open them |
| 9 | Any screen with a tour | Click the **?** beside the title, then **Show the tour** in the panel footer | The help panel closes and the tour runs again from step 1. On the Help article for Today, **Get add-ons** or **Media**, **Show the tour** next to **Go to** opens that screen and runs its tour |
| 10 | `/hub/profile` › **Tours** | Click **Show the tours again** | A toast reads "Tours will show again the next time you open each screen." The next visit to Today, the page builder, **Get add-ons** or **Website › Media** runs its tour again |
