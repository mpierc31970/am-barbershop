// IncidentBox (12-10 choice 6; COMM-12, D103; 12-UI-SPEC "Incident" lines 490-499). At the top
// of a ticket linked to a known problem, and inside the notice strip's What happened dialog:
// CdsSurface, CdsMark 20 + "Known problem: {title}" + Being fixed / Fixed badge, the public
// text (68ch, pre-wrap) and one date line ("Updated 2:14 pm" / "Fixed 12 Oct, 4:10 pm. Your
// ticket was marked resolved."; in the notice dialog, `context="notice"`, no ticket sentence).
// It accepts IncidentView only (title, public_text, status), so
// it can never show a count of other sites or tickets or another business's name
// (T-12-10-02). Server-safe (useId only).
import type { IncidentView } from "@cds/core/support";
import { useId } from "react";
import { Badge } from "../../Badge";
import { CdsMark, CdsSurface } from "../../cds";
import { formatDayMonth } from "../../today/copy";
import { clockTime } from "../thread/copy";
import { PAID_COPY } from "./copy";

export interface IncidentBoxProps {
  incident: IncidentView;
  /** Last update (open) or fix time (resolved); omit to drop the time. */
  at?: string | null;
  timeZone: string;
  /** Heading level inside the page or the dialog. Default h2. */
  headingLevel?: "h2" | "h3";
  /**
   * "ticket" (default): on a ticket linked to the incident, so a fix says the ticket was
   * resolved. "notice": the notice strip's dialog, where the person may have no ticket
   * (12-REVIEW WR-D08).
   */
  context?: "ticket" | "notice";
}

export function IncidentBox({
  incident,
  at,
  timeZone,
  headingLevel = "h2",
  context = "ticket",
}: IncidentBoxProps) {
  const headingId = useId();
  const H = headingLevel;
  const fixed = incident.status === "resolved";
  const time = at ? clockTime(at, timeZone) : "";
  const dayMonth = at ? formatDayMonth(at, timeZone) : "";
  const fixedWhen = dayMonth && time ? `${dayMonth}, ${time}` : dayMonth;
  const dateLine = fixed
    ? context === "notice"
      ? PAID_COPY.incidentFixedNoticeLine(fixedWhen)
      : PAID_COPY.incidentFixedLine(fixedWhen)
    : time
      ? PAID_COPY.incidentUpdated(time)
      : "";
  return (
    <CdsSurface
      as="section"
      padding="lg"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 font-hub"
      data-incident-box=""
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <H
          id={headingId}
          className="inline-flex items-center gap-2 text-lg leading-tight font-semibold"
        >
          <CdsMark size={20} label />
          {PAID_COPY.incidentHeading(incident.title)}
        </H>
        <Badge tone={fixed ? "inc-resolved" : "inc-open"}>
          {fixed ? PAID_COPY.incidentFixed : PAID_COPY.incidentOpen}
        </Badge>
      </div>
      <p className="max-w-[68ch] text-base whitespace-pre-wrap">
        {incident.public_text}
      </p>
      {dateLine ? (
        <p
          className={
            fixed ? "text-sm text-hub-ink" : "text-sm text-hub-ink-muted"
          }
          data-incident-date=""
        >
          {dateLine}
        </p>
      ) : null}
    </CdsSurface>
  );
}
