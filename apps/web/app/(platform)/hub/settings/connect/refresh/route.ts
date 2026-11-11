// /hub/settings/connect/refresh (CONNECT_REFRESH_PATH, 10-14): Stripe sends the owner here when
// an onboarding link has expired or was already used. Mints a fresh link silently and 303s to
// it (10-25 choice 1; UI-SPEC "An expired onboarding link silently gets a fresh one").
//
// WR-D02: it only re-mints a link for the org's existing account (refreshConnectLink); it never
// creates or replaces one, because a GET can be triggered by any site the owner visits. With no
// account, or a disconnected one, it lands on the Payments tab, where Connect is a POST.
//
// Needs a hub session (none -> /sign-in). Owner only, never under impersonation: the
// chokepoint's `connect:write` decides; anyone it refuses, and any failure, lands on the
// Payments tab instead (no error page; the tab shows the state and its button). The redirect
// target is the adapter's URL or a fixed hub path, never input (T-10-25-03); the link is
// never logged (T-10-25-02).
import { refreshConnectLink } from "@cds/db";
import { getHubSession } from "../../../../../../lib/session";
import { PAYMENTS_TAB } from "../../payments-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" } as const;

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, Location: location },
  });
}

/** Only an absolute http(s) URL from the adapter is followed; anything else is the tab. */
function safeOnboardingUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export async function GET(): Promise<Response> {
  let session: Awaited<ReturnType<typeof getHubSession>>;
  try {
    session = await getHubSession();
  } catch (err) {
    console.error(
      "[hub] connect refresh: session failed",
      err instanceof Error ? err.name : typeof err,
    );
    return seeOther(PAYMENTS_TAB);
  }
  if (!session) return seeOther("/sign-in");
  const { ctx } = session;
  if (ctx.role !== "owner" || ctx.impersonator) return seeOther(PAYMENTS_TAB);
  try {
    const { url } = await refreshConnectLink(ctx);
    return seeOther(safeOnboardingUrl(url) ?? PAYMENTS_TAB);
  } catch (err) {
    console.error(
      "[hub] connect refresh failed",
      err instanceof Error ? err.name : typeof err,
    );
    return seeOther(PAYMENTS_TAB);
  }
}
