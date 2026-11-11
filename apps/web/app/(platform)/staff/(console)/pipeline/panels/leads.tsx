// Panel pipeline/leads: filled by 13-34
// Panel pipeline/leads (13-34 choice 1; STAFF-01, D28, P13-P22; 13-UI-SPEC "Leads" lines
// 615-630; T-13-34-02). One `staffLeads({ since })` read; filters are URL params (a filtered
// view is a link): since = 7d | 30d | all (default 30d), stage = a LEAD_STAGE_CHIPS id,
// abandoned=1. Stage chips count the rows in the time range; "Only abandoned" sorts oldest
// first, otherwise newest activity first. Emails arrive masked from the read model; the full
// address only through Reveal email (audited). A failed read logs the class name only.
// 15-07 (A3-Q2): hub /contact inquiries join the same table (`staffInquiryLeads`, same time
// range): stage text "Contact form · <topic>", Lead column "Contact form", masked email with
// Reveal. They carry no stage chip and are never abandoned, so a stage or abandoned filter
// hides them. The message body is never shown (the staff email carries it).
import { LEAD_STAGE_CHIPS, type LeadStageChip } from "@cds/core/staff";
import {
  staffInquiryLeads,
  staffLeads,
  type StaffInquiryLeadRow,
  type StaffLeadRow,
  type StaffLeadsSince,
} from "@cds/db";
import {
  PIPELINE_COPY,
  QuickFilters,
  StageChips,
  type PipelineLeadsSince,
} from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { LeadsTable, type LeadView } from "../PipelineActions";

const C = PIPELINE_COPY.leads;
/** Inquiry label (15-07 choice 2); staff console words, not marketing copy. */
export const CONTACT_FORM_LABEL = "Contact form";
const SINCE: readonly PipelineLeadsSince[] = ["7d", "30d", "all"];

export type LeadsParams = {
  since: StaffLeadsSince;
  stage: LeadStageChip | "";
  abandoned: boolean;
};

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

/** Untrusted URL params → a closed filter (unknown values read as the default). */
export function parseLeadsParams(
  params: StaffPanelProps["params"],
): LeadsParams {
  const rawSince = one(params.since);
  const since = (SINCE as readonly string[]).includes(rawSince)
    ? (rawSince as StaffLeadsSince)
    : "30d";
  const rawStage = one(params.stage);
  const stage = LEAD_STAGE_CHIPS.some((c) => c.id === rawStage)
    ? (rawStage as LeadStageChip)
    : "";
  return { since, stage, abandoned: one(params.abandoned) === "1" };
}

export function leadsHref(p: LeadsParams): string {
  const qs = new URLSearchParams({ tab: "leads" });
  if (p.since !== "30d") qs.set("since", p.since);
  if (p.stage) qs.set("stage", p.stage);
  if (p.abandoned) qs.set("abandoned", "1");
  return `/staff/pipeline?${qs.toString()}`;
}

function toTime(iso: string): number {
  const t = new Date(iso.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Stage + abandoned filter, then the UI-SPEC sort. */
export function filterLeads(
  rows: readonly StaffLeadRow[],
  p: LeadsParams,
): StaffLeadRow[] {
  const kept = rows.filter(
    (r) => (!p.stage || r.stage === p.stage) && (!p.abandoned || r.abandoned),
  );
  return kept.sort((a, b) =>
    p.abandoned
      ? toTime(a.lastActivity) - toTime(b.lastActivity)
      : toTime(b.lastActivity) - toTime(a.lastActivity),
  );
}

const STAGE_LABEL = new Map<string, string>(
  LEAD_STAGE_CHIPS.map((c) => [c.id, c.label]),
);

function toView(r: StaffLeadRow): LeadView {
  return {
    id: r.id,
    orgId: r.orgId,
    business: r.business,
    stageLabel: STAGE_LABEL.get(r.stage) ?? r.stage,
    path: r.path,
    abandoned: r.abandoned,
    abandonedDays: r.abandonedDays,
    lastActivity: r.lastActivity,
    emailMasked: r.emailMasked,
  };
}

function inquiryView(r: StaffInquiryLeadRow): LeadView {
  return {
    id: r.id,
    orgId: null,
    business: r.business,
    stageLabel: `${CONTACT_FORM_LABEL} · ${r.topicLabel}`,
    path: "",
    abandoned: false,
    abandonedDays: 0,
    lastActivity: r.lastActivity,
    emailMasked: r.emailMasked,
    noOrgLabel: CONTACT_FORM_LABEL,
  };
}

/** Lead rows plus inquiries (only when no stage / abandoned filter), in the panel's order. */
export function mergeLeadViews(
  rows: readonly StaffLeadRow[],
  inquiries: readonly StaffInquiryLeadRow[],
  p: LeadsParams,
): LeadView[] {
  const views = filterLeads(rows, p).map(toView);
  if (p.stage || p.abandoned || inquiries.length === 0) return views;
  return [...views, ...inquiries.map(inquiryView)].sort(
    (a, b) => toTime(b.lastActivity) - toTime(a.lastActivity),
  );
}

export default async function Panel({ session, params }: StaffPanelProps) {
  const p = parseLeadsParams(params);
  const now = new Date();
  let rows: StaffLeadRow[];
  let inquiries: StaffInquiryLeadRow[];
  try {
    // 15 WR-A04: inquiries are additive, so their failure (e.g. hub_inquiries not yet
    // migrated on prod, or any read error) drops only the inquiry rows, never the quotes
    // and in-setup sites. Both reads still run in parallel.
    [rows, inquiries] = await Promise.all([
      staffLeads(session.ctx, { since: p.since, now }),
      staffInquiryLeads(session.ctx, { since: p.since, now }).catch(
        (err: unknown): StaffInquiryLeadRow[] => {
          console.error(
            "[staff] inquiry leads read failed",
            err instanceof Error ? err.name : typeof err,
          );
          return [];
        },
      ),
    ]);
  } catch (err) {
    console.error(
      "[staff] leads read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href={leadsHref(p)} />;
  }
  const shown = mergeLeadViews(rows, inquiries, p);
  const abandonedCount = rows.filter((r) => r.abandoned).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <QuickFilters
          label={C.since}
          items={SINCE.map((s) => ({
            id: s,
            label: C.sinceOptions[s],
            href: leadsHref({ ...p, since: s }),
            pressed: p.since === s,
          }))}
        />
        <QuickFilters
          label={C.filters}
          items={[
            {
              id: "abandoned",
              label: C.onlyAbandoned,
              href: leadsHref({ ...p, abandoned: !p.abandoned }),
              pressed: p.abandoned,
              count: abandonedCount,
            },
          ]}
        />
      </div>
      <StageChips
        label={C.stages}
        stages={LEAD_STAGE_CHIPS.map((c) => ({
          id: c.id,
          label: c.label,
          count: rows.filter((r) => r.stage === c.id).length,
          href: leadsHref({ ...p, stage: p.stage === c.id ? "" : c.id }),
          pressed: p.stage === c.id,
        }))}
      />
      <LeadsTable
        rows={shown}
        now={now.toISOString()}
        canReveal={staffCan(session.role, "lead_reveal")}
      />
      <p className="font-hub text-sm text-hub-ink-muted tabular-nums">
        {C.summary(shown.length, shown.filter((r) => r.abandoned).length)}
      </p>
    </div>
  );
}
