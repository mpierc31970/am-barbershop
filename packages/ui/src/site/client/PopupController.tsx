"use client";
// Pop-up controller (CONT-12, D118, D124; CONTEXT A3-Q4; 03-UI-SPEC "Pop-up dialog";
// T-03-40, T-03-41). Pop-ups set no cookies (the frequency flags are session/local storage);
// the cookie banner is for third-party frames (07-14).
//
// Renders nothing. Wires the server-rendered <dialog data-cds-popup="<id>"> elements:
// - Click: one delegated document listener for [data-cds-popup-open]; a click always opens
//   an enabled pop-up (shouldShowPopup event "click"). Buttons inside a pop-up never open
//   another pop-up (no nesting; validatePopup already forbids them).
// - Automatic triggers: delay (setTimeout), scroll (passive listener, scroll_percent),
//   exit intent (pointer leaves the top edge; desktop fine pointer only), page load (on
//   mount). Each asks shouldShowPopup with the stored frequency flags and a module-level
//   "an automatic pop-up already opened in this page view" flag, then marks it seen.
// - Automatic triggers wait until the cookie banner is answered (onConsentResolved) and
//   never fire on viewports narrower than 768 px, checked at schedule and at fire time
//   (CONT-34: no mobile interstitials). Click-opened pop-ups always work.
// - Open dispatches `cds:popup-open` on the dialog and plays its pop-up videos muted; close
//   pauses its media and dispatches `cds:popup-close` (CONT-21, popup-media.ts).
// - Only one pop-up is open at a time; every listener and timer is removed on unmount.
import { useEffect } from "react";
import {
  shouldShowPopup,
  type PopupFrequency,
  type PopupRecord,
  type PopupShowOn,
  type PopupTrigger,
} from "@cds/core/content";
import {
  browserStores,
  isFinePointer,
  markSeen,
  readSeen,
  scrollPercent,
} from "./popup-dom";
import { onConsentResolved } from "./consent-state";
import {
  POPUP_CLOSE_EVENT,
  POPUP_OPEN_EVENT,
  playPopupMedia,
  stopPopupMedia,
} from "./popup-media";
import { openOverlay, type OverlayHandle } from "./useOverlay";

export interface PopupControllerConfig {
  id: string;
  trigger: PopupTrigger;
  delay_seconds: number;
  scroll_percent: number;
  frequency: PopupFrequency;
  show_on: PopupShowOn;
  page_ids: string[];
  enabled: boolean;
}

export interface PopupControllerProps {
  config: PopupControllerConfig[];
  pageId: string;
}

// One automatic pop-up per page view. Module-level so a remount of the same page view
// (React Strict Mode, a refreshed RSC payload) cannot open a second one; a different
// pageId starts a new view.
const view = { pageId: "", autoShown: false };

function asRecord(cfg: PopupControllerConfig): PopupRecord {
  return { ...cfg, name: "", content: { items: [] } };
}

const WIDE = "(min-width: 768px)";
const REDUCED = "(prefers-reduced-motion: reduce)";

/** Without matchMedia (jsdom, old browsers) the viewport counts as wide. */
function wide(): boolean {
  return (
    typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches
  );
}

function reducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(REDUCED).matches
  );
}

function findDialog(id: string): HTMLDialogElement | null {
  for (const el of document.querySelectorAll<HTMLDialogElement>(
    "dialog[data-cds-popup]",
  )) {
    if (el.dataset.cdsPopup === id) return el;
  }
  return null;
}

