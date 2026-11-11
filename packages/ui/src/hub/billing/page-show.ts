"use client";
// WR-C04: a button that stays pending "until the page leaves" (Accept and pay, Connect) must
// not come back frozen when the owner presses Back from the provider's page and the browser
// restores this page from the back/forward cache (Safari, and Chrome for eligible pages).
// The restore fires `pageshow` with `persisted: true`; `onRestore` runs then. Pass a stable
// callback (useCallback), or the listener is re-added on every render.
import { useEffect } from "react";

export function useBfcacheReset(onRestore: () => void): void {
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) onRestore();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [onRestore]);
}
