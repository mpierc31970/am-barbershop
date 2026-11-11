// Panel pipeline/fit: filled by 13-34
// Panel pipeline/fit (13-34 choice 2; STAFF-03, D26; 13-UI-SPEC "Fit holds" lines 632-645).
// `staffFitHolds` (oldest hold first), each row a disclosure with the FitCasePanel and the
// decisions. Approve fit / Decline fit are super_admin + step-up (fit_review); agents read the
// case and see SUPER-ONLY. A paid order declines through org:decline (full refund; the
// consequence line names the amount from `declineCase`), an unpaid hold through fit:review
// --decline. A failed read logs the class name only.
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { formatCentsExact } from "@cds/core/pricing";
import { declineCase, staffFitHolds, type StaffFitHold } from "@cds/db";
import { Badge } from "@cds/ui/hub";
import { FIT_VERDICT_TONE, PIPELINE_COPY, compactAge } from "@cds/ui/staff";
import { staffCan } from "../../../../../../lib/staff-session";
import type { StaffPanelProps } from "../../StaffAreaPage";
import { SitesLoadError } from "../../sites/SitesLoadError";
import { FitHoldItem, type FitHoldView } from "../PipelineActions";

const C = PIPELINE_COPY.fit;

function heldLabel(iso: string | null, now: Date): string | null {
  if (!iso) return null;
  const t = new Date(iso.replace(" ", "T"));
  if (Number.isNaN(t.getTime())) return null;
  return `${compactAge(t, now, BUSINESS_TIME_ZONE)} ago`;
}

export default async function Panel({ session }: StaffPanelProps) {
  const now = new Date();
  let holds: StaffFitHold[];
  try {
    holds = await staffFitHolds(session.ctx);
  } catch (err) {
    console.error(
      "[staff] fit holds read failed",
      err instanceof Error ? err.name : typeof err,
    );
    return <SitesLoadError href="/staff/pipeline?tab=fit" />;
  }
  if (holds.length === 0) {
    return (
      <p className="py-6 font-hub text-base text-hub-ink-muted">{C.empty}</p>
    );
  }
  const canDecide = staffCan(session.role, "fit_review");
  const canRefund = canDecide && staffCan(session.role, "org_decline");
  const views: FitHoldView[] = await Promise.all(
    holds.map(async (h) => {
      let refund: string | null = null;
      let refundUnknown = false;
      if (canRefund) {
        try {
          const c = await declineCase(session.ctx, h.orgId, {
            now: () => now,
          });
          if (c.paidAt && c.refundableCents > 0) {
            refund = formatCentsExact(c.refundableCents);
          }
        } catch (err) {
          // CR-D02: fail closed. An unknown payment state never defaults to the unpaid
          // decline (no refund); Decline stays off until the read works. declineFit also
          // refuses a paid org server-side.
          refundUnknown = true;
          console.error(
            "[staff] decline case read failed",
            err instanceof Error ? err.name : typeof err,
          );
        }
      }
      return {
        orgId: h.orgId,
        name: h.name,
        businessType: h.businessType,
        description: h.description,
        verdict: h.verdict,
        reasons: h.reasons,
        fields: h.fields,
        heldSince: heldLabel(h.heldSince, now),
        fingerprint: h.fingerprint,
        refund,
        refundUnknown,
      };
    }),
  );
  return (
    <ul aria-label={C.caption} className="flex flex-col gap-3">
      {views.map((h, i) => (
        <li
          key={h.orgId}
          className="rounded border border-hub-border bg-hub-surface"
        >
          <details open={i === 0} className="group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 rounded p-4 font-hub text-hub-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent">
              <span className="text-base font-semibold">
                {h.name || h.orgId}
              </span>
              <Badge tone={FIT_VERDICT_TONE[h.verdict]}>
                {C.verdicts[h.verdict]}
              </Badge>
              {h.heldSince ? (
                <span className="text-sm text-hub-ink-muted tabular-nums">
                  {`${C.heldSince}: ${h.heldSince}`}
                </span>
              ) : null}
            </summary>
            <div className="border-t border-hub-border p-4">
              <FitHoldItem hold={h} canDecide={canDecide} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}
