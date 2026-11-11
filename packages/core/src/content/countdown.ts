// Countdown state for the countdown column item (CONT-10, D122; RESEARCH Pitfall 8).
//
// Pure and deterministic: the caller passes `now`, so the server render and the client
// island compute identical initial markup (the island gets the server's now as a prop and
// starts ticking in an effect). Targets are UTC ISO strings: the editor converts its
// datetime-local value to UTC in the browser, because the server (UTC in Docker) cannot
// know the editor's zone. Labels are formatted in UTC so server output never depends on
// the host's zone.

export type CountdownState =
  | { done: true }
  | {
      done: false;
      days: number;
      hours: number;
      minutes: number;
      seconds: number;
    };

/** Time left until `targetIso` at `now`; done at or after the target, or when either is invalid. */
export function countdownState(targetIso: string, now: Date): CountdownState {
  const target = typeof targetIso === "string" ? Date.parse(targetIso) : NaN;
  const ms = target - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return { done: true };
  const s = Math.floor(ms / 1000);
  return {
    done: false,
    days: Math.floor(s / 86400),
    hours: Math.floor(s / 3600) % 24,
    minutes: Math.floor(s / 60) % 60,
    seconds: s % 60,
  };
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type UtcParts = {
  day: number;
  month: number;
  year: number;
  time: string;
};

function utcParts(iso: string): UtcParts | null {
  const ms = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const h = d.getUTCHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  return {
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    year: d.getUTCFullYear(),
    time: `${hour12}:${minutes} ${h < 12 ? "am" : "pm"}`,
  };
}

/** "12 Oct, 9:00 am" in UTC (UI-SPEC copy: item summaries, banner status); "" when invalid. */
export function formatShortUtc(iso: string): string {
  const p = utcParts(iso);
  if (!p) return "";
  return `${p.day} ${MONTHS[p.month]!.slice(0, 3)}, ${p.time}`;
}

/** "12 October 2026, 9:00 am" in UTC; "" when invalid. */
export function formatLongUtc(iso: string, locale?: string): string {
  const p = utcParts(iso);
  if (!p) return "";
  if (locale && !/^en\b/i.test(locale)) {
    try {
      return new Intl.DateTimeFormat(locale, {
        timeZone: "UTC",
        dateStyle: "long",
        timeStyle: "short",
      }).format(new Date(Date.parse(iso)));
    } catch {
      // Unknown locale: fall through to the English form.
    }
  }
  return `${p.day} ${MONTHS[p.month]} ${p.year}, ${p.time}`;
}

/** The timer's accessible name: "Time left until 12 October 2026, 9:00 am" (UI-SPEC). */
export function countdownAriaLabel(targetIso: string, locale?: string): string {
  const when = formatLongUtc(targetIso, locale);
  return when === "" ? "Countdown" : `Time left until ${when}`;
}
