// Tenant Privacy policy / Terms page body (09-22; AGR-08, D217, D-UI-P9-8; 09-UI-SPEC "Tenant
// policy pages"; invariant 7).
//
// The one H1 (PageTitleHeader), then inside the 1120px container a 68ch left-aligned column:
// "Last updated {date}" (body, text-muted), the Draft box while the template is draft
// (surface-raised, 2px border, radius-media, text 600), then the policy HTML mapped to the
// site roles: <h2> --site-text-h2, <h3> --site-text-h3, everything else --site-text-body,
// links primary. Only --site-* roles; no accent, no new contrast pairs.
//
// SECURITY (T-09-22-01): `html` MUST already be sanitised (apps/web site-policy-pages runs
// sanitizeLegalHtml over renderSitePolicy's escaped output). This component never parses or
// sanitises; it only injects what it is given. Server component: no hooks, zero client JS.
import { PageTitleHeader } from "./PageTitleHeader";
import { BODY_CLASS } from "./types";
import { text } from "./urls";

export const POLICY_DRAFT_TEXT =
  "Draft: this page is a starting template and has not been reviewed by a lawyer.";

export interface PolicyPageProps {
  title: string;
  /** Already formatted, e.g. "8 Oct 2026". */
  lastUpdatedLabel: string;
  /** Sanitised legal HTML. */
  html: string;
  draft: boolean;
}

const PROSE = [
  "flex flex-col gap-4 text-site-text",
  BODY_CLASS,
  "[&_h2]:mt-6 [&_h2]:text-[length:var(--site-text-h2)] [&_h2]:font-semibold [&_h2]:leading-[1.2] [&_h2]:text-balance",
  "[&_h3]:mt-2 [&_h3]:text-[length:var(--site-text-h3)] [&_h3]:font-semibold [&_h3]:leading-[1.3]",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li+li]:mt-2",
  "[&_strong]:font-semibold",
  "[&_a]:text-site-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:break-words",
].join(" ");

export function PolicyPage({
  title,
  lastUpdatedLabel,
  html,
  draft,
}: PolicyPageProps) {
  return (
    <>
      <PageTitleHeader title={title} />
      <div className="mx-auto max-w-[1120px] px-6 pb-16 md:px-8">
        <div className="flex max-w-[68ch] flex-col gap-6">
          <p className={`${BODY_CLASS} text-site-text-muted`}>
            {text(`Last updated ${lastUpdatedLabel}`)}
          </p>
          {draft ? (
            <div
              role="note"
              data-policy-draft=""
              className={`rounded-site-media border-2 border-site-border bg-site-surface-raised p-4 font-semibold text-site-text ${BODY_CLASS}`}
            >
              <p>{POLICY_DRAFT_TEXT}</p>
            </div>
          ) : null}
          <div
            data-policy-body=""
            className={PROSE}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </div>
      </div>
    </>
  );
}
