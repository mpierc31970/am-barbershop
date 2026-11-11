"use client";
// Get add-ons client pieces (ADDON-05, ADDON-07; 05-UI-SPEC "Catalog", "Detail", "Add and
// remove", "Destructive actions", "Accessibility contract", R1; D-UI-P5-1, D-UI-P5-8).
//   - AddFlowProvider: the one Add confirm dialog (or its "Add both" variant) shared by the
//     catalog cards and the detail page. Pending locks the dialog ("Adding…"); success lands
//     on the add-on's tab with a toast offering View on site; failure keeps the dialog open
//     with the mapped copy.
//   - CatalogGrid: AddonCards in manifest order (added ones are not moved).
//   - DetailHeaderActions, RemoveSection, HowItWorks: the detail page's client parts.
//     Remove confirms with "Keep it" focused; success toasts "<Name> was removed. Your
//     <plural> are kept." with Add it back (8 s), which opens the Add confirm (10-31).
// P10 (10-31; BILL-12, BILL-03, D186, D-UI-P10-14): the Add confirm asks the server for the
// charge when it opens (skeleton until then) and shows the money block by state: joins the
// order before checkout, today's proration before launch, setup + proration after launch.
// Declined -> ERR-CARD with Update card, nothing added; paused -> PAUSED-NO-ADD with Update
// card and pay and no add button. Pending reads "Charging your card…" when money moves.
// Server Actions are passed straight in as props, so tests can drive them. UI copy never
// says install or uninstall.
import {
  AddonCard,
  Button,
  Dialog,
  InlineAlert,
  Skeleton,
  TrainingDrawer,
  buttonClasses,
  useToast,
  type HowToStepView,
} from "@cds/ui/hub";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AddPreviewResult,
  AddonActionResult,
  addAddonAction,
  addAddonPreviewAction,
  addBothAction,
  removeAddonAction,
  updateCardAction,
} from "../../../actions/addons";
import {
  ERR_CARD,
  ERR_CARD_NOTHING_ADDED,
  PAUSED_NO_ADD,
  PREVIEW_FAILED,
  UNPRICED_ADDON_REASON,
  UPDATE_CARD_AND_PAY,
  addBothCopy,
  errAddPartialCopy,
  COMING_SOON_REASON,
  joinAnd,
  removeRefusedCopy,
  type AddMoney,
  type AddonRef,
  type AvailabilityState,
} from "./catalog-logic";

/** Everything the client needs about one add-on, computed on the server. */
export type AddonView = {
  slug: string;
  name: string;
  /** "testimonials" */
  plural: string;
  /** /hub/add-ons/<slug> */
  href: string;
  /** The add-on's tab. */
  manageHref: string;
  /** Seeded page (or site home) on the live site; null when the site has no host. */
  pageUrl: string | null;
  active: boolean;
  /** Catalog price for the org's path ("$9/mo", "Included"); null = not priced yet. */
  priceLabel: string | null;
  /** Disabled by a billing lapse (BILL-03): Paused badge, Details only. */
  paused: boolean;
  /** PAUSED-ADDON copy. */
  pausedCopy: string;
  /** Remove dialog: "Your monthly bill drops by $9. …"; null before checkout or when free. */
  removeBill: string | null;
  /** 13-32: listed as coming soon and not on the site: Add to site disabled. */
  comingSoon?: boolean;
  state: AvailabilityState;
  missing: AddonRef[];
  add: { title: string; body: string; restored: string | null };
  remove: { title: string; body: string; section: string; toast: string };
  errAdd: string;
  errRemove: string;
};

type UpdateCard = typeof updateCardAction;

export type AddonActions = {
  add: typeof addAddonAction;
  addBoth: typeof addBothAction;
  remove: typeof removeAddonAction;
  /** The Add confirm's server figures (10-31, choice 1). */
  preview: typeof addAddonPreviewAction;
  /** The card page link (Owner only); omitted where nobody may pay. */
  updateCard?: UpdateCard;
};

const CARD_LINK_FAILED =
  "We couldn't open your card page. Try again in a minute.";

