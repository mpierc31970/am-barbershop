// SeoHealthPanel (11-33; D188, DASH-11; 11-UI-SPEC "Reports" section 5). "82 out of 100 ·
// Good" (score Heading 20/600 tabular + word badge), then up to three Top fixes in an <ol>
// (priority order carries meaning), each with "Fix on {page}" opening that page's SEO
// drawer. All clear: "Nothing to fix right now." Shows before launch too (D-UI-P11-15).
// Server-safe; types only from @cds/core.
import type { SeoFix } from "@cds/core/analytics";
import type { HubLinkComponent } from "../AddonCard";
import { Badge } from "../Badge";
import { REPORTS_COPY, seoWord } from "./copy";

export interface SeoHealthPanelProps {
  score: number;
  fixes: readonly SeoFix[];
  /** Pre-formatted "3 Oct, 9:40 AM" (the manifest time); omit to hide the line. */
  checkedAt?: string;
  /** Page id -> title, for the "Fix on {page}" link. */
  pageNames?: Readonly<Record<string, string>>;
  /** Href of a page's SEO drawer; null hides the link (Viewers, site-wide fixes). */
  fixHref?: (pageId: string) => string | null;
  LinkComponent?: HubLinkComponent;
}

const MAX_FIXES = 3;

export function SeoHealthPanel({
  score,
  fixes,
  checkedAt,
  pageNames = {},
  fixHref,
  LinkComponent,
}: SeoHealthPanelProps) {
  const Link = LinkComponent ?? "a";
  const safe = Math.max(0, Math.min(100, Math.round(score)));
  const word = seoWord(safe);
  const top = fixes.slice(0, MAX_FIXES);
  return (
    <div className="flex flex-col gap-3 font-hub text-hub-ink">
      <p className="flex flex-wrap items-center gap-2">
        <span className="text-xl font-semibold tabular-nums">
          {safe} out of 100
        </span>
        <span aria-hidden="true" className="text-hub-ink-muted">
          ·
        </span>
        <Badge tone={word.tone}>{word.word}</Badge>
      </p>
      {top.length === 0 ? (
        <p className="text-base">{REPORTS_COPY.seoAllClear}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">
            {REPORTS_COPY.seoTopFixes}
          </h3>
          <ol className="flex list-decimal flex-col gap-2 pl-5">
            {top.map((f, i) => {
              const href = f.pageId && fixHref ? fixHref(f.pageId) : null;
              const name = f.pageId ? pageNames[f.pageId] : undefined;
              return (
                <li key={`${f.rule}-${f.pageId ?? "site"}-${i}`}>
                  <span className="text-base">{f.message}</span>
                  {href ? (
                    <>
                      {" "}
                      <Link
                        href={href}
                        className="text-hub-accent underline underline-offset-2 hover:text-hub-accent-hover"
                      >
                        {name ? REPORTS_COPY.fixOn(name) : "Fix it"}
                      </Link>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      {checkedAt ? (
        <p className="text-sm text-hub-ink-muted">
          {REPORTS_COPY.seoChecked(checkedAt)}
        </p>
      ) : null}
    </div>
  );
}
