// Panel pipeline/polish: filled by 13-34
// Panel pipeline/polish (13-34 choice 4; STAFF-04, D29; 13-UI-SPEC "Polish queue" lines 655-664).
// `staffPolishQueue` (assembled being_built sites, oldest assembly first). Each row: business,
// assembled age, unfilled slots, items to polish, build note, View preview (new tab), and a
// disclosure with the SlotReport (unfilled first) plus the report's polish items; footer
// primary "Mark ready for owner review" → "Send to review" (super_admin; agents SUPER-ONLY).
// The row leaves the list on success (revalidated). A failed read logs the class name only.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { staffPolishQueue, type StaffPolishRow } from "@cds/db";
import { PIPELINE_COPY, SlotReport, compactAge } from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { MarkReadyButton, PreviewLink } from "../PipelineActions";

const C = PIPELINE_COPY.polish;

function ago(iso: string | null, now: Date): string {
  if (!iso) return PIPELINE_COPY.none;
  const t = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return PIPELINE_COPY.none;
  return `${compactAge(t, now, BUSINESS_TIME_ZONE)} ago`;
}

function Fact({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="text-sm">
      <span className="text-hub-ink-muted">{`${label}: `}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export default async function Panel({ session }: StaffPanelProps) {
  let rows: StaffPolishRow[];
  try {
    rows = await staffPolishQueue(session.ctx);
  } catch (err) {
    console.error(
      "[staff] polish queue read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href="/staff/pipeline?tab=polish" />;
  }
  if (rows.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">{C.empty}</p>
    );
  }
  const now = new Date();
  const canStage = staffCan(session.role, "org_stage");
  return (
    <ul className="flex flex-col gap-3 font-hub text-hub-ink">
      {rows.map((r) => {
        const business = r.name || r.orgId;
        return (
          <li
            key={r.orgId}
            className="flex flex-col gap-3 rounded border border-hub-border bg-hub-surface p-4"
          >
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <a
                href={`/staff/sites/${r.orgId}`}
                className="rounded text-base font-semibold underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
              >
                {business}
              </a>
              <Fact label={C.assembled} value={ago(r.assembledAt, now)} />
              <Fact label={C.unfilled} value={r.unfilled} />
              <Fact label={C.toPolish} value={r.toPolish} />
              <span className="ml-auto">
                <PreviewLink url={r.previewUrl} label={C.viewPreview} />
              </span>
            </div>
            {r.buildNote ? (
              <p className="text-sm">
                <span className="text-hub-ink-muted">{`${C.notes}: `}</span>
                {r.buildNote}
              </p>
            ) : null}
            <details>
              <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
                {C.slotsFor(business)}
              </summary>
              <div className="flex flex-col gap-3 pt-3">
                <SlotReport slots={r.slots} caption={C.slotsFor(business)} />
                {r.polish.length > 0 ? (
                  <ul className="list-disc pl-5 text-sm">
                    {r.polish.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </details>
            <div className="flex justify-end">
              <MarkReadyButton
                orgId={r.orgId}
                business={business}
                canStage={canStage}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