const UpdateCardContext = createContext<UpdateCard | null>(null);

const CHARGING = "Charging your card…";
const ADD_TOAST_MS = 6000;
const REMOVE_TOAST_MS = 8000;

function failureText(
  res: Extract<AddonActionResult<unknown>, { ok: false }>,
  fallback: string,
): string {
  return res.code === "save_failed" ? fallback : res.message;
}

/**
 * A Server Action fetch can reject (network drop, deploy version skew, a 413) instead of
 * resolving to a result (C-WR-01, the WR-B02 class). A rejection becomes the generic
 * save_failed result, so the caller's `!res.ok` branch unlocks the dialog and shows the
 * ERR-ADD / ERR-REMOVE fallback copy, and nothing becomes an unhandled rejection.
 */
async function settle<T>(
  call: () => Promise<AddonActionResult<T>>,
): Promise<AddonActionResult<T>> {
  try {
    return await call();
  } catch (err) {
    console.error("[hub add-ons] request failed", err);
    return { ok: false, code: "save_failed", message: "" };
  }
}

function openOnSite(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------------------
// Add flow

type AddFlow = { open: (view: AddonView) => void };

const AddFlowContext = createContext<AddFlow | null>(null);

function useAddFlow(): AddFlow {
  const flow = useContext(AddFlowContext);
  if (!flow)
    throw new Error("useAddFlow must be used inside <AddFlowProvider>");
  return flow;
}

type Target = { view: AddonView; missing: AddonRef[] };

/** `token` is the preview's confirm token (CR-C01), sent back with the add. */
type QuoteBlock = {
  slug: string;
  name: string;
  money: AddMoney;
  token: string;
};

/** The dialog's money state: loading (skeleton), ready (blocks), or a refusal. */
type Quote =
  | { status: "loading" }
  | { status: "ready"; blocks: QuoteBlock[] }
  | {
      status: "refused";
      reason: "unpriced" | "paused" | "forbidden" | "not_found" | "error";
      message: string;
    };

/** One preview request; a rejected fetch becomes the generic error refusal (C-WR-01). */
async function previewOf(
  preview: AddonActions["preview"],
  slug: string,
): Promise<AddPreviewResult> {
  try {
    return await preview(slug);
  } catch (err) {
    console.error("[hub add-ons] price preview failed", err);
    return { ok: false, reason: "error", message: "" };
  }
}

/** Money rows for one add-on (UI-SPEC "Add-on prices and charges"). Formats only. */
function MoneyBlock({ money }: { money: AddMoney }) {
  if (money.kind !== "charge") {
    return <p className="text-sm text-hub-ink-muted">{money.note}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <dl className="flex flex-col gap-2 rounded border border-hub-border p-4 tabular-nums">
        {money.rows.map((r) => (
          <div key={r.label} className="flex flex-wrap items-baseline gap-x-1">
            <dt className={r.strong ? "font-semibold" : undefined}>
              {r.label} ·
            </dt>
            <dd className={r.strong ? "font-semibold" : undefined}>
              {r.amount}
            </dd>
            {r.detail ? (
              <dd className="text-hub-ink-muted">{r.detail}</dd>
            ) : null}
          </div>
        ))}
      </dl>
      {money.note ? (
        <p className="text-sm text-hub-ink-muted">{money.note}</p>
      ) : null}
      {money.cardLine ? (
        <p className="text-sm text-hub-ink-muted">{money.cardLine}</p>
      ) : null}
    </div>
  );
}

export function AddFlowProvider({
  actions,
  children,
}: {
  actions: AddonActions;
  children: ReactNode;
}) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<Target | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const [quote, setQuote] = useState<Quote>({ status: "loading" });
  // Bumped to fetch fresh figures (and tokens) after a price change or a decline (CR-C01).
  const [reload, setReload] = useState(0);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const request = useRef(0);

  const open = useCallback((view: AddonView) => {
    setError(null);
    setDeclined(false);
    setTarget({
      view,
      missing: view.state === "needs" ? view.missing : [],
    });
  }, []);
  const flow = useMemo(() => ({ open }), [open]);

  // Choice 1 (10-31): ask the server for the figures whenever the dialog opens or its set of
  // add-ons changes (Add both). Until they arrive the primary is disabled over a skeleton.
  const items = useMemo(
    () =>
      target
        ? [
            ...target.missing,
            { slug: target.view.slug, name: target.view.name },
          ]
        : [],
    [target],
  );
  const slugKey = items.map((r) => r.slug).join(",");
  const preview = actions.preview;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    if (slugKey === "") return;
    const id = ++request.current;
    const wanted = itemsRef.current;
    setQuote({ status: "loading" });
    void Promise.all(wanted.map((r) => previewOf(preview, r.slug))).then(
      (results) => {
        if (id !== request.current) return;
        const blocks: QuoteBlock[] = [];
        for (let i = 0; i < results.length; i++) {
          const r = results[i]!;
          if (!r.ok) {
            setQuote({
              status: "refused",
              reason: r.reason,
              message: r.message,
            });
            return;
          }
          blocks.push({
            slug: wanted[i]!.slug,
            name: wanted[i]!.name,
            money: r.preview,
            token: r.token,
          });
        }
        setQuote({ status: "ready", blocks });
      },
    );
  }, [slugKey, preview, reload]);

  // P5 add rule: the primary takes focus once the figures are in.
  useEffect(() => {
    if (quote.status === "ready") primaryRef.current?.focus();
  }, [quote]);

  const close = () => {
    if (pending) return;
    request.current++;
    setTarget(null);
    setError(null);
    setDeclined(false);
  };

  const charging =
    quote.status === "ready" &&
    quote.blocks.some((b) => b.money.kind === "charge");

  const confirm = async () => {
    if (!target || pending || quote.status !== "ready") return;
    const { view, missing } = target;
    const both = missing.length > 0;
    const tokens: Record<string, string> = Object.create(null);
    for (const b of quote.blocks) tokens[b.slug] = b.token;
    setPending(true);
    setError(null);
    setDeclined(false);
    const res = both
      ? await settle(() => actions.addBoth(view.slug, { ...tokens }))
      : await settle(() => actions.add(view.slug, tokens[view.slug]));
    setPending(false);
    if (!res.ok) {
      // Add both is step by step (C-WR-02): requirements that went on stay on. Say so, drop
      // them from the dialog, and refresh so the catalog and detail page show them as added.
      const done = ("added" in res ? res.added : undefined) ?? [];
      const partial =
        done.length > 0 ? errAddPartialCopy(view.name, done) : null;
      router.refresh();
      if (res.code === "paused" || res.code === "unpriced") {
        // The account lapsed or the price was unset since the preview: no add button now.
        setQuote({ status: "refused", reason: res.code, message: res.message });
        return;
      }
      // The site changed under us: a requirement is missing, so offer Add both instead.
      if (res.code === "addon_missing_requirement" && "missing" in res) {
        const more = res.missing ?? [];
        if (more.length > 0) {
          setTarget({ view, missing: more });
          setError(partial);
          return;
        }
      }
      if (done.length > 0) {
        const on = new Set(done.map((r) => r.slug));
        setTarget({ view, missing: missing.filter((r) => !on.has(r.slug)) });
      }
      if (res.code === "price_changed") {
        // CR-C01: the figures moved since the preview. Show the new ones; nothing was charged.
        setError(partial ?? res.message);
        setReload((n) => n + 1);
        return;
      }
      if (res.code === "card_declined" && !partial) {
        // ERR-CARD: nothing was installed (the gate installs only after payment). A retry
        // after Update card needs a new attempt, so fetch fresh figures (a new token).
        setDeclined(true);
        setReload((n) => n + 1);
        return;
      }
      setError(partial ?? failureText(res, view.errAdd));
      return;
    }
    setTarget(null);
    const names = both
      ? joinAnd([...missing.map((r) => r.name), view.name])
      : view.name;
    const pageUrl = res.data.pageUrl;
    toast.show({
      message: `${names} ${both ? "are" : "is"} on your site.${charging ? " Receipt emailed." : ""}`,
      durationMs: ADD_TOAST_MS,
      ...(pageUrl
        ? {
            action: {
              label: "View on site",
              onClick: () => openOnSite(pageUrl),
            },
          }
        : {}),
    });
    router.push(res.data.tabHref);
    // The sidebar is composed in the shared /hub layout, which push alone does not re-render
    // (C-WR-05). The router queue runs this after the push, so the layout re-reads the
    // active add-ons on the new route.
    router.refresh();
  };

  const view = target?.view;
  const both = (target?.missing.length ?? 0) > 0;
  const copy = view
    ? both
      ? { ...addBothCopy(view.name, target!.missing), restored: null }
      : view.add
    : null;
  const single =
    quote.status === "ready" && quote.blocks.length === 1
      ? quote.blocks[0]!.money
      : null;
  const primaryLabel = both
    ? "Add both"
    : single?.kind === "charge"
      ? single.confirmLabel
      : "Add to site";
  const refused = quote.status === "refused" ? quote : null;

  return (
    <AddFlowContext.Provider value={flow}>
      <UpdateCardContext.Provider value={actions.updateCard ?? null}>
        {children}
        {/* Mounted only while open. The primary takes focus once the price is in. */}
        {copy ? (
          <Dialog
            open
            onClose={close}
            title={copy.title}
            footer={
              <>
                {refused ? null : (
                  <Button
                    ref={primaryRef}
                    variant="primary"
                    data-add-primary=""
                    disabled={quote.status !== "ready"}
                    loading={pending}
                    loadingLabel={charging ? CHARGING : "Adding…"}
                    onClick={() => void confirm()}
                  >
                    {primaryLabel}
                  </Button>
                )}
                <Button variant="ghost" onClick={close} disabled={pending}>
                  Not now
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-4">
              <p>{copy.body}</p>
              {copy.restored ? <p>{copy.restored}</p> : null}
              {quote.status === "loading" ? (
                <div data-money-skeleton="">
                  <Skeleton rows={2} rowHeight={24} />
                </div>
              ) : null}
              {quote.status === "ready"
                ? quote.blocks.map((b) => (
                    <div key={b.slug} className="flex flex-col gap-2">
                      {quote.blocks.length > 1 ? (
                        <p className="text-sm font-semibold">{b.name}</p>
                      ) : null}
                      <MoneyBlock money={b.money} />
                    </div>
                  ))
                : null}
              {refused?.reason === "paused" ? (
                <InlineAlert
                  tone="warning"
                  action={<UpdateCardButton variant="secondary" />}
                >
                  {PAUSED_NO_ADD}
                </InlineAlert>
              ) : null}
              {refused?.reason === "unpriced" ? (
                <InlineAlert tone="warning">
                  {UNPRICED_ADDON_REASON}
                </InlineAlert>
              ) : null}
              {refused &&
              refused.reason !== "paused" &&
              refused.reason !== "unpriced" ? (
                <InlineAlert tone="error">
                  {refused.reason === "error" || refused.message === ""
                    ? PREVIEW_FAILED
                    : refused.message}
                </InlineAlert>
              ) : null}
              {declined ? (
                <InlineAlert
                  tone="error"
                  action={
                    <UpdateCardButton variant="secondary" label="Update card" />
                  }
                >
                  <p>{ERR_CARD}</p>
                  <p>{ERR_CARD_NOTHING_ADDED}</p>
                </InlineAlert>
              ) : null}
              {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
            </div>
          </Dialog>
        ) : null}
      </UpdateCardContext.Provider>
    </AddFlowContext.Provider>
  );
}

// ---------------------------------------------------------------------------------------
// Catalog

export type CatalogCard = AddonView & { summary: string; meta: string };

export function CatalogGrid({
  cards,
  canAdd,
}: {
  cards: readonly CatalogCard[];
  canAdd: boolean;
}) {
  const flow = useAddFlow();
  return (
    <ul className="grid grid-cols-1 gap-6 md:grid-cols-2 min-[1120px]:grid-cols-3">
      {cards.map((c, i) => (
        <li
          key={c.slug}
          className="flex"
          data-tour={i === 0 ? "addons-card" : undefined}
        >
          <div className="flex w-full flex-col [&>article]:flex-1">
            <AddonCard
              name={c.name}
              summary={c.summary}
              meta={c.meta}
              active={c.active}
              href={c.href}
              manageHref={c.manageHref}
              canAdd={canAdd}
              priceLabel={c.priceLabel}
              paused={c.paused}
              comingSoon={c.comingSoon === true}
              onAdd={() => flow.open(c)}
              LinkComponent={Link}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------
// Detail

/** Header right side: Add to site, or Manage + View on site once it is on. */
export function DetailHeaderActions({ view }: { view: AddonView }) {
  const flow = useAddFlow();
  if (view.active) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link href={view.manageHref} className={buttonClasses("primary")}>
          Manage {view.plural}
        </Link>
        {view.pageUrl ? (
          <a
            href={view.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${view.name} page (opens in a new tab)`}
            className={buttonClasses("secondary")}
          >
            <ExternalLink aria-hidden size={16} strokeWidth={2} />
            <span>View on site</span>
          </a>
        ) : null}
      </div>
    );
  }
  const enabled = view.state === "can-add" || view.state === "needs";
  if (view.comingSoon && !view.paused) {
    // 13-32 (STAFF-07): shown, never added; the action refuses it server-side too.
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="primary"
          aria-disabled
          aria-describedby={`coming-soon-${view.slug}`}
          className="cursor-not-allowed opacity-50"
        >
          Add to site
        </Button>
        <p
          id={`coming-soon-${view.slug}`}
          className="text-sm text-hub-ink-muted"
        >
          {COMING_SOON_REASON}
        </p>
      </div>
    );
  }
  if (view.paused) {
    // BILL-03: the Owner pays to bring it back; nothing new is added while paused.
    return enabled ? <UpdateCardButton variant="secondary" /> : null;
  }
  if (enabled && view.priceLabel === null) {
    // D264: no invented number, so no dialog until the price is set (UNPRICED-ADDON).
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          variant="primary"
          aria-disabled
          aria-describedby={`unpriced-${view.slug}`}
          className="cursor-not-allowed opacity-50"
        >
          Add to site
        </Button>
        <p id={`unpriced-${view.slug}`} className="text-sm text-hub-ink-muted">
          {UNPRICED_ADDON_REASON}
        </p>
      </div>
    );
  }
  return (
    <Button
      variant="primary"
      disabled={!enabled}
      onClick={() => flow.open(view)}
    >
      Add to site
    </Button>
  );
}

/**
 * "Update card and pay" / "Update card": opens the provider's card page for the org's own
 * customer (billingPortalLink, Owner only). The URL is fetched on click, never rendered into
 * the page, so a stale link can't be reused.
 */
export function UpdateCardButton({
  variant = "secondary",
  label = UPDATE_CARD_AND_PAY,
}: {
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
}) {
  const update = useContext(UpdateCardContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!update) return null;
  const go = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    let res: Awaited<ReturnType<UpdateCard>>;
    try {
      res = await update();
    } catch (err) {
      console.error("[hub add-ons] card link failed", err);
      res = { ok: false, code: "save_failed", message: CARD_LINK_FAILED };
    }
    if (res.ok) {
      window.location.assign(res.data.url);
      return;
    }
    setPending(false);
    setError(res.code === "save_failed" ? CARD_LINK_FAILED : res.message);
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant={variant}
        loading={pending}
        loadingLabel="Opening…"
        onClick={() => void go()}
      >
        {label}
      </Button>
      {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
    </div>
  );
}

/** Secondary-danger: 1px danger border, danger text, danger tint on hover. */
const DANGER_OUTLINE =
  "inline-flex h-10 items-center justify-center gap-2 rounded border border-hub-danger " +
  "bg-hub-surface px-4 font-hub text-base font-semibold whitespace-nowrap text-hub-danger " +
  "transition-colors duration-150 select-none hover:bg-hub-danger-tint " +
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-hub-surface " +
  "pointer-coarse:min-h-11";

export function RemoveSection({
  view,
  actions,
  dependents,
  refusal,
}: {
  view: AddonView;
  actions: AddonActions;
  /** Active add-ons that need this one; non-empty refuses removal up front. */
  dependents: readonly AddonRef[];
  /** Not-owner / impersonating copy, when removal isn't the viewer's to make. */
  refusal: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedBy, setBlockedBy] = useState<readonly AddonRef[]>(dependents);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(null);
  };

  const flow = useAddFlow();

  const confirm = async () => {
    setPending(true);
    setError(null);
    const res = await settle(() => actions.remove(view.slug));
    setPending(false);
    if (!res.ok) {
      if (res.code === "addon_required_by" && "dependents" in res) {
        setBlockedBy(res.dependents ?? []);
        setOpen(false);
        return;
      }
      setError(failureText(res, view.errRemove));
      return;
    }
    setOpen(false);
    toast.show({
      message: view.remove.toast,
      durationMs: REMOVE_TOAST_MS,
      // D-UI-P5-8 resolved (10-31): adding back can charge now, so it opens the Add
      // confirm with its money block instead of re-adding silently (T-10-31-01).
      action: {
        label: "Add it back",
        onClick: () => flow.open({ ...view, active: false, paused: false }),
      },
    });
    router.refresh();
  };

  return (
    <section
      aria-labelledby="remove-heading"
      className="mt-12 flex flex-col gap-4 border-t border-hub-border pt-12"
    >
      <h2 id="remove-heading" className="text-xl leading-tight font-semibold">
        Remove from site
      </h2>
      <p className="max-w-[68ch] text-base">{view.remove.section}</p>
      {blockedBy.length > 0 ? (
        <InlineAlert tone="warning">
          {removeRefusedCopy(view.name, blockedBy)}{" "}
          {blockedBy.map((d, i) => (
            <span key={d.slug}>
              {i > 0 ? " · " : null}
              <Link
                href={`/hub/add-ons/${encodeURIComponent(d.slug)}`}
                className="text-hub-accent underline underline-offset-2"
              >
                {d.name}
              </Link>
            </span>
          ))}
        </InlineAlert>
      ) : null}
      {refusal ? <InlineAlert tone="info">{refusal}</InlineAlert> : null}
      <div>
        <button
          type="button"
          className={DANGER_OUTLINE}
          disabled={refusal !== null || blockedBy.length > 0}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Remove from site
        </button>
      </div>
      {open ? (
        <Dialog
          open
          onClose={close}
          title={view.remove.title}
          footer={
            <>
              <Button
                variant="ghost"
                autoFocus
                onClick={close}
                disabled={pending}
              >
                Keep it
              </Button>
              <Button
                variant="destructive"
                loading={pending}
                loadingLabel="Removing…"
                onClick={() => void confirm()}
              >
                Remove from site
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            <p>{view.remove.body}</p>
            {view.removeBill ? <p>{view.removeBill}</p> : null}
            {error ? <InlineAlert tone="error">{error}</InlineAlert> : null}
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

/** How it works: the first 3 "Use" steps, then "Read all steps" in the TrainingDrawer. */
export function HowItWorks({
  title,
  steps,
}: {
  title: string;
  steps: readonly HowToStepView[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-base font-semibold">{title}</p>
      <ol className="flex max-w-[68ch] list-decimal flex-col gap-4 pl-6 marker:font-semibold">
        {steps.slice(0, 3).map((s, i) => (
          <li key={i} className="text-base">
            <p>{s.action}</p>
            <p className="mt-1 text-sm text-hub-ink-muted">{s.expected}</p>
          </li>
        ))}
      </ol>
      {steps.length > 3 ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded text-base text-hub-accent underline underline-offset-2"
          >
            Read all steps
          </button>
        </div>
      ) : null}
      <TrainingDrawer
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        steps={steps}
      />
    </div>
  );
}
