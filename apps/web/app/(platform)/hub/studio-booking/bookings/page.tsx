// /hub/studio-booking/bookings: upcoming bookings. The owner sees every barber (filter by
// one with ?seat=); a barber sees only their own (listBookings in @cds/db decides).
import { listBookings, listSeats, type BookingView } from "@cds/db";
import { Badge, Button, EmptyState, InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { Metadata } from "next";
import { bookingStatusAction } from "../../../../actions/studio";
import { requireHubSession } from "../../../../../lib/session";
import {
  duration,
  money,
  readStudioNote,
  STUDIO_BASE,
} from "../../../../../lib/studio";
import { GuardedLink } from "../../GuardedLink";
import { StudioTabs } from "../StudioTabs";

export const metadata: Metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const STATUS_LABEL: Record<BookingView["status"], string> = {
  confirmed: "Booked",
  completed: "Done",
  no_show: "No-show",
  cancelled: "Cancelled",
};

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function time12(t: string): string {
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${t.slice(3, 5)} ${h < 12 ? "am" : "pm"}`;
}

function StatusButton({
  b,
  to,
  label,
}: {
  b: BookingView;
  to: string;
  label: string;
}) {
  return (
    <form action={bookingStatusAction}>
      <input type="hidden" name="bookingId" value={b.id} />
      <input type="hidden" name="status" value={to} />
      <Button
        type="submit"
        size="sm"
        variant={to === "cancelled" ? "ghost" : "secondary"}
      >
        {label}
      </Button>
    </form>
  );
}

export default async function BookingsPage({ searchParams }: Props) {
  const { ctx } = await requireHubSession();
  const manager = ctx.role === "owner" || ctx.role === "admin";
  const sp = searchParams ? await searchParams : {};
  const seatParam =
    typeof sp.seat === "string" && /^[a-z0-9]{15}$/.test(sp.seat)
      ? sp.seat
      : "";
  const [seats, list] = await Promise.all([
    listSeats(ctx),
    listBookings(ctx, seatParam ? { seatId: seatParam } : {}),
  ]);
  const note = await readStudioNote();
  const byDay = new Map<string, BookingView[]>();
  for (const b of list.bookings) {
    byDay.set(b.date, [...(byDay.get(b.date) ?? []), b]);
  }

  return (
    <div className="flex w-full max-w-[880px] flex-col gap-8 font-hub text-hub-ink">
      <ScreenHeader
        title="Bookings"
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      />
      <StudioTabs active="bookings" manager={manager} />
      {note ? (
        <InlineAlert tone={note.tone === "success" ? "success" : "error"}>
          {note.text}
        </InlineAlert>
      ) : null}
      {manager && seats.length > 1 ? (
        <nav aria-label="Barber" className="flex flex-wrap gap-2 text-sm">
          <GuardedLink
            href={`${STUDIO_BASE}/bookings`}
            className={`rounded border px-3 py-1 ${seatParam ? "border-hub-border" : "border-hub-accent font-semibold"}`}
          >
            Everyone
          </GuardedLink>
          {seats.map((s) => (
            <GuardedLink
              key={s.id}
              href={`${STUDIO_BASE}/bookings?seat=${s.id}`}
              className={`rounded border px-3 py-1 ${seatParam === s.id ? "border-hub-accent font-semibold" : "border-hub-border"}`}
            >
              {s.name}
            </GuardedLink>
          ))}
        </nav>
      ) : null}
      {list.bookings.length === 0 ? (
        <EmptyState
          heading="No bookings coming up"
          body="Bookings made on your site show here, by day."
        />
      ) : (
        [...byDay.entries()].map(([date, items]) => (
          <section
            key={date}
            className="flex flex-col gap-2"
            aria-label={dayLabel(date)}
          >
            <h2 className="text-lg font-semibold">{dayLabel(date)}</h2>
            <ul className="divide-y divide-hub-border rounded border border-hub-border bg-hub-surface">
              {items.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold tabular-nums">
                      {time12(b.time)}
                    </span>
                    <span className="font-semibold">{b.clientName}</span>
                    <span className="text-hub-ink-muted">
                      {b.service} · {duration(b.durationMinutes)} ·{" "}
                      {money(b.priceCents)}
                      {manager ? ` · ${b.barber}` : ""}
                    </span>
                    <Badge
                      tone={b.status === "confirmed" ? "published" : "draft"}
                    >
                      {STATUS_LABEL[b.status]}
                    </Badge>
                  </div>
                  <p className="text-sm text-hub-ink-muted">
                    <a className="underline" href={`mailto:${b.clientEmail}`}>
                      {b.clientEmail}
                    </a>
                    {b.clientPhone ? (
                      <>
                        {" · "}
                        <a className="underline" href={`tel:${b.clientPhone}`}>
                          {b.clientPhone}
                        </a>
                      </>
                    ) : null}
                    {" · "}
                    {b.reference}
                  </p>
                  {b.note ? <p className="text-sm">“{b.note}”</p> : null}
                  {b.status === "confirmed" ? (
                    <div className="flex flex-wrap gap-2">
                      <StatusButton b={b} to="completed" label="Done" />
                      <StatusButton b={b} to="no_show" label="No-show" />
                      <StatusButton
                        b={b}
                        to="cancelled"
                        label="Cancel and email client"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
