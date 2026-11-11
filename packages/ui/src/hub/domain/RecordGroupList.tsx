"use client";
// RecordGroupList (14-30 choice 3; 14-UI-SPEC "S2 · What we'll copy" item 3, "DNS records",
// "Email setup" step 3, "Leaving CDS" handback; D-UI-P14-3, D-UI-P14-7; Accessibility
// contract). Records grouped in a fixed order with **Your email** always first (rendered even
// when empty: "No email records found."). Each group is a <section aria-labelledby> with a
// surface-2 header (Body 600 name + Label count). At >= 768px a real <table> per group
// (caption "Your email: 7 records", <th scope="col">); below, one <dl> per record (type +
// name, value, status). `layout` forces one shape (tests, staff previews); "auto" renders
// both and lets the md breakpoint show one, so the server render never shifts.
//
// Modes: check (Status column), manage (Who manages it + action: Remove on the owner's own
// verification rows, Ask to change on other "Yours" rows, none on CDS rows), handback
// (Found at your new DNS / Not found yet when given) and preview (Change: Add / Replace /
// Update). Values are font-mono selectable text (never images; T-14-30-01: React text nodes
// only), `@` shows as the domain, MX shows "10 host", and a value over 64 characters shows
// its first 64 plus a Show full value disclosure. Rows are owner views: no record sources
// (T-14-30-02, D-UI-P14-4).
import { P14_COPY } from "@cds/core/dns";
import { useId, useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "../Badge";
import { Button } from "../Button";
import {
  DOMAIN_UI_COPY as C,
  type RecordChange,
  type RecordGroupKey,
  type RecordManager,
  type RecordStatus,
} from "./copy";

export type RecordGroupMode = "check" | "manage" | "handback" | "preview";

/** One owner-view record row (no sources, no ids from the provider). */
export interface DomainRecordRow {
  /** Stable key for the row. */
  key: string;
  /** Record type as written ("MX", "TXT", …). */
  type: string;
  /** Relative name; "@" is the domain itself. */
  name: string;
  value: string;
  /** MX/SRV priority, shown before the value. */
  priority?: number;
  manager?: RecordManager;
  status?: RecordStatus;
  change?: RecordChange;
  /** manage mode: "remove" (owner's own verification record) or "ask" (other Yours). */
  action?: "remove" | "ask";
}

export interface RecordGroup {
  key: RecordGroupKey;
  records: readonly DomainRecordRow[];
  /** Optional control in the group header (manage: "Change email setup" on Your email). */
  headerAction?: ReactNode;
}

export interface RecordGroupListProps {
  mode: RecordGroupMode;
  groups: readonly RecordGroup[];
  domain: string;
  onRemove?(row: DomainRecordRow): void;
  onAskChange?(row: DomainRecordRow): void;
  /** Force the table or the stacked shape. Default "auto" (md breakpoint). */
  layout?: "auto" | "table" | "stacked";
  /** Read-only (Admins): no row actions. */
  readOnly?: boolean;
}

export const RECORD_GROUP_ORDER: readonly RecordGroupKey[] = Object.freeze([
  "email",
  "copy_exactly",
  "verification",
  "site",
  "points_to_cds",
  "sending",
  "cds_sending",
  "other",
]);

/** Values longer than this show the first 64 characters plus Show full value. */
export const RECORD_VALUE_PREVIEW = 64;

const MANAGER_TONE: Readonly<Record<RecordManager, BadgeTone>> = {
  cds: "rec-cds",
  email: "rec-email",
  yours: "rec-yours",
};

const STATUS_TONE: Readonly<Record<RecordStatus, BadgeTone>> = {
  copied: "rec-copied",
  checking: "rec-checking",
  added: "rec-added",
  pending: "rec-pending",
  found: "rec-copied",
  not_found: "rec-pending",
};

export function displayRecordName(name: string, domain: string): string {
  const n = name.trim();
  return n === "@" || n === "" ? domain : n;
}

export function displayRecordValue(row: DomainRecordRow): string {
  return row.priority !== undefined && (row.type === "MX" || row.type === "SRV")
    ? `${row.priority} ${row.value}`
    : row.value;
}

function RecordValue({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = value.length > RECORD_VALUE_PREVIEW;
  return (
    <span className="flex flex-col items-start gap-1">
      <span
        id={id}
        data-record-value=""
        className="font-mono text-sm [overflow-wrap:anywhere] text-hub-ink select-text"
      >
        {long && !open ? `${value.slice(0, RECORD_VALUE_PREVIEW)}…` : value}
      </span>
      {long ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? C.showLess : C.showFull}
        </Button>
      ) : null}
    </span>
  );
}

