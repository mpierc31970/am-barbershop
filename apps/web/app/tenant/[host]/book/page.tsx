// /book on tenant hosts: online booking (Studio Booking step 2), ported from palm-science's
// wizard (service -> date/time -> contact -> confirm) as plain server-rendered steps driven
// by the query string, so it works without JavaScript: ?barber -> &service -> &date ->
// &time -> the contact form, which posts to /api/book (303 back here with ?booked= or
// ?error=). Every read goes through @cds/db (published barbers of this site only).
import { listPublicSeats, publicAvailability, type PublicSeat } from "@cds/db";
import {
  HEADING_CLASSES,
  PageTitleHeader,
  siteButtonClasses,
} from "@cds/ui/site";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { siteForRequest } from "../../../../lib/tenant";
import { MUTED, minutes, money, Portrait } from "../barbers/BarberViews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Book a chair",
  description: "Pick your barber, your service and an open time.",
  robots: { index: true, follow: true },
};

type SP = Record<string, string | string[] | undefined>;
type Props = { params: Promise<{ host: string }>; searchParams?: Promise<SP> };

const ERRORS: Record<string, string> = {
  taken: "That time was just taken. Pick another time.",
  input: "Check your name and email, then try again.",
  rate: "Too many bookings from this device. Call the shop to book.",
  failed:
    "Something went wrong and you're not booked yet. Try again or call the shop.",
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** The step link; the anchor keeps the visitor at the step that just opened. */
function href(q: Record<string, string>): string {
  const step = q.time ? 4 : q.service ? 3 : 2;
  return `/book?${new URLSearchParams(q).toString()}#step-${step}`;
}

/** "14:30" -> "2:30 pm". */
function time12(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "am" : "pm"}`;
}

const CHIP =
  "inline-flex min-h-11 items-center justify-center border border-site-border px-4 " +
  "no-underline text-site-text hover:border-site-primary";
const CHIP_ON =
  "border-site-primary bg-site-primary text-site-primary-contrast";
const DAY =
  "flex aspect-square min-h-11 w-full items-center justify-center border no-underline tabular-nums";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 0 = Sunday, from a "YYYY-MM-DD" calendar date. */
function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** "November 2026" or "November – December 2026" for the days shown. */
function monthLabel(days: { date: string }[]): string {
  const f = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      ...o,
    });
  const first = days[0]!.date;
  const last = days[days.length - 1]!.date;
  const year = f(last, { year: "numeric" });
  return first.slice(0, 7) === last.slice(0, 7)
    ? `${f(first, { month: "long" })} ${year}`
    : `${f(first, { month: "long" })} – ${f(last, { month: "long" })} ${year}`;
}

const FIELD =
  "w-full border border-site-border bg-site-surface px-3 py-2 text-site-text";

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`step-${n}`} className="flex flex-col gap-4">
      <h2 id={`step-${n}`} className={HEADING_CLASSES[3]}>
        {n}. {title}
      </h2>
      {children}
    </section>
  );
}

export default async function BookPage({ params, searchParams }: Props) {
  const { host } = await params;
  const site = await siteForRequest(host);
  const sp = searchParams ? await searchParams : {};
  const q = {
    barber: one(sp.barber),
    service: one(sp.service),
    date: one(sp.date),
    time: one(sp.time),
  };
  const booked = one(sp.booked);
  const error = ERRORS[one(sp.error)] ?? "";

  if (booked) {
    return (
      <main id="content" tabIndex={-1} className="outline-none">
        <PageTitleHeader title="You're booked" />
        <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-6 pb-16 md:px-8">
          <p>
            {one(sp.b)} · {one(sp.s)} · {one(sp.w)}
          </p>
          <p className={MUTED}>
            Booking {booked}. We emailed you the details and we&apos;ll remind
            you the day before.
          </p>
          <div>
            <Link href="/" className={siteButtonClasses("secondary")}>
              Back to the home page
            </Link>
          </div>
        </div>
      </main>
    );
  }

  let seats: PublicSeat[] = [];
  try {
    seats = await listPublicSeats(site);
  } catch {
    console.error("[book] barbers read failed");
  }
  const seat = seats.find((s) => s.slug === q.barber) ?? null;
  const service = seat?.services.find((s) => s.id === q.service) ?? null;
  let avail: Awaited<ReturnType<typeof publicAvailability>> | null = null;
  if (seat && service) {
    try {
      avail = await publicAvailability(site, {
        barber: seat.slug,
        service: service.id,
        days: 30,
        ...(q.date ? { date: q.date } : {}),
      });
    } catch {
      console.error("[book] availability read failed");
    }
  }
  const slot = avail?.slots.find((s) => s.time === q.time) ?? null;
  const day = avail?.days.find((d) => d.date === q.date) ?? null;

  return (
    <main id="content" tabIndex={-1} className="outline-none" data-book-page="">
      <PageTitleHeader
        title={seat ? `Book with ${seat.name}` : "Book a chair"}
      />
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-6 pb-16 md:px-8">
        {error ? (
          <p role="alert" className="border border-site-primary px-4 py-3">
            {error}
          </p>
        ) : null}

        <Step n={1} title={seat ? "Your barber" : "Pick your barber"}>
          {seat ? (
            <div className="flex flex-col gap-3">
              <div
                className="w-40 border-2 border-site-primary"
                data-chosen-barber=""
              >
                <Portrait seat={seat} />
                <p className="px-2 py-2 font-semibold">{seat.name}</p>
              </div>
              {seats.length > 1 ? (
                <a href="/book" className="text-site-text underline">
                  Pick a different barber
                </a>
              ) : null}
            </div>
          ) : seats.length === 0 ? (
            <p className={MUTED}>
              Online booking opens soon. Call the shop to book.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {seats.map((s) => (
                <li key={s.id}>
                  <a
                    href={href({ barber: s.slug })}
                    aria-current={s.slug === q.barber ? "true" : undefined}
                    className={`flex flex-col gap-2 border-2 no-underline text-site-text ${s.slug === q.barber ? "border-site-primary" : "border-transparent hover:border-site-border"}`}
                  >
                    <Portrait seat={s} />
                    <span className="px-2 pb-2 font-semibold">{s.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Step>

        {seat ? (
          <Step n={2} title={`Pick a service with ${seat.name}`}>
            {seat.services.length === 0 ? (
              <p className={MUTED}>
                {seat.name} hasn&apos;t listed services yet. Call the shop.
              </p>
            ) : (
              <ul className="flex flex-col divide-y divide-site-border border-y border-site-border">
                {seat.services.map((s) => (
                  <li key={s.id}>
                    <a
                      href={href({ barber: seat.slug, service: s.id })}
                      aria-current={s.id === q.service ? "true" : undefined}
                      className={`flex items-baseline gap-4 px-3 py-3 no-underline text-site-text ${s.id === q.service ? "bg-site-surface-raised" : "hover:bg-site-surface-raised"}`}
                    >
                      <span className="min-w-0 flex-1 font-semibold">
                        {s.id === q.service ? "✓ " : ""}
                        {s.name}
                      </span>
                      <span className={`text-sm ${MUTED}`}>
                        {minutes(s.durationMinutes)}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {money(s.priceCents)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Step>
        ) : null}

        {seat && service ? (
          <Step n={3} title="Pick a day and time">
            {!avail ? (
              <p className={MUTED}>
                Times couldn&apos;t load. Refresh, or call the shop.
              </p>
            ) : avail.days.every((d) => !d.open) ? (
              <p className={MUTED}>
                {seat.name} has no open times in the next month. Pick another
                barber or call the shop.
              </p>
            ) : (
              <div className="grid gap-8 md:grid-cols-2">
                <div data-book-calendar="">
                  <p className="mb-3 font-semibold">{monthLabel(avail.days)}</p>
                  <ol className="grid grid-cols-7 gap-1 text-center">
                    {WEEKDAYS.map((w) => (
                      <li
                        key={w}
                        aria-hidden
                        className={`pb-1 text-sm ${MUTED}`}
                      >
                        {w}
                      </li>
                    ))}
                    {Array.from({ length: weekday(avail.days[0]!.date) }).map(
                      (_, i) => (
                        <li key={`pad-${i}`} aria-hidden />
                      ),
                    )}
                    {avail.days.map((d) => (
                      <li key={d.date}>
                        {d.open ? (
                          <a
                            href={href({
                              barber: seat.slug,
                              service: service.id,
                              date: d.date,
                            })}
                            aria-label={d.label}
                            aria-current={
                              d.date === q.date ? "date" : undefined
                            }
                            className={`${DAY} ${d.date === q.date ? CHIP_ON : "border-site-border text-site-text hover:border-site-primary"}`}
                          >
                            {Number(d.date.slice(8))}
                          </a>
                        ) : (
                          <span
                            aria-label={`${d.label}, closed`}
                            className={`${DAY} border-transparent ${MUTED} line-through opacity-50`}
                          >
                            {Number(d.date.slice(8))}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
                <div data-book-times="">
                  {!day ? (
                    <p className={MUTED}>
                      Pick a day to see {seat.name}&apos;s open times.
                    </p>
                  ) : (
                    <>
                      <p className="mb-3 font-semibold">{day.label}</p>
                      {avail.slots.length === 0 ? (
                        <p className={MUTED}>
                          No open times left that day. Pick another day.
                        </p>
                      ) : (
                        <ul
                          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                          aria-label={`Open times, ${day.label}`}
                        >
                          {avail.slots.map((s) => (
                            <li key={s.time}>
                              <a
                                href={href({
                                  barber: seat.slug,
                                  service: service.id,
                                  date: day.date,
                                  time: s.time,
                                })}
                                aria-current={
                                  s.time === q.time ? "time" : undefined
                                }
                                className={`${CHIP} w-full whitespace-nowrap px-2 ${s.time === q.time ? CHIP_ON : ""}`}
                              >
                                {time12(s.time)}
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </Step>
        ) : null}

        {seat && service && day && slot ? (
          <Step n={4} title="Your details">
            <p>
              <strong>{seat.name}</strong> · {service.name} · {day.label} at{" "}
              {time12(slot.time)}
              {" · "}
              {money(service.priceCents)}
            </p>
            <form
              method="post"
              action="/api/book"
              className="flex max-w-[560px] flex-col gap-4"
            >
              <input type="hidden" name="barber" value={seat.slug} />
              <input type="hidden" name="service" value={service.id} />
              <input type="hidden" name="date" value={day.date} />
              <input type="hidden" name="time" value={slot.time} />
              <div aria-hidden className="hidden">
                <label>
                  Leave this empty
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Your name</span>
                <input
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="name"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Email</span>
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  autoComplete="email"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">Phone (optional)</span>
                <input
                  name="phone"
                  type="tel"
                  maxLength={30}
                  autoComplete="tel"
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-semibold">
                  Anything we should know? (optional)
                </span>
                <textarea
                  name="note"
                  maxLength={500}
                  rows={3}
                  className={FIELD}
                />
              </label>
              <p className={`text-sm ${MUTED}`}>
                Pay in the shop. We&apos;ll email you a confirmation.
              </p>
              <div>
                <button type="submit" className={siteButtonClasses("primary")}>
                  Book it
                </button>
              </div>
            </form>
          </Step>
        ) : null}
      </div>
    </main>
  );
}
