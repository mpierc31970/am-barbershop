// packages/db/src/email/sending-domains/ses.ts (P14, ONB-10). Owner: 14-24 (choice 3).
// Not in the barrel: only factory.ts imports it. The SES v2 adapter, SigV4-signed with the
// pinned aws4fetch (same as storage/s3.ts; no new dependency):
//   create  POST   /v2/email/identities                  { EmailIdentity }  -> DkimAttributes.Tokens
//           PUT    /v2/email/identities/<d>/mail-from    { MailFromDomain: "send.<d>", BehaviorOnMxFailure }
//   status  GET    /v2/email/identities/<d>              VerifiedForSendingStatus + DkimAttributes.Status
//   delete  DELETE /v2/email/identities/<d>
// Errors carry the HTTP status only (T-14-24-03): never the body, the domain or a key.
// Unit-tested with an injected fetch and recorded JSON shapes; never called live in tests.
import { AwsClient } from "aws4fetch";
import {
  SENDING_MAIL_FROM_LABEL,
  SendingDomainsError,
  sendingDomainName,
  type SendingDomains,
  type SendingIdentityStatus,
} from "./ports";

export type SesConfig = {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Default `https://email.<region>.amazonaws.com`. */
  endpoint?: string;
  fetch?: typeof fetch;
};

type IdentityJson = {
  VerifiedForSendingStatus?: boolean;
  DkimAttributes?: { Tokens?: string[]; Status?: string };
};

const TOKEN = /^[a-z0-9]{1,63}$/i;
/** Per-request timeout (WR-A10). */
const SES_TIMEOUT_MS = 10_000;

function tokensOf(j: IdentityJson): string[] {
  const t = j.DkimAttributes?.Tokens;
  if (
    !Array.isArray(t) ||
    t.length !== 3 ||
    !t.every((x) => TOKEN.test(String(x)))
  ) {
    throw new SendingDomainsError("ses_bad_tokens");
  }
  return t.map((x) => String(x).toLowerCase());
}

/** SES DKIM + sending state -> port status. */
export function sesStatusOf(j: IdentityJson): SendingIdentityStatus {
  const dkim = String(j.DkimAttributes?.Status ?? "").toUpperCase();
  if (dkim === "FAILED") return "failed";
  if (j.VerifiedForSendingStatus === true && dkim === "SUCCESS")
    return "verified";
  return "pending";
}

export function sesSendingDomains(cfg: SesConfig): SendingDomains {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "ses",
    region: cfg.region,
    retries: 0,
  });
  const base = (
    cfg.endpoint ?? `https://email.${cfg.region}.amazonaws.com`
  ).replace(/\/+$/, "");
  const fetchImpl = cfg.fetch ?? ((input, init) => fetch(input, init));

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    const signed = await client.sign(`${base}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    // WR-A10: the sending job holds the org lock; never wait on a hung connection.
    return fetchImpl(signed, { signal: AbortSignal.timeout(SES_TIMEOUT_MS) });
  }

  function fail(op: string, res: Response): never {
    throw new SendingDomainsError(`ses_${op}_${res.status}`);
  }

  async function getIdentity(d: string): Promise<IdentityJson | null> {
    const res = await call(
      "GET",
      `/v2/email/identities/${encodeURIComponent(d)}`,
    );
    if (res.status === 404) return null;
    if (!res.ok) fail("get", res);
    return (await res.json()) as IdentityJson;
  }

  return {
    name: "ses",
    async createIdentity(domain) {
      const d = sendingDomainName(domain);
      const res = await call("POST", "/v2/email/identities", {
        EmailIdentity: d,
      });
      let tokens: string[];
      if (res.ok) {
        tokens = tokensOf((await res.json()) as IdentityJson);
      } else if (res.status === 409) {
        // AlreadyExistsException: a retry after a half-finished run. Read the tokens back.
        const existing = await getIdentity(d);
        if (!existing) fail("create", res);
        tokens = tokensOf(existing);
      } else {
        fail("create", res);
      }
      const mailFrom = `${SENDING_MAIL_FROM_LABEL}.${d}`;
      const mf = await call(
        "PUT",
        `/v2/email/identities/${encodeURIComponent(d)}/mail-from`,
        { MailFromDomain: mailFrom, BehaviorOnMxFailure: "USE_DEFAULT_VALUE" },
      );
      if (!mf.ok) fail("mail_from", mf);
      return { dkimTokens: tokens, mailFrom };
    },
    async status(domain) {
      const j = await getIdentity(sendingDomainName(domain));
      return j ? sesStatusOf(j) : "failed";
    },
    async deleteIdentity(domain) {
      const d = sendingDomainName(domain);
      const res = await call(
        "DELETE",
        `/v2/email/identities/${encodeURIComponent(d)}`,
      );
      if (res.status === 404) return;
      if (!res.ok) fail("delete", res);
    },
  };
}
