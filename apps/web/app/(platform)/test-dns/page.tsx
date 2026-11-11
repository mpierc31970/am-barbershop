// /test-dns (14-44; UI-SPEC "Test DNS page", D-UI-P14-24, P14-P32): plays the outside world for
// the fake DNS, SES and HTTPS adapters. Lists the caller org's own fake worlds (fakeWorldsForOrg),
// shows the chosen one's state and posts one outside event per button to submitTestDns. The page
// changes fake state only; the hub catches up on the next domains:run. Robots: noindex.
// Buttons: one primary (Change nameservers to CDS), the rest secondary, ghost Back to the hub.
import { P14_COPY } from "@cds/core/dns";
import { EmptyState, InlineAlert, Select, buttonClasses } from "@cds/ui/hub";
import { fakeWorldsForOrg, type FakeWorldForOrg } from "@cds/db";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { submitTestDns } from "../../actions/test-dns";
import { requireHubSession } from "../../../lib/session";
import {
  TEST_DNS_BUTTON,
  TEST_DNS_DONE,
  TEST_DNS_FAILED,
  isTestDnsAction,
  testDnsDisabled,
  type TestDnsAction,
} from "../../../lib/test-dns";

export const metadata: Metadata = {
  title: "Test DNS",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

const TITLE = "Test DNS";
const INTRO =
  "Plays the outside world for the fake DNS, SES and HTTPS adapters.";
const HUB = "/hub";

type Search = {
  domain?: string | string[];
  done?: string | string[];
  error?: string | string[];
};

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

const DELEGATED: Record<FakeWorldForOrg["world"]["delegatedTo"], string> = {
  old: "The old host",
  cds: "Support",
  other: "Another host",
};

const SES: Record<FakeWorldForOrg["world"]["ses"]["status"], string> = {
  none: "Not set up",
  pending: "Pending",
  verified: "Verified",
  failed: "Failed",
};

function dateText(iso: string | null): string {
  if (!iso) return "Unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** TEST_DNS_RUN_HINT with its `npm run domains:run` shown as code. */
function RunHint() {
  const parts = P14_COPY.TEST_DNS_RUN_HINT.split("`");
  return (
    <p className="text-sm text-hub-ink-muted">
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <code
            key={i}
            className="rounded bg-hub-surface-2 px-1 font-mono text-[13px] text-hub-ink"
          >
            {p}
          </code>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  );
}

function ActionButton({
  action,
  variant,
}: {
  action: TestDnsAction;
  variant: "primary" | "secondary";
}) {
  return (
    <button
      type="submit"
      name="action"
      value={action}
      className={buttonClasses(variant)}
    >
      {TEST_DNS_BUTTON[action]}
    </button>
  );
}

export default async function TestDnsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  if (testDnsDisabled()) notFound();
  const session = await requireHubSession();
  const sp = await searchParams;

  let worlds: FakeWorldForOrg[] = [];
  let loadFailed = false;
  try {
    worlds = await fakeWorldsForOrg(session.ctx);
  } catch (err) {
    console.error(
      "[test-dns] load failed",
      err instanceof Error ? err.name : typeof err,
    );
    loadFailed = true;
  }

  const wanted = one(sp.domain);
  const chosen = worlds.find((w) => w.world.domain === wanted) ?? worlds[0];
  const done = one(sp.done);
  const business = session.org.name;

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl leading-tight font-semibold text-hub-ink">
          {TITLE}
        </h1>
        <p className="text-base text-hub-ink">{INTRO}</p>
      </div>

      {one(sp.error) === "1" || loadFailed ? (
        <InlineAlert tone="error">{TEST_DNS_FAILED}</InlineAlert>
      ) : null}
      {isTestDnsAction(done) ? (
        <div role="status">
          <InlineAlert tone="success">{TEST_DNS_DONE[done]}</InlineAlert>
        </div>
      ) : null}

      {!chosen ? (
        <EmptyState
          heading="No fake zones yet"
          body={P14_COPY.TEST_DNS_EMPTY}
          action={
            <Link href={HUB} className={buttonClasses("ghost")}>
              Back to the hub
            </Link>
          }
        />
      ) : (
        <>
          <form
            method="get"
            action="/test-dns"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex-1">
              <Select
                id="test-dns-domain"
                name="domain"
                label="Domain"
                defaultValue={chosen.world.domain}
                options={worlds.map((w) => ({
                  value: w.world.domain,
                  label: `${w.world.domain} · ${business} · zone ${w.zoneStatus}`,
                }))}
              />
            </div>
            <button type="submit" className={buttonClasses("secondary")}>
              Show
            </button>
          </form>

          <section
            aria-labelledby="test-dns-state"
            className="flex flex-col gap-3 rounded border border-hub-border p-4"
          >
            <h2
              id="test-dns-state"
              className="text-base font-semibold text-hub-ink"
            >
              {chosen.world.domain}
            </h2>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-hub-ink-muted">Registrar</dt>
              <dd className="text-hub-ink">
                {chosen.world.registrar ?? "Unknown"}
              </dd>
              <dt className="text-hub-ink-muted">DNSSEC</dt>
              <dd className="text-hub-ink">
                {chosen.world.dnssec ? "On" : "Off"}
              </dd>
              <dt className="text-hub-ink-muted">Delegated to</dt>
              <dd className="text-hub-ink">
                {DELEGATED[chosen.world.delegatedTo]}
              </dd>
              <dt className="text-hub-ink-muted">Sending domain (SES)</dt>
              <dd className="text-hub-ink">{SES[chosen.world.ses.status]}</dd>
              <dt className="text-hub-ink-muted">HTTPS check</dt>
              <dd className="text-hub-ink">
                {chosen.world.https === "ok"
                  ? `Works · certificate ${chosen.world.certDaysLeft} days left`
                  : "Fails"}
              </dd>
              <dt className="text-hub-ink-muted">Expires</dt>
              <dd className="text-hub-ink">
                {dateText(chosen.world.expiresAt)}
              </dd>
            </dl>
          </section>

          <form action={submitTestDns} className="flex flex-col gap-3">
            <input type="hidden" name="domain" value={chosen.world.domain} />
            <div className="flex flex-wrap gap-2">
              <ActionButton action="ns_cds" variant="primary" />
              <ActionButton action="ns_back" variant="secondary" />
              <ActionButton action="break_email" variant="secondary" />
              <ActionButton
                action={chosen.world.dnssec ? "dnssec_off" : "dnssec_on"}
                variant="secondary"
              />
              <ActionButton action="ses_verified" variant="secondary" />
              <ActionButton
                action={chosen.world.https === "ok" ? "https_fail" : "https_ok"}
                variant="secondary"
              />
              <ActionButton action="expire_7" variant="secondary" />
            </div>
          </form>

          <RunHint />

          <div>
            <Link href={HUB} className={buttonClasses("ghost")}>
              Back to the hub
            </Link>
          </div>
        </>
      )}
    </>
  );
}
