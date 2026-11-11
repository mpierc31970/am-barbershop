// P14 `/test-dns` (14-44; UI-SPEC "Test DNS page", D-UI-P14-24, P14-P32). What the dev page and
// its Server Actions share: the guard, the strict domain pattern, the action keys and their
// Done copy. Server-only ("use server" files may export only async functions, so it lives here).
import { P14_COPY } from "@cds/core/dns";
import { dnsProviderMode } from "@cds/db";

/** 404 / refused when production, or when the DNS provider is not the fake world. */
export function testDnsDisabled(): boolean {
  if (process.env.CDS_ENV === "production") return true;
  try {
    return dnsProviderMode() !== "fake";
  } catch {
    // An unknown CDS_DNS_PROVIDER value is a misconfiguration: never open the page.
    return true;
  }
}

/** Lower-case hostname, labels 1-63 chars, a TLD of letters; nothing else reaches @cds/db. */
export const TEST_DNS_DOMAIN_RE =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const TEST_DNS_ACTIONS = [
  "ns_cds",
  "ns_back",
  "break_email",
  "dnssec_on",
  "dnssec_off",
  "ses_verified",
  "https_fail",
  "https_ok",
  "expire_7",
] as const;
export type TestDnsAction = (typeof TEST_DNS_ACTIONS)[number];

export function isTestDnsAction(v: unknown): v is TestDnsAction {
  return (
    typeof v === "string" && (TEST_DNS_ACTIONS as readonly string[]).includes(v)
  );
}

/** Button label per action (UI-SPEC "Test DNS page"). */
export const TEST_DNS_BUTTON: Record<TestDnsAction, string> = {
  ns_cds: P14_COPY.BTN_TEST_DNS_CHANGE_NS,
  ns_back: "Change nameservers back",
  break_email: "Break an email record",
  dnssec_on: "Turn DNSSEC on",
  dnssec_off: "Turn DNSSEC off",
  ses_verified: "Mark sending domain verified",
  https_fail: "Make HTTPS fail",
  https_ok: "Make HTTPS work",
  expire_7: "Expire in 7 days",
};

/** The confirmation shown after each action (UI-SPEC Toast "Done: …"). */
export const TEST_DNS_DONE: Record<TestDnsAction, string> = {
  ns_cds: "Done: nameservers now point to us.",
  ns_back: "Done: nameservers point back to the old host.",
  break_email: "Done: an email record is now wrong in public DNS.",
  dnssec_on: "Done: DNSSEC is on.",
  dnssec_off: "Done: DNSSEC is off.",
  ses_verified: "Done: the sending domain is verified.",
  https_fail: "Done: HTTPS checks now fail.",
  https_ok: "Done: HTTPS checks now pass.",
  expire_7: "Done: the domain now expires in 7 days.",
};

export const TEST_DNS_FAILED = "That didn't go through. Try again.";
export const TEST_DNS_PATH = "/test-dns";
