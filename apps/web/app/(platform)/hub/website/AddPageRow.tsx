"use client";
// Pages tab header + inline Add page row (CONT-30; UI-SPEC "Pages tab", Copywriting slug
// rows, EMPTY-1, "Page created."). Not a modal: Add page opens a form row at the top of
// the list. The URL fills itself from the title (lowercase, hyphens) until the owner edits
// it, and is checked live against the format, the system addresses and this site's pages.
// Create page saves through createPageAction (the tenant comes from the session cookie),
// then opens the new page's builder and shows "Page created.". Discard new page just
// closes the row: nothing was saved, so there is no confirm.
// 07-25 (choice 13, UI-SPEC line 335): the row has "Show this page in the site menu", on by
// default while the menu has fewer than 6 top-level links, off at 6-7, disabled with the
// NAV-LIMIT helper at 8. Its value reaches createPageAction as `addToNav`.
// 11-28 (DASH-08, D185, D273; UI-SPEC "Page allowance and page packs"): the header reads
// "N of {allowance} pages" with ALLOWANCE-HELP under it. At the limit the Add page primary
// and its row give way to PagesFullPanel; the Owner's "Add 5 more pages" opens the P10
// ChargeConfirmDialog with the server's preview (packPreviewAction("pages-5")) and confirms
// through buyPackAction with the preview's token, then the page data refreshes. A server
// refusal (PageLimitReached, another tab used the last page) keeps the typed title and shows
// PAGES-FULL inline (Owner: an "Add 5 more pages" link into the same purchase).
import { NAV_COPY, NAV_SUGGEST_BELOW, NAV_TOP_MAX } from "@cds/core/content";
import {
  Button,
  EmptyState,
  InlineAlert,
  TextField,
  useToast,
} from "@cds/ui/hub";
import {
  ChargeConfirmDialog,
  type ChargePreview,
  type ChargeResult,
} from "@cds/ui/hub/billing";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { buyPackAction, packPreviewAction } from "../../../actions/billing";
import { createPageAction } from "../../../actions/pages";
import { CARD_HREF } from "../settings/billing-copy";
import { slugError, slugify, tidySlugInput } from "./page-slug";
import {
  PAGES_FULL_COPY,
  PagesFullPanel,
  pagesFullView,
  type PagesFullWho,
} from "./PagesFullPanel";

const TITLE_REQUIRED = "Give the page a title.";
const TITLE_ID = "new-page-title";
const SLUG_ID = "new-page-slug";
const ADD_ID = "add-page";
const NAV_ID = "new-page-nav";
export const ADD_TO_NAV_LABEL = "Show this page in the site menu";
export const ADD_TO_NAV_HELP =
  "It shows in the menu once the page is published.";
/** UI-SPEC ALLOWANCE-HELP. */
export const ALLOWANCE_HELP =
  "Policy, 404, password and landing pages don't count.";
const PREVIEW_FAILED =
  "We couldn't get the price just now. Try again in a minute.";
const PACK = "pages-5";

/**
 * 11-30: the pages pack purchase for rows inside the list (Recently deleted's restore refused
 * at the allowance offers the Owner the same "Add 5 more pages" as the Add page row).
 */
export interface PagesBuy {
  who: PagesFullWho | undefined;
  onBuy: () => void;
}
const PagesBuyContext = createContext<PagesBuy | null>(null);

/** The Pages tab's purchase path, or null outside AddPageRow. */
export function usePagesBuy(): PagesBuy | null {
  return useContext(PagesBuyContext);
}

/** Focus by id on the next frame (the target may mount on this render). */
function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export interface AddPageRowProps {
  /** Counted pages (11-28: builder pages only, D273); omitted when the count failed. */
  count?: number;
  /** The page allowance (10 + 5 x packs); omitted when the count failed. */
  limit?: number;
  /** Who is looking: drives the at-limit panel. Without it there is no panel. */
  who?: PagesFullWho;
  /** Slugs this site already uses. */
  taken: readonly string[];
  /** Addresses the system owns (from @cds/db RESERVED_SLUGS). */
  reserved: readonly string[];
  /** Top-level links in the site menu now (07-25); 8 disables the menu checkbox. */
  navTopCount: number;
  /** The page list; null when there are no pages. */
  children: ReactNode;
}

