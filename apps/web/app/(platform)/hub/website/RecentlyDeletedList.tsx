"use client";
// Recently deleted (11-30 choice 4; DASH-06, DASH-08; D185, D275; UI-SPEC "Page delete and
// Recently deleted" › Recently deleted). Below the Pages table; absent when the bin is empty.
// A native <details> disclosure, closed by default, summary "Recently deleted (N)". Each row:
// title · "/about-us" · "Deleted 9 Oct by Maria · Gone for good on 8 Nov" · secondary sm
// Restore ("Restore About us"). No confirm (restore is not destructive). Success: Toast
// "{Page} is back, with its menu and footer links." and the tab refreshes. Refused at the
// allowance: InlineAlert warning in the row with PAGES-FULL (Owner: link "Add 5 more pages",
// the Pages tab's own purchase) or PAGES-FULL-MEMBER; address taken: RESTORE-SLUG-TAKEN.
import { Button, InlineAlert, useToast } from "@cds/ui/hub";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { restoreDeletedPageAction } from "../../../actions/pages";
import { usePagesBuy } from "./AddPageRow";
import { PAGE_DELETE_UI_COPY, restoreErrorCopy } from "./DeletePageDialog";
import { pagePath } from "./page-slug";
import { PAGES_FULL_COPY, pagesFullView } from "./PagesFullPanel";

/** A page in the bin (client copy of @cds/db DeletedPage). */
export interface DeletedPageView {
  id: string;
  title: string;
  slug: string;
  deletedAt: string;
  deletedBy: string;
}

const BIN_DAYS = 30;
const DAY_MS = 86_400_000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export const RECENTLY_DELETED_COPY = Object.freeze({
  summary: (n: number) => `Recently deleted (${n})`,
  restore: "Restore",
  restoring: "Restoring…",
  restoreName: (title: string) => `Restore ${title}`,
  footnote: "Deleted pages are removed for good after 30 days.",
});

/** "9 Oct" in UTC (the hub shows UTC until organizations carry a time zone); "" if invalid. */
function dayMonth(ms: number): string {
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Deleted 9 Oct by Maria · Gone for good on 8 Nov" (no "by" when the name is unknown). */
export function deletedLine(
  p: Pick<DeletedPageView, "deletedAt" | "deletedBy">,
): string {
  const at = Date.parse(p.deletedAt.replace(" ", "T"));
  const when = dayMonth(at);
  if (!when) return "";
  const by = p.deletedBy ? ` by ${p.deletedBy}` : "";
  return `Deleted ${when}${by} · Gone for good on ${dayMonth(at + BIN_DAYS * DAY_MS)}`;
}

type RowError =
  | { kind: "limit"; allowance: number; message: string }
  | { kind: "other"; message: string };

export function RecentlyDeletedList({
  pages,
}: {
  pages: readonly DeletedPageView[];
}) {
  if (pages.length === 0) return null;
  return (
    <details className="mt-6 font-hub" data-recently-deleted="">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-hub-ink">
        {RECENTLY_DELETED_COPY.summary(pages.length)}
      </summary>
      <div className="mt-2 flex flex-col gap-2 rounded bg-hub-surface-2 p-4">
        <ul className="flex flex-col divide-y divide-hub-border">
          {pages.map((p) => (
            <DeletedRow key={p.id} page={p} />
          ))}
        </ul>
        <p className="text-sm text-hub-ink-muted">
          {RECENTLY_DELETED_COPY.footnote}
        </p>
      </div>
    </details>
  );
}

function DeletedRow({ page }: { page: DeletedPageView }) {
  const toast = useToast();
  const router = useRouter();
  const buy = usePagesBuy();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RowError | null>(null);

  async function restore() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await restoreDeletedPageAction(page.id);
      if (res.ok) {
        toast.show({ message: PAGE_DELETE_UI_COPY.back(page.title) });
        router.refresh();
        return;
      }
      if ("allowance" in res) {
        setError({
          kind: "limit",
          allowance: res.allowance,
          message: res.message,
        });
      } else {
        setError({ kind: "other", message: restoreErrorCopy(res, page.slug) });
      }
    } catch {
      setError({ kind: "other", message: PAGE_DELETE_UI_COPY.errRestore });
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 py-3" data-deleted-row={page.id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-base font-semibold text-hub-ink">
            {page.title}
          </span>
          <span className="text-sm text-hub-ink-muted">
            {pagePath(page.slug)}
          </span>
          <span className="text-sm text-hub-ink">{deletedLine(page)}</span>
        </div>
        <Button
          size="sm"
          aria-label={RECENTLY_DELETED_COPY.restoreName(page.title)}
          loading={pending}
          loadingLabel={RECENTLY_DELETED_COPY.restoring}
          onClick={() => void restore()}
        >
          {RECENTLY_DELETED_COPY.restore}
        </Button>
      </div>
      {error?.kind === "limit" ? (
        <LimitRefusal
          allowance={error.allowance}
          fallback={error.message}
          buy={buy}
        />
      ) : null}
      {error?.kind === "other" ? (
        <InlineAlert tone="warning">{error.message}</InlineAlert>
      ) : null}
    </li>
  );
}

/** PAGES-FULL for the Owner (with the buy link), PAGES-FULL-MEMBER for everyone else. */
function LimitRefusal({
  allowance,
  fallback,
  buy,
}: {
  allowance: number;
  fallback: string;
  buy: ReturnType<typeof usePagesBuy>;
}) {
  const who = buy?.who;
  const view = who ? pagesFullView(who, allowance) : null;
  const canBuy = view?.kind === "buy" && Boolean(who?.priceLabel);
  return (
    <InlineAlert
      tone="warning"
      action={
        canBuy && buy ? (
          <button
            type="button"
            onClick={buy.onBuy}
            className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-hub-accent underline underline-offset-4"
          >
            {PAGES_FULL_COPY.addLink}
          </button>
        ) : undefined
      }
    >
      {view?.text ?? fallback}
    </InlineAlert>
  );
}
