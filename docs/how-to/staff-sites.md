---
feature: Sites and site detail
phase: 13
route: /staff/sites
---

# How to: Sites and site detail

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

**Sites** lists every site on the platform, most urgent status first, and opens one site's whole picture: **Overview**, **Add-ons**, **Support**, **Media**, **Indexing**, **Domain**, **Offboarding**, **Audit** and **Actions**. Everything CDS does to one site starts here. Installing or removing an add-on, opening a site as owner and suspending are Super Admin only; a Support agent sees those greyed out with "Super Admin only". The deep procedures have their own articles: [Staff impersonation](impersonation.md), [Suspending a site](staff-suspending-a-site.md), [Search indexing](staff-indexing.md), [Media staff tools](media-staff-tools.md), [Domain moves and the zone gate](staff-domain-moves.md) and [Offboarding a site](staff-offboarding.md).

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sign-in` | Sign in as a Super Admin or Support agent (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |
| 2 | Sidebar | Click **Sites** (or press `g s`) | `/staff/sites` opens: "Sites, most urgent status first" |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/sites` | Read the table | Business · Status (Suspended, Notice, Held, Building, Ready for review, Live, Intake, Fit review, Ready for build, Lapsed, Closed) · Path · Plan (with Care Plan) · Add-ons · Host (a preview host is marked "preview") · Created · Last owner activity · Open tickets ("2 open tickets"). Badges: **Demo**, "Leaving · 23d" for a site under a Leaving CDS notice (days left), and "3 upheld DMCA" for a repeat infringer. Order: suspended, notice, held, building, review, live, then the rest |
| 2 | Same screen | Type in **Search** (business, host or org id) and pick **Status** (including **Demo** and **Leaving**, `/staff/sites?status=leaving`), **Path**, **Add-on** or **Open tickets** › **Has open tickets** | The list filters and the address keeps the filters, so the view can be shared. "12 sites"; none: "No sites match." 50 per page with Previous / Next |
| 3 | A row | Click the business name | `/staff/sites/<org>` opens on **Overview** |
| 4 | **Overview** | Read the **Site** panel | Status · Path · Plan · Care Plan · Billing ("Paid · next invoice 1 Nov", "Unpaid", "No billing yet") · Domains (Live and Preview, or "No domain yet") · Demo site · Suspension ("None", "Notice sent · fix by Thu 16 Oct", "Suspended on 16 Oct") · Created · Org id with **Copy org id** ("Copied") |
| 5 | Same tab | Read **Members** and **Recent activity** | Names with role badges (never emails), and the last 10 audit rows. **See the full audit log** opens the Audit tab |
| 6 | `?tab=addons` | Read "Add-ons on this site" | Every add-on for the site's path, private ones included: Add-on · State (**On site**, **Removed**, **Not on site**) · Since · Price ("Price coming soon" when unpriced) |
| 7 | Add-on row (Super Admin) | Click **Install add-on**, type a **Reason**, click **Install** in "Install Testimonials on Rivera Bakery?" ("It is a sale: $19.00/mo is added from the next invoice.") or **Keep as is** | **Confirm it's you** first if your sign-in is older than 15 minutes. "Testimonials installed." The owner sees it in the hub at once |
| 8 | Add-on row (Super Admin) | Click **Uninstall add-on**, type a **Reason**, click **Uninstall** in "Uninstall Testimonials?" ("Its content is kept and comes back if reinstalled.") | "Testimonials uninstalled. Its content is kept." |
| 9 | `?tab=support` | Read "This site's tickets, most urgent first" | # · Subject · Type · Status · Priority · SLA · Assignee; a row opens `/staff/tickets/<n>`. **Open ticket for this site** goes to the Actions tab |
| 10 | `?tab=media` | Read the site's media storage | Images · Video · Audio · Total vs allowance, and the line naming `npm run media:takedown` for taking one file down. None: "This site stores no media yet." |
| 11 | `?tab=indexing` | Read the site's indexing row | Last ping · Sitemap · Pages indexed, with **Resubmit now** ([Search indexing](staff-indexing.md)) |
| 12 | `?tab=domain` | Read the domain move and gate report | The move timeline (ten steps), **Gate report** and **Domain details** with the site's hosts; "Domain · 1" on the tab when a step failed or a gate waits for an override. Retry step, Re-take snapshot, Add zone file, Override, Cancel move and Move domain are in [Domain moves and the zone gate](staff-domain-moves.md) |
| 13 | `?tab=offboarding` | Read the Leaving CDS case | "Rivera Bakery isn't leaving." with **Start offboarding** (Super Admin), or the running notice: the owner's checklist, the system steps and the **Handback check**. The procedures are in [Offboarding a site](staff-offboarding.md) |
| 14 | `?tab=audit` | Pick **Show** All, CDS actions or Impersonation | "This site's audit log, newest first": Time · Actor ("CDS · Lee" for staff, "CDS (system)" for jobs) · Action · Target, 50 per page with Newer / Older. The owner sees the same CDS rows in their own audit log |
| 15 | `?tab=actions`, **View as CDS** | Click **Open as admin** ("Ends after 60 minutes.") or, as a Super Admin, **Open as owner** | The "View Rivera Bakery as CDS staff" dialog asks for a **Reason**; **Start viewing** opens the hub with the staff banner. See [Staff impersonation](impersonation.md) |
| 16 | Actions, **Talk to the site** | Click **Open ticket** or **Post to site** | **Open ticket** opens "Open a ticket for Rivera Bakery" (shows as "Opened by CDS", counts as answered for SLA). **Post to site** posts a Message, Internal message, Note (optionally **Pin to the top**) or Document (up to 10 MB) with an "As Rivera Bakery sees it" preview; the team gets a bell and an email |
| 17 | Actions, **Stage** (Super Admin) | Pick **Move to**, click **Move stage** | The stage moves forward only, to a build stage ("Stages only move forward. Launch with Approve launch in the pipeline."). Live is never offered here: launch is **Approve launch** in the pipeline. A live site reads "This site is live. Live is final." |
| 18 | Actions, **Hosting rules** | Read the state ("No notice. The site is online.", "Under notice · Fix by Thu 16 Oct", "Suspended 16 Oct · …"); click **Suspend or warn…**, **Mark fixed** or **Lift suspension** | The steps are in [Suspending a site](staff-suspending-a-site.md) |
| 19 | Actions, **Add-ons** | Click **Go to Add-ons** | The Add-ons tab opens (step 7) |
| 20 | Actions, **Leaving CDS** (Super Admin) | Read the line; click **Start offboarding** | "Starts the 30-day notice and emails the owner the checklist." opens the same dialog as the Offboarding tab. Under a notice: "A notice is running. See the Offboarding tab." with **Open Offboarding** |
| 21 | Actions, **Demo** | Read the line | "This is the demo site. It resets every night at 3 am Central (Settings › Demo)." or "Not a demo site." |
