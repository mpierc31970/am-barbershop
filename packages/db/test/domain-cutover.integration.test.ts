// 14-23 (DOM-02, DOM-08, CONT-16; T-14-23-01..04): the domain move state machine, steps 6-10
// (site records -> edge -> HTTPS -> cutover -> search), on the real PocketBase binary over
// the fake DNS world, with an injected clock. A launch move is prepared with the 14-22 steps
// (snapshot .. delegation), then CDS approval runs startCutover.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { robotsFor } from "@cds/core/seo";
import type { DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { startCutover } from "../src/dns/cutover";
import {
  cdsHostProof,
  clearEdgeCache,
  edgeRouterName,
  edgeRoutes,
} from "../src/dns/edge";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeHttpsProber } from "../src/dns/fake/prober";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeSetHttps, fakeWorldPatch } from "../src/dns/fake-world";
import {
  advanceMove,
  getMove,
  openMoveFor,
  retryStep,
  startMove,
  type MoveDeps,
  type MoveView,
} from "../src/dns/moves";
import { readDnsZoneRow } from "../src/dns/snapshot";
import { captureTransport } from "../src/email/transport";
import { __clearOrgLiveCacheForTests } from "../src/org-stage";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
import {
  FAKE_OLD_SITE_IP,
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let n = 0;
let staffUser = "";
const provider = fakeDnsProvider();
const EDGE_IP = "198.18.0.99";
const SERVICE = "https-0-test@docker";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domain-cutover-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  process.env.CDS_EDGE_IPV4 = EDGE_IP;
  resetDnsForTests();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  const password = randomBytes(18).toString("hex");
  staffUser = (
    await pb.collection("users").create({
      email: `staff-${tag()}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await inst?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const tag = () => randomBytes(4).toString("hex");
const MIN = 60_000;

type Site = { org: string; owner: string; ctx: OrgContext; preview: string };

async function site(
  opts: { live?: boolean; ready?: boolean } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  // WR-A03: a launch needs ready_for_review and the owner's submitted review.
  const ready = !opts.live && opts.ready !== false;
  const org = (
    await pb.collection("organizations").create({
      name: `Cutover ${n}`,
      slug: `cutover-${n}-${t}`,
      status: "active",
      ...(opts.live ? { stage: "live" } : {}),
      ...(ready ? { stage: "ready_for_review" } : {}),
    })
  ).id;
  if (ready) {
    await pb.collection("launch_review_marks").create({
      organization: org,
      kind: "submitted",
      page: "",
      at: "2026-10-17 09:00:00.000Z",
    });
  }
  const preview = `cutover-${n}-${t}.sites.localhost`;
  await pb.collection("org_hosts").create({
    hostname: preview,
    organization: org,
    kind: "preview",
    primary: true,
  });
  const password = randomBytes(18).toString("hex");
  const owner = (
    await pb.collection("users").create({
      email: `owner-${t}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: owner, organization: org, role: "owner" });
  return {
    org,
    owner,
    preview,
    ctx: mintOrgContext({
      orgId: org,
      actor: owner,
      role: "owner",
      grants: [],
      ip: "1.1.1.1",
    }),
  };
}

function staff(
  role: "super_admin" | "support_agent" = "super_admin",
): PlatformContext {
  return mintPlatformContext({
    actor: staffUser,
    staffRole: role,
    ip: "2.2.2.2",
  });
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

async function domain(): Promise<string> {
  const d = `cut${++n}-${tag()}.example`;
  await seedFakeDomain(d, "google", {
    oldZone: [...presetRecords(d, "google"), dmarc(d)],
  });
  return d;
}

type Clock = { at: Date; deps: MoveDeps };
function clock(org: string): Clock {
  const c: Clock = {
    at: new Date("2026-10-17T10:00:00.000Z"),
    deps: {
      provider,
      transport: captureTransport(),
      prober: fakeHttpsProber({ expectedProof: (h) => cdsHostProof(h, org) }),
    },
  };
  c.deps.now = () => c.at;
  return c;
}
const later = (c: Clock, ms: number) => {
  c.at = new Date(c.at.getTime() + ms);
};

/** A launch move at `prepared` (14-22 steps 1-5). */
async function preparedLaunch(s: Site, c: Clock, d: string): Promise<MoveView> {
  const v = await startMove(
    s.ctx,
    s.org,
    { domain: d, kind: "launch", by: s.owner },
    c.deps,
  );
  expect(v.currentStep).toBe("nameservers");
  await switchToCds(d);
  later(c, 5 * MIN);
  const p = await advanceMove(v.id, c.deps);
  expect(p.status).toBe("prepared");
  return p;
}

const stepOf = (v: MoveView, key: string) =>
  v.steps.find((s) => s.key === key) as MoveView["steps"][number];

async function hostsOf(org: string) {
  const rows = await pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
  return Object.fromEntries(
    rows.map((r) => [
      r.hostname as string,
      {
        kind: r.kind as string,
        primary: r.primary === true,
        redirectTo: r.redirect_to as string,
        verified: (r.verified_at as string) !== "",
      },
    ]),
  );
}

async function routeRules(): Promise<Record<string, string>> {
  const cfg = await edgeRoutes({ service: SERVICE });
  return Object.fromEntries(
    Object.entries(cfg.http.routers)
      .filter(([name]) => !name.endsWith("-http"))
      .map(([name, r]) => [r.rule, name]),
  );
}

async function auditActions(org: string): Promise<string[]> {
  const rows = await pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "created,id",
  });
  return rows.map((r) => r.action as string);
}

