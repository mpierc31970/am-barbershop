"use client";
// HoursEditor: weekly opening hours (06-19; 06-UI-SPEC "Hours editor", "Accessibility
// contract", Copywriting "Hours end before start" / "Hours overlap"; ONB-13, D257, D119,
// D-UI-P6-22, D-UI-P6-23).
//   - A fieldset "Opening hours"; the time zone read-only under the legend.
//   - Seven rows, Monday first (D-UI-P6-22), each its own fieldset + legend: an Open switch
//     ("Open on Monday"), then one or more ranges of two native selects (15-minute steps,
//     12-hour labels "9:00 am", value HH:MM) joined by "to", a named remove button when a
//     day has more than one range, and Add hours for split days. Closed rows read "Closed".
//   - The one bulk shortcut (D119): copy Monday to Tuesday-Friday, with an Undo toast.
//   - Each row is pre-checked with validateHours from @cds/core/intake, so its message
//     (end before start, overlap) shows under that row. No overnight ranges (D-UI-P6-23).
// Controlled: the caller keeps the value and saves it (debounced 800ms in HoursSection).
import {
  DAYS,
  DAY_LABELS,
  MAX_RANGES_PER_DAY,
  emptyWeeklyHours,
  validateHours,
  type Day,
  type TimeRange,
  type WeeklyHours,
} from "@cds/core/intake";
import { Copy, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Switch } from "./Switch";
import { useToast } from "./Toast";

export interface HoursEditorProps {
  value: WeeklyHours | null;
  timeZone: string;
  onChange(v: WeeklyHours): void;
  readOnly?: boolean;
  /** Server-side messages per day (shown when the client check has none). */
  errors?: Partial<Record<Day, string>>;
  /** Where the time zone is edited (a link after the time zone line). */
  timeZoneHref?: string;
  /** Rendered as the link, e.g. a Next Link; default a plain anchor. */
  renderLink?: (href: string, children: ReactNode) => ReactNode;
}

export const HOURS_EMPTY_HELPER =
  "Leave all days closed and your site says 'Contact us for hours'.";
export const HOURS_OVERNIGHT_HELPER =
  "Open past midnight? Set the day to close at 11:45 pm and tell CDS.";
export const COPY_WEEKDAYS_TOAST =
  "Copied Monday's hours to Tuesday to Friday.";

