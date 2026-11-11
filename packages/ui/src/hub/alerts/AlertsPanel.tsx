"use client";
// Bell drawer (11-21; DASH-34, DASH-37; 11-UI-SPEC "Bell", "Interaction states"; D-UI-P11-8).
// A right Drawer, 480px, titled Alerts, with Mark all as read (only while something is
// unread) and Close. Rows are grouped by business-time day (Today / Yesterday / Earlier); each
// row is one link to its item. Unread rows are weight 600 plus sr "Unread"; urgent rows add a
// TriangleAlert (danger) plus sr "Urgent" (weight and icons, never colour alone). An alert
// whose Needs-you item is done renders read with "Done". Opening a row calls onOpenRow (mark
// read, close, navigate); a modified click opens the link normally.
// States: 4 skeleton rows; ERR-LOAD + Try again; BELL-EMPTY. Footer: Alert settings.
// 12-29 (COMM-03, COMM-05; 12-UI-SPEC "Bell rows"): CDS-authored rows (types `support.*` and
// `cds.*`) show CdsMark 16 in the marker column inside a data-cds-identity wrapper; urgent rows
// (cds.notice) keep TriangleAlert. Keyed on the type only, so tenant or visitor alerts are never
// styled as CDS (T-12-29-01).
import { Bell, TriangleAlert } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "../Button";
import { CdsMark } from "../cds";
import { Drawer } from "../Drawer";
import { EmptyState, InlineAlert, Skeleton } from "../feedback";
import {
  ALERTS_COPY,
  alertAge,
  alertSectionLabel,
  groupBellRows,
  type BellRow,
} from "./copy";

export type AlertsPanelState = "loading" | "error" | "ready";

export interface AlertsPanelProps {
  open: boolean;
  onClose: () => void;
  state: AlertsPanelState;
  rows: readonly BellRow[];
  /** Business time zone for the day groups. */
  timeZone: string;
  /** "Now" in ms (ages and day groups). */
  now: number;
  onOpenRow: (row: BellRow) => void;
  onMarkAll: () => void;
  onRetry: () => void;
  /** Shown when more rows exist past the first 30. */
  onShowMore?: () => void;
  markingAll?: boolean;
}

/** CDS-authored alert types (12-29): the support and CDS families only. */
export function isCdsAlertType(type: string): boolean {
  return type.startsWith("support.") || type.startsWith("cds.");
}

function plainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

function AlertRow({
  row,
  now,
  onOpen,
}: {
  row: BellRow;
  now: number;
  onOpen: (row: BellRow) => void;
}) {
  const unread = !row.read && !row.cleared;
  const age = alertAge(row.createdAt, now);
  const meta = [alertSectionLabel(row.section), age]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="border-b border-hub-border last:border-b-0">
      <a
        href={row.href}
        data-alert-row={row.id}
        data-unread={unread ? "" : undefined}
        onClick={(e) => {
          if (!plainLeftClick(e)) return;
          e.preventDefault();
          onOpen(row);
        }}
        className={
          "flex min-h-16 items-start gap-3 bg-hub-surface p-4 text-hub-ink no-underline " +
          "transition-colors duration-150 hover:bg-hub-surface-2 " +
          "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-hub-accent"
        }
      >
        {row.level === "urgent" ? (
          <span className="mt-0.5 shrink-0">
            <TriangleAlert
              aria-hidden="true"
              size={16}
              strokeWidth={2}
              className="text-hub-danger"
            />
            <span className="sr-only">{ALERTS_COPY.urgent}: </span>
          </span>
        ) : isCdsAlertType(row.type) ? (
          <span data-cds-identity="" className="mt-0.5 shrink-0">
            <CdsMark size={16} />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={
              "text-base break-words " +
              (unread ? "font-semibold" : "font-normal")
            }
          >
            {unread ? (
              <span className="sr-only">{ALERTS_COPY.unread}: </span>
            ) : null}
            {row.title}
          </span>
          <span className="text-sm text-hub-ink-muted">
            {meta}
            {row.cleared && !row.read ? ` · ${ALERTS_COPY.done}` : ""}
          </span>
        </span>
      </a>
    </li>
  );
}

export function AlertsPanel({
  open,
  onClose,
  state,
  rows,
  timeZone,
  now,
  onOpenRow,
  onMarkAll,
  onRetry,
  onShowMore,
  markingAll = false,
}: AlertsPanelProps) {
  const anyUnread = rows.some((r) => !r.read && !r.cleared);
  const groups = groupBellRows(rows, timeZone, now);
  return (
    <Drawer
      open={open}
      onClose={onClose}
      label={ALERTS_COPY.title}
      side="right"
    >
      <div className="flex items-center gap-2 border-b border-hub-border px-4 py-3">
        <h2 className="flex-1 text-xl leading-tight font-semibold">
          {ALERTS_COPY.title}
        </h2>
        {state === "ready" && anyUnread ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkAll}
            loading={markingAll}
          >
            {ALERTS_COPY.markAll}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onClose}>
          {ALERTS_COPY.close}
        </Button>
      </div>
      <div className="flex-1 px-4 py-4" aria-busy={state === "loading"}>
        {state === "loading" ? (
          <>
            <span className="sr-only" role="status">
              {ALERTS_COPY.loading}
            </span>
            <Skeleton rows={4} rowHeight={64} />
          </>
        ) : state === "error" ? (
          <InlineAlert
            tone="error"
            action={
              <Button variant="secondary" size="sm" onClick={onRetry}>
                {ALERTS_COPY.tryAgain}
              </Button>
            }
          >
            {ALERTS_COPY.errLoad}
          </InlineAlert>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Bell}
            heading={ALERTS_COPY.emptyHeading}
            body={ALERTS_COPY.emptyBody}
          />
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((g) => (
              <section key={g.key} aria-labelledby={`alerts-${g.key}`}>
                <h3
                  id={`alerts-${g.key}`}
                  className="mb-2 text-sm font-semibold text-hub-ink-muted"
                >
                  {g.label}
                </h3>
                <ul className="overflow-hidden rounded border border-hub-border">
                  {g.rows.map((r) => (
                    <AlertRow key={r.id} row={r} now={now} onOpen={onOpenRow} />
                  ))}
                </ul>
              </section>
            ))}
            {onShowMore ? (
              <div>
                <Button variant="secondary" size="sm" onClick={onShowMore}>
                  {ALERTS_COPY.showMore}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="border-t border-hub-border px-4 py-3">
        <a
          href={ALERTS_COPY.settingsHref}
          className="text-base font-semibold text-hub-accent underline-offset-4 hover:underline"
        >
          {ALERTS_COPY.settings}
        </a>
      </div>
    </Drawer>
  );
}