describe("steps 6-8: site records, edge, HTTPS (14-23 Task 1)", () => {
  it("no route before public DNS points at the edge; then hosts are verified and routed", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    await fakeSetHttps(d, true);
    // Public resolvers still see the old website (a cached answer).
    await fakeWorldPatch(d, {
      publicOverrides: [
        { type: "A", name: d, value: FAKE_OLD_SITE_IP, ttl: 300 },
      ],
    });
    // The resolver cache knows the domain as unknown (negative entry).
    expect(await resolveOrganization(d)).toBeNull();

    const v = await startCutover(staff(), s.org, c.deps);
    expect(v.status).toBe("cutover_running");
    expect(stepOf(v, "site_records").status).toBe("done");
    expect(stepOf(v, "edge").status).toBe("waiting");
    expect(stepOf(v, "edge").detail).toBe("waiting_dns:1");

    // Step 6: apex A -> the edge, www -> apex, the old website's A gone; keys are CDS keys.
    const row = await readDnsZoneRow(s.org, d);
    const zone = await provider.listRecords(row!.providerZoneId!);
    const apexA = zone.filter((r) => r.type === "A" && r.name === d);
    expect(apexA.map((r) => [r.value, r.ttl])).toEqual([[EDGE_IP, 300]]);
    const www = zone.filter((r) => r.name === `www.${d}`);
    expect(www.map((r) => [r.type, r.value, r.ttl])).toEqual([
      ["CNAME", d, 300],
    ]);
    expect(zone.some((r) => r.type === "MX")).toBe(true);
    expect(row!.cdsKeys.cds.length).toBeGreaterThanOrEqual(2);

    // Pitfall 4: no org_hosts row, no route, while public DNS is not on the edge.
    const before = await routeRules();
    expect(before[`Host(\`${d}\`)`]).toBeUndefined();
    expect(before[`Host(\`www.${d}\`)`]).toBeUndefined();
    expect(Object.keys(await hostsOf(s.org))).toEqual([s.preview]);

    // Not due yet (backoff 1 min): nothing runs.
    await advanceMove(v.id, c.deps);
    expect(stepOf(await getMove(staff(), v.id), "edge").detail).toBe(
      "waiting_dns:1",
    );
    later(c, MIN);
    const w2 = await advanceMove(v.id, c.deps);
    expect(stepOf(w2, "edge").detail).toBe("waiting_dns:2");
    expect(stepOf(w2, "edge").nextAttemptAt).toBe(
      new Date(c.at.getTime() + 2 * MIN).toISOString(),
    );

    // Public DNS catches up: hosts verified and on the route list, then HTTPS.
    await fakeWorldPatch(d, { publicOverrides: [] });
    later(c, 2 * MIN);
    const after = await advanceMove(v.id, c.deps);
    expect(stepOf(after, "edge").status).toBe("done");
    expect(stepOf(after, "https").status).toBe("done");
    expect(stepOf(after, "https").detail).toMatch(/^prober 200/);
    const rules = await routeRules();
    expect(rules[`Host(\`${d}\`)`]).toBe(edgeRouterName(d));
    expect(rules[`Host(\`www.${d}\`)`]).toBe(edgeRouterName(`www.${d}`));
    expect(after.status).toBe("done");
  });

  it("HTTPS failure: failed after 6 checks, site still on preview; fix + retry bumps the router", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    // HTTPS fails (seeded world: no certificate yet).
    const v = await startCutover(staff(), s.org, c.deps);
    expect(stepOf(v, "edge").status).toBe("done");
    expect(stepOf(v, "https").detail).toBe("waiting_https:1");
    let cur = v;
    for (const wait of [1, 2, 4, 8, 15]) {
      later(c, wait * MIN);
      cur = await advanceMove(v.id, c.deps);
    }
    expect(cur.status).toBe("failed");
    expect(cur.failedStep).toBe("https");
    expect(stepOf(cur, "https").detail).toBe("https_failed:tls_failed");

    // The site stays on its preview address: not live, preview still primary.
    const org = await pb.collection("organizations").getOne(s.org);
    expect(org.stage).not.toBe("live");
    const hosts = await hostsOf(s.org);
    expect(hosts[s.preview]).toMatchObject({ kind: "preview", primary: true });
    expect(hosts[d]).toMatchObject({ kind: "custom", primary: false });
    expect((await routeRules())[`Host(\`${d}\`)`]).toBe(edgeRouterName(d));
    const staffMail = (
      c.deps.transport as ReturnType<typeof captureTransport>
    ).sent.filter((m) => m.type === "staff.domain_alert");
    expect(staffMail.length).toBeGreaterThan(0);

    // Fix the certificate and Retry (support agent): the router name gains -r1.
    await fakeSetHttps(d, true);
    later(c, MIN);
    const r = await retryStep(staff("support_agent"), v.id, c.deps);
    expect(stepOf(r, "https").status).toBe("done");
    expect(r.status).toBe("done");
    const meta = await pb
      .collection("platform_meta")
      .getFirstListItem(pb.filter("key = {:k}", { k: `edge:retry:${d}` }));
    expect(meta.value).toBe("1");
    const rules = await routeRules();
    expect(rules[`Host(\`${d}\`)`]).toBe(edgeRouterName(d, 1));
    expect(rules[`Host(\`${d}\`)`]).toMatch(/-r1$/);
  });

  it("refuses a hostname another org owns (host_taken) and a missing edge IP", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    const other = await site();
    await pb.collection("org_hosts").create({
      hostname: `www.${d}`,
      organization: other.org,
      kind: "custom",
      primary: false,
    });
    const v = await startCutover(staff(), s.org, c.deps);
    expect(v.status).toBe("failed");
    expect(v.failedStep).toBe("edge");
    expect(stepOf(v, "edge").detail).toBe("host_taken");
    expect(Object.keys(await hostsOf(s.org))).toEqual([s.preview]);
    const taken = await hostsOf(other.org);
    expect(taken[`www.${d}`]).toMatchObject({ verified: false });

    // CDS_EDGE_IPV4 unset: step 6 fails before writing anything.
    const s2 = await site();
    const c2 = clock(s2.org);
    const d2 = await domain();
    await preparedLaunch(s2, c2, d2);
    delete process.env.CDS_EDGE_IPV4;
    try {
      const v2 = await startCutover(staff(), s2.org, c2.deps);
      expect(v2.failedStep).toBe("site_records");
      expect(stepOf(v2, "site_records").detail).toBe("edge_ip_unset");
    } finally {
      process.env.CDS_EDGE_IPV4 = EDGE_IP;
    }
  });

  it("gives up after 2 hours when public DNS never points at the edge", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    await fakeWorldPatch(d, {
      publicOverrides: [
        { type: "A", name: d, value: FAKE_OLD_SITE_IP, ttl: 300 },
      ],
    });
    let v = await startCutover(staff(), s.org, c.deps);
    for (const wait of [1, 2, 4, 8, 15, 30, 30, 30]) {
      expect(v.status).toBe("cutover_running");
      later(c, wait * MIN);
      v = await advanceMove(v.id, c.deps);
    }
    expect(v.status).toBe("failed");
    expect(stepOf(v, "edge").detail).toBe("dns_not_pointing");
    expect(Object.keys(await hostsOf(s.org))).toEqual([s.preview]);
  });
});

