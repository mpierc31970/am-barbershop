"use client";
// Hub help drawer host (11-47; DASH-17, D110, D-UI-P11-16; 11-UI-SPEC "\"?\" on every
// screen"; T-11-47-02). Mounted once by HubShell around the screen. It provides the
// HelpOpenerContext that every ScreenHeader "?" uses: a plain click sets `?help=<helpId>` on
// the current URL (history.replaceState, so `tab` and the rest of the query stay and no
// server round trip happens) and opens the TrainingDrawer with that screen's how-to steps,
// fetched from GET /hub/api/help/<id> (session, closed id map, audience check; 404 otherwise).
// A `?help=` already in the URL (shared link, reload) opens the drawer on load. Closing (Esc,
// Close, backdrop) removes the param. Unknown or refused ids open nothing.
// Screen-owned ids: when a screen has its own `?help=` drawer, that drawer wins and this host
// stays shut (SCREEN_OWNED_HELP_IDS: `stripe` = Settings › Payments' Stripe how-to).
// Without JavaScript the "?" is a link to /hub/help/<helpId>.
// 11-48 (DASH-17): also provides TourReplayContext. A screen's TourHost registers its tour
// while mounted; when the open article's `tour` (from the API) is registered here, the footer
// adds "Show the tour", which closes the drawer and replays the tour in place.
// 12-20 (COMM-06; 12-UI-SPEC "Help entry" lines 612-617): after Open in Help center, a line in
// the CDS identity, "Still stuck? Ask CDS", opens the Get help form as a question about the
// current screen: /hub/support/tickets/new?type=question&target=<screen target>&from=<url>.
// The help API says whether this person may file (`askCds`: support:write, not impersonating),
// so Viewers and staff viewing as the tenant never see it. The target is only a hint: the form
// keeps it only when it is one of the org's own options (else Whole site).
import type { HowToStepView } from "@cds/ui/hub";
import { TrainingDrawer } from "@cds/ui/hub";
import {
  TOUR_COPY,
  TourReplayContext,
  isTourId,
  type TourId,
  type TourReplay,
} from "@cds/ui/hub/help";
import { HelpOpenerContext } from "@cds/ui/hub/shell";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { WEBSITE_TABS } from "./website/tabs";

/** `?help=` ids a screen answers with its own drawer (the screen's drawer wins). */
export const SCREEN_OWNED_HELP_IDS: ReadonlySet<string> = new Set(["stripe"]);

/** Shape check before any fetch: ids are short lower-case slugs with dots (T-11-47-02). */
const HELP_ID = /^[a-z0-9][a-z0-9.-]{0,99}$/;

export const HELP_DRAWER_COPY = {
  openInHelpCenter: "Open in Help center",
  stillStuck: "Still stuck?",
  askCds: "Ask Support",
} as const;

const NEW_TICKET_HREF = "/hub/support/tickets/new";
/**
 * Website tabs that name a site part (SITE_PARTS). IN-C02: Banner and Site settings edit the
 * header part (the lock map's `header`).
 */
const PART_TABS: Readonly<Record<string, string>> = {
  footer: "footer",
  navigation: "menus",
  banner: "header",
  site: "header",
};
const CORE_WEBSITE_TABS: ReadonlySet<string> = new Set(
  WEBSITE_TABS.map((t) => t.id),
);
const ADDON_SLUG = /^[a-z0-9-]{1,64}$/;

/**
 * The ticket target a hub screen is about, as `kind:id`, or null (Whole site): a page in the
 * builder, an add-on's own screen (its catalog page or its Website tab), or the Website
 * Footer / Navigation / Banner / Site settings tab. Only a hint: the form drops unknown values.
 */
export function screenTarget(
  pathname: string,
  search: URLSearchParams | null,
): string | null {
  const page = /^\/hub\/website\/pages\/([a-z0-9]{15})(?:\/|$)/.exec(pathname);
  if (page) return `page:${page[1]}`;
  const addon = /^\/hub\/add-ons\/([a-z0-9-]{1,64})\/?$/.exec(pathname);
  if (addon) return `addon:${addon[1]}`;
  if (/^\/hub\/website\/?$/.test(pathname)) {
    const tab = search?.get("tab") ?? "";
    if (Object.hasOwn(PART_TABS, tab)) return `part:${PART_TABS[tab]}`;
    if (!CORE_WEBSITE_TABS.has(tab) && ADDON_SLUG.test(tab)) {
      return `addon:${tab}`;
    }
  }
  return null;
}

/** "Still stuck? Ask CDS": a question ticket about this screen, coming back here. */
export function askCdsHref(
  pathname: string,
  search: URLSearchParams | null,
): string {
  const q = new URLSearchParams({ type: "question" });
  const target = screenTarget(pathname, search);
  if (target) q.set("target", target);
  const rest = new URLSearchParams(search ?? undefined);
  rest.delete("help");
  const tail = rest.toString();
  q.set("from", tail ? `${pathname}?${tail}` : pathname);
  return `${NEW_TICKET_HREF}?${q.toString()}`;
}

