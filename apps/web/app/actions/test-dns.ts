"use server";
// Server Actions behind `/test-dns` (14-44; UI-SPEC "Test DNS page", D-UI-P14-24, P14-P32). Each
// re-derives the hub session (runAction), validates the domain with a strict pattern and the
// action against a fixed list, checks the domain is one of the caller org's own fake worlds
// (fakeWorldsForOrg, T-14-44-02), then calls the matching fake world function, which refuses in
// production itself (T-14-44-01). Fake state only: domains:run is never triggered here.
import { InvalidInput, NotFound } from "@cds/core";
import {
  fakeBreakEmailRecord,
  fakeChangeNameservers,
  fakeExpireIn,
  fakeSetDnssec,
  fakeSetHttps,
  fakeSetSesStatus,
  fakeWorldsForOrg,
} from "@cds/db";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "../../lib/action";
import {
  TEST_DNS_DOMAIN_RE,
  TEST_DNS_PATH,
  isTestDnsAction,
  testDnsDisabled,
  type TestDnsAction,
} from "../../lib/test-dns";

const BAD_INPUT = "That domain or action isn't on this page. Reload it.";

async function apply(domain: string, action: TestDnsAction): Promise<void> {
  switch (action) {
    case "ns_cds":
      await fakeChangeNameservers(domain, "cds");
      return;
    case "ns_back":
      await fakeChangeNameservers(domain, "old");
      return;
    case "break_email":
      await fakeBreakEmailRecord(domain);
      return;
    case "dnssec_on":
      await fakeSetDnssec(domain, true);
      return;
    case "dnssec_off":
      await fakeSetDnssec(domain, false);
      return;
    case "ses_verified":
      await fakeSetSesStatus(domain, "verified");
      return;
    case "https_fail":
      await fakeSetHttps(domain, false);
      return;
    case "https_ok":
      await fakeSetHttps(domain, true);
      return;
    case "expire_7":
      await fakeExpireIn(domain, 7);
      return;
  }
}

/** Play one outside event on one of the caller org's fake domains. */
export async function runTestDnsAction(
  domain: string,
  action: TestDnsAction,
): Promise<ActionResult<{ domain: string; action: TestDnsAction }>> {
  if (testDnsDisabled()) {
    return { ok: false, code: "not_found", message: BAD_INPUT };
  }
  return runAction(async ({ ctx }) => {
    if (
      typeof domain !== "string" ||
      !TEST_DNS_DOMAIN_RE.test(domain) ||
      !isTestDnsAction(action)
    ) {
      throw new InvalidInput(BAD_INPUT);
    }
    const owned = await fakeWorldsForOrg(ctx);
    if (!owned.some((w) => w.world.domain === domain)) {
      throw new NotFound(BAD_INPUT);
    }
    await apply(domain, action);
    return { domain, action };
  });
}

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** `/test-dns` form: hidden `domain`, one submit button per `action`. */
export async function submitTestDns(form: FormData): Promise<void> {
  const domain = field(form, "domain");
  const action = field(form, "action");
  const result = isTestDnsAction(action)
    ? await runTestDnsAction(domain, action)
    : null;
  if (result && !result.ok && result.code === "signed_out") {
    redirect("/sign-in");
  }
  const back = TEST_DNS_DOMAIN_RE.test(domain)
    ? `${TEST_DNS_PATH}?domain=${encodeURIComponent(domain)}`
    : TEST_DNS_PATH;
  if (result?.ok) {
    redirect(`${back}${back.includes("?") ? "&" : "?"}done=${action}`);
  }
  redirect(`${back}${back.includes("?") ? "&" : "?"}error=1`);
}
