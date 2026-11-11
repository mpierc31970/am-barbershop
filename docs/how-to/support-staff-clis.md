---
feature: Support staff tools
phase: 12
route: /staff/tickets (terminal: npm run support:list, support:show, support:reply, support:open, support:sla, cds:post, service:window, incident:run, ideas:run, support:run)
---

# How to: Support staff tools

**The same work is on the console: [/staff/tickets](staff-tickets.md).** Inbox, replies and canned replies: [Ticket inbox and canned replies](staff-tickets.md) (`/staff/tickets`). Incidents and planned-work windows: [Incidents and service windows](staff-incidents-and-service-windows.md) (`/staff/tickets?tab=incidents`, `?tab=windows`). Opening a ticket and posting to a site: Site › Actions (`/staff/sites/<org>?tab=actions`). The console calls the same functions as these tools. **Staff only:** this how-to has no training entry, so it never appears in a tenant's Help (T-11-45-01).

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Terminal tools for working support tickets while there is no staff console:

| Tool | What it does | Who may run it |
|---|---|---|
| **`support:list`** | Tickets across every site, most urgent first: number, site, type, status, age, time to the first-reply SLA, assignee and the paid-service category. Filters: `--org`, `--status`, `--type`, `--sla at-risk\|missed` | Super admin or support agent |
| **`support:show`** | One ticket: header (site, type, status, priority, assignee, SLA, target, opened by, the page and browser it was sent from) and the full thread in time order, internal notes marked `[internal]`, attachments with their scan state. `--download <file-id> --out <path>` saves one attachment | Super admin or support agent |
| **`support:reply`** | Reply to the owner, or add an internal note, and change status, assignee or priority, mark a Change request a paid service, attach files. Prints the reply as the owner will see it, then asks `Send? [y/N]` | Super admin or support agent |
| **`support:open`** | Open a ticket on a site's behalf. The owner sees **Opened by CDS**; it counts as already answered for the SLA. Asks `Open? [y/N]` | Super admin or support agent |
| **`support:sla`** | First-reply SLA for one month: Problem and Question tickets created that month, how many were answered within 2 business days and which were late | Super admin or support agent |
| **`cds:post`** | Post to one site: a message in its CDS conversation (or an internal note), a CDS note (pinned to the top with `--pin`) or a shared document. Prints it as the owner will see it, naming the business, then asks `Post? [y/N]` | Super admin or support agent |
| **`service:window`** | Planned-work windows: `create` pauses editing on a page, a site part, a whole site, an add-on or the platform and shows owners a notice; `list`; `clear` ends one early. Asks `Create? [y/N]` | Page, part and site windows: super admin or support agent. Add-on and platform windows: super admin only |
| **`incident:run`** | Known problems: `open` one, `link` tickets from any site to it, `resolve` it (every linked open ticket moves to Resolved and its people are alerted; asks `Resolve? [y/N]`), `list` | Super admin or support agent |
| **`ideas:run`** | The Suggest a feature board: `list` (with the suggesting business, CDS only), `status` (resolves the suggestion tickets; Built alerts every site that voted), `merge` a duplicate, `hide` / `unhide`, `edit`. `status` and `merge` ask y/N | Super admin or support agent |
| **`support:run`** | The hourly support job, by hand: closes tickets Resolved for 7 days with no reply, emails CDS support once per ticket near or past its SLA, alerts sites when a planned-work window starts, clears ended windows, rescans waiting attachments (when a scanner is set), prunes held drafts and abandoned uploads. Production runs it hourly through `POST /api/jobs/support` | Anyone with the `.env.local` superuser (no staff sign-in, like the other jobs) |

