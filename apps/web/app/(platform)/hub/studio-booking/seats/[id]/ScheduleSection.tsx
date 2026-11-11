// The seat screen's Hours and Time off (Studio Booking step 2). Plain forms (no JS needed):
// one working range per day (15-minute steps), the booking interval, and blocked time (whole
// days, or From/To on each of those days). Server component.
import { DAYS, DAY_LABELS } from "@cds/core/intake";
import type { ScheduleView } from "@cds/db";
import { Button, TextField } from "@cds/ui/hub";
import {
  addTimeOffAction,
  removeTimeOffAction,
  saveHoursAction,
} from "../../../../../actions/studio";

const CARD =
  "flex flex-col gap-4 rounded border border-hub-border bg-hub-surface p-4";
const INPUT =
  "h-10 rounded border border-hub-border-strong bg-hub-surface px-2 font-hub text-base text-hub-ink";

const INTERVALS = [
  [15, "15 minutes"],
  [30, "30 minutes"],
  [45, "45 minutes"],
  [60, "1 hour"],
  [90, "1 1/2 hours"],
  [120, "2 hours"],
] as const;

/** "14:30" -> "2:30 pm". */
function time12(t: string): string {
  const h = Number(t.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${t.slice(3, 5)} ${h < 12 ? "am" : "pm"}`;
}

function dateLabel(d: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${d}T12:00:00Z`));
}

export function ScheduleSection({
  seatId,
  schedule,
}: {
  seatId: string;
  schedule: ScheduleView;
}) {
  return (
    <section
      id="hours"
      aria-labelledby="hours-h"
      className="flex flex-col gap-3"
    >
      <h2 id="hours-h" className="text-xl font-semibold">
        Hours and time off
      </h2>
      <form action={saveHoursAction} className={CARD}>
        <input type="hidden" name="seatId" value={seatId} />
        <p className="text-sm text-hub-ink-muted">
          Clients can book you only inside these hours. Shop time zone.
        </p>
        <table className="w-full text-left">
          <thead className="sr-only">
            <tr>
              <th>Day</th>
              <th>Working</th>
              <th>From</th>
              <th>To</th>
            </tr>
          </thead>
          <tbody>
            {DAYS.map((d) => {
              const day = schedule.hours?.[d];
              const r = day?.ranges[0];
              return (
                <tr
                  key={d}
                  className="border-t border-hub-border first:border-t-0"
                >
                  <th scope="row" className="py-2 pr-3 font-semibold">
                    {DAY_LABELS[d]}
                  </th>
                  <td className="py-2 pr-3">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        name={`open_${d}`}
                        defaultChecked={day?.open ?? false}
                        className="h-5 w-5"
                      />
                      Working
                    </label>
                  </td>
                  <td className="py-2 pr-3">
                    <input
                      type="time"
                      step={900}
                      name={`start_${d}`}
                      aria-label={`${DAY_LABELS[d]} from`}
                      defaultValue={r?.start ?? "09:00"}
                      className={INPUT}
                    />
                  </td>
                  <td className="py-2">
                    <input
                      type="time"
                      step={900}
                      name={`end_${d}`}
                      aria-label={`${DAY_LABELS[d]} to`}
                      defaultValue={r?.end ?? "18:00"}
                      className={INPUT}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <label className="flex flex-wrap items-center gap-3">
          <span className="font-semibold">Booking interval</span>
          <select
            name="slotMinutes"
            defaultValue={String(schedule.slotMinutes)}
            className={INPUT}
          >
            {INTERVALS.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
          <span className="text-sm text-hub-ink-muted">
            Time between the start times clients can pick.
          </span>
        </label>
        <div>
          <Button type="submit" variant="primary">
            Save hours
          </Button>
        </div>
      </form>

      <div className={CARD}>
        <h3 className="font-semibold">Blocked time</h3>
        <p className="text-sm text-hub-ink-muted">
          Clients can&apos;t book these times. Leave From and To blank to block
          whole days.
        </p>
        {schedule.timeOff.length === 0 ? (
          <p className="text-hub-ink-muted">Nothing blocked.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {schedule.timeOff.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {dateLabel(t.start)}
                  {t.end !== t.start ? ` to ${dateLabel(t.end)}` : ""}
                  {t.from && t.to
                    ? `, ${time12(t.from)} to ${time12(t.to)}`
                    : ", all day"}
                  {t.note ? ` · ${t.note}` : ""}
                </span>
                <form action={removeTimeOffAction}>
                  <input type="hidden" name="seatId" value={seatId} />
                  <input type="hidden" name="timeOffId" value={t.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <form action={addTimeOffAction} className="grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="seatId" value={seatId} />
          <TextField
            id="off-start"
            name="start"
            type="date"
            label="First day"
            required
          />
          <TextField
            id="off-end"
            name="end"
            type="date"
            label="Last day"
            helper="Blank: one day"
          />
          <TextField
            id="off-from"
            name="from"
            type="time"
            step={900}
            label="From"
            helper="Blank: all day"
          />
          <TextField id="off-to" name="to" type="time" step={900} label="To" />
          <TextField
            id="off-note"
            name="note"
            label="Note (optional)"
            maxLength={120}
          />
          <div>
            <Button type="submit">Block time</Button>
          </div>
        </form>
      </div>
    </section>
  );
}
