"use client";
// The /start configurator (ONB-06, ONB-08, ONB-11, ONB-12; UI-SPEC "Configurator", Persuade
// mode, D79, D104; CONTEXT A1-Q2). One page, progressive sections: path, then business
// type, then add-ons + extras. Every choice persists to the server quote through
// chooseQuoteAction (the first one creates it and sets the httpOnly cookie), so a reload
// restores every choice. The add-on list is computed here from plain PickableAddon[] with
// pickableAddons(pickSourceFrom(list), …): no functions cross the RSC boundary.
//
// Saves: path and business type go at once; ticks and the "Something else" text are
// debounced 500 ms (at most one request per 500 ms, T-06-71). Only the latest response is
// applied. A new section fades in (200 ms, instant under reduced motion) and focus moves to
// its heading.
//
// The receipt (06-15): at 1024 px and up it sits in the sticky 360 px rail; below, the
// phone ReceiptBar + bottom sheet. Its figures are the client priceQuote until the latest
// save returns, then the server's recomputed totals (T-06-76). A restored quote shows the
// returning Toast once per session; ?welcome=1 (the reopen link, 06-16) shows the welcome
// variant and is stripped from the URL.
import type { AddonPath } from "@cds/core/addons";
import {
  businessTypesFor,
  findBusinessType,
  pickableAddons,
  pickSourceFrom,
  reconcileSelections,
  type Extra,
  type PathInfo,
  type PickableAddon,
} from "@cds/core/onboarding";
import type {
  BillingCadence,
  CatalogRow,
  QuoteSelections,
} from "@cds/core/pricing";
import type { QuoteView } from "@cds/core/pricing";
import {
  InlineAlert,
  ToastRegion,
  useReducedMotion,
  useToast,
} from "@cds/ui/hub";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { addonPreselectedLine } from "@cds/core/marketing";
import { chooseQuoteAction, type QuoteChoice } from "../../../actions/quote";
import { AddonPickList } from "./AddonPickList";
import { BusinessTypePicker } from "./BusinessTypePicker";
import { HOSTING_FAQ_ID, HostingFaq } from "./HostingFaq";
import { PathChoice } from "./PathChoice";
import { Receipt, receiptTotals } from "./Receipt";
import { ReceiptBar, useWideScreen } from "./ReceiptBar";
import { SAVE_EMAIL_ID, SaveQuoteCard } from "./SaveQuoteCard";
import { StartFrame } from "./StartFrame";
import {
  currentStep,
  removedMessage,
  sectionVisibility,
  type StartPreselect,
} from "./start-logic";

export const SAVE_DEBOUNCE_MS = 500;
export const RETURNING_TOAST = "Your quote is just as you left it.";
export const WELCOME_TOAST = "Welcome back. Your quote is just as you left it.";
/** sessionStorage: the returning Toast has been shown (or a quote began) this session. */
export const RETURN_SEEN_KEY = "cds-start-returned";
/** sessionStorage: the save card was dismissed or used this session. */
export const SAVE_CARD_KEY = "cds-start-save-card";
const RATE_COPY = "You're going a little fast. Wait a minute, then try again.";

export interface ConfiguratorProps {
  initialQuote: QuoteView | null;
  catalog: CatalogRow[] | null;
  addons: PickableAddon[];
  /** 13-32: listed add-ons that can't be picked yet (shown disabled, "Coming soon"). */
  comingSoon?: readonly string[];
  paths: readonly PathInfo[];
  extras: readonly Extra[];
  /**
   * 15-21 (HUB-02): a hub CTA's validated `?path=` / `?addon=`. Applied once on mount, and
   * only when the restored quote has no path (P15-P25, Pitfall 9).
   */
  preselect?: StartPreselect | null;
}

type Choices = {
  path: AddonPath | "";
  businessType: string;
  businessTypeOther: string;
  selections: QuoteSelections;
};

const EMPTY_SELECTIONS: QuoteSelections = {
  addons: [],
  extras: [],
  carePlan: false,
  cadence: "monthly",
};

function fromQuote(q: QuoteView | null): Choices {
  if (!q) {
    return {
      path: "",
      businessType: "",
      businessTypeOther: "",
      selections: EMPTY_SELECTIONS,
    };
  }
  return {
    path: q.path,
    businessType: q.businessType,
    businessTypeOther: q.businessTypeOther,
    selections: q.selections,
  };
}

