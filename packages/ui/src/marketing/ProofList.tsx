// Owner: 15-11 (P15-P1). ProofList: "Sites we've built" as rows, not cards (UI-SPEC Work §3, Home §5).
// Row = client name (Heading) · path chip dot + path name (Label) · one-line outcome (Body) ·
// Visit site (text link, new tab, rel="noopener", T-15-11-02). 1px rule between rows.
// Callers pass the list already filtered by visibleProof() (P15-P15, T-15-11-01); the DRAFT badge
// shows on unconfirmed entries only when showDrafts. An empty list renders nothing.
import { MK_COPY, MK_PATHS, type WorkSite } from "@cds/core/marketing";
import { DraftBadge, shownProof } from "./DraftBadge";
import { MkLinkButton } from "./MkButton";

const DOT: Record<WorkSite["path"], string> = {
  standard: "bg-mk-cobalt",
  studio: "bg-mk-berry",
};

export type ProofListProps = {
  sites: readonly WorkSite[];
  showDrafts: boolean;
  /** Optional H2 above the rows (hides with the list). */
  title?: string;
  /** Max rows (home shows 4). */
  limit?: number;
  className?: string;
};

export function ProofList({
  sites,
  showDrafts,
  title,
  limit,
  className,
}: ProofListProps) {
  // Unconfirmed entries are dropped here too when drafts are hidden (WR-C05).
  const visible = shownProof(sites, showDrafts);
  const rows = limit === undefined ? visible : visible.slice(0, limit);
  if (rows.length === 0) return null;
  return (
    <div
      className={["flex flex-col gap-8", className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      {title ? (
        <h2 className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]">
          {title}
        </h2>
      ) : null}
      <ul className="m-0 list-none divide-y divide-mk-rule border-y border-mk-rule p-0">
        {rows.map((site) => (
          <li
            key={site.url}
            className="grid grid-cols-1 gap-3 py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,3fr)_auto] md:items-center md:gap-8"
          >
            <span className="flex flex-wrap items-center gap-3">
              <span className="font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold">
                {site.name}
              </span>
              <DraftBadge show={showDrafts && !site.confirmed} />
            </span>
            <span className="flex items-center gap-2 text-[14px] leading-[1.4]">
              <span
                aria-hidden="true"
                className={`inline-block size-3 rounded-full ${DOT[site.path]}`}
              />
              {MK_PATHS[site.path].name}
            </span>
            <span className="text-[18px] leading-[1.55] text-mk-muted [text-wrap:pretty]">
              {site.outcome}
            </span>
            <MkLinkButton
              href={site.url}
              external
              variant="text"
              aria-label={`${MK_COPY.WORK.VISIT}: ${site.name}`}
            >
              {MK_COPY.WORK.VISIT}
            </MkLinkButton>
          </li>
        ))}
      </ul>
    </div>
  );
}
