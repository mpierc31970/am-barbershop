// packages/db/src/dns/fake/prober.ts (P14, DOM-03; 14-10 choice 5).
// The fake HTTPS probe: ok iff the world says https "ok" and the host is the domain or its
// `www.`. The proof (the `cds-host` MAC the real edge would serve) is computed by a
// caller-supplied `expectedProof(host)` hook, so 14-14's HMAC check is exercised end to end;
// without a hook the proof is null.
import type { HttpsProber, ProbeResult } from "../ports";
import { normalizeDomain, refuseInProduction, storeList } from "./store";

export type FakeProofHook = (host: string) => string | Promise<string>;

let defaultHook: FakeProofHook | null = null;

/** Set (or clear with null) the proof hook used by probers built without one. */
export function setFakeProberProof(hook: FakeProofHook | null): void {
  defaultHook = hook;
}

export function fakeHttpsProber(
  opts: { expectedProof?: FakeProofHook } = {},
): HttpsProber {
  return {
    async probe(host): Promise<ProbeResult> {
      refuseInProduction();
      const h = normalizeDomain(host);
      const w = (await storeList()).find(
        (x) => h === x.domain || h === `www.${x.domain}`,
      );
      if (!w) {
        return {
          ok: false,
          status: null,
          proof: null,
          certDaysLeft: null,
          error: "unknown_host",
        };
      }
      if (w.https !== "ok") {
        return {
          ok: false,
          status: null,
          proof: null,
          certDaysLeft: null,
          error: "tls_failed",
        };
      }
      const hook = opts.expectedProof ?? defaultHook;
      return {
        ok: true,
        status: 200,
        proof: hook ? await hook(h) : null,
        certDaysLeft: w.certDaysLeft,
        error: null,
      };
    },
  };
}
