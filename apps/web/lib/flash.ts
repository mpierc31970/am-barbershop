// One-time post-redirect toasts (11-50): shared by the server actions that redirect into the
// hub (they add `?flash=<kind>`) and the client island HubFlash that shows the toast and strips
// the param. Plain module (no server or client-only imports) so both sides can use it.
// Copy: 11-UI-SPEC org switcher "You're now in {site}." and invite page "Welcome to {org}.".

export const FLASH_PARAM = "flash";

export const FLASH_KINDS = ["switched", "joined"] as const;
export type FlashKind = (typeof FLASH_KINDS)[number];

/** The toast for a known kind, naming the current site; null for anything else. */
export function flashCopy(kind: string | null, site: string): string | null {
  const name = site.trim();
  if (!name) return null;
  if (kind === "switched") return `You're now in ${name}.`;
  if (kind === "joined") return `Welcome to ${name}.`;
  return null;
}

/** `href` with `?flash=<kind>` added. */
export function withFlash(href: string, kind: FlashKind): string {
  return `${href}${href.includes("?") ? "&" : "?"}${FLASH_PARAM}=${kind}`;
}

/** The same URL without the flash param (other params kept, in order). */
export function withoutFlash(
  pathname: string,
  params: URLSearchParams,
): string {
  const next = new URLSearchParams(params);
  next.delete(FLASH_PARAM);
  const q = next.toString();
  return q ? `${pathname}?${q}` : pathname;
}
