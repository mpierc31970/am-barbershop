"use client";
// The home-screen app's red number (Badging API; iOS 16.4+ home-screen apps with notification
// permission). Feature-detected: where unsupported, nothing happens and nothing throws.
import { useEffect } from "react";

type BadgeNavigator = Navigator & {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

export function syncAppBadge(count: number): void {
  if (typeof navigator === "undefined") return;
  const nav = navigator as BadgeNavigator;
  try {
    const p =
      count > 0 ? nav.setAppBadge?.(Math.floor(count)) : nav.clearAppBadge?.();
    p?.catch(() => {});
  } catch {
    // Unsupported or not allowed: the badge is a nicety.
  }
}

/** The Alerts screen marks everything read: clear the app badge once it has rendered. */
export function ClearAppBadge() {
  useEffect(() => syncAppBadge(0), []);
  return null;
}
