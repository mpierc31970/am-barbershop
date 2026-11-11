// packages/db/src/email/sending-domains/factory.ts (P14, ONB-10).
// Owner: 14-24 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Builds the SendingDomains adapter from env (14-24 choice 1, payments/factory.ts shape):
//   CDS_SENDING_DOMAINS unset -> `closed` in production (nothing is created), `fake` elsewhere
//   CDS_SENDING_DOMAINS=fake  -> fake (state in the fake DNS world; refuses in production)
//   CDS_SENDING_DOMAINS=ses   -> SES v2; needs AWS_SES_REGION, AWS_SES_ACCESS_KEY_ID,
//                                AWS_SES_SECRET_ACCESS_KEY (the error names the missing ones)
//   anything else             -> throws (fail closed)
// The only importer of ./fake and ./ses.
import { fakeSendingDomains } from "./fake";
import type { SendingDomains } from "./ports";
import { sesSendingDomains } from "./ses";

export type SendingDomainsMode = "fake" | "ses" | "closed";

const SES_ENV = [
  "AWS_SES_REGION",
  "AWS_SES_ACCESS_KEY_ID",
  "AWS_SES_SECRET_ACCESS_KEY",
] as const;

/** Region used when building the `send.` MX target in fake mode. */
const DEFAULT_REGION = "us-east-1";

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requireSesEnv(): void {
  const missing = SES_ENV.filter((k) => env(k) === "");
  if (missing.length > 0) {
    throw new Error(
      `CDS_SENDING_DOMAINS=ses needs ${SES_ENV.join(", ")} (missing: ${missing.join(", ")})`,
    );
  }
}

export function sendingDomainsMode(): SendingDomainsMode {
  const raw = env("CDS_SENDING_DOMAINS").toLowerCase();
  if (raw === "") {
    return process.env.CDS_ENV === "production" ? "closed" : "fake";
  }
  if (raw === "fake") return "fake";
  if (raw === "ses") {
    requireSesEnv();
    return "ses";
  }
  throw new Error('CDS_SENDING_DOMAINS must be "fake" or "ses"');
}

/** The SES region for the `send.<d>` MX target (`feedback-smtp.<region>.amazonses.com`). */
export function sendingDomainsRegion(): string {
  const r = env("AWS_SES_REGION").toLowerCase();
  return /^[a-z]{2}(-[a-z]+)+-\d$/.test(r) ? r : DEFAULT_REGION;
}

let memo: SendingDomains | null = null;
let override: SendingDomains | null = null;

/** The configured adapter, memoised. Throws in `closed` mode: callers check the mode first. */
export function getSendingDomains(): SendingDomains {
  if (override) return override;
  const mode = sendingDomainsMode();
  if (mode === "closed") {
    throw new Error("own-domain sending is closed (CDS_SENDING_DOMAINS unset)");
  }
  if (memo && memo.name === mode) return memo;
  memo =
    mode === "ses"
      ? sesSendingDomains({
          region: sendingDomainsRegion(),
          accessKeyId: env("AWS_SES_ACCESS_KEY_ID"),
          secretAccessKey: env("AWS_SES_SECRET_ACCESS_KEY"),
        })
      : fakeSendingDomains();
  return memo;
}

/** Tests: inject an adapter (a spy, an SES client over a recorded fetch). */
export function setSendingDomainsForTests(s: SendingDomains): void {
  override = s;
}

/** Tests: drop the override and the memoised adapter (env is re-read on next use). */
export function resetSendingDomainsForTests(): void {
  override = null;
  memo = null;
}
