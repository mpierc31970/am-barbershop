// POST /api/webhooks/stripe: CDS's own Stripe account events (10-24; PAY-01, CONTEXT A1,
// D244; RESEARCH Pitfall 2). The raw body is read as text and handed with the
// `stripe-signature` header to processCdsWebhook, which verifies it before anything else
// (T-10-24-01/02). The body is never parsed here. Answers: 400 bad signature (no ledger
// row), 200 applied / duplicate / ignored, 500 failed handler so Stripe retries. The
// response body is empty; logs carry the status only, never the payload (T-10-24-04).
// Webhooks hit the platform host, so no middleware matcher change is needed.
// Add-on collections must be registered before a handler installs a paid add-on.
import "@cds/addon-registry/server";
import { processCdsWebhook } from "@cds/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { MAX_WEBHOOK_BYTES, readCappedText } from "../../../../lib/capped-body";
import { ensurePaymentAddonDeps } from "../../../../lib/payment-deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  try {
    // No signature, nothing to verify: refused before the body is read (WR-D01).
    const sig = req.headers.get("stripe-signature") ?? "";
    if (sig === "")
      return new Response(null, { status: 400, headers: NO_STORE });
    const raw = await readCappedText(req, MAX_WEBHOOK_BYTES);
    if (raw === null) {
      return new Response(null, { status: 413, headers: NO_STORE });
    }
    // Paid add-ons install (and lapses pause them) only with the app's add-on deps (10-23).
    ensurePaymentAddonDeps();
    const result = await processCdsWebhook(raw, sig);
    if (result.status === 200 && result.orgId) {
      // 10-24 choice 2: entitlements show at once rather than after the 60 s cache.
      revalidateTag(`org:${result.orgId}:addons`);
      revalidatePath("/hub", "layout");
    }
    return new Response(null, { status: result.status, headers: NO_STORE });
  } catch (err) {
    console.error(
      `[webhooks/stripe] failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}

/** Only POST is a webhook; any other method reads as absent. */
export function GET(): Response {
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}
