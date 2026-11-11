// P10 payments: the pinned Stripe client (PAY-09, CONTEXT A1). Only files under
// packages/db/src/payments/stripe/ may import the SDK (ESLint STRIPE_BOUNDARY + deps scan).
//
// - apiVersion: the SDK pin (stripe@23.0.0 = 2026-09-30.endive); never overridden here.
// - maxNetworkRetries 2 + an explicit idempotency key on every mutating call (T-10-06-04).
// - timeout 20 s: runInstall calls the gate inside withOrgLock (RESEARCH Pattern 5).
// - telemetry off.
// - Live keys (sk_live_ / rk_live_) are refused unless CDS_ENV=production and
//   STRIPE_ALLOW_LIVE=1 (RESEARCH Pitfall 4, T-10-06-05). Outside production only test keys.
import Stripe from "stripe";

export type StripeEnv = {
  readonly CDS_ENV?: string | undefined;
  readonly STRIPE_ALLOW_LIVE?: string | undefined;
};

export type StripeClientOptions = {
  /** Test seam: the recording client (recording-http.ts). Production uses the SDK default. */
  httpClient?: Stripe.HttpClient;
  /** Defaults to process.env; tests pass their own. */
  env?: StripeEnv;
};

/** A key or environment that must not reach Stripe. Message never echoes the key. */
export class StripeKeyRefused extends Error {
  readonly code = "stripe_key_refused";
}

const LIVE = /^(sk|rk)_live_/;
const TEST = /^(sk|rk)_test_/;

/** Throws StripeKeyRefused unless the key is allowed in this environment. */
export function assertStripeKeyAllowed(key: string, env: StripeEnv): void {
  if (!key) throw new StripeKeyRefused("STRIPE_SECRET_KEY is not set");
  const production = env.CDS_ENV === "production";
  if (LIVE.test(key)) {
    if (production && env.STRIPE_ALLOW_LIVE === "1") return;
    throw new StripeKeyRefused(
      "A live Stripe key (sk_live_) is refused unless CDS_ENV=production and STRIPE_ALLOW_LIVE=1",
    );
  }
  if (TEST.test(key)) return;
  throw new StripeKeyRefused(
    "STRIPE_SECRET_KEY must be a Stripe test key (sk_test_) or an allowed live key",
  );
}

export function stripeClient(
  key: string = process.env.STRIPE_SECRET_KEY ?? "",
  options: StripeClientOptions = {},
): Stripe {
  assertStripeKeyAllowed(
    key,
    options.env ?? {
      CDS_ENV: process.env.CDS_ENV,
      STRIPE_ALLOW_LIVE: process.env.STRIPE_ALLOW_LIVE,
    },
  );
  return new Stripe(key, {
    maxNetworkRetries: 2,
    timeout: 20_000,
    telemetry: false,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
  });
}
