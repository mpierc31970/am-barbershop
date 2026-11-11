// Pop-up DOM helpers (CONT-12, D124; CONTEXT A3-Q4; T-03-41).
//
// Small, injectable wrappers so the controller's browser facts are testable with fakes.
// Frequency flags live in sessionStorage / localStorage under popupFrequencyKey(id), never
// cookies: the value is a constant, the key holds no personal data, so no consent banner
// is needed. Storage that throws (privacy modes, quota, sandboxed frames) is treated as
// "not seen" and never breaks the page.
import { popupFrequencyKey, type PopupFrequency } from "@cds/core/content";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface PopupStores {
  session: StorageLike | null;
  local: StorageLike | null;
}

export const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function safeGet(
  get: () => StorageLike | null | undefined,
): StorageLike | null {
  try {
    return get() ?? null;
  } catch {
    return null;
  }
}

/** The browser's storages, or null for any that cannot be reached. */
export function browserStores(
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): PopupStores {
  if (!win) return { session: null, local: null };
  return {
    session: safeGet(() => win.sessionStorage),
    local: safeGet(() => win.localStorage),
  };
}

function has(store: StorageLike | null, key: string): boolean {
  if (!store) return false;
  try {
    return store.getItem(key) !== null;
  } catch {
    return false;
  }
}

function put(store: StorageLike | null, key: string): void {
  if (!store) return;
  try {
    store.setItem(key, "1");
  } catch {
    // Privacy mode or quota: the pop-up may show again; never an error.
  }
}

export function readSeen(
  stores: PopupStores,
  id: string,
): { session: boolean; local: boolean } {
  const key = popupFrequencyKey(id);
  return { session: has(stores.session, key), local: has(stores.local, key) };
}

export function markSeen(
  stores: PopupStores,
  frequency: PopupFrequency,
  id: string,
): void {
  const key = popupFrequencyKey(id);
  if (frequency === "once-per-session") put(stores.session, key);
  else if (frequency === "once-per-visitor") put(stores.local, key);
}

/** Desktop with a mouse: exit intent is only meaningful here. */
export function isFinePointer(
  matchMedia: ((query: string) => Pick<MediaQueryList, "matches">) | undefined,
): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia(FINE_POINTER_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** How far down the page the visitor has scrolled, 0-100. Unscrollable pages are 100. */
export function scrollPercent(doc: Pick<Document, "documentElement">): number {
  const el = doc.documentElement;
  const range = el.scrollHeight - el.clientHeight;
  if (range <= 0) return 100;
  const pct = Math.round((el.scrollTop / range) * 100);
  return Math.min(100, Math.max(0, pct));
}