/** Read a sessionStorage flag, optionally setting it. False when storage is unavailable. */
export function sessionFlag(key: string, set = false): boolean {
  try {
    const seen = window.sessionStorage.getItem(key) === "1";
    if (set) window.sessionStorage.setItem(key, "1");
    return seen;
  } catch {
    return false;
  }
}

/** The returning-visitor Toast (UI-SPEC Configurator states). Renders nothing. */
function ReturnNotice({ restored }: { restored: boolean }) {
  const toast = useToast();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const url = new URL(window.location.href);
    const welcome = url.searchParams.get("welcome") === "1";
    if (welcome) {
      url.searchParams.delete("welcome");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    if (!restored) return;
    const seen = sessionFlag(RETURN_SEEN_KEY, true);
    if (welcome) toast.show({ message: WELCOME_TOAST });
    else if (!seen) toast.show({ message: RETURNING_TOAST });
  }, [restored, toast]);
  return null;
}

const NONE: readonly string[] = [];

const SECTION_FADE =
  "transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none";

export function Configurator({
  initialQuote,
  catalog,
  addons,
  comingSoon = NONE,
  paths,
  extras,
  preselect = null,
}: ConfiguratorProps) {
  const [choices, setChoices] = useState<Choices>(() =>
    fromQuote(initialQuote),
  );
  const [quote, setQuote] = useState<QuoteView | null>(initialQuote);
  // The server quote matches what is on screen (no save pending): its totals win.
  const [synced, setSynced] = useState(true);
  const wide = useWideScreen();
  // The save card: hidden for the session after No thanks or a save; `savedHere` keeps
  // its confirmation line on screen after a save in this visit.
  const [cardHidden, setCardHidden] = useState(false);
  const [savedHere, setSavedHere] = useState(false);
  useEffect(() => {
    if (sessionFlag(SAVE_CARD_KEY)) setCardHidden(true);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reduced = useReducedMotion();

  const source = useMemo(() => pickSourceFrom(addons), [addons]);
  const names = useMemo(
    () => new Map(addons.map((a) => [a.slug, a.name])),
    [addons],
  );
  const addonNames = useMemo(() => Object.fromEntries(names), [names]);
  const pathLabel = useCallback(
    (p: string) => paths.find((x) => x.id === p)?.label ?? p,
    [paths],
  );

  // ---------------------------------------------------------------- saving
  const seq = useRef(0);
  const selTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otherTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The business type last sent to (or loaded from) the server quote (B-WR-06).
  const sentType = useRef(initialQuote?.businessType ?? "");
  // A path the /start preselect put on screen but not yet on the server (15 CR-A01,
  // WR-A01): the visitor's first real choice carries it, so a page view alone never
  // creates a quote or a cookie, and a path-less save never fails on a fresh visit.
  const unsentPath = useRef<AddonPath | null>(null);
  // The latest on-screen choices, for the selections a carried path is saved with.
  const latest = useRef(choices);
  useEffect(() => {
    latest.current = choices;
  });

  const send = useCallback(
    async (input: QuoteChoice, toPathIn?: string) => {
      const mine = ++seq.current;
      let patch = input;
      let toPath = toPathIn;
      const carried = input.path === undefined ? unsentPath.current : null;
      unsentPath.current = null;
      if (carried) {
        const sel = latest.current.selections;
        const hasPicks = sel.addons.length > 0 || sel.extras.length > 0;
        patch = {
          path: carried,
          ...(hasPicks ? { selections: sel } : {}),
          ...input,
        };
        toPath = toPath ?? carried;
      }
      if (patch.businessType !== undefined)
        sentType.current = patch.businessType;
      let res: Awaited<ReturnType<typeof chooseQuoteAction>>;
      try {
        res = await chooseQuoteAction(patch);
      } catch {
        res = {
          quote: null,
          removed: [],
          error:
            "We couldn't save your latest choice. Check your connection; we'll try again with your next change.",
        };
      }
      if (res.error) {
        // Not saved: the next change carries the preselected path again.
        if (carried && unsentPath.current === null)
          unsentPath.current = carried;
        setError(res.error);
        return;
      }
      setError(null);
      if (res.removed.length > 0) {
        const gone = new Set(res.removed);
        setChoices((c) => ({
          ...c,
          selections: {
            ...c.selections,
            addons: c.selections.addons.filter((s) => !gone.has(s)),
          },
        }));
        setNotice(
          removedMessage(
            res.removed.map((s) => names.get(s) ?? s),
            pathLabel(toPath ?? res.quote?.path ?? ""),
          ),
        );
      }
      if (mine === seq.current) {
        setQuote(res.quote);
        // A quote begun this session is not a "returning" one on reload.
        sessionFlag(RETURN_SEEN_KEY, true);
        if (!selTimer.current && !otherTimer.current) setSynced(true);
      }
    },
    [names, pathLabel],
  );

  useEffect(
    () => () => {
      if (selTimer.current) clearTimeout(selTimer.current);
      if (otherTimer.current) clearTimeout(otherTimer.current);
    },
    [],
  );

  function saveSelectionsSoon(selections: QuoteSelections) {
    setSynced(false);
    if (selTimer.current) clearTimeout(selTimer.current);
    selTimer.current = setTimeout(() => {
      selTimer.current = null;
      void send({ selections });
    }, SAVE_DEBOUNCE_MS);
  }

  // ---------------------------------------------------------------- choices
  /** Put a path (and the selections it keeps) on screen; saving is the caller's job. */
  function showPath(path: AddonPath, current: QuoteSelections) {
    const { selections, removed } = reconcileSelections(source, path, current);
    const typeFits =
      findBusinessType(choices.businessType)?.paths.includes(path) ?? false;
    setChoices((c) => ({
      ...c,
      path,
      businessType: typeFits ? c.businessType : "",
      businessTypeOther: typeFits ? c.businessTypeOther : "",
      selections,
    }));
    setNotice(
      removedMessage(
        removed.map((s) => names.get(s) ?? s),
        pathLabel(path),
      ),
    );
  }

  function choosePath(
    path: AddonPath,
    current: QuoteSelections = choices.selections,
  ) {
    if (path === choices.path) return;
    if (selTimer.current) {
      clearTimeout(selTimer.current);
      selTimer.current = null;
    }
    showPath(path, current);
    setSynced(false);
    const hasPicks = current.addons.length > 0 || current.extras.length > 0;
    void send(hasPicks ? { path, selections: current } : { path }, path);
  }

  /**
   * B-WR-06: "Something else" with no text yet is no type at all, so the server quote must
   * not keep the one the visitor just left (a reload or Submit would bring it back).
   */
  function clearServerType() {
    if (sentType.current !== "") void send({ businessType: "" });
  }

  function chooseType(id: string) {
    if (id === choices.businessType) return;
    setChoices((c) => ({ ...c, businessType: id }));
    setSynced(false);
    if (id !== "other") {
      if (otherTimer.current) clearTimeout(otherTimer.current);
      void send({ businessType: id });
    } else if (choices.businessTypeOther.trim() !== "") {
      void send({
        businessType: "other",
        businessTypeOther: choices.businessTypeOther.trim(),
      });
    } else {
      clearServerType();
    }
  }

  function changeOther(text: string) {
    setChoices((c) => ({ ...c, businessTypeOther: text }));
    if (otherTimer.current) clearTimeout(otherTimer.current);
    otherTimer.current = null;
    const trimmed = text.trim();
    if (trimmed === "") {
      clearServerType();
      return;
    }
    otherTimer.current = setTimeout(() => {
      otherTimer.current = null;
      void send({ businessType: "other", businessTypeOther: trimmed });
    }, SAVE_DEBOUNCE_MS);
  }

  function toggle(kind: "addons" | "extras", key: string, on: boolean) {
    const list = choices.selections[kind];
    const nextList = on
      ? list.includes(key)
        ? list
        : [...list, key]
      : list.filter((k) => k !== key);
    const selections = { ...choices.selections, [kind]: nextList };
    setChoices((c) => ({ ...c, selections }));
    saveSelectionsSoon(selections);
  }

  function setSelection(patch: Partial<QuoteSelections>) {
    const selections = { ...choices.selections, ...patch };
    setChoices((c) => ({ ...c, selections }));
    saveSelectionsSoon(selections);
  }

  const setCadence = (cadence: BillingCadence) => {
    if (cadence !== choices.selections.cadence) setSelection({ cadence });
  };
  const setCarePlan = (carePlan: boolean) => setSelection({ carePlan });

  function dismissCard() {
    sessionFlag(SAVE_CARD_KEY, true);
    setCardHidden(true);
  }

  const onSaved = useCallback((email: string) => {
    sessionFlag(SAVE_CARD_KEY, true);
    setSavedHere(true);
    setQuote((q) => (q ? { ...q, email, status: "saved" } : q));
  }, []);

  /** Receipt "Save this quote": bring the card back and put the cursor in it. */
  function openSaveCard() {
    setCardHidden(false);
    setTimeout(() => {
      const input = document.getElementById(SAVE_EMAIL_ID);
      input?.scrollIntoView?.({ block: "center" });
      input?.focus({ preventScroll: true });
    }, 0);
  }

  // ---------------------------------------------------------------- preselect (15-21)
  // A stored quote with a path wins: the preselect never overwrites it (P15-P25).
  // The preselect is shown, never saved on mount (15 CR-A01, WR-A01): a page view (or a
  // crawler following a hub CTA) creates no quote and no cookie, and a path-less add-on
  // never hits the "no quote yet" save failure. The visitor's first choice saves it all.
  const pre = initialQuote?.path ? null : preselect;
  const preApplied = useRef(false);
  useEffect(() => {
    if (preApplied.current || !pre) return;
    preApplied.current = true;
    const slug = pre.addon?.slug;
    const sel = choices.selections;
    const withAddon =
      slug && !sel.addons.includes(slug)
        ? { ...sel, addons: [...sel.addons, slug] }
        : sel;
    if (pre.path && !choices.path) {
      showPath(pre.path, withAddon);
      unsentPath.current = pre.path;
    } else if (slug) setChoices((c) => ({ ...c, selections: withAddon }));
    // Mount only: the preselect comes from the first request's query string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------- reveal + focus
  const visible = sectionVisibility(choices);
  const businessHeading = useRef<HTMLHeadingElement>(null);
  const addonsHeading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(visible);
  const { business: showBusiness, addons: showAddons } = visible;
  useEffect(() => {
    const before = shown.current;
    shown.current = { business: showBusiness, addons: showAddons };
    const target =
      showAddons && !before.addons
        ? addonsHeading.current
        : showBusiness && !before.business
          ? businessHeading.current
          : null;
    if (!target) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView?.({
      block: "start",
      behavior: reduced ? "auto" : "smooth",
    });
  }, [showBusiness, showAddons, reduced]);

  function openFaq(e: MouseEvent<HTMLAnchorElement>) {
    const box = document.getElementById(HOSTING_FAQ_ID);
    if (!(box instanceof HTMLDetailsElement)) return;
    e.preventDefault();
    box.open = true;
    box.scrollIntoView?.({
      block: "start",
      behavior: reduced ? "auto" : "smooth",
    });
    box.querySelector("summary")?.focus({ preventScroll: true });
  }

  // ---------------------------------------------------------------- render
  const path = choices.path;
  const types = path ? businessTypesFor(path) : [];
  const type = findBusinessType(choices.businessType);
  const lists = path
    ? pickableAddons(source, path, choices.businessType || null)
    : { recommended: [], rest: [] };

  const typeChosen =
    Boolean(type) &&
    (choices.businessType !== "other" ||
      choices.businessTypeOther.trim() !== "");
  const serverTotals = synced ? (quote?.totals ?? null) : null;
  // After the second choice (path + type), once the server quote exists (D213).
  const offerSave =
    Boolean(path) && typeChosen && quote !== null && !quote.email;
  const showCard = savedHere || (offerSave && !cardHidden);
  const receipt = (
    <Receipt
      catalog={catalog}
      path={path}
      typeChosen={typeChosen}
      selections={choices.selections}
      serverTotals={serverTotals}
      addonNames={addonNames}
      extras={extras}
      paths={paths}
      savedEmail={quote?.email || null}
      onCadence={setCadence}
      onCarePlan={setCarePlan}
      onSaveLink={wide && offerSave ? openSaveCard : undefined}
    />
  );
  const barTotals = receiptTotals(
    catalog,
    path,
    choices.selections,
    serverTotals,
  );

  return (
    <ToastRegion>
      <ReturnNotice restored={initialQuote !== null} />
      <StartFrame step={currentStep(choices)} onFaqLink={openFaq}>
        <div className="lg:grid lg:grid-cols-[minmax(0,720px)_360px] lg:items-start lg:gap-12">
          <div className="flex min-w-0 flex-col">
            {error ? (
              <div className="mb-8">
                <InlineAlert tone={error === RATE_COPY ? "warning" : "error"}>
                  {error}
                </InlineAlert>
              </div>
            ) : null}

            <section
              id="start-path"
              aria-labelledby="start-path-title"
              className="scroll-mt-8"
            >
              <h1 className="text-[1.75rem] leading-tight font-semibold">
                Build your website
              </h1>
              <p className="mt-2 max-w-[56ch] text-base text-hub-ink-muted">
                Pick your path and the add-ons you want. Your price updates as
                you go, and you&apos;ll see the full cost before you commit.
              </p>
              <h2
                id="start-path-title"
                className="mt-12 mb-4 text-xl leading-tight font-semibold"
              >
                Which sounds like you?
              </h2>
              <PathChoice
                labelledBy="start-path-title"
                paths={paths}
                catalog={catalog}
                value={path}
                onChange={choosePath}
              />
              <div role="status" className="mt-4 empty:hidden">
                {notice ? (
                  <InlineAlert tone="info">{notice}</InlineAlert>
                ) : null}
              </div>
            </section>

            {visible.business && path ? (
              <section
                id="start-business"
                aria-labelledby="start-business-title"
                className={`scroll-mt-8 ${SECTION_FADE}`}
              >
                <h2
                  id="start-business-title"
                  ref={businessHeading}
                  tabIndex={-1}
                  className="mt-12 text-xl leading-tight font-semibold focus:outline-none"
                >
                  What kind of business?
                </h2>
                <p className="mt-2 mb-4 text-base text-hub-ink-muted">
                  We&apos;ll suggest the add-ons that suit it.
                </p>
                <BusinessTypePicker
                  labelledBy="start-business-title"
                  types={types}
                  value={choices.businessType}
                  other={choices.businessTypeOther}
                  onChange={chooseType}
                  onOtherChange={changeOther}
                />
              </section>
            ) : null}

            <div className="mt-8">
              <HostingFaq />
            </div>

            {visible.addons && path && type ? (
              <section
                id="start-addons"
                aria-labelledby="start-addons-title"
                className={`scroll-mt-8 ${SECTION_FADE}`}
              >
                <h2
                  id="start-addons-title"
                  ref={addonsHeading}
                  tabIndex={-1}
                  className="mt-12 text-xl leading-tight font-semibold focus:outline-none"
                >
                  Recommended for {type.plural}
                </h2>
                <p className="mt-2 mb-4 text-base text-hub-ink-muted">
                  Every site includes up to 10 pages you edit yourself, hosting
                  and support. Add-ons chosen now have no setup fee.
                </p>
                {pre?.addon ? (
                  <div className="mb-4">
                    <InlineAlert tone="info">
                      {addonPreselectedLine(pre.addon.name)}
                    </InlineAlert>
                  </div>
                ) : null}
                <AddonPickList
                  key={`${path}:${type.id}`}
                  path={path}
                  catalog={catalog}
                  recommended={lists.recommended}
                  rest={lists.rest}
                  extras={extras}
                  comingSoon={comingSoon}
                  selectedAddons={choices.selections.addons}
                  selectedExtras={choices.selections.extras}
                  onToggleAddon={(slug, on) => toggle("addons", slug, on)}
                  onToggleExtra={(key, on) => toggle("extras", key, on)}
                />
                {showCard ? (
                  <SaveQuoteCard onSaved={onSaved} onDismiss={dismissCard} />
                ) : null}
              </section>
            ) : null}
          </div>
          {wide ? (
            <div className="hidden lg:sticky lg:top-8 lg:block">{receipt}</div>
          ) : null}
        </div>
      </StartFrame>
      {!wide && path ? (
        <ReceiptBar
          monthlyCents={barTotals ? barTotals.monthlyCents : null}
          buildCents={barTotals ? barTotals.build.cents : null}
        >
          {receipt}
        </ReceiptBar>
      ) : null}
    </ToastRegion>
  );
}
