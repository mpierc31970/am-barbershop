// packages/db/src/dns/fake/registry.ts (P14, DOM-03; 14-10 choice 5).
// The fake RDAP: registrar, expiry and DNSSEC straight from the world; an unknown domain is
// "not found" (RDAP 404 -> DOM-NOT-REGISTERED, P14-P22).
import type { RegistryLookup } from "../ports";
import { refuseInProduction, storeGet } from "./store";

export function fakeRegistryLookup(): RegistryLookup {
  return {
    async lookup(domain) {
      refuseInProduction();
      const w = await storeGet(domain);
      if (!w) {
        return { found: false, registrar: null, expiresAt: null, dnssec: null };
      }
      return {
        found: true,
        registrar: w.registrar,
        expiresAt: w.expiresAt,
        dnssec: w.dnssec,
      };
    },
  };
}
