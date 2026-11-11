// 14-48 (ROADMAP P14 exit; DOM-02, DOM-05, DOM-08, LIFE-01; D58, D282; T-14-48-01/02): the phase
// exit proof, on the real PocketBase binary over the fake DNS world, SES, edge and prober, with
// one fixed clock advanced explicitly. A new org signs up (preview host at signup), connects
// riverabakery.example (Google Workspace mail), passes the gate, the owner switches nameservers,
// domains:run prepares the move, the owner's launch review is submitted, CDS approves
// (startCutover) and domains:run takes the site live on its custom domain. Then the same org
// offboards: every other step is refused until the zone is handed back; the reverse gate passes
// at the destination, domains:run deletes the CDS zone, the other steps run, and at notice end
// the org closes. At four points (E0 before, E1 after the switch, E2 after cutover, E3 after
// the handback) every email record read through the public resolvers is identical, compared as
// recordKey sets (never string dumps).
import "@cds/addon-registry/server";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyRecord, recordKey, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { loggingPinger } from "../src/content/scan-standin";
import { loggingSubmitter } from "../src/content/sitemap-submit";
import { startCutover } from "../src/dns/cutover";
import { cdsHostProof, clearEdgeCache, edgeRoutes } from "../src/dns/edge";
import { getDnsResolver, resetDnsForTests } from "../src/dns/factory";
import { fakeHttpsProber } from "../src/dns/fake/prober";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import {
  fakeSetHttps,
  fakeSetSesStatus,
  fakeWorldPatch,
} from "../src/dns/fake-world";
import { getMove, type MoveDeps, type MoveView } from "../src/dns/moves";
import { ownerConnectDomain } from "../src/dns/owner";
import { PUBLIC_RESOLVERS } from "../src/dns/ports";
import { readDnsZoneRow } from "../src/dns/snapshot";
import { captureTransport, sendEmail } from "../src/email";
import { resetSendingDomainsForTests } from "../src/email/sending-domains/factory";
import { runDomainsJob, type DomainsJobOptions } from "../src/jobs/domains";
import {
  markKeyFacts,
  markPage,
  markPhoneCheck,
} from "../src/launch-review/marks";
import {
  recordTestFormSubmission,
  reviewContextForToken,
} from "../src/launch-review/marks";
import {
  launchReviewView,
  reviewPages,
  submitLaunchReview,
} from "../src/launch-review/review";
import { signReviewToken } from "../src/dns/preview-links";
import { handbackView } from "../src/offboarding/handback";
import {
  chooseHandbackDestination,
  confirmHandbackSwitched,
} from "../src/offboarding/handback";
import {
  requestOffboardingCode,
  startOffboarding,
} from "../src/offboarding/offboardings";
import {
  completeOffboardingStep,
  requestOffboardingDownload,
} from "../src/offboarding/steps";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
import { createBillingSpy } from "./fake-billing-spy";
import {
  FAKE_OTHER_NAMESERVERS,
  presetRecords,
  seedFakeDomain,
  switchToCds,
  switchToOther,
} from "./helpers/fake-dns-world";
import {
  bootSeededPb,
  otpCodeFor,
  seedQuote,
  staffContext,
  submitWithCode,
  type SeededPb,
} from "./seeded";

const DOMAIN = "riverabakery.example";
const EDGE_IP = "198.18.0.99";
const SERVICE = "https-0-exit@docker";
const MIN = 60_000;
const DAY = 86_400_000;

let booted: SeededPb | null = null;
let pb: PocketBase;
let staff: PlatformContext;
let storageDir = "";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
  CDS_SENDING_DOMAINS: process.env.CDS_SENDING_DOMAINS,
  CDS_SEARCH_PINGER: process.env.CDS_SEARCH_PINGER,
  CDS_SITEMAP_SUBMITTER: process.env.CDS_SITEMAP_SUBMITTER,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-p14-exit-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  process.env.CDS_EDGE_IPV4 = EDGE_IP;
  delete process.env.CDS_SENDING_DOMAINS;
  delete process.env.CDS_SEARCH_PINGER;
  delete process.env.CDS_SITEMAP_SUBMITTER;
  resetDnsForTests();
  resetSendingDomainsForTests();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  staff = await staffContext(
    booted.inst,
    `exit-super-${randomBytes(3).toString("hex")}@cds.test`,
    "super_admin",
  );
}, 120_000);

