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
| 2 | `/hub/studio-booking/seats/<id>` | Fill **Headline** and **Bio** (optional: **Shop or chair name**, **Texas barber license number** and **Social links**, a link or an @handle each), tick **Show this barber on the site** and click **Save** | "Saved." shows and the badge reads **On the site** |
| 3 | Seat screen, **Photos** | Under **Add a portrait** pick a photo and click **Upload** | "Photo added." shows with the portrait. A **Logo** (the barber's own brand) and gallery photos (up to 8) work the same way. Shop name, logo, socials and license show on that barber's page only |
| 4 | Seat screen, **Services and prices** | Fill **New service**, **Minutes** and **Price ($)** (blank shows "Ask"), click **Add service** | "Service saved." shows and the service is listed with its length and price |
| 5 | Seat screen, **Sign-in and removal** | Click **Send invite** | "Invite sent. The link works for 7 days." The barber gets an email; after joining, their badge reads **Signed in** |
| 6 | Barber's own sign-in, `/hub/studio-booking` | The barber signs in on the hub and clicks **Barbers** | Their own seat opens. They can edit their page, photos and menu, nothing else |
| 7 | Seat screen | Click **Remove barber…**, then **Remove <name>** | "Barber removed. Their sign-in to this site is closed." Their page is gone from the site |
| 8 | Your site, `/barbers` | Open the page | Every barber shown on the site, each with **Book** and **About** |
| 9 | Seat screen, **Hours and time off** | Tick **Working** for each day, set **From** and **To** (15-minute steps), pick **Booking interval** (default 1 hour) and click **Save hours** | "Hours saved." Clients can now book this barber inside those hours, one start time per interval |
| 10 | Seat screen, **Blocked time** | Pick **First day** (and **Last day** for more than one day). To block part of the day fill **From** and **To**; leave them blank for the whole day. Click **Block time** | "Time blocked." Those times (or days) show no open times on the site |
| 11 | Your site, `/book` | Pick a barber, a service, a day and a time, fill **Your name** and **Email**, click **Book it** | "You're booked" with the booking number. The client gets a confirmation email; the barber and the owner get a hub alert (bell and email) |
| 12 | `/hub/studio-booking/bookings` | Open **Bookings** (a barber sees **My bookings**) | Upcoming bookings by day. The owner can filter by barber |
| 13 | Bookings, one booking | Click **Done**, **No-show** or **Cancel and email client** | The badge changes. Cancel emails the client that the shop cancelled |
| 14 | (automatic) | Every 15 minutes the shop's job runs | Each client gets one reminder email about a day before their booking |
| 15 | `/hub/studio-booking/rent` | Under a chair renter, open **Set rent**, fill **Rent ($)**, pick **How often** and **Next due**, click **Save rent** | "Rent saved." The barber shows **Up to date** with the amount and next due date |
| 16 | Rent, one barber | When they pay, check **Amount ($)** and **Paid on**, click **Mark <date> paid** | "Payment logged." The payment is listed and **Next due** moves on one period |
| 17 | Rent, the latest payment | Click **Undo** | "Payment removed." **Next due** goes back to that date |
| 18 | (automatic) | A due date passes without a payment | The barber shows **N days late**, a warning lists who is late, and the owner gets one hub alert (bell and email) per missed date |
| 19 | Barber's own sign-in, **My Rent** | Open the tab | Their rent, next due date and payments, read-only |

## Decisions

- One add-on, `studio-booking`, private (not in the Get add-ons catalog); `am:studio-seed` writes the shop's entitlement row. Barbers join as `renter` (chair renter) or `staff` (employee) members holding only the `studio-booking` grant; a seat links to the account whose email matches the seat's email on first sign-in.
- Barber photos are plain 2:3 rectangles (no hexagon). The five seeded seats are placeholders with AI-generated photos (`apps/web/public/am-barber/staff/CREDITS.md`), TODO(owner).
- Barber text is not run through the content scanner; the owner controls **Show this barber on the site**.
- Not premium (no D154 monitoring stack) and no fail-safe capture: single shop, free path.
- Booking times: one working range per day per barber; start times every booking interval (the barber picks 15 min to 2 hours, default 1 hour); no booking within 1 hour of now, up to 30 days ahead (the page shows 14). Two clients can't take the same time: the slot is re-checked under a lock.
- Clients pay in the shop (no payment processor). No client self-cancel link: the confirmation says to call the shop.
- Reminders and new-booking alerts use the existing email transport (SMTP in production, the logged stand-in elsewhere). Job: `POST /api/jobs/studio` with the `CDS_JOB_TOKEN` bearer, a Coolify scheduled task every 15 minutes.
- Blocked time: whole days, or a From/To window on each day of the range (lunch, appointments).
- Removing a barber removes their bookings, time off, lease and payment log too.
- Chair rent is a fixed amount per chair (D162's "fixed rent" fee only): weekly, every two weeks or monthly; payments are logged by hand ("Mark paid"), no payment processor. Only chair renter seats have rent; employees don't.