Every tool asks for the staff email, password and the emailed sign-in code. Every reply, note, status move, paid mark, opened ticket, post, window, incident step and idea change is written to the audit log with you as actor. `--help` prints the usage without signing in. `support:list`, `support:show` and `support:sla` only read; their `--dry-run` checks the arguments without signing in. `support:reply`, `support:open`, `cds:post`, `service:window create`, `incident:run resolve` and `ideas:run status` / `merge` take `--dry-run` (sign in, print the preview, change nothing) and `--yes` (skip the y/N question). The `list` verbs of `service:window`, `incident:run` and `ideas:run` only read; their `--dry-run` checks the arguments without signing in. A verb the tool does not know prints the usage and stops.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `https://api.cds.needtobeedgy.com/_/`, collection **users** | Make sure the staff member's **staff_role** is `super_admin` or `support_agent`, and fill **name** (the first word is what owners see: "Mara · CDS") | The record shows the staff role and name |
| 2 | Repo root, file `.env.local` | Make sure it has `PB_URL`, `PB_SUPERUSER_EMAIL` and `PB_SUPERUSER_PASSWORD` for the target PocketBase. `CDS_EMAIL_TRANSPORT` unset means owner emails are logged, not sent | The tools can reach the database. A missing value stops with `FAIL PB_URL is not set` (or the name of the missing value) |
| 3 | Terminal at the repo root | Run `npm run support:list -- --help`, then the same `--help` for `support:show`, `support:reply`, `support:open`, `support:sla`, `cds:post`, `service:window`, `incident:run` and `ideas:run` | Each prints its usage and exits. Nothing is signed in or changed |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | `npm run support:list`, then type your staff email, password and the 6-digit emailed code (in dev with `CDS_OTP_STANDIN=1` the code is in the PocketBase log line `OTP_STANDIN users <user-id> <otp-id> <code>`) | `PASS signed in`, then a table `#  Org  Type  Status  Age  SLA  Assignee` with one row per open ticket, most urgent first (for example `1042  Rivera Bakery  Problem  Open  4h  due in 11h  —`; a paid ticket ends with `paid: design changes`), and a last line such as `3 tickets · 1 at risk · 0 missed` |
| 2 | Same terminal | Narrow it: `npm run support:list -- --sla at-risk` (or `--org <org-id>`, `--status waiting`, `--type change`, `--status all` to include closed) | Only the matching tickets. `--status stuck` stops before sign-in with `FAIL --status must be open, in_progress, waiting, resolved or closed` |
| 3 | Same terminal | Read one ticket: `npm run support:show -- --ticket 1042` | The header block (`Ticket #1042 · <subject>`, `Org:`, `Type:`, `Status:`, `Priority:`, `Assignee:`, `Age:`, `SLA:`, `Target:`, `Opened by:`, `Context:`), then `Thread (n)` with each message's time and author, internal notes starting `[internal]`, and `Attachment: shot.png (120 KB, clean) id <file-id>` lines. A file still being checked shows `checking (not scanned yet)` |
| 4 | Same terminal | Save an attachment: `npm run support:show -- --ticket 1042 --download <file-id> --out shot.png` | `Saved shot.png (120 KB) to shot.png.` A file that is still being checked can be saved for triage: open it with care. An existing `--out` file is never overwritten |
| 5 | Any editor | Write the reply in a file, for example `reply.md` | The file holds the reply text (up to 5,000 characters) |
| 6 | Terminal at the repo root | `npm run support:reply -- --ticket 1042 --body-file reply.md --status waiting --dry-run` | `Ticket #1042 · Rivera Bakery · Problem · Open`, `Reply as the owner will see it:`, `Mara · CDS` and the text, `Status:     Open → Waiting on you`, `Recipients: the person who filed it, Owners and Admins (bell and email)`, then `DRY RUN would send this; nothing changed` |
| 7 | Same terminal | Run it again without `--dry-run`, answer `y` at `Send? [y/N]` | `Sent. Rivera Bakery sees it in the hub; 2 alerts raised.` The owner gets a bell row and an email and the ticket shows **Waiting on you** first in their list. Answering anything else prints `Nothing changed.` |
| 8 | Same terminal | Add an internal note: `npm run support:reply -- --ticket 1042 --body "Caching issue; purge after deploy." --internal --yes` | `Saved as an internal note. The owner never sees it.` Nobody is alerted |
| 9 | Same terminal | Triage without a message: `npm run support:reply -- --ticket 1042 --assign me --priority high --yes` (`--assign` also takes a staff email, or `none`) | `Updated. Assignee and priority are CDS-only; nobody was alerted.` |
| 10 | Same terminal | Attach files: add `--file before.png --file after.png` (up to 5, 10 MB each; png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx) | The preview lists each `Attachment:`; the owner can download them at once (CDS files need no scan). A file whose name and content disagree stops before sign-in |
| 11 | Same terminal | Mark a Change request a paid service: `npm run support:reply -- --ticket 1031 --body "This is design work. Choose a quote or your Care hour." --paid design` and answer `y` | The preview shows `Paid:       Design changes (the owner chooses a quote or the Care hour)` and `Status:     Open → Waiting on you`; then `Sent. … alerts raised.` Only a Change request can be paid (`Refused: only a Change request can be a paid service …`); `--paid` with `--status` stops before sign-in. Send the quote with `npm run work:quote -- … --ticket 1031`; log Care time with `npm run care:log -- … --ticket 1031` |
| 12 | Same terminal | Open a ticket for a site: `npm run support:open -- --org <org-id> --type change --subject "Your holiday hours are still up" --body "We noticed the banner still shows December hours." --target page:<page-id>` and answer `y` at `Open? [y/N]` | The preview (`New Change ticket for org <org-id> · Opened by CDS`, the message as the owner sees it, `Recipients: Owners and Admins …`), then `Ticket #1043 opened for Rivera Bakery (Opened by CDS). Already answered for SLA.` `--target` takes `page:<id>`, `addon:<slug>` or `part:header\|footer\|menus` of that site only |
| 13 | Same terminal | Monthly SLA: `npm run support:sla -- --month 2026-10` (no `--month`: this month) | `October 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)` and one line per missed ticket (`#1031  Rivera Bakery  answered late` or `still unanswered`). Lateness counts business time (Mon-Fri, America/Chicago) |
| 14 | PB admin UI `/_/`, collection **audit_log** | Filter `action ~ "support."` | One row per reply (`support.staff_reply`), paid mark (`support.paid_marked`) and opened ticket (`support.ticket_opened_by_cds`), with you as actor. No message text is stored in the log |