function lastColumn(mode: RecordGroupMode): string {
  if (mode === "manage") return C.colManager;
  if (mode === "preview") return C.colChange;
  return C.colStatus;
}

function hasStatusColumn(
  mode: RecordGroupMode,
  groups: readonly RecordGroup[],
) {
  if (mode !== "handback") return true;
  return groups.some((g) => g.records.some((r) => r.status));
}

interface CellProps {
  row: DomainRecordRow;
  mode: RecordGroupMode;
}

function LastCell({ row, mode }: CellProps) {
  if (mode === "manage") {
    return row.manager ? (
      <Badge tone={MANAGER_TONE[row.manager]}>{C.managers[row.manager]}</Badge>
    ) : null;
  }
  if (mode === "preview") {
    return row.change ? (
      <Badge tone="rec-added">{C.changes[row.change]}</Badge>
    ) : null;
  }
  return row.status ? (
    <Badge tone={STATUS_TONE[row.status]}>{C.statuses[row.status]}</Badge>
  ) : null;
}

function RowAction({
  row,
  domain,
  onRemove,
  onAskChange,
}: {
  row: DomainRecordRow;
  domain: string;
  onRemove?(row: DomainRecordRow): void;
  onAskChange?(row: DomainRecordRow): void;
}) {
  const name = displayRecordName(row.name, domain);
  if (row.manager === "cds") {
    return <span className="sr-only">{C.cdsRowNote}</span>;
  }
  if (row.action === "remove" && onRemove) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={C.removeName(row.type, name)}
        onClick={() => onRemove(row)}
      >
        {P14_COPY.BTN_REMOVE}
      </Button>
    );
  }
  if (row.action === "ask" && onAskChange) {
    return (
      <Button
        variant="ghost"
        size="sm"
        aria-label={C.askName(row.type, name)}
        onClick={() => onAskChange(row)}
      >
        {P14_COPY.BTN_ASK_TO_CHANGE}
      </Button>
    );
  }
  return null;
}

function emptyText(key: RecordGroupKey, mode: RecordGroupMode): string {
  if (key === "email")
    return mode === "manage" ? C.emailEmptyManage : C.emailEmpty;
  return P14_COPY.RECORDS_GROUP_EMPTY;
}

function groupNote(key: RecordGroupKey, mode: RecordGroupMode): string | null {
  if (key === "site" && mode === "check") return C.siteNote;
  if (key === "copy_exactly") return C.copyExactlyNote;
  return null;
}

/** Fixed order; Your email is always present unless the caller groups for handback. */
export function orderRecordGroups(
  groups: readonly RecordGroup[],
): RecordGroup[] {
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const handbackGroups = byKey.has("copy_exactly");
  if (!byKey.has("email") && !handbackGroups) {
    byKey.set("email", { key: "email", records: [] });
  }
  return RECORD_GROUP_ORDER.flatMap((k) => {
    const g = byKey.get(k);
    return g ? [g] : [];
  });
}

