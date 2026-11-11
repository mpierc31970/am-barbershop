// Hub suspension notice (13-22; STAFF-22, D215, D218; 13-UI-SPEC "Suspension (tenant side)",
// copy SUSP-NOTICE / SUSP-OFFLINE from P13_COPY). A full-width strip under the top bar on every
// hub screen (and in the focused frame): warning tint while a notice to fix is open, danger
// tint once the site is suspended. Not dismissible, shown under impersonation too (it is the
// site's real state). The link opens CDS Support › Messages, where the CDS note says what to fix.
import { P13_COPY } from "@cds/core/staff";
import { Ban, CirclePause } from "lucide-react";

/** Link words and target (UI-SPEC "See what to fix" / "Read why"). */
export const SUSPENSION_NOTICE_COPY = Object.freeze({
  fixLink: "See what to fix",
  whyLink: "Read why",
  supportHref: "/hub/support?tab=messages",
});

export interface SuspensionNoticeProps {
  state: "notice" | "suspended";
  /** ISO fix-by instant (notice state). */
  fixBy?: string;
  /** ISO suspension instant (suspended state). */
  suspendedAt?: string;
  /** The business time zone the dates are shown in. */
  timeZone: string;
}

function parts(iso: string, timeZone: string, withTime: boolean) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const date = `${p.day} ${p.month}`;
  if (!withTime) return date;
  return `${p.weekday} ${date}, ${p.hour}:${p.minute} ${String(p.dayPeriod ?? "").toLowerCase()}`;
}

/** "Thu 15 Oct, 5:00 pm" in the business zone (UI-SPEC example format). */
export function formatFixBy(iso: string, timeZone: string): string | null {
  return parts(iso, timeZone, true);
}

/** "12 Oct" in the business zone. */
export function formatSuspendedOn(
  iso: string,
  timeZone: string,
): string | null {
  return parts(iso, timeZone, false);
}

const STRIP =
  "flex items-start gap-3 border-b border-hub-border px-4 py-3 font-hub text-base text-hub-ink lg:px-8";
const LINK =
  "font-semibold text-hub-accent underline underline-offset-2 hover:no-underline";

function split(template: string, token: string): [string, string] {
  const i = template.indexOf(token);
  if (i < 0) return [template, ""];
  return [template.slice(0, i), template.slice(i + token.length)];
}

export function SuspensionNotice({
  state,
  fixBy,
  suspendedAt,
  timeZone,
}: SuspensionNoticeProps) {
  if (state === "notice") {
    const when = fixBy ? formatFixBy(fixBy, timeZone) : null;
    const [before, after] = split(P13_COPY.SUSP_NOTICE, "{when}");
    return (
      <div
        role="status"
        data-suspension="notice"
        className={`${STRIP} bg-hub-warning-tint`}
      >
        <CirclePause
          aria-hidden
          size={16}
          strokeWidth={2}
          className="mt-1 shrink-0 text-hub-warning"
        />
        <p className="min-w-0 flex-1">
          {when ? (
            <>
              {before}
              <strong className="font-semibold">{when}</strong>
              {after}
            </>
          ) : (
            // No fix-by recorded: the sentence without a date ("Fix it soon ...").
            `${before.replace(/ by $/, "")}${after}`
          )}{" "}
          <a href={SUSPENSION_NOTICE_COPY.supportHref} className={LINK}>
            {SUSPENSION_NOTICE_COPY.fixLink}
          </a>
        </p>
      </div>
    );
  }
  const date = suspendedAt ? formatSuspendedOn(suspendedAt, timeZone) : null;
  const text = date
    ? P13_COPY.SUSP_OFFLINE.replace("{date}", date)
    : P13_COPY.SUSP_OFFLINE.replace(" on {date}", "");
  const cut = text.indexOf(". ");
  const lead = cut < 0 ? text : text.slice(0, cut + 1);
  const rest = cut < 0 ? "" : text.slice(cut + 2);
  return (
    <div
      role="alert"
      data-suspension="suspended"
      className={`${STRIP} bg-hub-danger-tint`}
    >
      <Ban
        aria-hidden
        size={16}
        strokeWidth={2}
        className="mt-1 shrink-0 text-hub-danger"
      />
      <p className="min-w-0 flex-1">
        <strong className="font-semibold">{lead}</strong>
        {rest ? ` ${rest}` : null}{" "}
        <a href={SUSPENSION_NOTICE_COPY.supportHref} className={LINK}>
          {SUSPENSION_NOTICE_COPY.whyLink}
        </a>
      </p>
    </div>
  );
}
