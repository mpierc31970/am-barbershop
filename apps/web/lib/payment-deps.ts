// P10 payments: register the web app's add-on deps with the payment processor (10-12 carry-
// forward, wired by 10-23). Events that reach the processor without explicit deps (the fake
// adapter's emits from /test-pay, later the webhook routes and reconcile) need them to install
// or pause paid add-ons. Called by the entry points that emit, never at module load of
// lib/addons.ts, so tests that mock @cds/db are not affected. Idempotent. Server-only.
import { registerPaymentAddonDeps } from "@cds/db";
import { addonDeps } from "./addons";

let registered = false;

export function ensurePaymentAddonDeps(): void {
  if (registered) return;
  registerPaymentAddonDeps(addonDeps);
  registered = true;
}