type Errors = {
  title?: string;
  slug?: string;
  form?: { message: string; signedOut: boolean };
  /** 11-28: the server's PageLimitReached, with the allowance it was refused at. */
  limit?: number;
};

export function AddPageRow({
  count,
  limit,
  who,
  taken,
  reserved,
  navTopCount,
  children,
}: AddPageRowProps) {
  const known = typeof count === "number" && typeof limit === "number";
  const atLimit = Boolean(who) && known && count! >= limit!;
  const navFull = navTopCount >= NAV_TOP_MAX;
  const navDefault = !navFull && navTopCount < NAV_SUGGEST_BELOW;
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  const [addToNav, setAddToNav] = useState(navDefault);

  const empty = children === null || children === undefined;
  const liveSlugError = slug ? slugError(slug, { reserved, taken }) : null;
  const errors: Errors = {
    title:
      serverErrors.title ??
      (submitted && !title.trim() ? TITLE_REQUIRED : undefined),
    slug:
      serverErrors.slug ??
      liveSlugError ??
      (submitted && !slug ? slugError("", { reserved, taken }) : null) ??
      undefined,
    form: serverErrors.form,
    limit: serverErrors.limit,
  };

  // 11-28: one pages pack through the P10 purchase path (preview -> confirm -> buy).
  const [buyOpen, setBuyOpen] = useState(false);
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);

  function startBuy() {
    if (buyOpen) return;
    setBuyError(null);
    setPreview(null);
    setBuyOpen(true);
    packPreviewAction(PACK).then(
      (res) => {
        if (res.ok) setPreview(res.preview);
        else {
          setBuyOpen(false);
          setBuyError(res.message || PREVIEW_FAILED);
        }
      },
      () => {
        setBuyOpen(false);
        setBuyError(PREVIEW_FAILED);
      },
    );
  }

  async function confirmBuy(token: string): Promise<ChargeResult> {
    const res = await buyPackAction(PACK, token);
    if (res.ok) {
      setServerErrors((s) => ({ ...s, limit: undefined }));
      router.refresh();
    }
    return res;
  }

  function openRow() {
    setOpen(true);
    setAddToNav(navDefault);
    focusSoon(TITLE_ID);
  }

  function discard() {
    setOpen(false);
    setTitle("");
    setSlug("");
    setSlugEdited(false);
    setSubmitted(false);
    setServerErrors({});
    focusSoon(ADD_ID);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    setServerErrors({});
    const titleBad = !title.trim();
    const slugBad = slugError(slug, { reserved, taken }) !== null;
    if (titleBad || slugBad) {
      focusSoon(titleBad ? TITLE_ID : SLUG_ID);
      return;
    }
    setSaving(true);
    const res = await createPageAction({
      title: title.trim(),
      slug,
      addToNav: addToNav && !navFull,
    });
    if (res.ok) {
      toast.show({ message: "Page created." });
      router.push(`/hub/website/pages/${encodeURIComponent(res.data.id)}`);
      return;
    }
    setSaving(false);
    if ("allowance" in res) {
      // page_limit: another tab used the last page; keep what was typed, say why (UI-SPEC).
      setServerErrors({ limit: res.allowance });
    } else if (res.field === "slug") {
      setServerErrors({ slug: res.message });
      focusSoon(SLUG_ID);
    } else if (res.message === TITLE_REQUIRED) {
      setServerErrors({ title: res.message });
      focusSoon(TITLE_ID);
    } else {
      setServerErrors({
        form: { message: res.message, signedOut: res.code === "signed_out" },
      });
    }
  }

  return (
    <section aria-labelledby="pages-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h2
              id="pages-heading"
              className="text-xl leading-tight font-semibold text-hub-ink"
            >
              Pages
            </h2>
            {known ? (
              <span className="text-sm text-hub-ink-muted tabular-nums">
                {count} of {limit} pages
              </span>
            ) : null}
          </div>
          {known ? (
            <p className="text-sm text-hub-ink-muted">{ALLOWANCE_HELP}</p>
          ) : null}
        </div>
        {empty || (atLimit && !open) ? null : (
          <Button
            id={ADD_ID}
            variant="primary"
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={openRow}
            disabled={open}
          >
            Add page
          </Button>
        )}
      </div>

      {atLimit && !open && who ? (
        <PagesFullPanel
          {...who}
          allowance={limit!}
          onBuy={startBuy}
          busy={buyOpen}
        />
      ) : null}
      {buyError ? <InlineAlert tone="error">{buyError}</InlineAlert> : null}

      {open ? (
        <form
          onSubmit={submit}
          noValidate
          aria-label="New page"
          className="flex flex-col gap-4 rounded border border-hub-border bg-hub-surface-2 p-4 md:grid md:grid-cols-2 md:items-start"
        >
          <TextField
            id={TITLE_ID}
            label="Title"
            value={title}
            maxLength={120}
            error={errors.title}
            disabled={saving}
            onChange={(e) => {
              const next = e.target.value;
              setTitle(next);
              setServerErrors((s) => ({ ...s, title: undefined }));
              if (!slugEdited) setSlug(slugify(next));
            }}
          />
          <TextField
            id={SLUG_ID}
            label="URL"
            value={slug}
            maxLength={64}
            spellCheck={false}
            autoCapitalize="none"
            helper={slug ? `Your page's address: /${slug}` : undefined}
            error={errors.slug}
            disabled={saving}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(tidySlugInput(e.target.value));
              setServerErrors((s) => ({ ...s, slug: undefined }));
            }}
          />
          <div className="flex flex-col gap-1 md:col-span-2">
            <label
              htmlFor={NAV_ID}
              className="flex min-h-10 cursor-pointer items-center gap-3 text-base text-hub-ink pointer-coarse:min-h-11"
            >
              <input
                id={NAV_ID}
                type="checkbox"
                className="h-4 w-4"
                checked={addToNav && !navFull}
                disabled={saving || navFull}
                aria-describedby={`${NAV_ID}-help`}
                onChange={(e) => setAddToNav(e.currentTarget.checked)}
              />
              {ADD_TO_NAV_LABEL}
            </label>
            <p
              id={`${NAV_ID}-help`}
              className="pl-7 text-sm text-hub-ink-muted"
            >
              {navFull ? NAV_COPY.limit : ADD_TO_NAV_HELP}
            </p>
          </div>
          {errors.limit !== undefined ? (
            <div className="md:col-span-2">
              <LimitAlert allowance={errors.limit} who={who} onBuy={startBuy} />
            </div>
          ) : null}
          {errors.form ? (
            <div className="md:col-span-2">
              <InlineAlert
                tone="error"
                action={
                  errors.form.signedOut ? (
                    <Link
                      href="/sign-in"
                      className="font-semibold text-hub-accent underline underline-offset-4"
                    >
                      Sign in
                    </Link>
                  ) : undefined
                }
              >
                {errors.form.message}
              </InlineAlert>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button
              type="submit"
              variant="primary"
              loading={saving}
              loadingLabel="Creating…"
            >
              Create page
            </Button>
            <Button variant="ghost" onClick={discard} disabled={saving}>
              Discard new page
            </Button>
          </div>
        </form>
      ) : null}

      {empty ? (
        open ? null : (
          <EmptyState
            heading="No pages yet"
            body="Add your first page. Start with Home, the page visitors see first."
            action={
              <Button id={ADD_ID} variant="primary" onClick={openRow}>
                Add page
              </Button>
            }
          />
        )
      ) : (
        <PagesBuyContext.Provider value={{ who, onBuy: startBuy }}>
          {children}
        </PagesBuyContext.Provider>
      )}
      <ChargeConfirmDialog
        open={buyOpen}
        preview={preview}
        onConfirm={confirmBuy}
        onClose={() => setBuyOpen(false)}
        updateCardHref={CARD_HREF}
      />
    </section>
  );
}

/** The inline refusal (UI-SPEC "Server refusal"): PAGES-FULL, Owner gets the buy link. */
function LimitAlert({
  allowance,
  who,
  onBuy,
}: {
  allowance: number;
  who: PagesFullWho | undefined;
  onBuy: () => void;
}) {
  const view = pagesFullView(
    who ?? {
      role: "",
      impersonating: false,
      paused: false,
      unpriced: false,
    },
    allowance,
  );
  return (
    <InlineAlert
      tone="warning"
      action={
        view.kind === "buy" && who?.priceLabel ? (
          <button
            type="button"
            onClick={onBuy}
            className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-hub-accent underline underline-offset-4"
          >
            {PAGES_FULL_COPY.addLink}
          </button>
        ) : undefined
      }
    >
      {view.text}
    </InlineAlert>
  );
}
