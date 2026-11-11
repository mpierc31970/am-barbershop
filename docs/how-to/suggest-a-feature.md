---
feature: Suggest a feature
phase: 12
route: /hub/support?tab=ideas
---

# How to: Suggest a feature

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Ideas is a shared board of features CDS sites would like CDS to build. Every CDS site can see an idea, never which business suggested it, and each site gets one vote per idea. CDS reviews the ideas and moves them through **Suggested**, **Considering**, **Planned** and **Built**; the most-voted ideas shape what CDS builds next.

## Activate

Nothing to turn on: Ideas is a tab of CDS Support for everyone on your site. Owners, Admins and Editors can suggest and vote; Viewers see the counts.

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support` | Click the **Ideas** tab | "Ideas from CDS sites for things CDS could build. Vote for the ones you'd use. One vote per site." then **Search ideas**, the status filter **Suggested · Considering · Planned · Built** and **Suggest a feature** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/support?tab=ideas` | Read the list | Ideas ranked by votes, each with a vote box (arrow over the count), the title, a status badge, a short description (**Show more** opens the rest) and "Suggested 9 Oct" (plus "You suggested this" on your own) |
| 2 | `/hub/support?tab=ideas` | Click an idea's vote box | The count goes up by one and the box gets a dark border. Click again to take your vote back. If it can't save: "Your vote didn't save. Try again." |
| 3 | `/hub/support?tab=ideas` | Type in **Search ideas** | The list filters as you type. With no match: "No ideas match "…". **Suggest it** as a new idea." |
| 4 | `/hub/support?tab=ideas` | Click **Considering**, **Planned** or **Built** | The ideas at that status show |
| 5 | `/hub/support?tab=ideas` | Click **Suggest a feature** | The Get help form opens with **Suggest a feature** checked and the heading **Suggest a feature** |
| 6 | `/hub/support/tickets/new?type=suggestion` | Type a short name in **Idea** (up to 80 characters), e.g. "Gift cards in the store" | If similar ideas exist, "Already suggested? Vote for one of these instead." lists up to 3 with a vote box; voting there shows the toast "Vote added to {title}." |
| 7 | `/hub/support/tickets/new?type=suggestion` | Fill **Describe it** (what it would help you do, up to 2,000 characters) and read the note | "Every CDS site can see this idea, without your business name." |
| 8 | `/hub/support/tickets/new?type=suggestion` | Click **Post idea** | The Ideas tab opens on **Suggested** with your idea highlighted and a toast "Idea posted. Your site voted for it." If CDS needs to review it first: "Idea sent. CDS will review it before it's listed." Until the full content scan is live, every idea is reviewed first. |
| 9 | `/hub/support?tab=ideas` | Open an old link to an idea CDS merged | "This idea was merged with a similar one. Your vote carried over." above the idea it joined |
| 10 | Any hub screen | When an idea you voted for is built | The bell shows "An idea you voted for is built: {title}" |
