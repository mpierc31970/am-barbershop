---
feature: Download my data
phase: 11
route: /hub/settings?tab=business#your-data
---

# How to: Download my data

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The site's **Owner** can download a copy of everything on the site at any time (LIFE-04, D284): one zip with a spreadsheet (CSV) for each kind of record (pages, blocks, contacts, form messages, team, services, invoices, signed agreements and more), a **media** folder with the original photos, videos and audio, and a **README.txt** that says what each file holds. Passwords, card details and security keys are never included. It is part of every site (no add-on to buy) and needs no setup.

Rules: **Owner only** (Admins, Editors and Viewers see "Only the site owner can download the site's data."); **one download every 24 hours**; each link works for **7 days**; CDS staff viewing your site can't download it. Until real email is connected (SES), the "ready" email is logged, not sent (GO-LIVE); the alert in the hub always shows.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Hub sidebar (signed in as the Owner) | Click **Settings**, then the **Business info** tab | `/hub/settings?tab=business` opens on your business details |
| 2 | `/hub/settings?tab=business` | Scroll to the last section, **Your data** (or go straight to `/hub/settings?tab=business#your-data`) | **Your data** shows "Download a copy of everything on your site…", the button **Download my data** and the hint "Takes a few minutes. We'll email you when it's ready." |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | **Your data** | Click **Download my data** | The button reads "Preparing your download…", then the section says "We're putting your download together. Large media libraries can take a while. We'll email you and show it in your alerts when it's ready." You can leave the page; the build carries on |
| 2 | Hub top bar (a few minutes later) | Click the bell | An alert reads **Your data download is ready**; the same news arrives by email. Clicking the alert opens **Settings › Business info › Your data** |
| 3 | **Your data** | Read the section | It reads "Your download is ready. The link works until 19 Oct." with the button **Download your data** and the zip size |
| 4 | **Your data** | Click **Download your data** | The browser saves `<your-site>-data-<date>.zip` |
| 5 | Your computer | Open the zip | Inside: one `.csv` per kind of record (for example `pages.csv`, `contacts.csv`), a `media/` folder with your original files and `README.txt` listing what each file holds. CSVs open in Excel, Numbers or Google Sheets |
| 6 | **Your data** (same day) | Click **Ask for a new download** | Nothing starts; the line under it reads "You can ask for a new download after {date and time}." (24 hours after your last request; a failed build doesn't count) |
| 7 | The email link, after 7 days | Click it | The page **This download link has expired** says "Ask for a new one from Settings › Business info." with **Go to your hub** |
| 8 | **Your data** (a build that failed) | Read the section | "We couldn't build your download, and nothing was lost. Try again, or contact CDS Support if it keeps happening." with **Try again**, which starts a new build straight away |

## Good to know

- **Who sees what:** Admins, Editors and Viewers see the **Your data** section with "Only the site owner can download the site's data." and no button.
- **Very large media libraries:** a zip is capped just under 4 GB. If a site goes over, the build fails with the message in step 8; contact CDS Support for a copy.
- **The link only works for you:** it opens only when you are signed in as the Owner of that site. If you run more than one site, switch to this site first (top bar), then open the link.
- **Logins aren't in the download:** the people on your team keep their own sign-ins; see [People & roles](people-and-roles.md).