## Use: cds:post

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Pinned note: `npm run cds:post -- --org <org-id> --note "Your new menu page goes live Friday." --title "Menu launch" --pin --dry-run`, then sign in | `Pinned note to Rivera Bakery, as the owner will see it:`, the title and text, `Recipients: Owners, Admins and Editors (bell and email)`, then `DRY RUN would post this; nothing changed` |
| 2 | Same terminal | Run it again without `--dry-run` and answer `y` at `Post? [y/N]` | `Posted. Bell and email (logged) for 3 people.` The note is pinned at the top of Support → Messages and leads the From CDS card on Today. Answering anything else prints `Nothing changed.` |
| 3 | Same terminal | Message: `npm run cds:post -- --org <org-id> --message "We moved your site to the new server." --yes` (or `--message-file msg.md`; add `--internal` for a CDS-only note on the conversation) | `Posted. Bell and email (logged) for 3 people.` The message shows in the site's CDS conversation with your first name. With `--internal`: `Saved as an internal note. The owner never sees it.` |
| 4 | Same terminal | Document: `npm run cds:post -- --org <org-id> --document launch-checklist.pdf --title "Launch checklist" --doc-note "Tick these before Friday." --yes` (10 MB; png, jpg, webp, gif, pdf, txt, csv, docx, xlsx, pptx) | `Posted. …` The file is listed in Support → Documents. An unknown org stops with `Org <id> not found, or this account can't post to sites.` |

## Use: service:window

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | Page window: `npm run service:window -- create --scope page --org <org-id> --page <page-id> --until 16:00 --message "Fixing the photo gallery."`, sign in, answer `y` at `Create? [y/N]` | `Window W-12 · Rivera Bakery · page "About us" · now → 4:00 pm America/Chicago · editing paused for the owner.` The owner sees the notice strip and a save on that page is refused until the window ends. HH:MM is America/Chicago today (an `--until` already past means tomorrow); an ISO time also works |
| 2 | Same terminal | Planned site window: `--scope organization --org <org-id> --from 2026-10-16T21:00-05:00 --until 2026-10-16T23:00-05:00 --message "Server move."` (or `--scope component --component footer`; link a known problem with `--incident I-3`) | `Window W-13 · Rivera Bakery · Fri 16 Oct at 9:00 pm → Fri 16 Oct at 11:00 pm America/Chicago · editing pauses then for the owner.` Owners see "Planned work on …" from 24 hours before; when it starts they get a bell row and email |
| 3 | Same terminal | Platform window as a support agent: `--scope platform --until 16:00 --message "Upgrading."` | `Refused: platform and add-on windows need super_admin.` and exit 1. As a super admin it is created, and when it has already started every site's people are alerted (`n alerts raised.`) |
| 4 | Same terminal | `npm run service:window -- list` (`--all` includes ended and cleared ones) | A table `Window  Scope  Target  When  State  Message` and `n windows` |
| 5 | Same terminal | End one early: `npm run service:window -- clear --id W-12` | `Cleared W-12. Editing is back on; the notice is gone.` An ended window prints `W-12 had already ended; nothing changed.` |

