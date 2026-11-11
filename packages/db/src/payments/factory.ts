// P10 payments: builds CdsBilling / PaymentGateway from env; the only importer of ./stripe
// (PAY-09, CONTEXT A1, RESEARCH Pitfall 4).
//
// CDS_PAYMENTS=fake (default; dev, tests, keyless stand-in) or stripe (STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET; sk_test_ first). In production the
// fake never takes money: paymentsOpen() is false there and checkout shows "Payments open
// soon", and the fake itself throws PaymentsUnavailable on every money call (10-45).
//
// No import cycle (10-09 choice 2): adapters get an `emit(event)` callback that reaches the
// processor through a lazy import, so process.ts may import this file freely.
import type {
  CdsBilling,
  NormalisedEvent,
  PaymentGateway,
} from "@cds/core/payments";
import { orgIsDemo } from "../demo/flag";
import { fakeCdsBilling, fakePaymentGateway } from "./fake/index";
import { stripeCdsBilling, stripePaymentGateway } from "./stripe";

export type PaymentsMode = "fake" | "stripe";

/** The adapter callback that feeds an event into the one processor. */
export type EmitEvent = (e: NormalisedEvent) => Promise<void>;

function isProduction(): boolean {
  return process.env.CDS_ENV === "production";
}

/** `fake` unless CDS_PAYMENTS=stripe. Any other value is a config error (fail closed). */
export function paymentsMode(): PaymentsMode {
  const raw = process.env.CDS_PAYMENTS?.trim().toLowerCase() ?? "";
  if (raw === "" || raw === "fake") return "fake";
  if (raw === "stripe") return "stripe";
  throw new Error('CDS_PAYMENTS must be "fake" or "stripe"');
}

/**
 * The payments mode for one org (13-24, STAFF-18, D293): always `fake` for the demo org, so
 * no real money moves there even when CDS_PAYMENTS=stripe; otherwise paymentsMode().
 */
export async function paymentsModeFor(orgId: string): Promise<PaymentsMode> {
  if (await orgIsDemo(orgId)) return "fake";
  return paymentsMode();
}

/** false only in production on the fake adapter: no money is taken there (Pitfall 4). */
export function paymentsOpen(): boolean {
  return !(isProduction() && paymentsMode() === "fake");
}

/** Forwards an adapter-emitted event to the processor (lazy import: no cycle). */
async function emitToProcessor(e: NormalisedEvent): Promise<void> {
  const { processNormalisedEvent } = await import("./process");
  const result = await processNormalisedEvent(e);
  if (result.outcome === "failed") {
    console.warn(
      `[payments] emitted event ${e.provider} ${e.id} ${e.type} failed; left for retry`,
    );
  }
}

/**
 * The fake adapters (10-45 choice 4): the keyless stand-in, constructed with the emit
 * callback that feeds the one processor. Memoised by the getters, like the Stripe branch.
 */
function fakeAdapters(emit: EmitEvent): {
  billing: CdsBilling;
  gateway: PaymentGateway;
} {
  return {
    billing: fakeCdsBilling({ emit }),
    gateway: fakePaymentGateway({ emit }),
  };
}

function requireStripeKey(): void {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      "CDS_PAYMENTS=stripe needs STRIPE_SECRET_KEY (and the two webhook secrets)",
    );
  }
}

let billing: CdsBilling | null = null;
let gateway: PaymentGateway | null = null;
let overrides: { billing?: CdsBilling; gateway?: PaymentGateway } = {};

/** CDS as the seller (D66): the configured CdsBilling adapter, memoised. */
export function getCdsBilling(): CdsBilling {
  if (overrides.billing) return overrides.billing;
  if (billing) return billing;
  if (paymentsMode() === "stripe") {
    requireStripeKey();
    billing = stripeCdsBilling();
  } else {
    billing = fakeAdapters(emitToProcessor).billing;
  }
  return billing;
}

/** The tenant as the merchant (Connect Standard): the configured PaymentGateway, memoised. */
export function getPaymentGateway(): PaymentGateway {
  if (overrides.gateway) return overrides.gateway;
  if (gateway) return gateway;
  if (paymentsMode() === "stripe") {
    requireStripeKey();
    gateway = stripePaymentGateway();
  } else {
    gateway = fakeAdapters(emitToProcessor).gateway;
  }
  return gateway;
}

let demoAdapters: { billing: CdsBilling; gateway: PaymentGateway } | null =
  null;

function demoFake(): { billing: CdsBilling; gateway: PaymentGateway } {
  demoAdapters ??= fakeAdapters(emitToProcessor);
  return demoAdapters;
}

/**
 * CdsBilling for a checkout or charge that names one org (13-24): the fake adapter for the demo
 * org (paymentsModeFor), else getCdsBilling(). Test overrides still win.
 */
export async function cdsBillingFor(orgId: string): Promise<CdsBilling> {
  if (overrides.billing) return overrides.billing;
  if ((await paymentsModeFor(orgId)) === "fake" && paymentsMode() !== "fake") {
    return demoFake().billing;
  }
  return getCdsBilling();
}

/** PaymentGateway for one org's Connect flow (13-24): fake for the demo org. */
export async function paymentGatewayFor(
  orgId: string,
): Promise<PaymentGateway> {
  if (overrides.gateway) return overrides.gateway;
  if ((await paymentsModeFor(orgId)) === "fake" && paymentsMode() !== "fake") {
    return demoFake().gateway;
  }
  return getPaymentGateway();
}

/** Tests: inject adapters (a billing spy, a recorded Stripe client). */
export function setPaymentsForTests(p: {
  billing?: CdsBilling;
  gateway?: PaymentGateway;
}): void {
  overrides = { ...overrides, ...p };
}

/** Tests: drop overrides and memoised adapters (env is re-read on next use). */
export function resetPaymentsForTests(): void {
  overrides = {};
  billing = null;
  gateway = null;
  demoAdapters = null;
}