describe("steps 9-10: cutover, search; startCutover (14-23 Task 2)", () => {
  it("startCutover is refused unless the open move is a prepared launch", async () => {
    if (!inst) return;
    const s = await site();
    await expect(startCutover(staff(), s.org)).rejects.toThrow(
      "Domain not prepared: no domain is connected yet.",
    );
    const c = clock(s.org);
    const d = await domain();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    await expect(startCutover(staff(), s.org, c.deps)).rejects.toThrow(
      "Domain not prepared: step 4 (nameservers) is waiting on the owner.",
    );
    // Support agents cannot take a site live.
    await expect(
      startCutover(staff("support_agent"), s.org, c.deps),
    ).rejects.toMatchObject({ name: "Forbidden" });
    expect((await getMove(staff(), v.id)).status).toBe("waiting_owner");
  });

  it("WR-A03: startCutover refuses a site not at ready_for_review or without a submitted review", async () => {
    if (!inst) return;
    // Pre-review stage: refused even with a prepared launch move.
    const s = await site({ ready: false });
    await pb
      .collection("organizations")
      .update(s.org, { stage: "being_built" });
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    await expect(startCutover(staff(), s.org, c.deps)).rejects.toThrow(
      "The site isn't ready for review yet.",
    );
    // ready_for_review but the owner has not sent Ready to launch.
    await pb
      .collection("organizations")
      .update(s.org, { stage: "ready_for_review" });
    await expect(startCutover(staff(), s.org, c.deps)).rejects.toThrow(
      "The owner hasn't sent Ready to launch yet.",
    );
    const open = await getMove(
      staff(),
      (await openMoveFor(staff(), s.org))!.id,
    );
    expect(open.status).toBe("prepared");
    expect((await pb.collection("organizations").getOne(s.org)).stage).toBe(
      "ready_for_review",
    );
  });

  it("launch: custom apex primary, www redirect, preview kept, live, search told", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    await preparedLaunch(s, c, d);
    await fakeSetHttps(d, true);
    // Warm both caches with the pre-launch answers.
    expect((await resolveOrganization(s.preview))?.primaryHost).toBe(s.preview);
    expect(await resolveOrganization(d)).toBeNull();

    const v = await startCutover(staff(), s.org, c.deps);
    expect(v.status).toBe("done");
    expect(v.steps.slice(5).map((x) => x.status)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
    expect(stepOf(v, "search").detail).toBe("IndexNow logged · sitemap logged");

    const org = await pb.collection("organizations").getOne(s.org);
    expect(org.stage).toBe("live");
    expect(org.launched_at).not.toBe("");
    const hosts = await hostsOf(s.org);
    expect(hosts[d]).toEqual({
      kind: "custom",
      primary: true,
      redirectTo: "",
      verified: true,
    });
    expect(hosts[`www.${d}`]).toEqual({
      kind: "redirect",
      primary: false,
      redirectTo: d,
      verified: true,
    });
    expect(hosts[s.preview]).toMatchObject({ kind: "preview", primary: false });

    // The caches were forgotten: the custom host resolves at once, indexable.
    const resolved = await resolveOrganization(d);
    expect(resolved?.hostKind).toBe("custom");
    expect(resolved?.live).toBe(true);
    expect(robotsFor({ hostKind: resolved!.hostKind }).index).toBe(true);
    expect((await resolveOrganization(s.preview))?.primaryHost).toBe(d);
    const wwwResolved = await resolveOrganization(`www.${d}`);
    expect(wwwResolved?.hostKind).toBe("redirect");
    expect(wwwResolved?.redirectTo).toBe(d);

    // Search: recorded for the new host (the stand-ins answer "logged").
    const idx = await pb
      .collection("org_indexing")
      .getFirstListItem(pb.filter("org_id = {:o}", { o: s.org }));
    expect(idx.last_ping_result).toBe("logged");
    expect(idx.last_submit_result).toBe("logged");

    const actions = await auditActions(s.org);
    expect(actions).toEqual(
      expect.arrayContaining([
        "domain.cutover_started",
        "domain.cutover",
        "org.stage_changed",
      ]),
    );
    expect(actions.indexOf("domain.cutover")).toBeLessThan(
      actions.indexOf("org.stage_changed"),
    );
    const bell = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && type = 'site.stage'", {
        org: s.org,
      }),
    });
    expect(bell.length).toBe(1);
    // Finished: nothing runs again.
    await advanceMove(v.id, { ...c.deps, force: true });
    expect(await auditActions(s.org)).toHaveLength(actions.length);
  });

  it("www chosen as main address: www custom primary, apex redirects to it (P14-P16)", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock(s.org);
    const d = await domain();
    const p = await preparedLaunch(s, c, d);
    await pb.collection("domain_moves").update(p.id, { primary_choice: "www" });
    await fakeSetHttps(d, true);
    const v = await startCutover(staff(), s.org, c.deps);
    expect(v.status).toBe("done");
    const hosts = await hostsOf(s.org);
    expect(hosts[`www.${d}`]).toMatchObject({ kind: "custom", primary: true });
    expect(hosts[d]).toMatchObject({
      kind: "redirect",
      redirectTo: `www.${d}`,
    });
  });

  it("move: the old custom host redirects to the new one; the site stays live", async () => {
    if (!inst) return;
    const s = await site({ live: true });
    const old = `old-${tag()}.example`;
    await pb
      .collection("org_hosts")
      .getFirstListItem(pb.filter("hostname = {:h}", { h: s.preview }))
      .then((r) => pb.collection("org_hosts").update(r.id, { primary: false }));
    await pb.collection("org_hosts").create({
      hostname: old,
      organization: s.org,
      kind: "custom",
      primary: true,
      verified_at: "2026-09-01 00:00:00.000Z",
    });
    __clearOrgLiveCacheForTests();
    clearResolverCache();
    clearEdgeCache();
    const c = clock(s.org);
    const d = await domain();
    await fakeSetHttps(d, true);
    const v = await startMove(
      staff(),
      s.org,
      { domain: d, kind: "move", by: staffUser },
      c.deps,
    );
    expect(v.fromHost).toBe(old);
    await switchToCds(d);
    later(c, 5 * MIN);
    const done = await advanceMove(v.id, c.deps);
    expect(done.status).toBe("done");
    expect(done.prepared).toBe(false);

    const hosts = await hostsOf(s.org);
    expect(hosts[old]).toEqual({
      kind: "redirect",
      primary: false,
      redirectTo: d,
      verified: true,
    });
    expect(hosts[d]).toMatchObject({ kind: "custom", primary: true });
    expect(hosts[s.preview]).toMatchObject({ kind: "preview", primary: false });
    expect((await resolveOrganization(old))?.redirectTo).toBe(d);
    const actions = await auditActions(s.org);
    expect(actions).toContain("domain.cutover");
    expect(actions).not.toContain("org.stage_changed");
    const idx = await pb
      .collection("org_indexing")
      .getFirstListItem(pb.filter("org_id = {:o}", { o: s.org }));
    expect(idx.last_ping_result).toBe("logged");
    expect(idx.last_submit_result).toBe("logged");
  });
});
