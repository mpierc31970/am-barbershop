// PreviewStrip (14-19; DOM-09, D170, D-UI-P14-14..16; 14-UI-SPEC "Preview strip"): platform
// chrome on every preview-host page, rendered by the tenant layout before SiteThemeScope, so
// no theme token reaches it (hub tokens only). Server-rendered, no JS: a fixed 32px line in
// document flow (no layout shift). The full and short copy are two spans switched by the `sm:`
// breakpoint (CSS only). Forced-colors keeps a 1px CanvasText border. Normal, draft and
// expired have no interactive element.
// Review variant (14-35 choice 4; D172, D-UI-P14-12, D-UI-P14-13): "Review mode · Page 3 of 7 ·
// About us" (< 640px "Page 3 of 7"; only the title segment truncates, its full name in `title`)
// or, once, the `role="status"` line from the last action; then one link on the right, **Back to
// your review** (< 640px "Back", same accessible name), or, in a phone session on the first page,
// the **Checked on my phone** form button. Its 44px hit area is an invisible box overflowing the
// 32px strip, so the strip height never changes.
import { P14_COPY } from "@cds/core/dns";
import { REVIEW_MARK_PATH } from "../../../../lib/review-mode";

export type PreviewStripVariant = "normal" | "draft" | "expired" | "review";

/** UI-SPEC "Expired link" short copy (< 640px); P14_COPY carries only the long form. */
export const STRIP_EXPIRED_SHORT = "Link expired. Showing published.";

/** The review variant's data (14-35). */
export type ReviewStripInfo = {
  /** The page line; null on a path outside the review set ("Review mode" only). */
  page: { index: number; total: number; title: string } | null;
  /** The one-line status from the last action, shown once instead of the page line. */
  status: string | null;
  /** `<platform>/hub/review`. */
  backHref: string;
  /** Phone session on the first page: the Checked on my phone form (page id). */
  phoneCheckPageId: string | null;
};

type FixedVariant = Exclude<PreviewStripVariant, "review">;

const COPY: Record<FixedVariant, { full: string; short: string }> = {
  normal: { full: P14_COPY.STRIP, short: P14_COPY.STRIP_SHORT },
  draft: { full: P14_COPY.STRIP_DRAFT, short: P14_COPY.STRIP_DRAFT },
  expired: { full: P14_COPY.STRIP_EXPIRED, short: STRIP_EXPIRED_SHORT },
};

const BASE =
  "flex h-8 w-full items-center justify-start overflow-hidden whitespace-nowrap px-4 font-hub text-sm leading-none font-semibold sm:justify-center forced-colors:border forced-colors:border-[CanvasText]";

const TONE: Record<PreviewStripVariant, string> = {
  normal: "bg-hub-ink text-hub-surface",
  expired: "bg-hub-ink text-hub-surface",
  review: "bg-hub-ink text-hub-surface",
  draft:
    "border-b border-hub-warning bg-hub-warning-tint text-hub-ink forced-colors:border-b",
};

/** The review strip: no overflow clip on the aside, so the 44px hit box can overflow it. */
const REVIEW_BASE =
  "relative flex h-8 w-full items-center gap-3 whitespace-nowrap px-4 font-hub text-sm leading-none font-semibold forced-colors:border forced-colors:border-[CanvasText]";

/** The invisible 44px box centred on a 32px control (hit area only; no visual change). */
const HIT =
  "relative shrink-0 underline underline-offset-2 before:absolute before:inset-x-0 before:top-1/2 before:h-11 before:-translate-y-1/2 before:content-['']";

function ReviewLine({ page }: { page: ReviewStripInfo["page"] }) {
  if (page === null) return <span className="truncate">Review mode</span>;
  const position = `Page ${page.index} of ${page.total}`;
  return (
    <>
      <span className="hidden min-w-0 items-center sm:flex">
        <span className="shrink-0 whitespace-pre">{`Review mode · ${position} · `}</span>
        <span className="min-w-0 truncate" title={page.title}>
          {page.title}
        </span>
      </span>
      <span className="truncate sm:hidden">{position}</span>
    </>
  );
}

function ReviewStrip({ review }: { review: ReviewStripInfo }) {
  return (
    <aside
      aria-label="Preview notice"
      data-preview-strip="review"
      className={`${REVIEW_BASE} ${TONE.review}`}
    >
      <p className="flex min-w-0 flex-1 items-center sm:justify-center">
        {review.status ? (
          <span role="status" className="min-w-0 truncate">
            {review.status}
          </span>
        ) : (
          <ReviewLine page={review.page} />
        )}
      </p>
      {review.phoneCheckPageId !== null ? (
        <form method="post" action={REVIEW_MARK_PATH} className="shrink-0">
          <input type="hidden" name="choice" value="phone" />
          <input type="hidden" name="page" value={review.phoneCheckPageId} />
          <button type="submit" data-phone-check="" className={HIT}>
            {P14_COPY.BTN_CHECKED_ON_PHONE}
          </button>
        </form>
      ) : (
        <a href={review.backHref} data-back-to-review="" className={HIT}>
          <span className="hidden sm:inline">
            {P14_COPY.BTN_BACK_TO_REVIEW}
          </span>
          <span className="sm:hidden">
            {P14_COPY.BTN_BACK}
            <span className="sr-only">{" to your review"}</span>
          </span>
        </a>
      )}
    </aside>
  );
}

export function PreviewStrip({
  variant = "normal",
  review,
}: {
  variant?: PreviewStripVariant;
  /** Required for the review variant; without it the strip falls back to normal. */
  review?: ReviewStripInfo;
}) {
  if (variant === "review" && review) return <ReviewStrip review={review} />;
  const v: FixedVariant = variant === "review" ? "normal" : variant;
  const copy = COPY[v] ?? COPY.normal;
  const tone = TONE[v] ?? TONE.normal;
  return (
    <aside
      aria-label="Preview notice"
      data-preview-strip={v}
      className={`${BASE} ${tone}`}
    >
      <span className="hidden truncate sm:inline">{copy.full}</span>
      <span className="truncate sm:hidden">{copy.short}</span>
    </aside>
  );
}
