"use client";
// TicketHeaderStrip (13-35 choice 3; STAFF-05, STAFF-08, D210; 13-UI-SPEC "TicketHeaderStrip"
// lines 432-443). The subject as the heading (H2 in the split pane, H1 on its own page,
// text-balance), then one Label line: #1042 · status badge (staff words: "Waiting on owner") ·
// type · target · site link · "Opened by Maria 9 Oct" / "Opened by CDS" · SlaCell. Right: ghost
// "Open as admin" (to the site's Actions tab, reason prefilled "Ticket #1042") and, in the split
// pane, "Open on its own page". Paid-service and incident lines follow when they apply. In the
// split pane the heading takes focus on open (UI-SPEC a11y). Tenant text stays React text.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import type {
  SlaState,
  TargetRef,
  TicketStatus,
  TicketType,
} from "@cds/core/support";
import { ExternalLink, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Badge } from "../../hub/Badge";
import {
  ticketStatusTone,
  ticketTypeShort,
} from "../../hub/support/tickets/copy";
import { SlaCell } from "../table";
import { STAFF_TICKETS_COPY as C, staffStatusLabel } from "./copy";

export interface TicketHeaderView {
  number: number;
  subject: string;
  status: TicketStatus;
  type: TicketType;
  target: Pick<TargetRef, "kind" | "label">;
  orgId: string;
  orgName: string;
  openedBy: { cds: boolean; name: string };
  created: string;
  sla: SlaState;
  dueAt: string | null;
  firstRepliedAt: string | null;
  /** Paid-service category label, or null when not marked. */
  paidLabel: string | null;
  /** Incident code ("I-3") when linked. */
  incidentCode: string | null;
}

export interface TicketHeaderStripProps {
  ticket: TicketHeaderView;
  /** ISO time of the read (SLA reference). */
  now: string;
  /** Split pane: H2, focus on open, "Open on its own page" and a close link. */
  split?: boolean;
  closeHref?: string;
  timeZone?: string;
}

const LINK =
  "rounded text-hub-accent underline-offset-2 hover:underline focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const GHOST =
  "inline-flex h-8 items-center gap-1 rounded px-3 font-hub text-sm font-semibold text-hub-ink " +
  "hover:bg-hub-surface-2 pointer-coarse:min-h-11 focus-visible:outline-2 " +
  "focus-visible:outline-offset-2 focus-visible:outline-hub-accent";
const ICON =
  "inline-flex size-8 items-center justify-center rounded text-hub-ink hover:bg-hub-surface-2 " +
  "pointer-coarse:size-11 focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "focus-visible:outline-hub-accent";

/** "9 Oct" in business time; "" when unreadable. */
export function ticketDay(raw: string, tz = BUSINESS_TIME_ZONE): string {
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    day: "numeric",
    month: "short",
  }).format(d);
}

/** Site Actions tab with Open as admin's reason prefilled (13-43 reads `reason`). */
export function openAsAdminHref(orgId: string, number: number): string {
  const qs = new URLSearchParams({
    tab: "actions",
    reason: C.adminReason(number),
  });
  return `/staff/sites/${encodeURIComponent(orgId)}?${qs.toString()}`;
}

export function targetText(t: Pick<TargetRef, "kind" | "label">): string {
  const kind = C.targetKind[t.kind];
  if (t.kind === "site" || !t.label.trim()) return kind;
  return `${kind} · ${t.label}`;
}

export function TicketHeaderStrip({
  ticket: t,
  now,
  split = false,
  closeHref,
  timeZone = BUSINESS_TIME_ZONE,
}: TicketHeaderStripProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (split) headingRef.current?.focus();
  }, [split, t.number]);
  const at = new Date(now);
  const ref = Number.isNaN(at.getTime()) ? new Date() : at;
  const H = split ? "h2" : "h1";
  const opened = t.openedBy.cds
    ? C.openedByCds
    : C.openedBy(t.openedBy.name, ticketDay(t.created, timeZone));
  return (
    <header className="flex flex-col gap-2 font-hub text-hub-ink">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <H
          ref={headingRef}
          tabIndex={-1}
          data-ticket-heading={t.number}
          className={
            "font-semibold text-balance break-words text-hub-ink focus:outline-none " +
            (split ? "text-xl" : "text-3xl")
          }
        >
          {t.subject}
        </H>
        <div className="flex shrink-0 items-center gap-1">
          <a href={openAsAdminHref(t.orgId, t.number)} className={GHOST}>
            {C.openAsAdmin}
          </a>
          {split ? (
            <>
              <a
                href={`/staff/tickets/${t.number}`}
                aria-label={C.openOwnPage}
                title={C.openOwnPage}
                className={ICON}
              >
                <ExternalLink aria-hidden size={16} strokeWidth={2} />
              </a>
              {closeHref ? (
                <a
                  href={closeHref}
                  aria-label={C.closeSplit}
                  title={C.closeSplit}
                  className={ICON}
                >
                  <X aria-hidden size={16} strokeWidth={2} />
                </a>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-hub-ink-muted">
        <span className="font-semibold text-hub-ink tabular-nums">
          {C.ticketRef(t.number)}
        </span>
        <span aria-hidden>·</span>
        <Badge tone={ticketStatusTone(t.status)}>
          {staffStatusLabel(t.status)}
        </Badge>
        <span aria-hidden>·</span>
        <span>{ticketTypeShort(t.type)}</span>
        <span aria-hidden>·</span>
        <span>{targetText(t.target)}</span>
        <span aria-hidden>·</span>
        <a
          href={`/staff/sites/${encodeURIComponent(t.orgId)}`}
          className={LINK}
        >
          {t.orgName || t.orgId}
        </a>
        <span aria-hidden>·</span>
        <span data-opened-by="">{opened}</span>
        <span aria-hidden>·</span>
        <SlaCell
          state={t.sla}
          dueAt={t.dueAt}
          repliedAt={t.firstRepliedAt}
          now={ref}
          tz={timeZone}
        />
      </p>
      {t.paidLabel ? (
        <p className="text-sm text-hub-ink">{C.paidLine(t.paidLabel)}</p>
      ) : null}
      {t.incidentCode ? (
        <p className="text-sm">
          <a
            href={`/staff/tickets?tab=incidents&incident=${encodeURIComponent(t.incidentCode)}`}
            className={LINK}
          >
            {C.openIncident(t.incidentCode)}
          </a>
        </p>
      ) : null}
    </header>
  );
}
