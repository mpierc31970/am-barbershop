// /hub/checkout/return: confirm the build payment (10-22; BILL-01; 10-UI-SPEC "Checkout
// return"; D-UI-P10-7; T-10-22-03). The `session` query value is attacker-controllable, so it
// is never trusted alone: checkoutReturnStatus answers only when it equals the caller org's
// own stored checkout session id, and "paid" means the org's own billing account carries
// paid_at. Unknown or another org's session → /hub/checkout; failed → ERR-PAY. Confirming
// polls through ReturnStatus (every 2 s, up to 30 s, 10-22 choice 4). No celebration.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { can } from "@cds/core";
import { checkoutReturnStatus } from "@cds/db";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { paidLines } from "../../../../../lib/checkout-order";
import { requireHubSession } from "../../../../../lib/session";
import { ReturnStatus, type ReturnInitial } from "./ReturnStatus";

export const metadata: Metadata = { title: "Confirming your payment" };

export const dynamic = "force-dynamic";

const SESSION_RE = /^[A-Za-z0-9_-]{1,255}$/;

type Search = { session?: string | string[] };

export default async function CheckoutReturnPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireHubSession();
  const { ctx } = session;
  if (!can(ctx, "billing", "read")) redirect("/hub");
  const sp = await searchParams;
  const id = typeof sp.session === "string" ? sp.session : "";
  if (!SESSION_RE.test(id)) redirect("/hub/checkout");

  let initial: ReturnInitial = { state: "confirming" };
  try {
    const st = await checkoutReturnStatus(ctx, id, {
      registry: ADDON_REGISTRY,
    });
    if (st.state === "unknown") redirect("/hub/checkout");
    if (st.state === "failed") redirect("/hub/checkout?payment=failed");
    if (st.state === "received") {
      initial = { state: "received", paid: paidLines(st) };
    }
  } catch (err) {
    // redirect() signals by throwing; let it through.
    const digest = (err as { digest?: unknown } | null)?.digest;
    if (typeof digest === "string" && digest.startsWith("NEXT_")) throw err;
    console.error(
      "[checkout] return status failed",
      err instanceof Error ? err.name : typeof err,
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6 pt-12 font-hub">
      <ReturnStatus sessionId={id} initial={initial} />
    </div>
  );
}