const WEEKDAYS: readonly Day[] = ["tue", "wed", "thu", "fri"];
const DEFAULT_RANGE: TimeRange = { start: "09:00", end: "17:00" };

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** "09:00" -> "9:00 am", "12:00" -> "12:00 pm", "00:15" -> "12:15 am". */
export function timeLabel(t: string): string {
  const h = Number(t.slice(0, 2));
  const m = t.slice(3, 5);
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** 00:00 .. 23:45 in 15-minute steps. */
export const TIME_OPTIONS: readonly { value: string; label: string }[] =
  Array.from({ length: 96 }, (_, i) => {
    const v = toTime(i * 15);
    return { value: v, label: timeLabel(v) };
  });

/** The validateHours message for each open day that fails on its own. */
export function hoursRowErrors(h: WeeklyHours): Partial<Record<Day, string>> {
  const out: Partial<Record<Day, string>> = {};
  for (const d of DAYS) {
    const day = h[d];
    if (!day?.open) continue;
    try {
      validateHours({ [d]: day });
    } catch (err) {
      out[d] = err instanceof Error ? err.message : "Check these times.";
    }
  }
  return out;
}

function withDefaults(v: WeeklyHours | null): WeeklyHours {
  const base = emptyWeeklyHours();
  if (!v) return base;
  for (const d of DAYS) {
    const day = v[d];
    if (day) base[d] = { open: day.open, ranges: [...day.ranges] };
  }
  return base;
}

/** The next range after the last one: an hour later, four hours long, before midnight. */
function nextRange(ranges: readonly TimeRange[]): TimeRange {
  const last = ranges[ranges.length - 1];
  if (!last) return { ...DEFAULT_RANGE };
  const start = Math.min(toMin(last.end) + 60, 23 * 60 + 30);
  const end = Math.min(start + 240, 23 * 60 + 45);
  return { start: toTime(start), end: toTime(end) };
}

const SELECT =
  "h-10 rounded border border-hub-border-strong bg-hub-surface px-2 font-hub text-base " +
  "text-hub-ink tabular-nums transition-colors duration-150 hover:border-hub-ink-muted " +
  "disabled:cursor-not-allowed disabled:bg-hub-surface-2 disabled:text-hub-ink-muted " +
  "aria-invalid:border-hub-danger";

export function HoursEditor({
  value,
  timeZone,
  onChange,
  readOnly = false,
  errors = {},
  timeZoneHref,
  renderLink,
}: HoursEditorProps) {
  const toast = useToast();
  const hours = withDefaults(value);
  const rowErrors = hoursRowErrors(hours);
  const allClosed = DAYS.every((d) => !hours[d].open);

  function setDay(d: Day, next: WeeklyHours[Day]) {
    onChange({ ...hours, [d]: next });
  }

  function copyMonday() {
    const before = hours;
    const mon = hours.mon;
    const next = { ...hours };
    for (const d of WEEKDAYS) {
      next[d] = { open: mon.open, ranges: mon.ranges.map((r) => ({ ...r })) };
    }
    onChange(next);
    toast.show({
      message: COPY_WEEKDAYS_TOAST,
      action: { label: "Undo", onClick: () => onChange(before) },
    });
  }

  const link = (href: string, children: ReactNode) =>
    renderLink ? (
      renderLink(href, children)
    ) : (
      <a href={href} className="text-hub-accent underline underline-offset-2">
        {children}
      </a>
    );

  return (
    <fieldset
      className="flex flex-col gap-4 font-hub"
      id="field-hours"
      tabIndex={-1}
    >
      <legend className="sr-only">Opening hours</legend>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-hub-ink-muted">
          Times are in {timeZone || "your time zone"}.
          {timeZoneHref ? <> {link(timeZoneHref, "Change time zone")}</> : null}
        </p>
        {readOnly ? null : (
          <Button
            variant="secondary"
            size="sm"
            icon={<Copy aria-hidden size={16} strokeWidth={2} />}
            onClick={copyMonday}
          >
            Copy Monday to weekdays
          </Button>
        )}
      </div>
      {allClosed ? (
        <p className="text-sm text-hub-ink-muted">{HOURS_EMPTY_HELPER}</p>
      ) : null}
      <div className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {DAYS.map((d) => {
          const label = DAY_LABELS[d];
          const day = hours[d];
          const err = rowErrors[d] ?? errors[d];
          const errId = `hours-${d}-error`;
          return (
            <fieldset
              key={d}
              data-day={d}
              className="flex min-h-14 flex-col gap-2 py-2 sm:flex-row sm:items-start sm:gap-4"
            >
              <legend className="sr-only">{label}</legend>
              <span
                aria-hidden
                className="w-28 shrink-0 pt-2 text-base font-semibold text-hub-ink"
              >
                {label}
              </span>
              <div className="w-24 shrink-0 pt-1">
                <Switch
                  id={`hours-${d}-open`}
                  label="Open"
                  aria-label={`Open on ${label}`}
                  checked={day.open}
                  disabled={readOnly}
                  onChange={(open) =>
                    setDay(d, {
                      open,
                      ranges:
                        open && day.ranges.length === 0
                          ? [{ ...DEFAULT_RANGE }]
                          : day.ranges,
                    })
                  }
                />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {day.open ? (
                  <>
                    {day.ranges.map((r, i) => {
                      const nth =
                        day.ranges.length > 1 ? `, time range ${i + 1}` : "";
                      const update = (patch: Partial<TimeRange>) =>
                        setDay(d, {
                          open: true,
                          ranges: day.ranges.map((x, j) =>
                            j === i ? { ...x, ...patch } : x,
                          ),
                        });
                      return (
                        <div
                          key={i}
                          className="flex flex-wrap items-center gap-2"
                        >
                          <select
                            aria-label={`${label} opens at${nth}`}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? errId : undefined}
                            className={SELECT}
                            value={r.start}
                            disabled={readOnly}
                            onChange={(e) => update({ start: e.target.value })}
                          >
                            {TIME_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-sm text-hub-ink-muted">to</span>
                          <select
                            aria-label={`${label} closes at${nth}`}
                            aria-invalid={err ? true : undefined}
                            aria-describedby={err ? errId : undefined}
                            className={SELECT}
                            value={r.end}
                            disabled={readOnly}
                            onChange={(e) => update({ end: e.target.value })}
                          >
                            {TIME_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                          {day.ranges.length > 1 && !readOnly ? (
                            <IconButton
                              size="sm"
                              label={`Remove ${label} ${timeLabel(r.start)} to ${timeLabel(r.end)}`}
                              icon={<X aria-hidden size={16} strokeWidth={2} />}
                              onClick={() =>
                                setDay(d, {
                                  open: true,
                                  ranges: day.ranges.filter((_, j) => j !== i),
                                })
                              }
                            />
                          ) : null}
                        </div>
                      );
                    })}
                    {readOnly ||
                    day.ranges.length >= MAX_RANGES_PER_DAY ? null : (
                      <div>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Add another time range on ${label}`}
                          icon={<Plus aria-hidden size={16} strokeWidth={2} />}
                          onClick={() =>
                            setDay(d, {
                              open: true,
                              ranges: [...day.ranges, nextRange(day.ranges)],
                            })
                          }
                        >
                          Add hours
                        </Button>
                      </div>
                    )}
                  </>
                ) : (
                  <span className="pt-2 text-sm text-hub-ink-muted">
                    Closed
                  </span>
                )}
                {err ? (
                  <p id={errId} className="text-sm text-hub-danger">
                    {err}
                  </p>
                ) : null}
              </div>
            </fieldset>
          );
        })}
      </div>
      <p className="text-sm text-hub-ink-muted">{HOURS_OVERNIGHT_HELPER}</p>
    </fieldset>
  );
}
