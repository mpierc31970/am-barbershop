// GateFinding (14-30 choice 3; 14-UI-SPEC "S2 · Before you switch"; D-UI-P14-5). One
// finding in the InlineAlert shape at Body size: Body 600 title, Body text, then the fix
// (the caller's children: RegistrarSteps, a checkbox row, buttons). Owner-action findings
// (DNSSEC, two SPF, forwarding, parking) are warning, never red before a switch; the
// mail-records-incomplete finding is info; the CDS-review finding is info with the CdsAuthor
// byline and "We'll email you when it's done.". Hard blocks (DNSSEC, two SPF, or any finding
// the caller marks `hardBlock`) say "This step can't be skipped." in text. All words come
// from P14_COPY. Server-safe.
import { P14_COPY } from "@cds/core/dns";
import { Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { CdsAuthor } from "../cds/CdsAuthor";
import { DOMAIN_UI_COPY as C } from "./copy";

export type OwnerFindingKind =
  | "dnssec"
  | "spf"
  | "email_forwarding"
  | "web_forwarding"
  | "parking"
  | "mail_incomplete"
  | "cds_review";

/** Owner view of one open gate finding (no record values, no rule ids). */
export interface OwnerGateFinding {
  kind: OwnerFindingKind;
  /** SPF record count (spf) or records under review (cds_review). */
  count?: number;
  /** Mail provider display name (mail_incomplete). */
  provider?: string;
  /** Force the hard-block line (DNSSEC and two SPF always have it). */
  hardBlock?: boolean;
  /** Staff first name for the CdsAuthor byline (cds_review); blank shows "CDS". */
  cdsName?: string;
}

export interface GateFindingProps {
  finding: OwnerGateFinding;
  /** Registrar owner display name ("GoDaddy", "your registrar"). */
  registrar: string;
  /** The fix: steps, checkbox row, buttons. */
  children?: ReactNode;
}

const HARD: ReadonlySet<OwnerFindingKind> = new Set(["dnssec", "spf"]);

function words(
  f: OwnerGateFinding,
  registrar: string,
): { title: string; body: string } {
  switch (f.kind) {
    case "dnssec":
      return {
        title: P14_COPY.FIND_DNSSEC_T({ registrar }),
        body: P14_COPY.FIND_DNSSEC_B({ registrar }),
      };
    case "spf":
      return {
        title: P14_COPY.FIND_SPF_T({ count: f.count ?? 2 }),
        body: P14_COPY.FIND_SPF_B,
      };
    case "email_forwarding":
      return {
        title: P14_COPY.FIND_FWD_T({ registrar }),
        body: P14_COPY.FIND_FWD_B({ registrar }),
      };
    case "web_forwarding":
    case "parking":
      return {
        title: P14_COPY.FIND_WEBFWD_T({ registrar }),
        body: P14_COPY.FIND_WEBFWD_B({ registrar }),
      };
    case "mail_incomplete":
      return {
        title: P14_COPY.FIND_G2_T({ provider: f.provider ?? "email" }),
        body: P14_COPY.FIND_G2_B,
      };
    case "cds_review":
      return {
        title: P14_COPY.FIND_CDS_T({ count: f.count ?? 1 }),
        body: P14_COPY.FIND_CDS_B({ registrar }),
      };
  }
}

export function GateFinding({
  finding,
  registrar,
  children,
}: GateFindingProps) {
  const { title, body } = words(finding, registrar);
  const info =
    finding.kind === "mail_incomplete" || finding.kind === "cds_review";
  const hard = finding.hardBlock ?? HARD.has(finding.kind);
  const Icon = info ? Info : TriangleAlert;
  return (
    <div
      data-finding={finding.kind}
      data-tone={info ? "info" : "warning"}
      className={
        "flex items-start gap-3 rounded border p-4 font-hub text-base " +
        (info
          ? "border-hub-border bg-hub-surface-2 text-hub-ink"
          : "border-hub-warning bg-hub-warning-tint text-hub-warning")
      }
    >
      <Icon aria-hidden size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 text-hub-ink">
        <div className="flex flex-col gap-1">
          {finding.kind === "cds_review" ? (
            <span data-cds-identity="">
              <CdsAuthor firstName={finding.cdsName} />
            </span>
          ) : null}
          <p className="font-semibold">{title}</p>
          <p className="max-w-[68ch]">{body}</p>
        </div>
        {children}
        {finding.kind === "cds_review" ? (
          <p className="text-sm text-hub-ink-muted">{P14_COPY.FIND_CDS_WAIT}</p>
        ) : null}
        {hard ? (
          <p data-hard-block="" className="text-sm text-hub-ink-muted">
            {C.hardBlock}
          </p>
        ) : null}
      </div>
    </div>
  );
}