export function hostHelpId(raw: string | null | undefined): string | null {
  if (!raw || !HELP_ID.test(raw) || SCREEN_OWNED_HELP_IDS.has(raw)) return null;
  return raw;
}

type HelpDrawerData = {
  id: string;
  title: string;
  href: string;
  steps: HowToStepView[];
  tour: TourId | null;
  /** This person may file a ticket (12-20). */
  askCds: boolean;
};

function isStep(v: unknown): v is HowToStepView {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.screen === "string" &&
    typeof s.action === "string" &&
    typeof s.expected === "string"
  );
}

function parse(body: unknown): Omit<HelpDrawerData, "id"> | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.title !== "string" || typeof b.href !== "string") return null;
  if (!b.href.startsWith("/hub/help/")) return null;
  if (!Array.isArray(b.steps) || !b.steps.every(isStep)) return null;
  return {
    title: b.title,
    href: b.href,
    steps: b.steps,
    tour: isTourId(b.tour) ? b.tour : null,
    askCds: b.askCds === true,
  };
}

/** Sets or removes `help` on the current URL without a navigation. */
function writeHelpParam(id: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (id) params.set("help", id);
  else params.delete("help");
  const q = params.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`,
  );
}

export function HelpDrawerHost({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const search = useSearchParams();
  const fromUrl = hostHelpId(search?.get("help"));
  const [openId, setOpenId] = useState<string | null>(fromUrl);
  const [data, setData] = useState<HelpDrawerData | null>(null);
  // The drawer mounts on first use only, so a screen that never opens help carries no
  // hidden dialog (and its "Close" button) in the server HTML.
  const [used, setUsed] = useState(false);
  const firstPath = useRef(pathname);
  // Tours registered by the current screen (11-48), id -> start.
  const tours = useRef(new Map<TourId, () => void>());
  const [tourIds, setTourIds] = useState<ReadonlySet<TourId>>(new Set());
  const replay = useMemo<TourReplay>(
    () => ({
      register: (id, start) => {
        tours.current.set(id, start);
        setTourIds(new Set(tours.current.keys()));
        return () => {
          if (tours.current.get(id) === start) tours.current.delete(id);
          setTourIds(new Set(tours.current.keys()));
        };
      },
    }),
    [],
  );

  // The URL is the source of truth when it changes (load, back/forward, a shared link).
  useEffect(() => {
    setOpenId(fromUrl);
  }, [fromUrl]);

  // Leaving the screen closes the drawer.
  useEffect(() => {
    if (firstPath.current === pathname) return;
    firstPath.current = pathname;
    setOpenId(null);
  }, [pathname]);

  useEffect(() => {
    if (!openId) {
      setData(null);
      return;
    }
    let live = true;
    fetch(`/hub/api/help/${encodeURIComponent(openId)}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (!live) return;
        const parsed = parse(body);
        setData(parsed ? { id: openId, ...parsed } : null);
      })
      .catch(() => {
        if (live) setData(null);
      });
    return () => {
      live = false;
    };
  }, [openId]);

  const open = useCallback((helpId: string) => {
    const id = hostHelpId(helpId);
    if (!id) return;
    writeHelpParam(id);
    setOpenId(id);
  }, []);

  const close = useCallback(() => {
    writeHelpParam(null);
    setOpenId(null);
  }, []);

  const showTour = useCallback(
    (id: TourId) => {
      const start = tours.current.get(id);
      close();
      // After the drawer has closed and handed focus back.
      if (start) window.setTimeout(start, 0);
    },
    [close],
  );

  const shown = data && data.id === openId ? data : null;
  const tour = shown?.tour && tourIds.has(shown.tour) ? shown.tour : null;
  useEffect(() => {
    if (shown) setUsed(true);
  }, [shown]);
  return (
    <HelpOpenerContext.Provider value={open}>
      <TourReplayContext.Provider value={replay}>
        {children}
      </TourReplayContext.Provider>
      {shown || used ? (
        <TrainingDrawer
          open={shown !== null}
          onClose={close}
          title={shown?.title ?? ""}
          steps={shown?.steps ?? []}
          footer={
            shown ? (
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {tour ? (
                  <button
                    type="button"
                    onClick={() => showTour(tour)}
                    className={
                      "rounded text-sm font-semibold text-hub-accent underline underline-offset-2 " +
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                    }
                    data-show-tour={tour}
                  >
                    {TOUR_COPY.showTour}
                  </button>
                ) : null}
                <Link
                  href={shown.href}
                  className={
                    "rounded text-sm font-semibold text-hub-accent underline underline-offset-2 " +
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                  }
                >
                  {HELP_DRAWER_COPY.openInHelpCenter}
                </Link>
                {shown.askCds ? (
                  <p
                    className="text-sm text-hub-ink-muted"
                    data-cds-identity=""
                    data-ask-cds=""
                  >
                    {HELP_DRAWER_COPY.stillStuck}{" "}
                    <Link
                      href={askCdsHref(pathname, search)}
                      className={
                        "rounded font-semibold text-hub-accent underline underline-offset-2 " +
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hub-accent"
                      }
                    >
                      {HELP_DRAWER_COPY.askCds}
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null
          }
        />
      ) : null}
    </HelpOpenerContext.Provider>
  );
}
