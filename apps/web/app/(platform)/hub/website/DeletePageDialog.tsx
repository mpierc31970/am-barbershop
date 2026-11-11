"use client";
// DeletePageDialog (11-30; DASH-06, DASH-08; D183, D254, D275; UI-SPEC "Page delete and
// Recently deleted", "Destructive actions"; D-UI-P11-20). A danger Dialog, mounted only while
// open (so Keep page, the safe default, takes focus). It loads the server's case
// (pageDeleteCaseAction): the links that point at the page, which are hidden while it is
// deleted (max 5, then "and N more"), and the pages its old address can send visitors to
// (Home first, then by title, then "Nobody (show your page-not-found page)"). Delete page
// calls deletePageAction(pageId, redirectTo | null); a failure shows ERR-DELETE in the dialog.
// After a delete the caller shows the "{Page} deleted." toast with Undo
// (useDeletedPageToast, 8s UNDO_TOAST_MS); Undo restores through restoreDeletedPageAction.
import {
  Button,
  Dialog,
  InlineAlert,
  Select,
  Skeleton,
  useToast,
} from "@cds/ui/hub";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import {
  deletePageAction,
  pageDeleteCaseAction,
  restoreDeletedPageAction,
  type PageDeleteCaseView,
  type RestorePageResult,
} from "../../../actions/pages";
import { pagePath } from "./page-slug";

export const PAGE_DELETE_UI_COPY = Object.freeze({
  title: (title: string) => `Delete ${title}?`,
  /** UI-SPEC DELETE-BODY. */
  body: "It comes off your site straight away. You can restore it from Recently deleted for 30 days.",
  linksHeading: "Links to this page",
  linksHidden: "These links are hidden while the page is deleted.",
  more: (n: number) => `and ${n} more`,
  sendTo: (path: string) => `Send visitors who open ${path} to`,
  sendHelper: "Search engines learn the new address.",
  nobody: "Nobody (show your page-not-found page)",
  confirm: "Delete page",
  keep: "Keep page",
  deleting: "Deleting…",
  /** UI-SPEC ERR-DELETE. */
  errDelete:
    "We couldn't delete this page, so nothing changed. Try again in a minute.",
  /** UI-SPEC ERR-RESTORE. */
  errRestore: "We couldn't restore this page just now. Try again in a minute.",
  /** UI-SPEC RESTORE-SLUG-TAKEN. */
  slugTaken: (path: string) =>
    `Another page now uses ${path}. Change that page's address first, then restore this one.`,
  notDeletable: "Home and system pages can't be deleted.",
  homeNotDeletable: "Your home page can't be deleted.",
  deleted: (title: string) => `${title} deleted.`,
  undo: "Undo",
  back: (title: string) => `${title} is back, with its menu and footer links.`,
  rowMenu: (title: string) => `More for ${title}`,
  open: "Open",
  settings: "Page settings",
  deleteItem: "Delete page",
  deleteThis: "Delete this page",
});

const LINKS_MAX = 5;

type CaseLink = PageDeleteCaseView["links"][number];

/** "Menu: About us", "Footer: About", "Button on Home: Learn more about us". */
export function linkLine(link: CaseLink): string {
  return link.where === "button"
    ? `Button on ${link.place}: ${link.label}`
    : `${link.place}: ${link.label}`;
}

/** The message for a refused restore (PAGES-FULL comes from the server's own copy). */
export function restoreErrorCopy(
  res: Extract<RestorePageResult, { ok: false }>,
  slug: string,
): string {
  if (res.code === "page_limit") return res.message;
  if (res.code === "slug_taken") {
    return PAGE_DELETE_UI_COPY.slugTaken(pagePath(slug));
  }
  if (res.code === "save_failed" || !res.message) {
    return PAGE_DELETE_UI_COPY.errRestore;
  }
  return res.message;
}

export type DeletedPageRef = { id: string; title: string; slug: string };

/**
 * The "{Page} deleted." toast with Undo (8s). Undo restores the page and refreshes the
 * Pages tab; a refusal (allowance full, address taken) is said in its own toast.
 */
export function useDeletedPageToast(): (page: DeletedPageRef) => void {
  const toast = useToast();
  const router = useRouter();
  return useCallback(
    (page: DeletedPageRef) => {
      const undo = async () => {
        let res: RestorePageResult;
        try {
          res = await restoreDeletedPageAction(page.id);
        } catch {
          toast.show({ message: PAGE_DELETE_UI_COPY.errRestore });
          return;
        }
        if (res.ok) {
          toast.show({ message: PAGE_DELETE_UI_COPY.back(page.title) });
          router.refresh();
        } else {
          toast.show({ message: restoreErrorCopy(res, page.slug) });
        }
      };
      toast.show({
        message: PAGE_DELETE_UI_COPY.deleted(page.title),
        action: {
          label: PAGE_DELETE_UI_COPY.undo,
          onClick: () => void undo(),
        },
      });
    },
    [toast, router],
  );
}

