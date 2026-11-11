// Owner: 15-11 (P15-P1). TestimonialList: "What clients say" (UI-SPEC Work §4, Home §5).
// Each quote is <figure><blockquote> (Heading size up to 140 chars, Body otherwise) + <figcaption>
// "Name, Business" (Label 700). Callers pass the visibleProof()-filtered list (P15-P15); DRAFT shows on
// unconfirmed entries only when showDrafts. An empty list renders nothing (TESTIMONIALS is empty today).
import type { Testimonial } from "@cds/core/marketing";
import { DraftBadge, shownProof } from "./DraftBadge";

/** Quotes this long or shorter are set at Heading size. */
export const SHORT_QUOTE_MAX = 140;

const HEADING_QUOTE =
  "font-mk-display text-[clamp(28px,1.6vw+22px,40px)] leading-[1.1] font-bold [text-wrap:balance]";
const BODY_QUOTE = "text-[18px] leading-[1.55] [text-wrap:pretty]";

export type TestimonialListProps = {
  items: readonly Testimonial[];
  showDrafts: boolean;
  /** Optional H2 above the quotes (hides with the list). */
  title?: string;
  /** Max quotes (home shows 2). */
  limit?: number;
  className?: string;
};

export function TestimonialList({
  items,
  showDrafts,
  title,
  limit,
  className,
}: TestimonialListProps) {
  // Unconfirmed quotes are dropped here too when drafts are hidden (WR-C05).
  const visible = shownProof(items, showDrafts);
  const shown = limit === undefined ? visible : visible.slice(0, limit);
  if (shown.length === 0) return null;
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
      <ul className="m-0 grid list-none grid-cols-1 gap-12 p-0 lg:grid-cols-2">
        {shown.map((t) => (
          <li key={`${t.name}|${t.business}`}>
            <figure className="m-0 flex flex-col gap-4">
              <blockquote
                className={`m-0 max-w-[40ch] ${t.quote.length <= SHORT_QUOTE_MAX ? HEADING_QUOTE : BODY_QUOTE}`}
              >
                {t.quote}
              </blockquote>
              <figcaption className="flex flex-wrap items-center gap-3 text-[14px] leading-[1.4] font-bold">
                <span>
                  {t.name}, {t.business}
                </span>
                <DraftBadge show={showDrafts && !t.confirmed} />
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </div>
  );
}