afterAll(async () => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetSendingDomainsForTests();
  await booted?.inst.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const dmarc: DnsRecord = {
  type: "TXT",
  name: `_dmarc.${DOMAIN}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
};
/** The old host's zone: the old site plus Google Workspace mail and an existing DMARC. */
const OLD_ZONE: DnsRecord[] = [...presetRecords(DOMAIN, "google"), dmarc];

/** The record slots that carry email (MX, SPF + verification TXT, DKIM, DMARC). */
const EMAIL_SLOTS = [
  ...new Map(
    OLD_ZONE.filter((r) => classifyRecord(r, DOMAIN) === "email").map((r) => [
      `${r.type} ${r.name}`,
      { type: r.type, name: r.name },
    ]),
  ).values(),
];

/**
 * Every email record as the world sees it: each email slot asked of both public resolvers
 * (they must agree), email-class answers only, as a sorted recordKey list. No CDS keys are
 * passed to the classifier, so a CDS record landing on an email slot shows up as a difference.
 */
async function publicEmailKeys(): Promise<string[]> {
  const resolver = getDnsResolver();
  const per: string[][] = [];
  for (const server of PUBLIC_RESOLVERS) {
    const keys: string[] = [];
    for (const slot of EMAIL_SLOTS) {
      const a = await resolver.resolve(slot.name, slot.type, {
        servers: [server],
      });
      for (const r of a.records) {
        if (classifyRecord(r, DOMAIN) === "email") keys.push(recordKey(r));
      }
    }
    per.push([...new Set(keys)].sort());
  }
  expect(per[1], "the public resolvers disagree").toEqual(per[0]);
  return per[0]!;
}

/** Which record types differ between two key sets (no values printed). */
function differ(step: string, got: string[], want: string[]): string {
  const g = new Set(got);
  const w = new Set(want);
  const types = [
    ...[...w].filter((k) => !g.has(k)),
    ...[...g].filter((k) => !w.has(k)),
  ].map((k) => k.split("\u0000")[0]);
  return `${step}: email records differ (types: ${[...new Set(types)].join(", ") || "none"})`;
}

async function hostsOf(org: string) {
  const rows = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return Object.fromEntries(
    rows.map((r) => [
      String(r.hostname),
      {
        kind: String(r.kind),
        primary: r.primary === true,
        redirectTo: String(r.redirect_to ?? ""),
      },
    ]),
  );
}

async function routedHosts(): Promise<string[]> {
  clearEdgeCache();
  const cfg = await edgeRoutes({ service: SERVICE });
  return Object.entries(cfg.http.routers)
    .filter(([name]) => !name.endsWith("-http"))
    .map(([, r]) => /Host\(`([^`]+)`\)/.exec(r.rule)?.[1] ?? "");
}

const stepOf = (v: MoveView, key: string) =>
  v.steps.find((s) => s.key === key) as MoveView["steps"][number];

describe("P14 exit: a custom domain end to end, then offboarding with the zone handed back", () => {
  // 01:00 UTC: the daily health step stays off for the whole story (P14-P18).
  let at = new Date("2026-10-20T01:00:00.000Z");
  const later = (ms: number) => {
    at = new Date(at.getTime() + ms);
  };
  const mail = captureTransport();
  const provider = fakeDnsProvider();
  let org = "";
  let ownerId = "";
  let ownerEmail = "";
  let owner: OrgContext;
  let preview = "";
  let moveId = "";
  let E0: string[] = [];
  const moveDeps: MoveDeps = {
    provider,
    transport: mail,
    now: () => at,
    prober: fakeHttpsProber({ expectedProof: (h) => cdsHostProof(h, org) }),
  };
  const billing = createBillingSpy();
  const deps = (): DomainsJobOptions["deps"] => ({
    moves: moveDeps,
    sending: { provider },
    handbacks: { provider, transport: mail },
    offboarding: { billing, transport: mail, provider, moveDeps },
    health: { provider },
  });
  const job = async () => {
    const r = await runDomainsJob({ now: at, deps: deps() });
    expect(r.busy).toBe(false);
    expect(r.failedSteps).toEqual([]);
    return r;
  };

  it("(1) signup gives the new org its preview host, which resolves at once", async (t) => {
    if (!booted) return t.skip();
    const q = await seedQuote();
    ownerEmail = `rivera-${randomBytes(3).toString("hex")}@cds.test`;
    const out = await submitWithCode(booted.inst, {
      quoteToken: q.token,
      businessName: "Rivera Bakery",
      description: "Fresh bread and pastries every morning.",
      email: ownerEmail,
    });
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    org = out.orgId;
    const row = await pb.collection("organizations").getOne(org);
    preview = `${String(row.slug)}.sites.localhost`;
    expect(await hostsOf(org)).toEqual({
      [preview]: { kind: "preview", primary: true, redirectTo: "" },
    });
    clearResolverCache();
    const resolved = await resolveOrganization(preview);
    expect(resolved?.orgId).toBe(org);
    expect(resolved?.hostKind).toBe("preview");
    ownerId = String(
      (
        await pb
          .collection("memberships")
          .getFirstListItem(
            pb.filter("organization = {:o} && role = 'owner'", { o: org }),
          )
      ).user,
    );
    owner = mintOrgContext({
      orgId: org,
      actor: ownerId,
      role: "owner",
      grants: [],
      ip: "203.0.113.20",
    });
  });

  it("(2) the owner connects riverabakery.example (Google mail): gate passes, no custom host row", async (t) => {
    if (!booted || !org) return t.skip();
    await seedFakeDomain(DOMAIN, "google", { oldZone: OLD_ZONE }, at);
    // E0: what the world sees before CDS touches anything.
    E0 = await publicEmailKeys();
    expect(E0).toHaveLength(4); // MX, SPF, DKIM, DMARC
    expect(E0).toEqual(
      OLD_ZONE.filter((r) => classifyRecord(r, DOMAIN) === "email")
        .map(recordKey)
        .sort(),
    );

    const view = await ownerConnectDomain(owner, DOMAIN, moveDeps);
    expect(view.domain).toBe(DOMAIN);
    const zone = await readDnsZoneRow(org, DOMAIN);
    expect(zone).not.toBeNull();
    const moves = await pb.collection("domain_moves").getFullList({
      filter: pb.filter("org_id = {:o}", { o: org }),
    });
    expect(moves).toHaveLength(1);
    moveId = moves[0]!.id;
    const m = await getMove(staff, moveId);
    expect(m.status).toBe("waiting_owner");
    expect(m.currentStep).toBe("nameservers");
    expect(stepOf(m, "snapshot").status).toBe("done");
    expect(stepOf(m, "gate").status).toBe("done");
    // P14-P4: no custom row before delegation is verified; not routed.
    expect(Object.keys(await hostsOf(org))).toEqual([preview]);
    expect(await routedHosts()).not.toContain(DOMAIN);
    // Nothing changed for the world yet.
    expect(await publicEmailKeys()).toEqual(E0);
  });

  it("(3) the owner switches nameservers; domains:run prepares the move; every email record identical after the switch", async (t) => {
    if (!booted || !moveId) return t.skip();
    await switchToCds(DOMAIN);
    later(6 * MIN);
    const r = await job();
    expect(r.movesAdvanced).toBeGreaterThanOrEqual(1);
    const m = await getMove(staff, moveId);
    expect(m.status).toBe("prepared");
    expect(stepOf(m, "delegation").status).toBe("done");
    expect((await readDnsZoneRow(org, DOMAIN))?.status).toBe("active");

    // E1: the CDS zone now answers publicly.
    const E1 = await publicEmailKeys();
    expect(E1, differ("after the switch", E1, E0)).toEqual(E0);
    // Still no custom row and no route until cutover.
    expect(Object.keys(await hostsOf(org))).toEqual([preview]);
    expect(await routedHosts()).not.toContain(DOMAIN);
  });

  it("(4) the owner's launch review: pages, key facts, phone check, a test form message, submitted", async (t) => {
    if (!booted || !moveId) return t.skip();
    // CDS built the site: a published Home page and a contact form, stage ready_for_review.
    await pb.collection("pages").create({
      organization: org,
      slug: "home",
      title: "Home",
      status: "published",
      kind: "builder",
      published_at: "2026-10-19 10:00:00.000Z",
    });
    await pb
      .collection("forms")
      .create({ organization: org, name: "Contact", template: "contact" });
    await pb
      .collection("organizations")
      .update(org, { stage: "ready_for_review" });

    // Review mode on the preview host runs as the owner through the review token.
    const token = signReviewToken(org, ownerId, "review");
    const rctx = await reviewContextForToken(token, { ip: "203.0.113.21" });
    expect(rctx?.orgId).toBe(org);
    for (const page of await reviewPages(rctx!)) {
      await markPage(rctx!, page.id, "looks_good");
    }
    await markKeyFacts(rctx!);
    await markPhoneCheck(rctx!);
    // The form route stores a review-cookie submission as a test (P14-P26) and ticks item 5.
    const sub = await pb.collection("form_submissions").create({
      organization: org,
      form_name: "Contact",
      data: {},
      is_test: true,
    });
    expect(await recordTestFormSubmission(org, sub.id)).toBe(true);

    await submitLaunchReview(owner, { transport: mail, now: at });
    const v = await launchReviewView(owner);
    expect(v.submittedAt).not.toBeNull();
  });

  it("(5) CDS approves: domains:run takes the site live; email intact; search names only the custom host; own-domain sending", async (t) => {
    if (!booted || !moveId) return t.skip();
    const ping = vi.spyOn(loggingPinger, "ping");
    const submit = vi.spyOn(loggingSubmitter, "submit");
    await fakeSetHttps(DOMAIN, true);
    // Public resolvers still hold the old website (a cached answer): the edge must wait.
    await fakeWorldPatch(DOMAIN, {
      publicOverrides: [
        { type: "A", name: DOMAIN, value: "198.18.0.10", ttl: 300 },
      ],
    });

    // What the approve action runs after its checks (14-36).
    const v = await startCutover(staff, org, moveDeps);
    expect(v.status).toBe("cutover_running");
    expect(stepOf(v, "site_records").status).toBe("done");
    expect(stepOf(v, "edge").status).toBe("waiting");
    expect(Object.keys(await hostsOf(org))).toEqual([preview]);
    expect(await routedHosts()).not.toContain(DOMAIN);

    // Public DNS catches up; the job drives the waiting steps to the end.
    await fakeWorldPatch(DOMAIN, { publicOverrides: [] });
    later(MIN);
    await job();
    const done = await getMove(staff, moveId);
    expect(done.status).toBe("done");
    expect(stepOf(done, "https").detail).toMatch(/^prober 200/);

    const row = await pb.collection("organizations").getOne(org);
    expect(row.stage).toBe("live");
    const hosts = await hostsOf(org);
    expect(hosts[DOMAIN]).toEqual({
      kind: "custom",
      primary: true,
      redirectTo: "",
    });
    expect(hosts[`www.${DOMAIN}`]).toEqual({
      kind: "redirect",
      primary: false,
      redirectTo: DOMAIN,
    });
    expect(hosts[preview]).toMatchObject({ kind: "preview", primary: false });
    const routed = await routedHosts();
    expect(routed).toContain(DOMAIN);
    expect(routed).toContain(`www.${DOMAIN}`);
    clearResolverCache();
    expect((await resolveOrganization(DOMAIN))?.hostKind).toBe("custom");

    // E2: after cutover (site records, CAA, SES records all written by now).
    const E2 = await publicEmailKeys();
    expect(E2, differ("after cutover", E2, E0)).toEqual(E0);

    // IndexNow and sitemap submission named only the custom host.
    expect(ping).toHaveBeenCalled();
    const urls = ping.mock.calls.flatMap((c) => c[0]);
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u.startsWith(`https://${DOMAIN}/`)).toBe(true);
    expect(submit).toHaveBeenCalled();
    for (const c of submit.mock.calls) {
      // The two URLs (the third argument is the Search Console property, WR-A12).
      for (const u of (c as unknown[]).slice(0, 2)) {
        expect(String(u).startsWith(`https://${DOMAIN}`)).toBe(true);
      }
    }
    ping.mockRestore();
    submit.mockRestore();

    // Own-domain sending: SES verifies, the next job run records it, mail goes From hello@.
    await fakeSetSesStatus(DOMAIN, "verified");
    later(5 * MIN);
    await job();
    const profile = await pb
      .collection("business_profile")
      .getFirstListItem(pb.filter("organization = {:o}", { o: org }));
    expect(profile.sending_status).toBe("verified");
    const t2 = captureTransport();
    await sendEmail(
      { kind: "org", ctx: owner, orgId: org },
      "email.confirm",
      "orders@customer.example",
      {
        orgName: "Rivera Bakery",
        purposeLabel: "website inquiries",
        link: "http://localhost:3000/start/confirm-email?t=x",
      },
      { transport: t2 },
    );
    expect(t2.sent[0]!.fromAddress).toBe(`hello@${DOMAIN}`);
    expect(await publicEmailKeys()).toEqual(E0);
  });

  it("(6) offboarding: nothing runs until the zone is handed back; then the steps run and the org closes", async (t) => {
    if (!booted || !moveId) return t.skip();
    const { otpId } = await requestOffboardingCode(owner);
    const code = await otpCodeFor(booted.inst, otpId);
    const started = await startOffboarding(
      owner,
      undefined,
      { reasonCategory: "other", code: { otpId, code } },
      { now: at, transport: mail },
    );
    expect(started.status).toBe("notice");

    // T-14-48-02: every other step is refused until the DNS is handed back.
    for (const step of ["download", "addons", "services", "billing"] as const) {
      await expect(
        completeOffboardingStep(owner, undefined, step, { now: at }),
      ).rejects.toThrow("Move your DNS first.");
    }
    await expect(
      requestOffboardingDownload(owner, undefined, { now: at, run: false }),
    ).rejects.toThrow("Move your DNS first.");

    // The new host gets the copy-exactly records from the handback view (plus its SOA).
    const z = (await handbackView(owner)).zones[0]!;
    expect(z.domain).toBe(DOMAIN);
    const copied = z.groups.copy_exactly;
    for (const k of E0) expect(copied.map(recordKey)).toContain(k);
    await fakeWorldPatch(DOMAIN, {
      otherZone: [
        ...presetRecords(DOMAIN, "none"),
        ...copied,
        {
          type: "SOA",
          name: DOMAIN,
          value: `ns1.otherhost.test. hostmaster.${DOMAIN}. 1 7200 3600 1209600 300`,
        },
      ],
    });
    const ready = await chooseHandbackDestination(owner, undefined, DOMAIN, {
      kind: "other",
      nameservers: [FAKE_OTHER_NAMESERVERS[0]!, FAKE_OTHER_NAMESERVERS[1]!],
    });
    expect(ready.status).toBe("ready_to_switch");
    expect(ready.checkPassed).toBe(true);
    await confirmHandbackSwitched(owner, undefined, DOMAIN);
    // Still refused while the delegation has not moved.
    await expect(
      completeOffboardingStep(owner, undefined, "addons", { now: at }),
    ).rejects.toThrow("Move your DNS first.");

    await switchToOther(DOMAIN);
    later(5 * MIN);
    const r = await job();
    expect(r.handbacksChecked).toBeGreaterThanOrEqual(1);
    const zoneRow = await readDnsZoneRow(org, DOMAIN);
    expect(zoneRow?.status).toBe("deleted");
    // E3: public DNS now answers from the new host: every email record identical.
    const E3 = await publicEmailKeys();
    expect(E3, differ("after the handback", E3, E0)).toEqual(E0);

    // Handed back: the other steps run.
    await requestOffboardingDownload(owner, undefined, { now: at, run: false });
    for (const step of ["addons", "services", "billing"] as const) {
      expect(
        await completeOffboardingStep(owner, undefined, step, { now: at }),
      ).toEqual({ step, status: "done" });
    }
    expect(
      (await pb.collection("organizations").getOne(org)).closed_reason,
    ).toBe("");

    // Notice end: the job closes the org, custom hosts go, the zone stays deleted.
    later(31 * DAY);
    const end = await job();
    expect(end.offboardingsClosed).toBeGreaterThanOrEqual(1);
    const closed = await pb.collection("organizations").getOne(org);
    expect(closed.closed_reason).toBe("cancelled");
    const off = await pb
      .collection("offboardings")
      .getFirstListItem(pb.filter("org_id = {:o}", { o: org }));
    expect(off.status).toBe("closed");
    const kinds = Object.values(await hostsOf(org)).map((h) => h.kind);
    expect(kinds).not.toContain("custom");
    expect(kinds).not.toContain("redirect");
    expect((await readDnsZoneRow(org, DOMAIN))?.status).toBe("deleted");
    expect(await routedHosts()).not.toContain(DOMAIN);
  });
});