export interface DeletePageDialogProps {
  pageId: string;
  /** The page's title, for the dialog title before the case loads. */
  pageTitle: string;
  onClose: () => void;
  /** After the server deleted the page (the caller shows the Undo toast). */
  onDeleted: (page: DeletedPageRef) => void;
}

type Load =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; data: PageDeleteCaseView };

export function DeletePageDialog({
  pageId,
  pageTitle,
  onClose,
  onDeleted,
}: DeletePageDialogProps) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [target, setTarget] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectId = useId();
  const keepId = useId();

  // Keep page is the safe default. This runs after the Dialog's showModal() (child effects
  // first), so the platform's own dialog focus never wins over it.
  useEffect(() => {
    document.getElementById(keepId)?.focus();
  }, [keepId]);

  useEffect(() => {
    let live = true;
    pageDeleteCaseAction(pageId).then(
      (res) => {
        if (!live) return;
        if (res.ok) {
          setLoad({ state: "ready", data: res.data });
          setTarget(res.data.redirectOptions[0]?.id ?? "");
        } else {
          setLoad({ state: "error", message: res.message });
        }
      },
      () => {
        if (live) {
          setLoad({ state: "error", message: PAGE_DELETE_UI_COPY.errDelete });
        }
      },
    );
    return () => {
      live = false;
    };
  }, [pageId]);

  const ready = load.state === "ready" ? load.data : null;
  const deletable = Boolean(ready?.deletable);
  const title = ready?.page.title || pageTitle;

  async function confirm() {
    if (!ready || !deletable || pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await deletePageAction(pageId, target === "" ? null : target);
      if (res.ok) {
        onDeleted({ id: ready.page.id, title, slug: ready.page.slug });
        onClose();
        return;
      }
      setError(
        res.code === "save_failed" || !res.message
          ? PAGE_DELETE_UI_COPY.errDelete
          : res.message,
      );
    } catch {
      setError(PAGE_DELETE_UI_COPY.errDelete);
    }
    setPending(false);
  }

  const links = ready?.links ?? [];
  const shown = links.slice(0, LINKS_MAX);
  const options = ready
    ? [
        ...ready.redirectOptions.map((o) => ({ value: o.id, label: o.title })),
        { value: "", label: PAGE_DELETE_UI_COPY.nobody },
      ]
    : [];

  return (
    <Dialog
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={PAGE_DELETE_UI_COPY.title(title)}
      footer={
        <>
          <Button
            variant="destructive"
            loading={pending}
            loadingLabel={PAGE_DELETE_UI_COPY.deleting}
            disabled={!deletable}
            onClick={() => void confirm()}
          >
            {PAGE_DELETE_UI_COPY.confirm}
          </Button>
          <Button id={keepId} autoFocus onClick={onClose} disabled={pending}>
            {PAGE_DELETE_UI_COPY.keep}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-delete-page-dialog="">
        <p className="max-w-[68ch]">{PAGE_DELETE_UI_COPY.body}</p>
        {load.state === "loading" ? (
          <div aria-busy="true">
            <Skeleton rows={2} rowHeight={40} />
          </div>
        ) : null}
        {load.state === "error" ? (
          <InlineAlert tone="error">{load.message}</InlineAlert>
        ) : null}
        {ready && !ready.deletable ? (
          <InlineAlert tone="info">
            {PAGE_DELETE_UI_COPY.notDeletable}
          </InlineAlert>
        ) : null}
        {ready && ready.deletable && links.length > 0 ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-hub-ink">
              {PAGE_DELETE_UI_COPY.linksHeading}
            </p>
            <ul className="flex flex-col gap-1">
              {shown.map((l, i) => (
                <li key={`${i}-${l.place}-${l.label}`}>{linkLine(l)}</li>
              ))}
              {links.length > LINKS_MAX ? (
                <li className="text-hub-ink-muted">
                  {PAGE_DELETE_UI_COPY.more(links.length - LINKS_MAX)}
                </li>
              ) : null}
            </ul>
            <p className="text-sm text-hub-ink-muted">
              {PAGE_DELETE_UI_COPY.linksHidden}
            </p>
          </div>
        ) : null}
        {ready && ready.deletable ? (
          <Select
            id={selectId}
            label={PAGE_DELETE_UI_COPY.sendTo(pagePath(ready.page.slug))}
            helper={PAGE_DELETE_UI_COPY.sendHelper}
            options={options}
            value={target}
            disabled={pending}
            onChange={(e) => setTarget(e.currentTarget.value)}
          />
        ) : null}
        {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}
