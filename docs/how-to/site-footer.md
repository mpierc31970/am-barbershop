---
feature: Site footer
phase: 07
route: /hub/website?tab=footer
---

# How to: Site footer

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

The band at the bottom of every page of your site: your business details, opening hours and extra links, then a bottom row with the copyright line, **Cookie choices** (on sites with a cookie notice) and a small **Report** link (CONT-13, D249). Changes are live as soon as you save.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/sign-in` | Type your **Email** and **Password**, click **Sign in** | The **Website** screen opens at `/hub/website` on the **Pages** tab |
| 2 | `/hub/website` | Click the **Footer** tab | The address becomes `/hub/website?tab=footer`. The heading reads **Footer** and the **Preview** shows your footer with your business name, address, hours and social links, and **Report** in the bottom row |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/website?tab=footer` | Turn off **Show your address**, **Show opening hours** or **Show social links** | That part leaves the preview at once and the other columns close the gap |
| 2 | **Extra links** | Click **Add link**, keep **A page**, choose **Privacy**, click **Add to footer** | A **Privacy** row appears and the preview gets a **Links** column with **Privacy**. Up to 6 extra links; at 6, **Add link** is greyed out with "Footers hold up to 6 extra links." |
| 3 | **Copyright line** | Type "© {year} Rivera Bakery LLC" | The preview shows "© 2026 Rivera Bakery LLC" (this year). The helper reads "The year updates itself when you use {year}." Leave it empty for "© {year} {your business name}" |
| 4 | `/hub/website?tab=footer` | Read the note with the lock icon | "Every footer has a small Report link that lets visitors tell CDS about a problem. It can't be removed." The Report link is how visitors report abuse or a copyright problem to CDS, which the platform must offer on every site (D249) |
| 5 | `/hub/website?tab=footer` | Click **Save footer** | A toast reads "Footer saved. It's live on your site." |
| 6 | Your site, any page | Scroll to the bottom | The footer shows your columns, then the copyright line, **Cookie choices** (only on sites that show a cookie notice) and **Report**. A screen reader reads the Report link as "Report this site to CDS" |
