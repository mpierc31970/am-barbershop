---
feature: Studio Booking
phase: 15
route: /hub/studio-booking
---

# How to: Studio Booking (barber seats)

These steps are the recording script for the Remotion + Venice AI how-to videos (D110), so write every step precisely enough to record from.

Studio Booking gives every barber a seat: their own public page at `/barbers/<name>` (photo, bio, gallery, services and prices, a **Book** button) and their own sign-in to edit that page. A barber only ever sees their own seat. The shop owner adds and removes barbers and sends their invites.

## Activate

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | Terminal, repo root | Run `npm run am:studio-seed` | It prints `PASS studio-booking active`, one `PASS seat` line per placeholder barber and `PASS Barbers in the site menu`. The hub sidebar shows **Barbers** |

## Use

| # | Screen / route | Action | Expected result |
|---|---|---|---|
| 1 | `/hub/studio-booking` | Under **Add a barber**, type the **Name** and **Email**, pick **Seat** (Chair renter or Employee) and click **Add barber** | The barber's seat screen opens and reads "Barber added. Fill in their page, then send the invite." |
| 2 | `/hub/studio-booking/seats/<id>` | Fill **Headline** and **Bio**, tick **Show this barber on the site** and click **Save** | "Saved." shows and the badge reads **On the site** |
| 3 | Seat screen, **Photos** | Under **Add a portrait** pick a photo and click **Upload** | "Photo added." shows with the portrait. Gallery photos work the same way (up to 8) |
| 4 | Seat screen, **Services and prices** | Fill **New service**, **Minutes** and **Price ($)** (blank shows "Ask"), click **Add service** | "Service saved." shows and the service is listed with its length and price |
| 5 | Seat screen, **Sign-in and removal** | Click **Send invite** | "Invite sent. The link works for 7 days." The barber gets an email; after joining, their badge reads **Signed in** |
| 6 | Barber's own sign-in, `/hub/studio-booking` | The barber signs in on the hub and clicks **Barbers** | Their own seat opens. They can edit their page, photos and menu, nothing else |
| 7 | Seat screen | Click **Remove barber…**, then **Remove <name>** | "Barber removed. Their sign-in to this site is closed." Their page is gone from the site |
| 8 | Your site, `/barbers` | Open the page | Every barber shown on the site, each with **Book** and **About** |

## Decisions

- One add-on, `studio-booking`, private (not in the Get add-ons catalog); `am:studio-seed` writes the shop's entitlement row. Barbers join as `renter` (chair renter) or `staff` (employee) members holding only the `studio-booking` grant; a seat links to the account whose email matches the seat's email on first sign-in.
- Barber photos are plain 2:3 rectangles (no hexagon). The five seeded seats are placeholders with AI-generated photos (`apps/web/public/am-barber/staff/CREDITS.md`), TODO(owner).
- Barber text is not run through the content scanner; the owner controls **Show this barber on the site**.
- Not premium (no D154 monitoring stack) and no fail-safe capture: single shop, free path.
