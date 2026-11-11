"use client";
// "Payment received. Your add-ons are back on." (10-32; 10-UI-SPEC "Paused add-ons" Restored
// row; BILL-03, D27). The layout passes `restoredKey` only when a restore within the last 7
// days has not been toasted yet (lib/billing-banner.ts restoredToastAt). This island shows
// the toast once, then writes the key to the cds_restored_seen cookie, so neither a reload
// nor the next screen shows it again (choice 2). Mounted inside the hub ToastRegion.
import { useToast } from "@cds/ui/hub";
import { useEffect, useRef } from "react";

export const RESTORED_TOAST_COPY =
  "Payment received. Your add-ons are back on.";
/** Same name as RESTORED_SEEN_COOKIE in lib/billing-banner.ts (kept off @cds/db imports). */
const SEEN_COOKIE = "cds_restored_seen";
/** Long enough to outlive the 7-day toast window. */
const SEEN_MAX_AGE_S = 30 * 24 * 60 * 60;

export function RestoredToast({ restoredKey }: { restoredKey: string | null }) {
  const toast = useToast();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!restoredKey || !/^[0-9]{1,16}$/.test(restoredKey)) return;
    if (shown.current === restoredKey) return;
    shown.current = restoredKey;
    toast.show({ message: RESTORED_TOAST_COPY });
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${SEEN_COOKIE}=${restoredKey}; Path=/hub; Max-Age=${SEEN_MAX_AGE_S}; SameSite=Lax${secure}`;
  }, [restoredKey, toast]);
  return null;
}
