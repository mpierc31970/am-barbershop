"use client";
// Site menu island (CONT-13; D-UI-P7-28, D-UI-P7-29; 07-25 choices 4-6, 12; UI-SPEC "Site
// chrome (public)"). Never imports the rich-text sanitizer.
//
// First render equals SSR: desktop dropdowns and the phone menu are <details>/<summary>, so
// menus work with JavaScript off. After mount the same boxes become disclosure buttons
// (button aria-expanded + aria-controls; click, Enter, Space), one open at a time; Esc closes
// and returns focus to its button; a pointerdown outside closes a dropdown. No hover menus.
// Choice 5: current-page marking happens here on mount, from location.pathname (SSR marks
// nothing). Choice 6: a pop-up menu button is SSR-hidden and shown only when its
// dialog[data-cds-popup="<id>"] is on this page.
// A&M fork: after mount the phone menu is a native modal <dialog> drawer on the right, over
// a dimmed backdrop (useOverlay: focus trapped, body scroll locked, Esc / backdrop / Close
// dismiss, focus back to the Menu button), so the page never shifts. Without JS it stays the
// in-flow <details> panel. 48px rows, child links indented 24px under their parent label,
// then the utilities and the menu button full width. The slide-in lives in the site CSS and
// is off under reduced motion.
import { ChevronDown, Menu, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  ResolvedNavCta,
  ResolvedNavEntry,
  ResolvedNavLink,
} from "@cds/core/content";
import { SiteButton } from "../SiteButton";
import { BODY_CLASS } from "../types";
import { useOverlay } from "./useOverlay";

export type ChromeLayout = "auto" | "mobile" | "desktop";

export interface NavDisclosureProps {
  /** The logo link, rendered at the start of the header row. */
  brand: ReactNode;
  entries: ResolvedNavEntry[];
  cta: ResolvedNavCta | null;
  layout?: ChromeLayout;
  searchHref?: string | null;
  /** 07-26's Translate link; repeated inside the phone panel. */
  utilities?: ReactNode;
}

const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--site-focus)]";
const LINK =
  `inline-flex min-h-11 items-center text-site-text no-underline decoration-1 underline-offset-8 hover:underline ` +
  `aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:decoration-site-primary ${FOCUS}`;
const TOGGLE =
  `inline-flex min-h-11 cursor-pointer list-none items-center gap-1 bg-transparent p-0 text-site-text ` +
  `hover:underline decoration-1 underline-offset-8 [&::-webkit-details-marker]:hidden ${FOCUS}`;
const PANEL =
  "absolute left-0 top-full z-30 mt-2 min-w-56 rounded-site-media border border-site-border bg-site-surface py-2 shadow-site-overlay";
const PANEL_LINK =
  `flex min-h-11 items-center px-4 text-site-text no-underline hover:underline decoration-1 underline-offset-4 ` +
  `aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:decoration-site-primary ${FOCUS}`;
const MOBILE_ROW =
  `flex min-h-12 items-center text-site-text no-underline hover:underline decoration-1 underline-offset-4 ` +
  `aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:decoration-site-primary ${FOCUS}`;
const SEARCH = `inline-flex size-11 items-center justify-center rounded-site-button text-site-text hover:bg-site-surface-raised ${FOCUS}`;
const MENU_TOGGLE =
  `inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-site-button bg-transparent px-2 ` +
  `font-semibold text-site-text hover:bg-site-surface-raised [&::-webkit-details-marker]:hidden ${FOCUS}`;

function layoutClasses(layout: ChromeLayout) {
  if (layout === "desktop") {
    return { row: "h-20", desktop: "flex", mobile: "hidden", panel: "hidden" };
  }
  if (layout === "mobile") {
    return { row: "h-16", desktop: "hidden", mobile: "flex", panel: "block" };
  }
  return {
    row: "h-16 lg:h-20",
    desktop: "hidden lg:flex",
    mobile: "flex lg:hidden",
    panel: "block lg:hidden",
  };
}

function normalPath(p: string): string {
  if (p.length > 1 && p.endsWith("/")) return p.slice(0, -1);
  return p;
}

function linkProps(link: ResolvedNavLink, current: string | null) {
  const isCurrent =
    current !== null &&
    link.href.startsWith("/") &&
    normalPath(link.href) === current;
  return {
    href: link.href,
    ...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {}),
    ...(isCurrent ? { "aria-current": "page" as const } : {}),
  };
}

function popupPresent(id: string): boolean {
  try {
    const sel =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(id)
        : id.replace(/[^A-Za-z0-9_-]/g, "");
    return document.querySelector(`dialog[data-cds-popup="${sel}"]`) !== null;
  } catch {
    return false;
  }
}

function Cta({
  cta,
  visible,
  full,
}: {
  cta: ResolvedNavCta;
  visible: boolean;
  full?: boolean;
}) {
  const node =
    "popupId" in cta ? (
      <SiteButton text={cta.label} style="primary" popupId={cta.popupId} />
    ) : (
      <SiteButton text={cta.label} style="primary" href={cta.href} />
    );
  return (
    <span
      hidden={!visible}
      data-nav-cta=""
      className={full ? "flex flex-col" : "inline-flex"}
    >
      {node}
    </span>
  );
}

