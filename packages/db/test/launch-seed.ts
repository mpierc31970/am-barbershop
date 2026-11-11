// 14-36: test-only launch setup for the approve-launch tests (apps/web Pipeline action tests,
// the P13 exit test and launch-approval.integration.test.ts). Keeps the superuser client inside
// packages/db (Invariant 1). For a ready_for_review org it: adds the preview host when missing,
// publishes a Home page, seeds a fake
// domain (google email preset + DMARC), prepares a launch move with the 14-22 steps as the
// owner (snapshot .. delegation), completes the owner's six review items and submits the
// launch review (14-33), and points the default fake HTTPS prober at this org's host proof so
// the cutover's HTTPS step can pass once `https` is set. Setup only: approval itself must go
// through the action / startCutover under test.
import { randomBytes } from "node:crypto";
import type { DnsRecord } from "@cds/core/dns";
import { superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { cdsHostProof } from "../src/dns/edge";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeSetHttps, setFakeProberProof } from "../src/dns/fake-world";
import { advanceMove, startMove, type MoveDeps } from "../src/dns/moves";
import { captureTransport } from "../src/email/transport";
import {
  markKeyFacts,
  markPage,
  markPhoneCheck,
} from "../src/launch-review/marks";
import { reviewPages, submitLaunchReview } from "../src/launch-review/review";
import {
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "./helpers/fake-dns-world";

export type PreparedLaunch = {
  domain: string;
  moveId: string;
  moveCode: string;
  ownerCtx: OrgContext;
};

const proofOrgs = new Map<string, string>();

/** The default fake prober answers each launch domain with its own org's host proof. */
function installProofHook(domain: string, orgId: string): void {
  proofOrgs.set(domain, orgId);
  setFakeProberProof((host) => {
    const bare = host.startsWith("www.") ? host.slice(4) : host;
    return cdsHostProof(host, proofOrgs.get(bare) ?? "");
  });
}

async function ownerCtxFor(orgId: string): Promise<OrgContext> {
  const pb = await superuser();
  const m = await pb
    .collection("memberships")
    .getFirstListItem(
      pb.filter("organization = {:o} && role = 'owner'", { o: orgId }),
    );
  return mintOrgContext({
    orgId,
    actor: String(m.user),
    role: "owner",
    grants: [],
    ip: "198.51.100.7",
  });
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

/**
 * Prepare a launch: published Home page, a prepared launch move on a fresh fake domain, every
 * review item done and the review submitted. The org must be at ready_for_review with a
 * confirmed email route (seedPipelineOrg writes one). `submit: false` stops before Ready to
 * launch; `https: false` leaves the fake world's HTTPS failing (the cutover then waits).
 */
export async function prepareLaunchForTests(
  orgId: string,
  opts: { submit?: boolean; https?: boolean; now?: Date } = {},
): Promise<PreparedLaunch> {
  const pb = await superuser();
  // Signup gives every site its preview host (14-15); older seeds may lack it.
  const hosts = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    fields: "id",
  });
  if (hosts.length === 0) {
    const org = await pb.collection("organizations").getOne(orgId, {
      fields: "slug",
    });
    await pb.collection("org_hosts").create({
      hostname: `${String(org.slug)}.sites.localhost`,
      organization: orgId,
      kind: "preview",
      primary: true,
    });
  }
  await pb.collection("pages").create({
    organization: orgId,
    slug: "home",
    title: "Home",
    status: "published",
    kind: "builder",
    published_at: "2026-10-01 10:00:00.000Z",
  });
  const domain = `launch-${randomBytes(4).toString("hex")}.example`;
  const at = { now: opts.now ?? new Date() };
  await seedFakeDomain(
    domain,
    "google",
    { oldZone: [...presetRecords(domain, "google"), dmarc(domain)] },
    at.now,
  );
  const ownerCtx = await ownerCtxFor(orgId);
  const deps: MoveDeps = {
    provider: fakeDnsProvider(),
    transport: captureTransport(),
    now: () => at.now,
  };
  const v = await startMove(
    ownerCtx,
    orgId,
    { domain, kind: "launch", by: ownerCtx.actor },
    deps,
  );
  await switchToCds(domain);
  at.now = new Date(at.now.getTime() + 5 * 60_000);
  const p = await advanceMove(v.id, deps);
  if (p.status !== "prepared") {
    throw new Error(
      `launch move not prepared: ${p.status} at ${p.currentStep}`,
    );
  }
  for (const page of await reviewPages(ownerCtx)) {
    await markPage(ownerCtx, page.id, "looks_good");
  }
  await markKeyFacts(ownerCtx);
  await markPhoneCheck(ownerCtx);
  if (opts.submit !== false) {
    await submitLaunchReview(ownerCtx, { transport: captureTransport() });
  }
  installProofHook(domain, orgId);
  if (opts.https !== false) await fakeSetHttps(domain, true);
  return { domain, moveId: p.id, moveCode: p.code, ownerCtx };
}

/** org_hosts rows of one org: hostname -> kind and primary. */
export async function hostRowsFor(
  orgId: string,
): Promise<Record<string, { kind: string; primary: boolean }>> {
  const pb = await superuser();
  const rows = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
  return Object.fromEntries(
    rows.map((r) => [
      String(r.hostname),
      { kind: String(r.kind), primary: r.primary === true },
    ]),
  );
}
