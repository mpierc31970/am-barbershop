---
feature: Demo tenant
phase: 13
route: /staff/settings?tab=demo
---

# How to: Demo tenant

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The demo tenant is one permanent site, **Bella's Salon** (slug `demo`, Studio path), used for sales demos and for recording every how-to video (STAFF-18, D293). It is live on its preview host only (`demo.<preview domain>`, with the "in development" strip and `noindex`) and never gets a custom domain. Its demo flag blocks everything that would reach the outside world: email is logged instead of sent (SES and SMS), payments stay in Stripe test mode, no search indexing pings (IndexNow), no content or file scans, and no monitor alerts. Every night at 3 am America/Chicago it is wiped and reseeded, so a demo can be clicked through freely. Nothing outside Bella's Salon is touched.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Coolify, app `cds-platform-dev` (and `cds-platform-prod` at launch), **Scheduled Tasks** | Add a task, frequency `30 * * * *` (hourly at :30), command `wget -q -O- --post-data= --header "Authorization: Bearer $CDS_JOB_TOKEN" http://127.0.0.1:3000/api/jobs/demo` | The task runs every hour and resets the site only in the 3 am hour, once a day. The **demo:reset** row on Health › Jobs shows its last success |
| 2 | `/staff/sign-in` | Sign in as a Super Admin (see [Staff console sign-in](staff-console-sign-in.md)) | The console opens on **Today** |
| 3 | Sidebar | Click **Settings**, then the **Demo tenant** tab | `/staff/settings?tab=demo` opens. Before the first reset it reads "The demo tenant doesn't exist yet. Reset now creates Bella's Salon." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/staff/settings?tab=demo` | Read the panel | Site **Bella's Salon** with a **demo** badge · Host (the preview host, or "No preview host yet") · Last reset ("Oct 16, 2026, 3:30 AM · OK", or "Not reset yet") · Next reset ("Oct 17, 3:30 am (America/Chicago)") · Last nightly counts ("412 rows removed · 412 rows seeded") |
| 2 | Same panel, **What's blocked** | Read the list | Email not sent · Stripe test mode · No indexing pings · No scans · No monitor alerts |
| 3 | Same panel | Click **Reset now** | **Confirm it's you** asks for a fresh code if your sign-in is older than 15 minutes. Then the dialog "Reset Bella's Salon now?" shows Site and Host and "No other site changes." |
| 4 | Same dialog | Click **Reset now** (or **Don't reset**) | "Resetting…", then "Reset Bella's Salon. 412 rows replaced. No other site changed." Last reset updates. If a reset is already running, it says so and nothing changes |
| 5 | The preview host `https://demo.<preview domain>/` | Open it in a private window | Home, About us, Services and Contact (with the "Book a consultation" form) show the salon theme, 3 testimonials and 2 credentials. The page carries the "in development" strip and is `noindex` |
| 6 | Sites › **Bella's Salon** › Actions | Click **Open as admin** (see [Staff impersonation](impersonation.md)) | You work in the demo hub as its owner. Anything you change is gone after the next reset. Use this for recordings and sales demos |
| 7 | Terminal at the repo root | Run `npm run demo:reset -- --dry-run`, then `npm run demo:reset -- --now` | The dry run prints the rows it would remove and seed; `--now` resets whatever the hour (the terminal alternative to **Reset now**) |
| 8 | `/staff/health?tab=jobs` | Find the **demo:reset** row | Last success within the last day. A missed night turns the row Warning and is in the monitor brief (check 36) |
