"use client";

// Owner: 15-09 (P15-P1). MkMobileMenu: the < 1024px menu island (UI-SPEC "MkMobileMenu",
// Accessibility contract, Motion contract).
// - Server / no JS: an <a href="#footer-nav"> labelled "Menu" (the footer nav holds every link).
// - After mount: a <button aria-expanded aria-controls="mk-menu"> opening a right-edge panel,
//   role="dialog" aria-modal="true" aria-label="Menu".
// - Open: focus moves to the first link; Tab / Shift+Tab wrap inside; everything outside the
//   panel's ancestor chain gets `inert` (that covers #main and the footer); body scroll locks.
// - Close: Esc, Close button, backdrop click or following any link; focus returns to the Menu
//   button (the first desktop nav link when that button is hidden). Crossing to >= 1024px
//   closes it. Reduced motion: --mk-dur-* are 0, so it appears instantly (tokens.css). Only
//   transform, opacity and visibility transition.
import { MK_COPY } from "@cds/core/marketing";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { mkButtonClasses } from "./MkButton";
import type { MkHeaderSection } from "./MkHeader";

export type MkMobileMenuProps = { current?: MkHeaderSection | null };

const H = MK_COPY.HEADER;
const PANEL_ID = "mk-menu";
const DESKTOP = "(min-width: 1024px)";

const CONTROL =
  "inline-flex size-11 items-center justify-center rounded-mk-round text-mk-fg no-underline cursor-pointer";

/** Chip edge per nav href: Standard cobalt, Studio berry (closed colour code); others none. */
/** Path chip swatch beside the path links (closed colour code); null for the rest. */
function chipDot(href: string): string | null {
  if (href === "/standard") return "bg-mk-cobalt";
  if (href === "/studio") return "bg-mk-berry";
  return null;
}

function sectionOf(href: string): string {
  return href.replace(/^\//, "");
}

const FOCUSABLE = "a[href], button:not([disabled])";

/** Set `inert` on every sibling of every ancestor of `el` (up to <body>); returns an undo. */
function inertOutside(el: HTMLElement): () => void {
  const touched: HTMLElement[] = [];
  let node: HTMLElement | null = el;
  while (node && node !== document.body && node.parentElement) {
    for (const sib of Array.from(node.parentElement.children)) {
      if (
        sib !== node &&
        sib instanceof HTMLElement &&
        !sib.hasAttribute("inert")
      ) {
        sib.setAttribute("inert", "");
        touched.push(sib);
      }
    }
    node = node.parentElement;
  }
  return () => {
    for (const t of touched) t.removeAttribute("inert");
  };
}

/** Desktop nav link that takes focus when the Menu button is not rendered (WR-C04). */
const FALLBACK_FOCUS = "header nav[aria-label] a[href]";

/**
 * Focus back to the Menu button. Crossing to >= 1024px hides it (its `lg:hidden` wrapper), and
 * focus() on a non-rendered element does nothing, so focus would drop to <body>. If focus did
 * not land, move it to the first desktop nav link instead (WR-C04).
 */
function restoreFocus(opener: HTMLElement | null): void {
  opener?.focus();
  if (opener && document.activeElement === opener) return;
  document.querySelector<HTMLElement>(FALLBACK_FOCUS)?.focus();
}

export function MkMobileMenu({ current = null }: MkMobileMenuProps) {
  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHydrated(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const host = hostRef.current;
    const panel = panelRef.current;
    const opener = buttonRef.current;
    if (!host || !panel) return;

    const undoInert = inertOutside(host);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.querySelector<HTMLElement>("a[href]")?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);

    const mql =
      typeof window.matchMedia === "function"
        ? window.matchMedia(DESKTOP)
        : null;
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mql?.addEventListener("change", onChange);

    return () => {
      document.removeEventListener("keydown", onKey);
      mql?.removeEventListener("change", onChange);
      undoInert();
      document.body.style.overflow = prevOverflow;
      restoreFocus(opener);
    };
  }, [open]);

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!hydrated) {
    return (
      <a href="#footer-nav" className={CONTROL}>
        <Menu size={24} aria-hidden="true" />
        <span className="sr-only">{H.MENU}</span>
      </a>
    );
  }

  const links = [...H.NAV, ...H.MENU_EXTRA];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={H.MENU}
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen(true)}
        className={CONTROL}
      >
        <Menu size={24} aria-hidden="true" />
      </button>
      <div ref={hostRef}>
        <div
          data-mk-menu-backdrop=""
          aria-hidden="true"
          onClick={close}
          className={[
            "fixed inset-0 z-40 bg-mk-ink/55 transition-[opacity,visibility] duration-[var(--mk-dur-fast)]",
            open ? "visible opacity-100" : "invisible opacity-0",
          ].join(" ")}
        />
        <div
          ref={panelRef}
          id={PANEL_ID}
          role="dialog"
          aria-modal="true"
          aria-label={H.MENU}
          data-mk-field="card"
          onKeyDown={onPanelKeyDown}
          className={[
            "fixed inset-y-0 right-0 z-50 flex w-[min(360px,calc(100vw_-_48px))] flex-col overflow-y-auto shadow-mk-lift ease-[var(--mk-ease-out)]",
            "transition-[transform,visibility]",
            open
              ? "visible translate-x-0 duration-[var(--mk-dur-lift)]"
              : "invisible translate-x-full duration-[calc(var(--mk-dur-lift)*0.75)]",
          ].join(" ")}
        >
          <div className="flex justify-end p-2">
            <button
              type="button"
              aria-label={H.CLOSE_MENU}
              onClick={close}
              className={CONTROL}
            >
              <X size={24} aria-hidden="true" />
            </button>
          </div>
          <ul className="flex flex-col">
            {links.map((l) => {
              const isCurrent =
                current !== null && sectionOf(l.href) === current;
              const dot = chipDot(l.href);
              return (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    onClick={close}
                    aria-current={isCurrent ? "page" : undefined}
                    className={[
                      "flex min-h-14 items-center gap-3 px-4 text-[18px] leading-[1.55] font-bold",
                      isCurrent
                        ? "underline decoration-2 underline-offset-4"
                        : "no-underline",
                    ].join(" ")}
                  >
                    {dot ? (
                      <span
                        aria-hidden="true"
                        className={`inline-block size-3 shrink-0 rounded-mk-round ${dot}`}
                      />
                    ) : null}
                    {l.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-auto flex flex-col gap-3 border-t border-mk-rule p-4">
            <Link
              href="/sign-in"
              onClick={close}
              className={mkButtonClasses("secondary", "md", "w-full")}
            >
              {H.SIGN_IN}
            </Link>
            <Link
              href="/start"
              onClick={close}
              className={mkButtonClasses("primary", "lg", "w-full")}
            >
              {H.START}
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
