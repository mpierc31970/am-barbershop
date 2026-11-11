// packages/db/src/email/sending-domains/fake.ts (P14, ONB-10). Owner: 14-24 (choice 2).
// Not in the barrel: only factory.ts imports it. The fake identity lives in the fake DNS
// world (`dns_fake_state`, `ses` field): createIdentity sets `pending` with three tokens
// derived from the domain; `fakeSetSesStatus` (14-10) plays SES verifying or failing.
// Refuses in production (T-14-10-01).
import {
  emptyFakeWorld,
  refuseInProduction,
  storeGet,
  storePut,
} from "../../dns/fake/store";
import {
  SENDING_MAIL_FROM_LABEL,
  sendingDomainName,
  type SendingDomains,
} from "./ports";

/** `tok1<domain letters>` .. `tok3…`: stable per domain, valid DNS labels. */
export function fakeSendingTokens(domain: string): string[] {
  const slug = sendingDomainName(domain)
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 50);
  return ["tok1", "tok2", "tok3"].map((t) => `${t}${slug}`);
}

export function fakeSendingDomains(): SendingDomains {
  return {
    name: "fake",
    async createIdentity(domain) {
      refuseInProduction();
      const d = sendingDomainName(domain);
      const w = (await storeGet(d)) ?? emptyFakeWorld(d);
      const tokens =
        w.ses.tokens.length === 3 ? w.ses.tokens : fakeSendingTokens(d);
      const status = w.ses.status === "none" ? "pending" : w.ses.status;
      await storePut({ ...w, ses: { status, tokens } });
      return {
        dkimTokens: [...tokens],
        mailFrom: `${SENDING_MAIL_FROM_LABEL}.${d}`,
      };
    },
    async status(domain) {
      refuseInProduction();
      const w = await storeGet(sendingDomainName(domain));
      const s = w?.ses.status ?? "none";
      // No identity at all reads as failed, like SES answering 404.
      return s === "none" ? "failed" : s;
    },
    async deleteIdentity(domain) {
      refuseInProduction();
      const w = await storeGet(sendingDomainName(domain));
      if (!w || w.ses.status === "none") return;
      await storePut({ ...w, ses: { status: "none", tokens: [] } });
    },
  };
}