## Use: incident:run

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | `npm run incident:run -- open --title "Email delays" --public "Some emails from your site are arriving late. We're on it."`, sign in | `Opened I-3. Link tickets with: npm run incident:run -- link --incident I-3 --ticket <n>` |
| 2 | Same terminal | `npm run incident:run -- link --incident I-3 --ticket 1042` | `Linked #1042 (Rivera Bakery) to I-3. The owner sees "Linked to a known problem" and the public text.` The ticket page shows the Known problem box with the public text only |
| 3 | Same terminal | `npm run incident:run -- resolve --incident I-3 --message "Fixed: emails are on time again."`, answer `y` at `Resolve? [y/N]` | `Resolved I-3. 4 linked tickets moved to Resolved, 4 alerts raised.` Each ticket gets the reply and a Resolved line; running it again picks up any ticket left over |
| 4 | Same terminal | `npm run incident:run -- list` (`--all` includes resolved) | A table `Incident  Status  Linked  Opened  Title` and `n incidents` |

## Use: ideas:run

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | `npm run ideas:run -- list`, sign in | A table `Idea  Votes  Status  State  Suggested by  Ticket  Title`, most votes first, and `n ideas · 2 hidden (1 held for review; add --hidden)`. `--hidden` shows held and hidden ideas, held for review first |
| 2 | Same terminal | A duplicate: `npm run ideas:run -- merge --idea <duplicate-id> --into <idea-id>`, answer `y` | `Merged "Gift card store" into "Gift cards" · votes 7 + 5 → 10 (2 sites voted for both).` The duplicate leaves the board |
| 3 | Same terminal | `npm run ideas:run -- status --idea <idea-id> --to built --yes` (`considering`, `planned`, `suggested` too) | `"Gift cards" is now Built · 3 suggestion tickets resolved · 9 voting sites alerted.` Each voting site gets "An idea you voted for is built" |
| 4 | Same terminal | Remove a business name: `npm run ideas:run -- edit --idea <idea-id> --title "Gift cards"` (or `--description`), or take it off the board: `npm run ideas:run -- hide --idea <idea-id>` (`unhide` puts it back and clears a review hold) | `Saved: title changed.` / `Hidden "Gift cards". It is off the board and keeps its votes.` |
| 5 | PB admin UI `/_/`, collection **audit_log** | Filter by actor = your users id | One row per post (`support.note_posted`, `support.message_posted`, `support.document_shared`), window (`platform.service_window_set` / `_cleared`), incident step (`support.incident_*`) and idea change (`support.idea_*`), with you as actor |

## Use: support:run

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal at the repo root | `npm run support:run -- --dry-run` (no sign-in: it uses the `.env.local` superuser) | One `DRY RUN …` line per step, then `Support (dry run) · 2026-10-13 14:00 UTC · closed after 7 days 1 · SLA warnings sent 0 · windows started 0 (alerts 0) · windows cleared 0 · held drafts pruned 2 · failed 0` and `DRY RUN nothing written`. Nothing changes |
| 2 | Same terminal | `npm run support:run` | `Support · 2026-10-13 14:00 UTC · closed after 7 days 1 · SLA warnings sent 0 · …`. A ticket Resolved 7 days ago with no reply now shows **Closed** with the line "Closed after 7 days with no reply", and its people get a bell row. With `CDS_SUPPORT_EMAIL` unset no SLA warning is sent (logged) |
| 3 | Same terminal, while another run is going | `npm run support:run` | `Another support run is in progress. Nothing done.` |
| 4 | PB admin UI `/_/`, collection **platform_meta** | Find keys `job:support:last_success` and `job:support:last_counts` | The ISO time of the last clean run, and the counts JSON (`closed`, `slaWarned`, `windowsStarted`, `noticeAlerts`, `windowsCleared`, `rescanned`, `heldPruned`, `stagedPruned`, `slaMissedOpen`, `openWindows`, `failedSteps`). A run with a failed step prints `FAIL steps failed: …`, exits 1 and leaves `last_success` unchanged |
| 5 | Coolify, app `cds-platform-prod`, Scheduled Tasks | Add a task, schedule `0 * * * *`, command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/support` | The task log shows the counts JSON each hour. A wrong token or a `GET` answers 404 |
