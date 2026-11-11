// ReviewBar (14-35 choice 4; DOM-10, D172, D-UI-P14-12, D-UI-P14-13; 14-UI-SPEC "Review mode",
// "Preview strip colour", a11y lines): the fixed bottom bar of review mode on the preview host.
// Platform chrome, rendered by the tenant layout after the themed root (outside [data-site]:
// hub tokens only, so a theme of any colour sits around it calmly). Server-rendered, no JS:
// Looks good / Needs a change are <button>s in a <form method="post"> to /_site/review/mark,
// so they work on any phone; Previous / Next page are plain links.
//   - >= 640px one row, 56px + safe area: "Page 3 of 7" · the two choices · Previous / Next.
//   - < 640px two rows, 88px + safe area: "Page 3 of 7 · About us"; then four 44px controls
//     (ChevronLeft "Previous page" · Looks good · Needs a change · ChevronRight "Next page").
//   - Every control is 44px tall on every pointer. Secondary-button look (hub surface, 1px
//     border-strong); the current choice is pressed: aria-pressed="true", 2px ink border, 600.
//   - Names include the page ("Looks good: About us"); colour is never the only signal.
// The layout reserves the same height as bottom padding on the themed root (no layout shift).
import { P14_COPY } from "@cds/core/dns";
import { ChevronLeft, ChevronRight, CircleCheck, Pencil } from "lucide-react";
import type { ReactNode } from "react";
import { REVIEW_MARK_PATH } from "../../../../lib/review-mode";

export type ReviewBarPage = {
  id: string;
  title: string;
  status: string;
};

export interface ReviewBarProps {
  page: ReviewBarPage;
  /** 1-based position in the review set. */
  index: number;
  total: number;
  prevHref: string | null;
  nextHref: string | null;
}

/** The padding the themed root reserves for the bar (same heights as the bar). */
export const REVIEW_BAR_PADDING =
  "pb-[calc(88px+env(safe-area-inset-bottom))] sm:pb-[calc(56px+env(safe-area-inset-bottom))]";

const CONTROL =
  "inline-flex h-11 items-center justify-center gap-2 rounded bg-hub-surface px-3 font-hub " +
  "text-sm text-hub-ink whitespace-nowrap transition-colors duration-150 select-none " +
  "hover:bg-hub-surface-2 active:bg-hub-border forced-colors:border-[ButtonText]";

const RESTING = "border border-hub-border-strong font-normal";
const PRESSED = "border-2 border-hub-ink font-semibold";

function Choice({
  value,
  pressed,
  title,
  icon,
  word,
}: {
  value: "looks_good" | "needs_change";
  pressed: boolean;
  title: string;
  icon: ReactNode;
  word: string;
}) {
  return (
    <button
      type="submit"
      name="choice"
      value={value}
      aria-pressed={pressed ? "true" : "false"}
      data-review-choice={value}
      className={`${CONTROL} ${pressed ? PRESSED : RESTING} min-w-0 flex-1 sm:flex-none sm:px-4`}
    >
      {icon}
      <span className="truncate">{word}</span>
      <span className="sr-only">{`: ${title}`}</span>
    </button>
  );
}

function Step({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const word =
    dir === "prev" ? P14_COPY.BTN_PREVIOUS_PAGE : P14_COPY.BTN_NEXT_PAGE;
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  const inner = (
    <>
      {dir === "prev" ? <Icon aria-hidden size={16} strokeWidth={2} /> : null}
      <span className="sr-only sm:not-sr-only">{word}</span>
      {dir === "next" ? <Icon aria-hidden size={16} strokeWidth={2} /> : null}
    </>
  );
  const cls = `${CONTROL} ${RESTING} w-11 shrink-0 px-0 sm:w-auto sm:px-4`;
  if (href === null) {
    return (
      <span
        aria-disabled="true"
        data-review-step={dir}
        className={`${cls} cursor-not-allowed opacity-50 hover:bg-hub-surface`}
      >
        {inner}
      </span>
    );
  }
  return (
    <a href={href} data-review-step={dir} className={cls}>
      {inner}
    </a>
  );
}

export function ReviewBar({
  page,
  index,
  total,
  prevHref,
  nextHref,
}: ReviewBarProps) {
  const position = `Page ${index} of ${total}`;
  return (
    <nav
      aria-label="Page review"
      data-review-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hub-border-strong bg-hub-surface pb-[env(safe-area-inset-bottom)] font-hub text-hub-ink forced-colors:border-t-[CanvasText]"
    >
      <div className="mx-auto flex h-[88px] w-full max-w-5xl flex-col justify-center gap-1 px-4 py-2 sm:h-14 sm:flex-row sm:items-center sm:gap-4 sm:py-0">
        <p className="flex h-5 min-w-0 items-center text-sm leading-5 font-semibold sm:shrink-0">
          <span className="shrink-0">{position}</span>
          <span className="min-w-0 truncate sm:hidden" title={page.title}>
            {` · ${page.title}`}
          </span>
        </p>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-4">
          <div className="order-1 sm:order-2">
            <Step href={prevHref} dir="prev" />
          </div>
          <form
            method="post"
            action={REVIEW_MARK_PATH}
            className="order-2 flex min-w-0 flex-1 items-center gap-2 sm:order-1 sm:justify-center"
          >
            <input type="hidden" name="page" value={page.id} />
            <Choice
              value="looks_good"
              pressed={page.status === "looks_good"}
              title={page.title}
              word={P14_COPY.BTN_LOOKS_GOOD}
              icon={<CircleCheck aria-hidden size={16} strokeWidth={2} />}
            />
            <Choice
              value="needs_change"
              pressed={page.status === "needs_change"}
              title={page.title}
              word={P14_COPY.BTN_NEEDS_CHANGE}
              icon={<Pencil aria-hidden size={16} strokeWidth={2} />}
            />
          </form>
          <div className="order-3">
            <Step href={nextHref} dir="next" />
          </div>
        </div>
      </div>
    </nav>
  );
}
