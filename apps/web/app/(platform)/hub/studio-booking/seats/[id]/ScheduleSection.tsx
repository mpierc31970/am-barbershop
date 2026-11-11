// The seat screen's Hours and Time off (Studio Booking step 2). Plain forms (no JS needed):
// one working range per day (15-minute steps), and whole days off. Server component.
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
        <div>
          <Button type="submit" variant="primary">
            Save hours
          </Button>
        </div>
      </form>

      <div className={CARD}>
        <h3 className="font-semibold">Time off</h3>
        {schedule.timeOff.length === 0 ? (
          <p className="text-hub-ink-muted">No days off planned.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {schedule.timeOff.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3">
                <span>
                  {dateLabel(t.start)}
                  {t.end !== t.start ? ` to ${dateLabel(t.end)}` : ""}
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
            label="First day off"
            required
          />
          <TextField
            id="off-end"
            name="end"
            type="date"
            label="Last day off"
            helper="Blank: one day"
          />
          <TextField
            id="off-note"
            name="note"
            label="Note (optional)"
            maxLength={120}
          />
          <div>
            <Button type="submit">Add time off</Button>
          </div>
        </form>
      </div>
    </section>
  );
}
