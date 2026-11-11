---
feature: Console settings
phase: 13
route: /staff/settings
---

# How to: Console settings

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Settings is Super Admin only: a Support agent has no **Settings** in the sidebar, and visiting `/staff/settings` directly shows Not found. Three tabs: **Staff** (who has a console role, and changing it), **Demo tenant** (the permanent demo site, see [Demo tenant](staff-demo-tenant.md)) and **Monitor** (what the separate monitor app reads, STAFF-16, D174). Adding or removing a staff account is not on this screen ("Add or remove staff with the staff CLI.").

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | PB admin UI `/_/`, collection **users** (first time only) | Set **staff_role** to `super_admin` on the first staff person's user record | That person can sign in to the console as a Super Admin |
| 2 | `/staff/sign-in` | Sign in as a Super Admin (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today**; **Settings** is the last item in the sidebar |
| 3 | Sidebar | Click **Settings** | `/staff/settings` opens with tabs **Staff · Demo tenant · Monitor** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/settings` (Staff) | Read "Staff members" | Name · Email (masked, "m•••@gmail.com") · Role (**Super Admin** or **Support agent**) · Last sign-in ("Never" for someone who has not signed in) · Change role. "No staff yet." when the list is empty |
| 2 | Staff row | In **Role for Mara Lopez**, pick the other role | The dialog "Make Mara Lopez a Support agent?" shows Person · Now · Becomes and "Takes effect on their next click." |
| 3 | Same dialog | Click **Change role** (or **Keep role**) | **Confirm it's you** asks for a fresh code if your sign-in is older than 15 minutes. Then "Mara is now Support agent." The change is audited and applies on that person's next click |
| 4 | Your own row | Look at the role control | It is disabled: "You can't change your own role." Taking the last Super Admin away is refused: "The platform must keep one Super Admin. Make someone else a Super Admin first." |
| 5 | `/staff/settings?tab=demo` | Read and use the Demo tenant tab | Covered step by step in [Demo tenant](staff-demo-tenant.md) |
| 6 | `/staff/settings?tab=monitor` | Read the tab | "The monitor app reads GET /api/monitor/status with MONITOR_TOKEN." then Endpoint · Token configured (**Yes** or **No**) · Overall status (**OK**, **Degraded** or **Down**) |
| 7 | Same tab, "Status document sections" | Read the list | One line per section of the status document, each **OK** or **Degraded** (Degraded = that part could not be read just now). If the whole document fails: "The status document couldn't be built just now." |
| 8 | Same tab | Click **Monitor app brief: .planning/design/MONITOR-APP-BRIEF.md** | The brief opens on GitHub: every field the monitor app reads and every threshold. "The monitor app is built later (D174)." |
| 9 | Coolify, app `cds-platform-dev` / `cds-platform-prod`, **Environment Variables** | When **Token configured** reads **No**, set `MONITOR_TOKEN` to a long random value and redeploy (never paste it into chat or a ticket) | **Token configured** reads **Yes**. Without the token the endpoint answers 404 |
