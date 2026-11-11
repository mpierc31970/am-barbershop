// /hub/settings/billing/card (10-29; BILL-03; UI-SPEC "Update card"): the no-JS target of every
// Update card link on the Billing tab. 303s to the provider's hosted card page (or the test
// portal) for the caller's own customer; it returns to `?tab=billing&card=updated`. With JS the
// BillingPanel intercepts the click and uses updateCardAction instead (10-29 choice 4).
//
// Needs a hub session (none -> /sign-in). Owner only, never impersonating; the chokepoint's
// `billing:write` decides too. Anyone refused, and any failure, lands back on the Billing tab.
// The redirect target is the adapter's URL or a fixed hub path, never input; it is not logged.
import { billingPortalLink } from "@cds/db";
import { getHubSession } from "../../../../../../lib/session";
import { BILLING_TAB } from "../../billing-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" } as const;

function seeOther(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, Location: location },
  });
}

function safeUrl(url: unknown): string | null {
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
      "[hub] billing card: session failed",
      err instanceof Error ? err.name : typeof err,
    );
    return seeOther(BILLING_TAB);
  }
  if (!session) return seeOther("/sign-in");
  const { ctx } = session;
  if (ctx.role !== "owner" || ctx.impersonator) return seeOther(BILLING_TAB);
  try {
    const { url } = await billingPortalLink(ctx);
    return seeOther(safeUrl(url) ?? BILLING_TAB);
  } catch (err) {
    console.error(
      "[hub] billing card link failed",
      err instanceof Error ? err.name : typeof err,
    );
    return seeOther(BILLING_TAB);
  }
}
