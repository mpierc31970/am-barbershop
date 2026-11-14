// Owner/admin: "Move to <barber> > Transfer" for one booking (Bookings and Alerts). The rule
// for when it may move lives in transferBooking (@cds/db).
import type { BookingView } from "@cds/db";
import { Button } from "@cds/ui/hub";
import { transferBookingAction } from "../../../actions/studio";

/** Owner/admin: hand the booking to another barber (double booked elsewhere). */
export function MoveForm({
  b,
  seats,
  back,
}: {
  b: BookingView;
  seats: { id: string; name: string }[];
  /** "/hub/alerts" acts in place there. */
  back?: string;
}) {
  const others = seats.filter((s) => s.id !== b.seatId);
  if (others.length === 0) return null;
  return (
    <form
      action={transferBookingAction}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="bookingId" value={b.id} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <label htmlFor={`move-${b.id}`}>Move to</label>
      <select
        id={`move-${b.id}`}
        name="seatId"
        required
        defaultValue=""
        className="min-h-9 rounded border border-hub-border-strong bg-hub-surface px-2"
      >
        <option value="" disabled>
          Pick a barber
        </option>
        {others.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm" variant="secondary">
        Transfer
      </Button>
    </form>
  );
}
