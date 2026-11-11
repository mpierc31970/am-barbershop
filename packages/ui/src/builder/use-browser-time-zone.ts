"use client";
// The owner's browser time zone as a hook (03-UI-REVIEW Fix 1; 03-UI-SPEC "helper 'Your
// time zone: America/Chicago' from the browser"). Page-block countdowns, pop-up countdowns
// and the banner schedule all read the same clock: the browser's.
//
// The server has no browser, so its snapshot is "UTC"; React re-renders with the real zone
// right after hydration, so server and client markup never disagree.
import { useSyncExternalStore } from "react";
import { browserTimeZone } from "./editor-logic";

const noopSubscribe = () => () => {};
const serverZone = () => "UTC";

export function useBrowserTimeZone(): string {
  return useSyncExternalStore(noopSubscribe, browserTimeZone, serverZone);
}
