// packages/db/src/email/sending-domains/ports.ts (P14, ONB-10).
// Owner: 14-24 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The SendingDomains port (14-24 choices 1-3; D112, D173): an email identity for a tenant's
// own domain at the mail provider. `createIdentity` returns the three DKIM tokens and the
// custom MAIL FROM domain (`send.<domain>`); `status` polls verification; `deleteIdentity`
// removes it (offboarding). Adapters: `fake` (state in the fake DNS world) and `ses` (SES v2).

export type SendingIdentityStatus = "pending" | "verified" | "failed";

export type SendingIdentity = {
  /** Three Easy DKIM tokens; each becomes `<t>._domainkey.<domain>` CNAME. */
  dkimTokens: string[];
  /** The custom MAIL FROM domain, always `send.<domain>`. */
  mailFrom: string;
};

export interface SendingDomains {
  readonly name: "fake" | "ses";
  createIdentity(domain: string): Promise<SendingIdentity>;
  status(domain: string): Promise<SendingIdentityStatus>;
  deleteIdentity(domain: string): Promise<void>;
}

/** A provider call failed. The message carries an HTTP status or a short code, never a domain or key. */
export class SendingDomainsError extends Error {
  override readonly name = "SendingDomainsError";
}

/** The MAIL FROM subdomain label (RESEARCH Pitfall 8: its own MX + SPF, apex SPF untouched). */
export const SENDING_MAIL_FROM_LABEL = "send";

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Lowercase registrable-looking domain, or throws (never interpolated into a URL unchecked). */
export function sendingDomainName(domain: string): string {
  const d =
    typeof domain === "string"
      ? domain.trim().toLowerCase().replace(/\.$/, "")
      : "";
  const labels = d.split(".");
  if (
    d.length > 253 ||
    labels.length < 2 ||
    !labels.every((l) => LABEL.test(l))
  ) {
    throw new SendingDomainsError("invalid_domain");
  }
  return d;
}
