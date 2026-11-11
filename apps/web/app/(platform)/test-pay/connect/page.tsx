// /test-pay/connect?account=<acct_fake_…>: the fake adapter's Stripe Connect onboarding
// (10-23; UI-SPEC "Test pages"). Shown only when the query account is the caller org's own
// Connect account (gateway_accounts); otherwise the expired copy. The three buttons settle
// the pretend account as finished, unfinished or restricted, emit account.updated through the
// processor and return to Settings › Payments. Robots: noindex.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { testPayAccountId } from "@cds/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitTestConnect } from "../../../actions/test-pay";
import { requireHubSession } from "../../../../lib/session";
import {
  ACCOUNT_ID_RE,
  TEST_PAY_FAILED,
  testPayDisabled,
} from "../../../../lib/test-pay";
import { TestPayExpired } from "../TestPayExpired";

export const metadata: Metadata = {
  title: "Connect a test Stripe account",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const TITLE = "Connect a test Stripe account";
const BACK = "/hub/settings?tab=payments";

type Search = { account?: string | string[]; error?: string | string[] };

export default async function TestConnectPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (testPayDisabled()) notFound();
  const { ctx } = await requireHubSession();
  const sp = await searchParams;
  const account = typeof sp.account === "string" ? sp.account : "";

  let ok = false;
  if (ACCOUNT_ID_RE.test(account)) {
    try {
      ok = (await testPayAccountId(ctx)) === account;
    } catch (err) {
      // A role without connect:write, or a store outage: the expired copy.
      console.error(
        "[test-pay] connect load failed",
        err instanceof Error ? err.name : typeof err,
      );
      ok = false;
    }
  }
  if (!ok) return <TestPayExpired title={TITLE} />;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-tight font-semibold text-hub-ink">
          {TITLE}
        </h1>
        <p className="text-base text-hub-ink-muted">
          Pick how this pretend account should behave.
        </p>
      </div>
      {sp.error === "1" ? (
        <InlineAlert tone="error">{TEST_PAY_FAILED}</InlineAlert>
      ) : null}
      <form action={submitTestConnect} className="flex flex-col gap-2">
        <input type="hidden" name="account" value={account} />
        <button
          type="submit"
          name="kind"
          value="finished"
          className={buttonClasses("primary")}
        >
          Connect test account
        </button>
        <button
          type="submit"
          name="kind"
          value="unfinished"
          className={buttonClasses("secondary")}
        >
          Connect with setup not finished
        </button>
        <button
          type="submit"
          name="kind"
          value="restricted"
          className={buttonClasses("secondary")}
        >
          Connect a restricted account
        </button>
      </form>
      <a href={BACK} className={buttonClasses("ghost")}>
        Back to CDS
      </a>
    </>
  );
}