export function NavDisclosure({
  brand,
  entries,
  cta,
  layout = "auto",
  searchHref,
  utilities,
}: NavDisclosureProps) {
  const uid = useId();
  const [mounted, setMounted] = useState(false);
  const [current, setCurrent] = useState<string | null>(null);
  const [ctaShown, setCtaShown] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement | null>());
  const menuButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  useOverlay(drawer, {
    isOpen: menuOpen,
    onClose: () => setMenuOpen(false),
    returnFocusRef: menuButton,
  });
  const cls = layoutClasses(layout);
  const popupId = cta && "popupId" in cta ? cta.popupId : null;

  useEffect(() => {
    setMounted(true);
    setCurrent(normalPath(window.location.pathname || "/"));
    setCtaShown(popupId === null ? true : popupPresent(popupId));
  }, [popupId]);

  useEffect(() => {
    if (openId === null && !menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openId !== null) {
        const btn = toggles.current.get(openId);
        setOpenId(null);
        btn?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (openId === null) return;
      const box = rootRef.current?.querySelector(
        `[data-nav-group="${openId}"]`,
      );
      if (box && e.target instanceof Node && box.contains(e.target)) return;
      setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [openId, menuOpen]);

  // SSR shows a page-link CTA at once; a pop-up CTA waits for its dialog (choice 6).
  const ctaVisible = popupId === null ? true : mounted && ctaShown;
  const hasMenu = entries.length > 0 || cta !== null || Boolean(utilities);
  const searchLink = searchHref ? (
    <a href={searchHref} aria-label="Search this site" className={SEARCH}>
      <Search size={24} aria-hidden="true" />
    </a>
  ) : null;

  const desktopGroup = (e: Extract<ResolvedNavEntry, { kind: "group" }>) => {
    const panelId = `${uid}-d-${e.id}`;
    const links = (
      <ul
        id={panelId}
        className={PANEL}
        hidden={mounted ? openId !== e.id : undefined}
      >
        {e.links.map((l) => (
          <li key={l.id}>
            <a {...linkProps(l, current)} className={PANEL_LINK}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    );
    const label = (
      <>
        {e.label}
        <ChevronDown size={20} aria-hidden="true" />
      </>
    );
    if (!mounted) {
      return (
        <details className="relative" data-nav-group={e.id}>
          <summary className={TOGGLE}>{label}</summary>
          {links}
        </details>
      );
    }
    return (
      <div className="relative" data-nav-group={e.id}>
        <button
          type="button"
          ref={(el) => {
            toggles.current.set(e.id, el);
          }}
          aria-expanded={openId === e.id}
          aria-controls={panelId}
          className={TOGGLE}
          onClick={() => setOpenId((o) => (o === e.id ? null : e.id))}
        >
          {label}
        </button>
        {links}
      </div>
    );
  };

  const mobilePanelId = `${uid}-m`;
  const mobileList = (
    <div className="border-t border-site-border pb-4">
      <ul className="flex flex-col py-2">
        {entries.map((e) =>
          e.kind === "link" ? (
            <li key={e.id}>
              <a {...linkProps(e, current)} className={MOBILE_ROW}>
                {e.label}
              </a>
            </li>
          ) : (
            <li key={e.id}>
              <span className="flex min-h-12 items-center font-semibold text-site-text">
                {e.label}
              </span>
              <ul className="flex flex-col pl-6">
                {e.links.map((l) => (
                  <li key={l.id}>
                    <a {...linkProps(l, current)} className={MOBILE_ROW}>
                      {l.label}
                    </a>
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
      {utilities ? (
        <div className="flex min-h-12 items-center">{utilities}</div>
      ) : null}
      {cta ? <Cta cta={cta} visible={ctaVisible} full /> : null}
    </div>
  );

  const menuLabel = (
    <>
      <Menu size={24} aria-hidden="true" />
      Menu
    </>
  );

  return (
    <div ref={rootRef} className={`relative ${BODY_CLASS}`}>
      <div className={`flex items-center justify-between gap-6 ${cls.row}`}>
        {brand}
        {hasMenu || searchLink ? (
          <div className={`${cls.desktop} items-center gap-8`}>
            {entries.length > 0 ? (
              <nav aria-label="Main">
                <ul className="flex items-center gap-8">
                  {entries.map((e) => (
                    <li key={e.id}>
                      {e.kind === "link" ? (
                        <a {...linkProps(e, current)} className={LINK}>
                          {e.label}
                        </a>
                      ) : (
                        desktopGroup(e)
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
            {utilities}
            {searchLink}
            {cta ? <Cta cta={cta} visible={ctaVisible} /> : null}
          </div>
        ) : null}
        {hasMenu || searchLink ? (
          <div
            className={`${cls.mobile} items-center gap-2 ${
              hasMenu && !mounted ? "mr-28" : ""
            }`}
          >
            {searchLink}
            {hasMenu && mounted ? (
              <button
                ref={menuButton}
                type="button"
                aria-expanded={menuOpen}
                aria-controls={mobilePanelId}
                className={MENU_TOGGLE}
                onClick={() => setMenuOpen((o) => !o)}
              >
                {menuLabel}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {hasMenu ? (
        mounted ? (
          <dialog
            ref={drawer}
            id={mobilePanelId}
            aria-label="Menu"
            data-site-menu=""
            className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-[min(86vw,22rem)] max-w-none border-l border-site-border bg-site-surface p-0 text-site-text backdrop:bg-[var(--site-backdrop)]"
          >
            <div className="flex h-full flex-col overflow-y-auto px-6 py-3">
              <div className="flex justify-end">
                <button
                  type="button"
                  data-cds-popup-close=""
                  className={MENU_TOGGLE}
                >
                  <X size={24} aria-hidden="true" />
                  Close
                </button>
              </div>
              <nav aria-label="Main">{mobileList}</nav>
            </div>
          </dialog>
        ) : (
          <details className={cls.panel}>
            <summary className={`${MENU_TOGGLE} absolute right-0 top-0 my-2.5`}>
              {menuLabel}
            </summary>
            <nav aria-label="Main">{mobileList}</nav>
          </details>
        )
      ) : null}
    </div>
  );
}
