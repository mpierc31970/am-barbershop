// A&M fork: Today for a barber seat (renter, staff). Their own upcoming appointments as
// reminders (next 8 confirmed, today first), a link to all their bookings and their profile.
// No stage block, Needs-you, cards or CDS panels: a barber manages only their own seat.
import { listBookings, type BookingView } from "@cds/db";
import { EmptyState, InlineAlert } from "@cds/ui/hub";
import { ScreenHeader } from "@cds/ui/hub/shell";
import type { OrgContext } from "@cds/db";
import {
  dayLabel,
  duration,
  STUDIO_BASE,
  time12,
} from "../../../../lib/studio";
import { GuardedLink } from "../GuardedLink";

const SHOWN = 8;

export async function BarberToday({ ctx }: { ctx: OrgContext }) {
  let upcoming: BookingView[] | null = null;
  try {
    const { bookings } = await listBookings(ctx);
    upcoming = bookings.filter((b) => b.status === "confirmed").slice(0, SHOWN);
  } catch (err) {
    console.error(
      "[today] barber bookings failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
  return (
    <div className="flex max-w-[880px] flex-col gap-6" data-today="">
      <ScreenHeader
        title="Today"
        helpId="addon-studio-booking"
        LinkComponent={GuardedLink}
      />
      <section aria-labelledby="upcoming-h" className="flex flex-col gap-3">
        <h2 id="upcoming-h" className="text-xl font-semibold">
          Your upcoming appointments
        </h2>
        {upcoming === null ? (
          <InlineAlert tone="error">
            We couldn&apos;t load your appointments. Refresh to try again.
          </InlineAlert>
        ) : upcoming.length === 0 ? (
          <EmptyState
            heading="Nothing booked yet"
            body="New bookings from your profile show here."
          />
        ) : (
          <ul className="divide-y divide-hub-border rounded border border-hub-border bg-hub-surface">
            {upcoming.map((b) => (
              <li key={b.id} className="flex flex-col gap-1 px-4 py-3">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-semibold">{dayLabel(b.date)}</span>
                  <span className="font-semibold tabular-nums">
                    {time12(b.time)}
                  </span>
                </p>
                <p>
                  {b.clientName}
                  <span className="text-hub-ink-muted">
                    {" "}
                    · {b.service} · {duration(b.durationMinutes)}
                  </span>
                </p>
                {b.clientPhone ? (
                  <a
                    className="text-sm text-hub-ink-muted underline"
                    href={`tel:${b.clientPhone}`}
                  >
                    {b.clientPhone}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="flex flex-wrap gap-4 text-sm">
          <GuardedLink className="underline" href={`${STUDIO_BASE}/bookings`}>
            All my bookings
          </GuardedLink>
          <GuardedLink className="underline" href={STUDIO_BASE}>
            My profile
          </GuardedLink>
        </p>
      </section>
    </div>
  );
}
