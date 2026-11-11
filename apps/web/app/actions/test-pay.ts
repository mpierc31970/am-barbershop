"use server";
// Server Actions behind the fake adapter's test pages (10-23; CONTEXT A1, PAY-09). Each one
// re-derives the hub session (runAction), validates the id with a strict pattern, checks the
// fake object belongs to the caller's org (choice 1, T-10-23-02), then calls the port's fake
// helper, which emits the normalised events through the one processor. Never an SDK.
//
// Each returns `{ redirect }`: an internal path (adapter-stored success / cancel URL reduced
// to its path, or a fixed hub path), T-10-23-03. The `submit*` form handlers redirect outside
// runAction (a failure comes back to the same page with `error=1`).
//
// Paid add-ons in an emitted checkout need the app's add-on deps (10-12 carry-forward):
// ensurePaymentAddonDeps() registers them with the processor before any emit.
import { InvalidInput, NotFound, authorize } from "@cds/core";
import {
  fakeCompleteSession,
  fakeConnectOutcome,
  fakePayInvoice,
  fakeUpdateCard,
  testPayAccountId,
  testPayCustomerId,
} from "@cds/db";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "../../lib/action";
import { ensurePaymentAddonDeps } from "../../lib/payment-deps";
import {
  ACCOUNT_ID_RE,
  CARD_UPDATED_PATH,
  CONNECT_DONE_PATH,
  INVOICE_ID_RE,
  PORTAL_ID_RE,
  SESSION_ID_RE,
  TEST_PAY_EXPIRED,
  TEST_PAY_HOME,
  loadTestPayment,
  safeRedirect,
  testPayDisabled,
} from "../../lib/test-pay";

type Redirect = { redirect: string };
type SessionOutcome = "pay" | "decline" | "fail_later";
type InvoiceOutcome = "pay" | "decline";
type ConnectKind = "finished" | "unfinished" | "restricted";

const SESSION_OUTCOMES: readonly string[] = ["pay", "decline", "fail_later"];
const INVOICE_OUTCOMES: readonly string[] = ["pay", "decline"];
const CONNECT_KINDS: readonly string[] = [
  "finished",
  "unfinished",
  "restricted",
];
const BILLING_TAB = "/hub/settings?tab=billing";

function disabled(): ActionResult<never> {
  return { ok: false, code: "not_found", message: TEST_PAY_EXPIRED };
}

/** Pay, decline or "card fails later" for one open fake checkout session of the caller's org. */
export async function payTestSession(
  id: string,
  outcome: SessionOutcome,
): Promise<ActionResult<Redirect>> {
  if (testPayDisabled()) return disabled();
  return runAction(async ({ ctx }) => {
    if (
      typeof id !== "string" ||
      !SESSION_ID_RE.test(id) ||
      !SESSION_OUTCOMES.includes(outcome)
    ) {
      throw new InvalidInput(TEST_PAY_EXPIRED);
    }
    const view = await loadTestPayment(ctx, id);
    if (!view || view.kind !== "session") throw new NotFound(TEST_PAY_EXPIRED);
    // CDS as the seller: only the owner pays (billing:write). A tenant-side checkout is the
    // site's customer paying the tenant (D296); any member may walk it in dev.
    if (!view.tenantSide) authorize(ctx, "billing", "write");
    ensurePaymentAddonDeps();
    const done = await fakeCompleteSession(id, outcome);
    return {
      redirect: safeRedirect(done.redirect, TEST_PAY_HOME, view.tenantSide),
    };
  });
}

