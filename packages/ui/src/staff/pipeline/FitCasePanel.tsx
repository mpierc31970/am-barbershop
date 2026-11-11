// FitCasePanel (13-34 choice 2; STAFF-03, D26; 13-UI-SPEC "Fit holds" lines 632-645). The held
// signup's case as the fit:review CLI prints it (describeFitCase): business, type, the screened
// text with the matched terms marked (`<mark>` on the warning tint), the screening verdict,
// why it was held and how long ago. A blocked verdict carries the override label. Server-safe
// (no hooks): the action island passes the Approve / Decline buttons as `actions`. Tenant text
// is React text only, never markup.
import type { ReactNode } from "react";
import { Badge } from "../../hub/Badge";
import {
  FIT_VERDICT_TONE,
  PIPELINE_COPY,
  fitTerms,
  highlightParts,
  type FitVerdictView,
} from "./copy";

const C = PIPELINE_COPY.fit;

export interface FitCaseView {
  orgId: string;
  name: string;
  businessType: string;
  description: string;
  verdict: FitVerdictView;
  reasons: readonly string[];
  /** The screened public text fields (name, description, other business type). */
  fields: readonly { field: string; text: string }[];
  /** "2 business days" / "3d" — already formatted by the caller. */
  heldSince: string | null;
}

export interface FitCasePanelProps {
  hold: FitCaseView;
  /** Href for "Open the site" (site detail); omitted = no link. */
  siteHref?: string;
  /** Approve / Decline (client island). */
  actions?: ReactNode;
}

function Marked({ text, terms }: { text: string; terms: readonly string[] }) {
  return (
    <>
      {highlightParts(text, terms).map((p, i) =>
        p.match ? (
          <mark
            key={i}
            className="rounded-sm bg-hub-warning-tint px-0.5 text-hub-ink"
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function FitCasePanel({ hold, siteHref, actions }: FitCasePanelProps) {
  const terms = fitTerms(hold.reasons);
  const rows: [string, ReactNode][] = [
    [C.business, hold.name || PIPELINE_COPY.none],
    [C.type, hold.businessType || PIPELINE_COPY.none],
  ];
  for (const f of hold.fields) {
    if (f.text.trim() === "") continue;
    rows.push([f.field, <Marked key={f.field} text={f.text} terms={terms} />]);
  }
  if (
    hold.description &&
    !hold.fields.some((f) => f.text === hold.description)
  ) {
    rows.push([
      C.description,
      <Marked key="description" text={hold.description} terms={terms} />,
    ]);
  }
  rows.push([
    C.verdict,
    <Badge key="verdict" tone={FIT_VERDICT_TONE[hold.verdict]}>
      {C.verdicts[hold.verdict]}
    </Badge>,
  ]);
  rows.push([
    C.reasons,
    hold.reasons.length > 0 ? (
      <ul key="reasons" className="flex flex-col gap-1">
        {hold.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    ) : (
      PIPELINE_COPY.none
    ),
  ]);
  rows.push([C.heldSince, hold.heldSince ?? PIPELINE_COPY.none]);

  return (
    <section
      aria-label={`${hold.name || hold.orgId}: fit case`}
      className="flex flex-col gap-4 font-hub text-hub-ink"
    >
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded border border-hub-border bg-hub-surface-2 p-4 text-sm sm:grid-cols-[max-content_1fr]">
        {rows.map(([label, value], i) => (
          <div key={`${label}-${i}`} className="contents">
            <dt className="text-hub-ink-muted">{label}</dt>
            <dd className="min-w-0 break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {hold.verdict === "blocked" ? (
        <p className="text-sm text-hub-ink-muted">{C.blockedLabel}</p>
      ) : null}
      {siteHref || actions ? (
        <div className="flex flex-wrap items-center gap-3">
          {actions}
          {siteHref ? (
            <a
              href={siteHref}
              className="rounded text-sm font-semibold text-hub-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
            >
              {C.openIntake}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
