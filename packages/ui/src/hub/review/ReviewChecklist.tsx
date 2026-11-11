// ReviewChecklist (14-34 choice 1; DOM-10, D172; 14-UI-SPEC "Launch review" § ReviewChecklist,
// D-UI-P14-11). The six D172 items as an <ol>, in the fixed P11 order: StageStatusIcon 20 (its
// words are sr-only), the title, a muted sub-line by state and one secondary sm action (ghost
// once done, with the date in the sub-line). Above it the "N of 6 done" Label and the same 4px
// determinate bar Today shows (role=progressbar, aria-valuetext). Item 1 carries a native
// <details> "Show pages" with each review page's status badge and an Open link.
// Read mode (Admin, staff viewing): the list and the pages, no actions, plus the owner-only
// Label. Server-safe: no state, props in. Links to the preview host open in a new tab.
import { P14_COPY } from "@cds/core/dns";
import { ExternalLink } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { HubLinkComponent } from "../AddonCard";
import { Badge, type BadgeTone } from "../Badge";
import { buttonClasses } from "../Button";
import { StageStatusIcon } from "../StageRail";
import { formatDayMonth } from "../today/copy";
import {
  REVIEW_UI_COPY,
  itemSubLine,
  type ReviewChecklistView,
  type ReviewItemView,
  type ReviewPageStatus,
  type ReviewPageView,
} from "./copy";

export interface ReviewChecklistActions {
  /** The review-mode link on the preview host (opens the first unreviewed page); null when none. */
  reviewHref: string | null;
  /** Per page id: that page in review mode on the preview host. */
  pageHrefs?: Readonly<Record<string, string>>;
  /** CDS Support, filtered to change requests. */
  requestsHref: string;
  factsHref: string;
  phoneHref: string;
  /** The contact page in review mode on the preview host; null when there is no link. */
  testFormHref: string | null;
  inboxHref: string;
}

export interface ReviewChecklistProps {
  view: ReviewChecklistView;
  actions: ReviewChecklistActions;
  /** Admin / staff viewing: no actions (UI-SPEC: Owners act, Admins read). */
  readOnly?: boolean;
  /** For the "Confirmed 12 Oct" dates. */
  timeZone?: string;
  LinkComponent?: HubLinkComponent;
}

const PAGE_TONE: Readonly<Record<ReviewPageStatus, BadgeTone>> = Object.freeze({
  looks_good: "done",
  needs_change: "needed",
  not_looked: "optional",
  changed_since: "update-waiting",
});

const LINK =
  "rounded text-hub-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent";

const ACTION_BOX =
  "w-full shrink-0 sm:w-auto pointer-coarse:h-11 justify-center";

type ActionSpec = {
  label: string;
  href: string;
  external?: boolean;
};

function actionFor(
  item: ReviewItemView,
  view: ReviewChecklistView,
  a: ReviewChecklistActions,
): ActionSpec | null {
  switch (item.id) {
    case "pages_reviewed":
      return a.reviewHref
        ? {
            label: P14_COPY.BTN_REVIEW_ON_PREVIEW,
            href: a.reviewHref,
            external: true,
          }
        : null;
    case "changes_sent":
      return (item.of ?? 0) > 0
        ? { label: P14_COPY.BTN_SEE_REQUESTS, href: a.requestsHref }
        : null;
    case "key_facts":
      return { label: P14_COPY.BTN_CONFIRM_YOUR_DETAILS, href: a.factsHref };
    case "phone_check":
      return { label: P14_COPY.BTN_CHECK_ON_PHONE, href: a.phoneHref };
    case "test_form":
      if (!view.hasForm) return null;
      if (item.done)
        return { label: P14_COPY.BTN_OPEN_INBOX, href: a.inboxHref };
      return a.testFormHref
        ? {
            label: P14_COPY.BTN_SEND_TEST_MESSAGE,
            href: a.testFormHref,
            external: true,
          }
        : null;
    case "no_open_requests":
      return (item.count ?? 0) > 0
        ? { label: P14_COPY.BTN_SEE_REQUESTS, href: a.requestsHref }
        : null;
    default:
      return null;
  }
}

