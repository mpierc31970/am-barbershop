// P10 payments: PaymentGateway stand-in (the tenant as the merchant, D256, D296; PAY-09).
//
// - startConnect creates a fake Connect account (setup not finished) and returns the
//   platform's "Connect a test Stripe account" page; the page settles it with
//   fakeConnectOutcome.
// - Tenant checkouts are sessions on the tenant's fake account (`account` set), paid on the
//   same "Test payment" page. Refunds are recorded against the session's payment
//   (`pi_fake_<session suffix>`).
// - normaliseWebhook always throws (10-45 choice 3); in CDS_ENV=production every call that
//   would connect an account or move money throws PaymentsUnavailable.
import {
  WebhookSignatureInvalid,
  type NormalisedEvent,
  type PaymentGateway,
} from "@cds/core/payments";
import { platformUrl } from "../../email/env";
import {
  fakeId,
  getFakeObject,
  putFakeObject,
  updateFakeObject,
} from "./store";
import {
  lineCents,
  mustGet,
  refuseInProduction,
  registerEmit,
  toAccount,
  type EmitEvent,
  type FakeAccount,
  type FakeRefund,
  type FakeSession,
} from "./shared";

export type FakeGatewayDeps = { emit: EmitEvent; now?: () => Date };

/** The fake payment ref of a tenant-side session (what a Stripe payment intent would be). */
export function paymentRefOf(sessionId: string): string {
  return sessionId.replace(/^cs_fake_/, "pi_fake_");
}

function sessionOfPayment(paymentRef: string): string {
  return paymentRef.replace(/^pi_fake_/, "cs_fake_");
}

export function createFakePaymentGateway(
  deps: FakeGatewayDeps,
): PaymentGateway {
  const now = deps.now ?? (() => new Date());
  registerEmit(deps.emit);

  async function accountStatus(accountId: string) {
    const a = await getFakeObject<FakeAccount>(accountId);
    return toAccount(accountId, a && a.kind === "account" ? a.data : null);
  }

  return {
    provider: "fake",

    async startConnect(input) {
      refuseInProduction();
      const existing = input.accountId
        ? await getFakeObject<FakeAccount>(input.accountId)
        : null;
      // As on Stripe (WR-E02): no onboarding link for an account that disconnected the
      // platform, and creating with the same key hands back the same account.
      if (existing && existing.data.status === "disconnected") {
        throw new Error(
          `fake account ${existing.id} is disconnected: no account link`,
        );
      }
      const account =
        existing ??
        (await putFakeObject<FakeAccount>(
          "account",
          {
            orgId: input.orgId,
            chargesEnabled: false,
            detailsSubmitted: false,
            displayName: null,
            status: "restricted",
          },
          input.orgId,
          {
            idempotencyKey:
              input.idempotencyKey ?? `connect:${input.orgId}:account`,
          },
        ));
      return {
        accountId: account.id,
        url: platformUrl(
          `/test-pay/connect?account=${encodeURIComponent(account.id)}`,
        ),
      };
    },

    accountStatus,

    async createCheckout(input) {
      refuseInProduction();
      const account = await mustGet<FakeAccount>(input.accountId, "account");
      if (!account.data.chargesEnabled) {
        throw new Error(`fake account ${input.accountId} cannot take payments`);
      }
      const s = await putFakeObject<FakeSession>(
        "session",
        {
          orgId: account.data.orgId,
          customerId: "",
          account: input.accountId,
          customerEmail: input.customerEmail,
          lines: [...input.lines],
          deferredMonthly: [],
          cadence: null,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          status: "open",
          paymentStatus: "unpaid",
          subscriptionId: null,
          invoiceId: null,
          refundedCents: 0,
        },
        account.data.orgId,
        { idempotencyKey: `${input.accountId}:${input.idempotencyKey}` },
      );
      return { sessionId: s.id, url: platformUrl(`/test-pay/${s.id}`) };
    },

    async refund(input) {
      refuseInProduction();
      const session = await mustGet<FakeSession>(
        sessionOfPayment(input.paymentRef),
        "session",
      );
      if (
        session.data.account !== input.accountId ||
        session.data.paymentStatus !== "paid"
      ) {
        throw new Error(`fake payment ${input.paymentRef} not refundable`);
      }
      const refundKey = `${input.accountId}:${input.idempotencyKey}`;
      const prior = await getFakeObject<FakeRefund>(
        fakeId("refund", refundKey),
      );
      if (prior) return { refundedCents: prior.data.cents };
      const total = session.data.lines.reduce((s, l) => s + lineCents(l), 0);
      const remaining = total - session.data.refundedCents;
      const cents = Math.min(remaining, input.cents ?? remaining);
      if (cents <= 0) return { refundedCents: 0 };
      await putFakeObject<FakeRefund>(
        "refund",
        {
          customerId: null,
          account: input.accountId,
          target: input.paymentRef,
          cents,
        },
        session.data.orgId,
        { idempotencyKey: refundKey },
      );
      await updateFakeObject<FakeSession>(session.id, {
        refundedCents: session.data.refundedCents + cents,
      });
      return { refundedCents: cents };
    },

    normaliseWebhook() {
      return Promise.reject(new WebhookSignatureInvalid());
    },

    async reconcile(input) {
      const at = now().toISOString();
      const events: NormalisedEvent[] = [];
      for (const accountId of input.accountIds) {
        const status = await accountStatus(accountId);
        const base = {
          id: `reconcile:${accountId}:${status.status}`,
          provider: "fake" as const,
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