export function PopupController({ config, pageId }: PopupControllerProps) {
  useEffect(() => {
    if (view.pageId !== pageId) {
      view.pageId = pageId;
      view.autoShown = false;
    }
    const stores = browserStores();
    const fine = isFinePointer(
      typeof window.matchMedia === "function"
        ? (q) => window.matchMedia(q)
        : undefined,
    );
    const byId = new Map(config.map((c) => [c.id, c]));
    let current: OverlayHandle | null = null;
    let disposed = false;

    const show = (
      cfg: PopupControllerConfig,
      event: "click" | "auto",
      trigger: HTMLElement | null,
    ): boolean => {
      if (disposed || current) return false;
      if (event === "auto" && !wide()) return false;
      const allowed = shouldShowPopup({
        popup: asRecord(cfg),
        pageId,
        event,
        seen: readSeen(stores, cfg.id),
        autoAlreadyShown: view.autoShown,
        finePointer: fine,
      });
      if (!allowed) return false;
      const dialog = findDialog(cfg.id);
      if (!dialog) return false;
      if (event === "auto") {
        view.autoShown = true;
        markSeen(stores, cfg.frequency, cfg.id);
      }
      current = openOverlay(dialog, {
        returnFocus: trigger,
        onClosed: () => {
          stopPopupMedia(dialog);
          dialog.dispatchEvent(new CustomEvent(POPUP_CLOSE_EVENT));
          current = null;
        },
      });
      dialog.dispatchEvent(new CustomEvent(POPUP_OPEN_EVENT));
      playPopupMedia(dialog, { reducedMotion: reducedMotion() });
      return true;
    };

    const cleanups: (() => void)[] = [];

    // Click: delegated, so buttons anywhere on the page (and added later) work.
    const onClick = (e: MouseEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      const button = target?.closest<HTMLElement>("[data-cds-popup-open]");
      if (!button || button.closest("dialog[data-cds-popup]")) return;
      const cfg = byId.get(button.dataset.cdsPopupOpen ?? "");
      if (!cfg) return;
      e.preventDefault();
      show(cfg, "click", button);
    };
    document.addEventListener("click", onClick);
    cleanups.push(() => document.removeEventListener("click", onClick));

    const auto = config.filter(
      (c) => c.enabled && c.trigger !== "click" && c.show_on !== "button-only",
    );
    const fire = (cfg: PopupControllerConfig) => show(cfg, "auto", null);

    const scheduleAuto = () => {
      if (disposed) return;
      for (const cfg of auto) {
        switch (cfg.trigger) {
          case "page-load": {
            // Deferred a tick so the dialog markup is committed and hydration settled.
            const t = setTimeout(() => fire(cfg), 0);
            cleanups.push(() => clearTimeout(t));
            break;
          }
          case "delay": {
            const t = setTimeout(() => fire(cfg), cfg.delay_seconds * 1000);
            cleanups.push(() => clearTimeout(t));
            break;
          }
          case "scroll": {
            let done = false;
            const onScroll = () => {
              if (done || view.autoShown) return;
              if (scrollPercent(document) >= cfg.scroll_percent) {
                done = fire(cfg) || view.autoShown;
              }
            };
            window.addEventListener("scroll", onScroll, { passive: true });
            // Check once without a scroll event too (deferred a tick, like page-load): a
            // page too short to scroll counts as 100%, and a browser-restored position
            // may already be past the threshold, but neither ever fires "scroll" (WR-C06).
            const t = setTimeout(onScroll, 0);
            cleanups.push(() => {
              clearTimeout(t);
              window.removeEventListener("scroll", onScroll);
            });
            break;
          }
          case "exit-intent": {
            if (!fine) break;
            const onOut = (e: MouseEvent) => {
              if (e.relatedTarget === null && e.clientY <= 0) fire(cfg);
            };
            document.addEventListener("mouseout", onOut);
            cleanups.push(() =>
              document.removeEventListener("mouseout", onOut),
            );
            break;
          }
        }
      }
    };

    // Phones never get automatic pop-ups (CONT-34); elsewhere they wait for the cookie
    // choice (next tick when nothing is pending, so page-load keeps its deferred tick).
    if (auto.length > 0 && wide())
      cleanups.push(onConsentResolved(scheduleAuto));

    return () => {
      disposed = true;
      for (const c of cleanups) c();
      (current as OverlayHandle | null)?.close();
    };
  }, [config, pageId]);

  return null;
}
