// P10 payments: PaymentGateway on Stripe Connect Standard (the tenant as the merchant,
// D256, D296, BILL-06, PAY-10). CDS is never a payment processor: tenant checkouts are
// direct charges on the tenant's own account (the Stripe-Account header), with no platform
// fee, no transfer and no on-behalf-of (BILL-07, D52).
//
// Onboarding (RESEARCH Pattern 9, choice 1): a v1 account with Standard-equivalent
// controller properties, then an account_onboarding Account Link. Both "new" and
// "existing" use Account Links; Stripe's hosted onboarding lets an existing Stripe user
// sign in. OAuth is not built. Links are minted on demand and never stored or emailed
// (T-10-06-06); refresh_url must mint a new one.
//
// A4 verified against stripe@23.0.0 AccountCreateParams.Controller:
// stripe_dashboard.type 'express'|'full'|'none', fees.payer 'account'|'application',
// losses.payments 'application'|'stripe', requirement_collection 'application'|'stripe'.
import Stripe from "stripe";
import type {
  BillingLine,
  NormalisedEvent,
  PaymentGateway,
  ProviderAccount,
} from "@cds/core/payments";
import { normaliseStripeEvent } from "./normalise";

const CURRENCY = "usd";

/** Standard-equivalent controller properties (A4; `type: "standard"` is legacy). */
export const STANDARD_CONTROLLER = {
  stripe_dashboard: { type: "full" },
  fees: { payer: "account" },
  losses: { payments: "stripe" },
  requirement_collection: "stripe",
} as const satisfies Stripe.AccountCreateParams.Controller;

function lineItem(
  line: BillingLine,
): Stripe.Checkout.SessionCreateParams.LineItem {
  if (line.priceRef) return { price: line.priceRef, quantity: line.quantity };
  return {
    quantity: line.quantity,
    price_data: {
      currency: CURRENCY,
      unit_amount: line.unitCents,
      product_data: { name: line.label },
      ...(line.interval === "once"
        ? {}
        : { recurring: { interval: line.interval } }),
    },
  };
}

/**
 * The tenant's account is no longer connected to the platform. WR-E01: only a permission
 * refusal for that account says so. An authentication error is CDS's own key (rolled or
 * invalid) and a bare 404 is not specific to the account: both rethrow, so the reconcile
 * step fails and staff are alerted, instead of every tenant being marked disconnected.
 */
function isRevoked(e: unknown): boolean {
  if (e instanceof Stripe.errors.StripeAuthenticationError) return false;
  if (e instanceof Stripe.errors.StripePermissionError) return true;
  if (e instanceof Stripe.errors.StripeError) {
    return e.code === "account_invalid";
  }
  return false;
}

export function mapAccount(account: Stripe.Account): ProviderAccount {
  const chargesEnabled = account.charges_enabled === true;
  return {
    accountId: account.id,
    chargesEnabled,
    detailsSubmitted: account.details_submitted === true,
    displayName:
      account.business_profile?.name ??
      account.settings?.dashboard?.display_name ??
      null,
    status: chargesEnabled ? "connected" : "restricted",
  };
}

function disconnected(accountId: string): ProviderAccount {
  return {
    accountId,
    chargesEnabled: false,
    detailsSubmitted: false,
    displayName: null,
    status: "disconnected",
  };
}

export type StripeGatewayDeps = {
  stripe: Stripe;
  /** Connect endpoint secret (STRIPE_CONNECT_WEBHOOK_SECRET). */
  webhookSecret: string;
  now?: () => Date;
};

export function createStripePaymentGateway(
  deps: StripeGatewayDeps,
): PaymentGateway {
  const { stripe } = deps;
  const now = deps.now ?? (() => new Date());

  async function accountStatus(accountId: string): Promise<ProviderAccount> {
    try {
      return mapAccount(await stripe.accounts.retrieve(accountId));
    } catch (e) {
      if (isRevoked(e)) return disconnected(accountId);
      throw e;
    }
  }

  return {
    provider: "stripe",

    async startConnect(input) {
      // input.mode is informational: "existing" uses the same Account Link (choice 1).
      const accountId =
        input.accountId ??
        (
          await stripe.accounts.create(
            {
              controller: STANDARD_CONTROLLER,
              metadata: { org: input.orgId },
            },
            {
              idempotencyKey:
                input.idempotencyKey ?? `connect:${input.orgId}:account`,
            },
          )
        ).id;
      // No idempotency key: a link is single-use and must be fresh on every request.
      const link = await stripe.accountLinks.create({
        account: accountId,
        type: "account_onboarding",
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
      });
      return { accountId, url: link.url };
    },

    accountStatus,

    async createCheckout(input) {
      const recurring = input.lines.some((l) => l.interval !== "once");
      const session = await stripe.checkout.sessions.create(
        {
          mode: recurring ? "subscription" : "payment",
          line_items: input.lines.map(lineItem),
          success_url: input.successUrl,
          cancel_url: input.cancelUrl,
          ...(input.customerEmail
            ? { customer_email: input.customerEmail }
            : {}),
        },
        // Direct charge on the tenant's account (PAY-10, D296).
        {
          stripeAccount: input.accountId,
          idempotencyKey: input.idempotencyKey,
        },
      );
      if (!session.url) throw new Error("Stripe Checkout returned no URL");
      return { sessionId: session.id, url: session.url };
    },

    async refund(input) {
      const target = input.paymentRef.startsWith("ch_")
        ? { charge: input.paymentRef }
        : { payment_intent: input.paymentRef };
      const refund = await stripe.refunds.create(
        {
          ...target,
          ...(input.cents === null ? {} : { amount: input.cents }),
        },
        {
          stripeAccount: input.accountId,
          idempotencyKey: input.idempotencyKey,
        },
      );
      return { refundedCents: refund.amount };
    },

    normaliseWebhook(raw, signature) {
      return Promise.resolve(
        normaliseStripeEvent(raw, signature, deps.webhookSecret),
      );
    },

    async reconcile(input) {
      const at = now().toISOString();
      const events: NormalisedEvent[] = [];
      for (const accountId of input.accountIds) {
        const status = await accountStatus(accountId);
        const base = {
          id: `reconcile:${accountId}:${status.status}`,
          provider: "stripe" as const,
          account: accountId,
          orgId: null,
          createdAt: at,
        };
        events.push(
          status.status === "disconnected"
            ? { ...base, type: "account.deauthorized", accountId }
            : { ...base, type: "account.updated", accountId },
        );
      }
      return events;
    },
  };
}
