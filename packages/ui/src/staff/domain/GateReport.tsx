"use client";
// GateReport (14-38 choice 2; DOM-05, D58, D288; 14-UI-SPEC "GateReport"). Heading **Gate
// report**, the GateRuleList, then the records table grouped Email · Verification · Site ·
// Other (email first): Type · Name · Original · Copy (read from assigned NS) · Source (`zone
// file` / `scan` / `sweep`, several allowed) · Result (`g-*` badge with its word). A
// SegmentedControl **Problems · All** filters it (Problems by default when any record is a
// mismatch or missing, else All). Footer Label "Snapshot 10 Oct 09:02 · 49 records · read back
// from ada.ns.cloudflare.com".
// `mode: "reverse"` (14-43 handback): Original = **CDS zone**, Copy = **Destination answers**,
// and only G1 shows (G2-G7 are forward-only). Every value is a text node (T-14-38-01).
import { useId, useState } from "react";
import { Badge } from "../../hub/Badge";
import { SegmentedControl } from "../../hub/SegmentedControl";
import {
  DOMAIN_TABLE as T,
  RECORD_RESULT_TONE,
  STAFF_DOMAIN_COPY,
  formatDomainWhen,
  type StaffDomainOverrideAction,
  type StaffGateRecordData,
  type StaffGateRecordGroup,
  type StaffGateRuleData,
} from "./copy";
import { GateRuleList } from "./GateRuleList";

const C = STAFF_DOMAIN_COPY.gate;

export interface GateReportData {
  rules: readonly StaffGateRuleData[];
  records: readonly StaffGateRecordData[];
  snapshotAt: string;
  recordCount: number;
  readBackFrom: string | null;
}

export interface GateReportProps {
  mode: "forward" | "reverse";
  orgId: string;
  domain: string;
  gate: GateReportData | null;
  canSuper: boolean;
  override?: StaffDomainOverrideAction;
  timeZone?: string;
  /** Heading override (14-43 may call it "Handback check"). */
  heading?: string;
}

const GROUPS: readonly StaffGateRecordGroup[] = [
  "email",
  "verification",
  "site",
  "other",
];

export function isGateProblem(r: StaffGateRecordData): boolean {
  return r.result === "mismatch" || r.result === "missing";
}

export function GateReport({
  mode,
  orgId,
  domain,
  gate,
  canSuper,
  override,
  timeZone,
  heading,
}: GateReportProps) {
  const headingId = useId();
  const reverse = mode === "reverse";
  const hasProblems = gate ? gate.records.some(isGateProblem) : false;
  const [filter, setFilter] = useState<"problems" | "all">(
    hasProblems ? "problems" : "all",
  );

  if (!gate) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-4 font-hub"
      >
        <h2 id={headingId} className="text-xl font-semibold text-hub-ink">
          {heading ?? C.heading}
        </h2>
        <p className="text-base text-hub-ink-muted">{C.noSnapshot}</p>
      </section>
    );
  }

  const rules = reverse
    ? gate.rules.filter((r) => r.rule === "G1")
    : gate.rules;
  const shown =
    filter === "problems" ? gate.records.filter(isGateProblem) : gate.records;
  const originalLabel = reverse ? C.reverseOriginal : C.original;
  const copyLabel = reverse ? C.reverseCopy : C.copy;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-4 font-hub"
      data-gate-report={mode}
    >
      <h2 id={headingId} className="text-xl font-semibold text-hub-ink">
        {heading ?? C.heading}
      </h2>
      {rules.length > 0 ? (
        <GateRuleList
          orgId={orgId}
          domain={domain}
          rules={rules}
          canSuper={canSuper}
          override={reverse ? undefined : override}
        />
      ) : null}
      <div className="w-56">
        <SegmentedControl<"problems" | "all">
          name="gate-filter"
          label={C.filter}
          options={[
            { value: "problems", label: C.problems },
            { value: "all", label: C.all },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-hub-ink-muted" role="status">
          {gate.records.length === 0 ? C.noRecords : C.noProblems}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className={T.table} data-gate-records="">
            <caption className="sr-only">{C.recordsCaption}</caption>
            <thead>
              <tr className={T.headRow}>
                <th scope="col" className={T.th}>
                  {C.type}
                </th>
                <th scope="col" className={T.th}>
                  {C.name}
                </th>
                <th scope="col" className={T.th}>
                  {originalLabel}
                </th>
                <th scope="col" className={T.th}>
                  {copyLabel}
                </th>
                <th scope="col" className={T.th}>
                  {C.source}
                </th>
                <th scope="col" className={T.th}>
                  {C.result}
                </th>
              </tr>
            </thead>
            {GROUPS.map((g) => {
              const rows = shown.filter((r) => r.group === g);
              if (rows.length === 0) return null;
              return (
                <tbody key={g} data-group={g}>
                  <tr className="border-b border-hub-border">
                    <th
                      scope="rowgroup"
                      colSpan={6}
                      className="px-4 pt-4 pb-2 text-left text-sm font-semibold text-hub-ink-muted"
                    >
                      {C.groups[g]}
                    </th>
                  </tr>
                  {rows.map((r, i) => (
                    <tr
                      key={`${r.type}:${r.name}:${r.original ?? ""}:${r.copy ?? ""}:${i}`}
                      className={T.row}
                      data-result={r.result}
                    >
                      <td className={T.td}>{r.type}</td>
                      <td className={`${T.td} ${T.value}`}>{r.name}</td>
                      <td className={`${T.td} ${T.value}`}>
                        {r.original ?? C.none}
                      </td>
                      <td className={`${T.td} ${T.value}`}>
                        {r.copy ?? C.none}
                      </td>
                      <td className={T.td}>
                        {r.sources.map((s) => C.sources[s]).join(", ") ||
                          C.none}
                      </td>
                      <td className={T.td}>
                        <Badge tone={RECORD_RESULT_TONE[r.result]}>
                          {C.results[r.result]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
      )}
      <p
        className="text-sm text-hub-ink-muted tabular-nums"
        data-gate-footer=""
      >
        {C.footer(
          formatDomainWhen(gate.snapshotAt, timeZone),
          gate.recordCount,
          gate.readBackFrom,
          reverse,
        )}
      </p>
    </section>
  );
}
