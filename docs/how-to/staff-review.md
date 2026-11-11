---
feature: Review queue, reports and DMCA
phase: 13
route: /staff/review
---

# How to: Review queue, reports and DMCA

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The review queue is the one place a person looks at content the automatic screening could not decide (D248): **held** pages and files (not published until cleared, promised within 2 business days), **flags** on content already live, and items **queued** while the scanner was down. It also holds the weekly **spot checks** (5 live sites every Monday) and every **report** or **DMCA notice** from `/report` or the abuse@ mailbox (D249, D292). Reports are cases, never support tickets, and the owner is never told who reported them.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**; **Review queue** in the sidebar shows a count when items are waiting |
| 2 | Sidebar | Click **Review queue** | `/staff/review` opens with tabs **Flags & holds · Spot checks · Reports & DMCA**. **Suspend…** and taking down a media file are Super Admin only; a Support agent sees them greyed out with "Super Admin only" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/review` (Flags & holds) | Read the list; switch **Open · Done** | Held items first, oldest on top ("Held 3 days" past the 2-day promise), then flags, then queued. Columns Kind · Site · What ("Page · About us") · Why ("Text: matched "replica"") · Age · Assignee. Fit holds show as one row "1 fit hold · in Pipeline". Empty: "No flags or holds. Scans that need a person land here." |
| 2 | Flags & holds row | Click the row | The case page opens (`/staff/review/<id>`), headed like "Held page · About us" with its kind badge and status |
| 3 | Case page, **What was found** | Read the panel; click **View live page** | The excerpt with the matched words highlighted, the verdict per check and the reasons. The live page opens in a new tab |
| 4 | Case page, right rail | Click **Assign to me** (or **Unassign**) | Assignee shows "You". **Due** reads "2-business-day promise: Thu 2:00 pm" (red once past). **Audit** lists the site's last 5 lines with **Full audit** |
| 5 | Case page, outcome bar | Click **Clear hold**, then **Clear hold** in "Clear this hold? The page publishes now and the owner sees nothing." (or **Keep holding**) | "Cleared. About us is published." The item moves to Done |
| 6 | Case page, outcome bar | Click **Ask to fix**, write **What the owner reads** ("Say what to fix. The owner has 3 days."), then **Send notice** | The site gets a 3-day notice to fix, exactly as in [Suspending a site](staff-suspending-a-site.md): "Notice sent to Rivera Bakery. Fix by Mon 19 Oct." |
| 7 | Case page, outcome bar | Click **Remove content**: for a page, **Unpublish page** in "Unpublish About us?" (or **Keep it published**); for a file, **Take down file** in "Take down hero.jpg?" with its size and the pages using it (Super Admin, fresh code; or **Keep the file**) | The page stops showing to visitors and the owner is told; or the file is deleted and removed from the CDN |
| 8 | Case page, outcome bar | Click **Suspend…** (Super Admin), write the **Staff note**, then **Suspend now** | The site goes offline at once (see [Suspending a site](staff-suspending-a-site.md)) |
| 9 | `/staff/review?tab=spot` | Open a spot check ("Why picked": launched recently, pages changed, random) | The case lists the changed pages, each with **View** and **OK · Issue**. Empty: "No spot checks open. The next five open on Monday." |
| 10 | Spot check case | Mark every page **OK**, or **Issue** with "What's wrong?" and **Save issue**; then click **Close spot check** | "Spot check closed." An issue turns into a flag in Flags & holds |
| 11 | `/staff/review?tab=reports` | Read the list; switch **Open · Closed** | Columns Case ("R-31") · Kind (Report, DMCA) · Site (with a "3 upheld DMCA" badge for repeat sites) · Category · Current step · Due · Received. Empty: "No open reports. Reports from /report and abuse@ land here." |
| 12 | `/staff/review?tab=reports` | Click **Log a report** (for an abuse@ email or a phone call), fill the report fields, **Received by** (abuse@ email, Phone, Other) and **Received at** (Central; empty means now), click **Log report** | "Case R-32 logged. The owner was not contacted." Email is optional for phone calls and required for copyright notices |
| 13 | Report or DMCA case page | Read the case | **What was found** shows the URL, category and description, the reporter's name and email ("Only CDS sees the reporter.") and, for DMCA, the ticked statements and signature |
| 14 | DMCA case, **Case timeline** | Click the step marked **Next** in turn: **Mark content disabled**, **Mark owner notified**, **Record counter-notice**, **Set restore date** (10 to 14 business days after the counter-notice), then **Mark restored** or **Mark upheld**, then **Close case**; each opens a small dialog with an optional **Note** and **Save** | Each step gets a tick, the date and your name. The restore step reads "Restore after Thu 30 Oct (10 business days)". A site with 3 upheld DMCA cases in 12 months shows "Closing the site is a Super Admin decision." |