function ActionLink({
  spec,
  done,
  Link,
}: {
  spec: ActionSpec;
  done: boolean;
  Link: HubLinkComponent | "a";
}) {
  const cls = `${buttonClasses(done ? "ghost" : "secondary", "sm")} ${ACTION_BOX}`;
  if (spec.external) {
    return (
      <a
        href={spec.href}
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
        data-review-action=""
      >
        <ExternalLink aria-hidden size={16} strokeWidth={2} />
        <span>{spec.label}</span>
        <span className="sr-only"> {REVIEW_UI_COPY.newTab}</span>
      </a>
    );
  }
  return (
    <Link href={spec.href} className={cls} data-review-action="">
      {spec.label}
    </Link>
  );
}

function PagesDisclosure({
  pages,
  hrefs,
  readOnly,
}: {
  pages: readonly ReviewPageView[];
  hrefs: Readonly<Record<string, string>>;
  readOnly: boolean;
}) {
  if (pages.length === 0) return null;
  return (
    <details className="group mt-2" data-review-pages="">
      <summary className={`${LINK} cursor-pointer text-sm pointer-coarse:py-3`}>
        {P14_COPY.BTN_SHOW_PAGES}
      </summary>
      <ul className="mt-2 flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {pages.map((p) => {
          const href = hrefs[p.id];
          return (
            <li
              key={p.id}
              data-review-page={p.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">{p.title}</span>
              <Badge tone={PAGE_TONE[p.status]}>
                {REVIEW_UI_COPY.pageStatus[p.status]}
              </Badge>
              {!readOnly && href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${LINK} pointer-coarse:py-3`}
                >
                  {REVIEW_UI_COPY.open}
                  <span className="sr-only">
                    {" "}
                    {p.title} {REVIEW_UI_COPY.newTab}
                  </span>
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** "4 of 6 done" + the P11 4px determinate bar (D-UI-P14-11). */
export function ReviewProgress({
  done,
  total,
}: {
  done: number;
  total: number;
}) {
  const count = REVIEW_UI_COPY.count(done, total);
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex flex-col gap-2" data-review-progress="">
      <p className="text-sm tabular-nums">{count}</p>
      <div
        role="progressbar"
        aria-label={REVIEW_UI_COPY.progressLabel}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={count}
        className="h-1 w-full overflow-hidden rounded-full bg-hub-border"
      >
        <div className="h-full bg-hub-ink" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ReviewChecklist({
  view,
  actions,
  readOnly = false,
  timeZone = "UTC",
  LinkComponent,
}: ReviewChecklistProps) {
  const listId = useId();
  const Link = LinkComponent ?? "a";
  const hrefs = actions.pageHrefs ?? {};
  return (
    <section
      aria-labelledby={`${listId}-h`}
      className="flex flex-col gap-4 font-hub text-hub-ink"
      data-review-checklist=""
      data-read-only={readOnly ? "" : undefined}
    >
      <h2 id={`${listId}-h`} className="sr-only">
        {REVIEW_UI_COPY.progressLabel}
      </h2>
      <ReviewProgress done={view.done} total={view.total} />
      {readOnly ? (
        <p className="text-sm text-hub-ink-muted" data-owner-only="">
          {REVIEW_UI_COPY.ownerOnly}
        </p>
      ) : null}
      <ol className="flex flex-col divide-y divide-hub-border border-y border-hub-border">
        {view.items.map((item) => {
          const day = item.at ? formatDayMonth(item.at, timeZone) : "";
          const sub = itemSubLine(item, view.pages, view.hasForm, day);
          const spec = readOnly ? null : actionFor(item, view, actions);
          const started =
            !item.done && (item.count ?? 0) > 0 && item.id === "pages_reviewed";
          let extra: ReactNode = null;
          if (item.id === "pages_reviewed") {
            extra = (
              <PagesDisclosure
                pages={view.pages}
                hrefs={hrefs}
                readOnly={readOnly}
              />
            );
          }
          return (
            <li
              key={item.id}
              data-review-item={item.id}
              data-done={item.done ? "" : undefined}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="pt-0.5">
                  <StageStatusIcon
                    status={
                      item.done ? "done" : started ? "started" : "not_started"
                    }
                    size={20}
                  />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-base font-semibold">{item.label}</p>
                  {sub ? (
                    <p className="text-sm text-hub-ink-muted">{sub}</p>
                  ) : null}
                  {extra}
                </div>
              </div>
              {spec ? (
                <ActionLink spec={spec} done={item.done} Link={Link} />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