export function RecordGroupList({
  mode,
  groups,
  domain,
  onRemove,
  onAskChange,
  layout = "auto",
  readOnly = false,
}: RecordGroupListProps) {
  const baseId = useId();
  const ordered = orderRecordGroups(groups);
  const showLast = hasStatusColumn(mode, ordered);
  const showAction = mode === "manage" && !readOnly;
  const tableClass =
    layout === "auto" ? "hidden w-full md:table" : "table w-full";
  const stackedClass = layout === "auto" ? "md:hidden" : "";
  return (
    <div
      data-record-groups={mode}
      data-layout={layout}
      className="flex flex-col gap-6 font-hub text-hub-ink"
    >
      {ordered.map((g) => {
        const headingId = `${baseId}-${g.key}`;
        const title = C.groups[g.key];
        const note = groupNote(g.key, mode);
        const count = g.records.length;
        return (
          <section
            key={g.key}
            aria-labelledby={headingId}
            data-group={g.key}
            className="overflow-hidden rounded-lg border border-hub-border"
          >
            <header className="flex flex-wrap items-center justify-between gap-2 bg-hub-surface-2 px-4 py-2">
              <span className="flex flex-wrap items-baseline gap-2">
                <h3 id={headingId} className="text-base font-semibold">
                  {title}
                </h3>
                <span className="text-sm text-hub-ink-muted tabular-nums">
                  {C.groupCount(count)}
                </span>
              </span>
              {g.headerAction && !readOnly ? g.headerAction : null}
            </header>
            {note ? (
              <p className="px-4 pt-2 text-sm text-hub-ink-muted">{note}</p>
            ) : null}
            {count === 0 ? (
              <p className="px-4 py-4 text-sm text-hub-ink-muted">
                {emptyText(g.key, mode)}
              </p>
            ) : (
              <>
                {layout !== "stacked" ? (
                  <table className={`${tableClass} border-collapse text-left`}>
                    <caption className="sr-only">
                      {C.caption(title, count)}
                    </caption>
                    <thead>
                      <tr className="text-sm text-hub-ink-muted">
                        <th scope="col" className="px-4 py-2 font-semibold">
                          {C.colType}
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          {C.colName}
                        </th>
                        <th scope="col" className="px-4 py-2 font-semibold">
                          {C.colValue}
                        </th>
                        {showLast ? (
                          <th scope="col" className="px-4 py-2 font-semibold">
                            {lastColumn(mode)}
                          </th>
                        ) : null}
                        {showAction ? (
                          <th scope="col" className="px-4 py-2 font-semibold">
                            <span className="sr-only">{C.colAction}</span>
                          </th>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody>
                      {g.records.map((r) => (
                        <tr
                          key={r.key}
                          data-record-row={r.key}
                          className="min-h-12 border-t border-hub-border align-top"
                        >
                          <td className="px-4 py-4">
                            <Badge tone="role">{r.type}</Badge>
                          </td>
                          <td className="px-4 py-4 font-mono text-sm [overflow-wrap:anywhere]">
                            {displayRecordName(r.name, domain)}
                          </td>
                          <td className="px-4 py-4">
                            <RecordValue value={displayRecordValue(r)} />
                          </td>
                          {showLast ? (
                            <td className="px-4 py-4">
                              <LastCell row={r} mode={mode} />
                            </td>
                          ) : null}
                          {showAction ? (
                            <td className="px-4 py-4 text-right">
                              <RowAction
                                row={r}
                                domain={domain}
                                onRemove={onRemove}
                                onAskChange={onAskChange}
                              />
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
                {layout !== "table" ? (
                  <div className={stackedClass} data-stacked="">
                    {g.records.map((r) => (
                      <dl
                        key={r.key}
                        data-record-row={r.key}
                        className="flex min-h-12 flex-col gap-2 border-t border-hub-border px-4 py-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <dt className="sr-only">{C.colType}</dt>
                          <dd>
                            <Badge tone="role">{r.type}</Badge>
                          </dd>
                          <dt className="sr-only">{C.colName}</dt>
                          <dd className="font-mono text-sm [overflow-wrap:anywhere]">
                            {displayRecordName(r.name, domain)}
                          </dd>
                        </div>
                        <div>
                          <dt className="sr-only">{C.colValue}</dt>
                          <dd>
                            <RecordValue value={displayRecordValue(r)} />
                          </dd>
                        </div>
                        {showLast ? (
                          <div>
                            <dt className="sr-only">{lastColumn(mode)}</dt>
                            <dd>
                              <LastCell row={r} mode={mode} />
                            </dd>
                          </div>
                        ) : null}
                        {showAction ? (
                          <div>
                            <dt className="sr-only">{C.colAction}</dt>
                            <dd>
                              <RowAction
                                row={r}
                                domain={domain}
                                onRemove={onRemove}
                                onAskChange={onAskChange}
                              />
                            </dd>
                          </div>
                        ) : null}
                      </dl>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
