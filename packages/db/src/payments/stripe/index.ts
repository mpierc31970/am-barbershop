// P10 payments: Stripe adapter entry points (PAY-09, CONTEXT A1). Only factory.ts imports
// this folder; the payments barrel never re-exports it (10-02).
//
// Env read here and in client.ts only: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (CDS
// endpoint), STRIPE_CONNECT_WEBHOOK_SECRET (Connect endpoint), STRIPE_ALLOW_LIVE, CDS_ENV.
import type Stripe from "stripe";
import type { CdsBilling, PaymentGateway } from "@cds/core/payments";
import { createStripeCdsBilling } from "./billing";
import { stripeClient } from "./client";
import { createStripePaymentGateway } from "./connect";

export type StripeAdapterDeps = {
  stripe?: Stripe;
  now?: () => Date;
  /** Overrides the endpoint secret from env (tests). */
  webhookSecret?: string;
};

export function stripeCdsBilling(deps: StripeAdapterDeps = {}): CdsBilling {
  return createStripeCdsBilling({
    stripe: deps.stripe ?? stripeClient(),
    webhookSecret:
      deps.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET ?? "",
    ...(deps.now ? { now: deps.now } : {}),
  });
}

/** Tenant-side gateway (Connect Standard); verifies with the Connect endpoint secret. */
export function stripePaymentGateway(
  deps: StripeAdapterDeps = {},
): PaymentGateway {
  return createStripePaymentGateway({
    stripe: deps.stripe ?? stripeClient(),
    webhookSecret:
      deps.webhookSecret ?? process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? "",
    ...(deps.now ? { now: deps.now } : {}),
  });
}

export { stripeClient, StripeKeyRefused } from "./client";
