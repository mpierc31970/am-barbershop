// POST /api/webhooks/stripe-connect: tenants' Connect account events (10-24; PAY-01,
// PAY-03, CONTEXT A1; RESEARCH Pitfall 2). A copy of the CDS webhook route: the raw body is
// read as text and handed with the `stripe-signature` header to
// processConnectWebhook, which verifies it with the Connect signing secret before anything
// else (T-10-24-01/02). Answers: 400 bad signature (no ledger row), 200 applied / duplicate
// / ignored, 500 failed handler so Stripe retries. Empty body; logs carry the status only
// (T-10-24-04).
// Add-on collections must be registered before a handler touches add-on state.
import "@cds/addon-registry/server";
import { processConnectWebhook } from "@cds/db";
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
    ensurePaymentAddonDeps();
    const result = await processConnectWebhook(raw, sig);
    if (result.status === 200 && result.orgId) {
      revalidateTag(`org:${result.orgId}:addons`);
      revalidatePath("/hub", "layout");
    }
    return new Response(null, { status: result.status, headers: NO_STORE });
  } catch (err) {
    console.error(
      `[webhooks/stripe-connect] failed: ${err instanceof Error ? err.message : "unknown error"}`,
    );
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}

/** Only POST is a webhook; any other method reads as absent. */
export function GET(): Response {
  return new Response("Not Found", { status: 404, headers: NO_STORE });
}
