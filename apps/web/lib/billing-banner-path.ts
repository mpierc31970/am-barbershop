// Where the owner billing banner never shows (10-32; 10-UI-SPEC "Billing banner"). Pure, so
// the server (lib/billing-banner.ts) and the client HubShell share one rule: the hub layout
// is kept across client navigation, so the shell re-checks the live path itself.

/**
 * True on the screens where the banner never shows: Settings › Billing (`?tab=billing`
 * and its `/hub/settings/billing/*` routes), the focused frames (re-accept, declined) and
 * the full-bleed draft preview. `path` may carry a query.
 */
export function bannerSuppressed(path: string): boolean {
  const [pathname = "", query = ""] = (path.split("#", 1)[0] ?? "").split(
    "?",
    2,
  );
  const params = new URLSearchParams(query);
  if (
    /^\/hub\/settings\/?$/.test(pathname) &&
    params.get("tab") === "billing"
  ) {
    return true;
  }
  if (/^\/hub\/settings\/billing(?:\/|$)/.test(pathname)) return true;
  if (
    /^\/hub\/agreement\/?$/.test(pathname) &&
    params.get("mode") === "reaccept"
  ) {
    return true;
  }
  if (/^\/hub\/declined\/?$/.test(pathname)) return true;
  return /^\/hub\/website\/pages\/[^/]+\/preview\/?$/.test(pathname);
}
