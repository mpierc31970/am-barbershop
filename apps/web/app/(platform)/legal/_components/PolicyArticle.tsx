// One public policy page (09-09; 09-UI-SPEC "Public policy pages"; CONTEXT A3-Q4, D215).
// H1 Display title, Label meta line, DRAFT-PUBLIC warning while draft, the past-version info
// alert, the In short box, then the full text. Side <nav aria-label="Policies">: sticky at
// >= 1024px, under the text below that (DOM order).
//
// SECURITY (T-09-09-01): bodyHtml is the codegen-rendered, sanitised text compiled into
// POLICY_SET; nothing on this page comes from a request except the resolved key/version.
import { activePolicyVersions } from "@cds/core/legal";
import { InlineAlert } from "@cds/ui/hub";
import { LegalProse } from "@cds/ui/hub/legal";
import Link from "next/link";
import { formatLegalDate, type LegalPage } from "../../../../lib/legal-pages";

export const DRAFT_PUBLIC =
  "Draft: this text hasn't been reviewed by a lawyer yet and will change before it takes effect.";

const NAV_LINK =
  "inline-flex min-h-11 items-center text-base underline-offset-4";

function PolicyNav({ page }: { page: LegalPage }) {
  const { policy, current, earlier } = page;
  return (
    <nav
      aria-label="Policies"
      className="flex flex-col gap-6 lg:sticky lg:top-24 lg:self-start"
    >
      <ul className="flex flex-col">
        {activePolicyVersions().map((p) => (
          <li key={p.key}>
            {p.key === policy.key ? (
              <Link
                href={`/legal/${p.key}`}
                aria-current="page"
                className={`${NAV_LINK} font-semibold text-hub-ink`}
              >
                {p.title}
              </Link>
            ) : (
              <Link
                href={`/legal/${p.key}`}
                className={`${NAV_LINK} text-hub-accent hover:underline`}
              >
                {p.title}
              </Link>
            )}
          </li>
        ))}
      </ul>
      {earlier.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Earlier versions</h2>
          <ul className="flex flex-col text-sm tabular-nums">
            {earlier.map((e) => (
              <li key={e.version}>
                <Link
                  href={`/legal/${current.key}/v${e.version}`}
                  aria-current={
                    e.version === policy.version ? "page" : undefined
                  }
                  className="inline-flex min-h-11 items-center text-hub-accent underline-offset-4 hover:underline"
                >
                  Version {e.version} · until {formatLegalDate(e.until)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

export function PolicyArticle({ page }: { page: LegalPage }) {
  const { policy, isCurrent, replacedOn } = page;
  return (
    <div className="grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,68ch)_240px] lg:justify-between">
      <article className="flex min-w-0 flex-col gap-4">
        <h1 className="text-[1.75rem] leading-[1.2] font-semibold">
          {policy.title}
        </h1>
        <p className="text-sm text-hub-ink-muted tabular-nums">
          Version {policy.version} · Effective{" "}
          {formatLegalDate(policy.effectiveAt)}
        </p>
        {policy.draft ? (
          <InlineAlert tone="warning">{DRAFT_PUBLIC}</InlineAlert>
        ) : null}
        {!isCurrent && replacedOn ? (
          <InlineAlert
            tone="info"
            action={
              <Link
                href={`/legal/${policy.key}`}
                className="text-hub-accent underline underline-offset-4"
              >
                Read the current version
              </Link>
            }
          >
            This is version {policy.version}. It was replaced on{" "}
            {formatLegalDate(replacedOn)}.
          </InlineAlert>
        ) : null}
        <section
          aria-labelledby="in-short"
          className="rounded-lg bg-hub-surface-2 p-6"
        >
          <h2 id="in-short" className="text-xl leading-tight font-semibold">
            In short
          </h2>
          <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-base">
            {policy.summary.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <LegalProse html={policy.bodyHtml} className="mt-4" />
      </article>
      <PolicyNav page={page} />
    </div>
  );
}
