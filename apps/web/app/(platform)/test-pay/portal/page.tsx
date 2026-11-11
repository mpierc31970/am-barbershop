// /test-pay/portal?session=<bps_fake_…>: the fake adapter's "Update card" portal (10-23;
// UI-SPEC "Test pages"). Shown only when the portal link belongs to the caller's org and
// names the org's own customer (billing_accounts); otherwise the expired copy. Save test card
// pays every open invoice and reactivates past due; Use a card that fails makes the next
// charge fail. Robots: noindex.
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import { testPayCustomerId } from "@cds/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { submitTestCard } from "../../../actions/test-pay";
import { requireHubSession } from "../../../../lib/session";
import {
  TEST_PAY_FAILED,
  portalMatches,
  testPayDisabled,
} from "../../../../lib/test-pay";
import { TestPayExpired } from "../TestPayExpired";

export const metadata: Metadata = {
  title: "Update your test card",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const TITLE = "Update your test card";
const BACK = "/hub/settings?tab=billing";

type Search = { session?: string | string[]; error?: string | string[] };

export default async function TestPortalPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (testPayDisabled()) notFound();
  const { ctx } = await requireHubSession();
  const sp = await searchParams;
  const portal = typeof sp.session === "string" ? sp.session : "";

  let ok = false;
  try {
    ok = await portalMatches(ctx, portal, await testPayCustomerId(ctx));
  } catch (err) {
    // A role without billing:write, or a store outage: the expired copy, never a crash.
    console.error(
      "[test-pay] portal load failed",
      err instanceof Error ? err.name : typeof err,
    );
    ok = false;
  }
  if (!ok) return <TestPayExpired title={TITLE} />;

  return (
    <>
      <h1 className="text-2xl leading-tight font-semibold text-hub-ink">
        {TITLE}
      </h1>
      {sp.error === "1" ? (
        <InlineAlert tone="error">{TEST_PAY_FAILED}</InlineAlert>
      ) : null}
      <p className="text-base text-hub-ink">Test card ending 4242</p>
      <form action={submitTestCard} className="flex flex-col gap-2">
        <input type="hidden" name="session" value={portal} />
        <button
          type="submit"
          name="outcome"
          value="save"
          className={buttonClasses("primary")}
        >
          Save test card
        </button>
        <button
          type="submit"
          name="outcome"
          value="fail"
          className={buttonClasses("ghost")}
        >
          Use a card that fails
        </button>
      </form>
      <a href={BACK} className={buttonClasses("ghost")}>
        Back to the hub
      </a>
    </>
  );
}
