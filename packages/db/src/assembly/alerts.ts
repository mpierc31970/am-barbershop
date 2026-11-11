// P8 (08-10): staff hand-off emails (TMPL-04, CONTEXT A4-Q1, A2-Q4); no PII: business name,
// org id, URLs and slot statuses only.
//
// The orchestrator (08-16) turns an AssemblyReport into `site.assembled` data here and sends
// it, or sends `site.assembly_failed` after 3 tries. Mail goes to the staff alert recipient
// as CDS through the one send path, so the logged-not-sent transport stand-in applies until
// SES. Logs carry the error name only, never the recipient or the error message.
import {
  SOURCE_WORDS,
  slotLabel,
  type AssemblyReport,
  type SlotReportLine,
} from "@cds/core/templates";
import { mintSystemContext } from "../context";
import type { EmailData } from "../email/render/templates";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import { staffAlertAddress, type AlertStatus } from "../media/ops/alerts";

export type SiteAssembledData = EmailData["site.assembled"];
export type SiteAssemblyFailedData = EmailData["site.assembly_failed"];

export type AssembledMeta = {
  businessName: string;
  pathLabel: string;
  businessTypeLabel: string;
  orgId: string;
  assembledAt: Date;
  pages: { label: string; url: string }[];
};

function withNote(line: SlotReportLine): string {
  const label = slotLabel(line.slot);
  return line.note ? `${label} (${line.note})` : label;
}

/**
 * Report lines → email lines (08-10 choice 2). To polish: each fallback slot as
 * "{Label} · Default used · {note}", then report.polish verbatim. Filled: "{Label}" or
 * "{Label} ({note})". Left out: "{Label} ({note})".
 */
export function assembledEmailData(
  report: AssemblyReport,
  meta: AssembledMeta,
): SiteAssembledData {
  const polish: string[] = [];
  const filled: string[] = [];
  const leftOut: string[] = [];
  for (const line of report.slots) {
    if (line.source === "fallback") {
      polish.push(
        [slotLabel(line.slot), SOURCE_WORDS.fallback, line.note]
          .filter(Boolean)
          .join(" · "),
      );
    } else if (line.source === "provided") {
      filled.push(withNote(line));
    } else {
      leftOut.push(withNote(line));
    }
  }
  polish.push(...report.polish);
  return {
    businessName: meta.businessName,
    pathLabel: meta.pathLabel,
    businessTypeLabel: meta.businessTypeLabel,
    templateId: report.templateId,
    templateVersion: report.templateVersion,
    assembledAt: meta.assembledAt,
    orgId: meta.orgId,
    pages: meta.pages.map((p) => ({ label: p.label, url: p.url })),
    polish,
    filled,
    leftOut,
  };
}

type SendFn = typeof sendEmail;
export type AssemblyAlertDeps = { transport?: EmailTransport; send?: SendFn };

async function sendStaff<T extends "site.assembled" | "site.assembly_failed">(
  type: T,
  data: EmailData[T],
  deps: AssemblyAlertDeps,
): Promise<{ status: AlertStatus }> {
  const to = staffAlertAddress();
  if (!to) {
    console.warn(`[assembly] ${type} not sent: no staff recipient configured`);
    return { status: "skipped" };
  }
  try {
    const r = await (deps.send ?? sendEmail)(
      { kind: "cds", ctx: mintSystemContext({ job: "assembly" }) },
      type,
      to,
      data,
      { transport: deps.transport },
    );
    if (r.status === "sent") return { status: "sent" };
    console.warn(`[assembly] ${type} not sent: staff recipient suppressed`);
    return { status: "skipped" };
  } catch (err) {
    const name = err instanceof Error ? err.name : "error";
    console.error(`[assembly] ${type} failed: ${name}`);
    return { status: "failed" };
  }
}

export async function sendSiteAssembled(
  data: SiteAssembledData,
  deps: AssemblyAlertDeps = {},
): Promise<{ status: AlertStatus }> {
  return sendStaff("site.assembled", data, deps);
}

export async function sendSiteAssemblyFailed(
  data: SiteAssemblyFailedData,
  deps: AssemblyAlertDeps = {},
): Promise<{ status: AlertStatus }> {
  return sendStaff("site.assembly_failed", data, deps);
}