/** Pay or decline one open fake invoice (quote deposit, balance, installments) of the org. */
export async function payTestInvoice(
  id: string,
  outcome: InvoiceOutcome,
): Promise<ActionResult<Redirect>> {
  if (testPayDisabled()) return disabled();
  return runAction(async ({ ctx }) => {
    if (
      typeof id !== "string" ||
      !INVOICE_ID_RE.test(id) ||
      !INVOICE_OUTCOMES.includes(outcome)
    ) {
      throw new InvalidInput(TEST_PAY_EXPIRED);
    }
    const view = await loadTestPayment(ctx, id);
    if (!view || view.kind !== "invoice") throw new NotFound(TEST_PAY_EXPIRED);
    authorize(ctx, "billing", "write");
    ensurePaymentAddonDeps();
    await fakePayInvoice(id, outcome);
    return {
      redirect:
        outcome === "pay" ? BILLING_TAB : `${BILLING_TAB}&payment=failed`,
    };
  });
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** `/test-pay/<id>` form: one submit button per outcome (`outcome`), the id hidden (`id`). */
export async function submitTestPayment(form: FormData): Promise<void> {
  const id = field(form, "id");
  const outcome = field(form, "outcome");
  const result = SESSION_ID_RE.test(id)
    ? await payTestSession(id, outcome as SessionOutcome)
    : INVOICE_ID_RE.test(id)
      ? await payTestInvoice(id, outcome as InvoiceOutcome)
      : null;
  if (result?.ok) redirect(result.data.redirect);
  if (result && result.code === "signed_out") redirect("/sign-in");
  redirect(result ? `/test-pay/${id}?error=1` : TEST_PAY_HOME);
}

/**
 * The portal page: save a good test card (pays every open invoice, reactivates past-due) or
 * one that fails. The customer is the caller org's own (billing_accounts), never a query id.
 */
export async function saveTestCard(
  failing: boolean,
): Promise<ActionResult<Redirect>> {
  if (testPayDisabled()) return disabled();
  return runAction(async ({ ctx }) => {
    if (typeof failing !== "boolean") throw new InvalidInput(TEST_PAY_EXPIRED);
    // testPayCustomerId checks billing:write (owner only).
    const customerId = await testPayCustomerId(ctx);
    if (customerId === null) throw new NotFound(TEST_PAY_EXPIRED);
    ensurePaymentAddonDeps();
    await fakeUpdateCard(customerId, failing);
    return { redirect: failing ? BILLING_TAB : CARD_UPDATED_PATH };
  });
}

/** The Connect page: settle the caller org's own test account as finished, unfinished or restricted. */
export async function connectTestAccount(
  kind: ConnectKind,
): Promise<ActionResult<Redirect>> {
  if (testPayDisabled()) return disabled();
  return runAction(async ({ ctx }) => {
    if (!CONNECT_KINDS.includes(kind)) throw new InvalidInput(TEST_PAY_EXPIRED);
    // testPayAccountId checks connect:write (owner only).
    const accountId = await testPayAccountId(ctx);
    if (accountId === null || !ACCOUNT_ID_RE.test(accountId)) {
      throw new NotFound(TEST_PAY_EXPIRED);
    }
    ensurePaymentAddonDeps();
    await fakeConnectOutcome(accountId, kind);
    return { redirect: CONNECT_DONE_PATH };
  });
}

/** `/test-pay/portal` form: `outcome` is `save` or `fail`; `session` is the portal link id. */
export async function submitTestCard(form: FormData): Promise<void> {
  const portal = field(form, "session");
  const outcome = field(form, "outcome");
  const result =
    outcome === "save" || outcome === "fail"
      ? await saveTestCard(outcome === "fail")
      : null;
  if (result?.ok) redirect(result.data.redirect);
  if (result && result.code === "signed_out") redirect("/sign-in");
  redirect(
    PORTAL_ID_RE.test(portal)
      ? `/test-pay/portal?session=${portal}&error=1`
      : TEST_PAY_HOME,
  );
}

/** `/test-pay/connect` form: `kind` picks the outcome; `account` is the page's account id. */
export async function submitTestConnect(form: FormData): Promise<void> {
  const account = field(form, "account");
  const result = await connectTestAccount(field(form, "kind") as ConnectKind);
  if (result.ok) redirect(result.data.redirect);
  if (result.code === "signed_out") redirect("/sign-in");
  redirect(
    ACCOUNT_ID_RE.test(account)
      ? `/test-pay/connect?account=${account}&error=1`
      : TEST_PAY_HOME,
  );
}
