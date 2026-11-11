// 14-27 (DOM-06, DOM-08; T-14-27-01..03): daily domain health on the real PocketBase binary
// over the fake DNS world. Each case launches its own site through the 14-22/14-23 move
// steps, checks it, then retires its zone so later runs see only the next site.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { cdsHostProof } from "../src/dns/edge";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeHttpsProber } from "../src/dns/fake/prober";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import {
  fakeBreakEmailRecord,
  fakeExpireIn,
  fakeSetHttps,
} from "../src/dns/fake-world";
import {
  domainHealthSummary,
  domainIncidentKey,
  runDomainHealth,
  type DomainHealthDeps,
} from "../src/dns/health";
import { advanceMove, startMove, type MoveDeps } from "../src/dns/moves";
import { captureTransport } from "../src/email/transport";
import {
  presetRecords,
  seedFakeDomain,
  switchBack,
  switchToCds,
  switchToOther,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let n = 0;
let staffUser = "";
const provider = fakeDnsProvider();
const EDGE_IP = "198.18.0.99";
const STAFF = "staff-alerts@cds.test";
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_EDGE_IPV4: process.env.CDS_EDGE_IPV4,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domain-health-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF;
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
const DAY = 86_400_000;

type Site = {
  org: string;
  owner: string;
  admin: string;
  ctx: OrgContext;
  domain: string;
  deps: MoveDeps;
  at: Date;
};

function staff(): PlatformContext {
  return mintPlatformContext({
    actor: staffUser,
    staffRole: "super_admin",
    ip: "2.2.2.2",
  });
}

async function user(role: "owner" | "admin", org: string): Promise<string> {
  const password = randomBytes(18).toString("hex");
  const id = (
    await pb.collection("users").create({
      email: `${role}-${tag()}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: id, organization: org, role });
  return id;
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

async function seedDomain(): Promise<string> {
  const d = `health${++n}-${tag()}.example`;
  await seedFakeDomain(d, "google", {
    oldZone: [...presetRecords(d, "google"), dmarc(d)],
  });
  await fakeSetHttps(d, true);
  return d;
}

/** A live site on its own custom domain (launch move: steps 1-5, then cutover 6-10). */
async function launched(): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Health ${n}`,
      slug: `health-${n}-${t}`,
      status: "active",
      stage: "ready_for_review",
    })
  ).id;
  // WR-A03: the launch gate needs the owner's submitted review.
  await pb.collection("launch_review_marks").create({
    organization: org,
    kind: "submitted",
    page: "",
    at: "2026-10-17 09:00:00.000Z",
  });
  await pb.collection("org_hosts").create({
    hostname: `health-${n}-${t}.sites.localhost`,
    organization: org,
    kind: "preview",
    primary: true,
  });
  const owner = await user("owner", org);
  const admin = await user("admin", org);
  const ctx = mintOrgContext({
    orgId: org,
    actor: owner,
    role: "owner",
    grants: [],
    ip: "1.1.1.1",
  });
  const s: Site = {
    org,
    owner,
    admin,
    ctx,
    domain: "",
    at: new Date("2026-10-17T10:00:00.000Z"),
    deps: {
      provider,
      transport: captureTransport(),
      prober: fakeHttpsProber({ expectedProof: (h) => cdsHostProof(h, org) }),
    },
  };
  s.deps.now = () => s.at;
  s.domain = await seedDomain();
  const v = await startMove(
    ctx,
    org,
    { domain: s.domain, kind: "launch", by: owner },
    s.deps,
  );
  expect(v.currentStep).toBe("nameservers");
  await switchToCds(s.domain);
  s.at = new Date(s.at.getTime() + 5 * MIN);
  expect((await advanceMove(v.id, s.deps)).status).toBe("prepared");
  const done = await startCutover(staff(), org, s.deps);
  expect(done.status).toBe("done");
  expect((await pb.collection("organizations").getOne(org)).stage).toBe("live");
  return s;
}

/** Take the site's zones out of later runs. */
async function retire(s: Site): Promise<void> {
  const rows = await pb.collection("dns_zones").getFullList({
    filter: pb.filter("org_id = {:org}", { org: s.org }),
  });
  for (const r of rows) {
    await pb.collection("dns_zones").update(r.id, { status: "deleted" });
  }
}

type Run = Awaited<ReturnType<typeof runDomainHealth>> & {
  mail: ReturnType<typeof captureTransport>["sent"];
};

async function run(
  s: Site,
  opts: { dryRun?: boolean; at?: Date } = {},
): Promise<Run> {
  const transport = captureTransport();
  const deps: DomainHealthDeps = {
    provider,
    transport,
    prober: s.deps.prober,
  };
  const r = await runDomainHealth({
    now: opts.at ?? new Date(s.at.getTime() + DAY),
    ...(opts.dryRun ? { dryRun: true } : {}),
    deps,
  });
  return { ...r, mail: transport.sent };
}

async function alertsOf(org: string, type: string) {
  return pb.collection("alerts").getFullList({
    filter: pb.filter("organization = {:org} && type = {:type}", {
      org,
      type,
    }),
  });
}

async function meta(key: string): Promise<string | null> {
  const rows = await pb.collection("platform_meta").getFullList({
    filter: pb.filter("key = {:key}", { key }),
  });
  return rows[0] ? String(rows[0].value) : null;
}

describe("daily domain health (14-27)", () => {
  it("healthy: zero counts, no mail; the summary is stored; a dry run writes nothing", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      const dry = await run(s, { dryRun: true });
      expect(dry.dryRun).toBe(true);
      expect(dry.summary.checked).toBe(1);
      expect(await meta("domains:health:summary")).toBeNull();

      const r = await run(s);
      expect(r.errors).toBe(0);
      expect(r.summary).toMatchObject({
        https_failing: 0,
        delegation_lost: 0,
        email_drift: 0,
        expiring_30d: 0,
        expiring_7d: 0,
        checked: 1,
        cert_min_days: 89,
      });
      expect(r.mail).toEqual([]);
      expect(r.opened).toBe(0);
      const stored = await domainHealthSummary();
      expect(stored).toEqual(r.summary);
      // Expiry read from the registry is kept on the zone row (owner view reads it).
      const zone = await pb.collection("dns_zones").getFirstListItem(
        pb.filter("org_id = {:org} && domain = {:d}", {
          org: s.org,
          d: s.domain,
        }),
      );
      expect(zone.expires_at).not.toBe("");
    } finally {
      await retire(s);
    }
  });

  it("HTTPS failing: one staff mail, a second run sends none; fixed closes it", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      await fakeSetHttps(s.domain, false);
      const r = await run(s);
      expect(r.summary.https_failing).toBe(1);
      expect(r.mail.map((m) => [m.type, m.to])).toEqual([
        ["staff.health_alert", STAFF],
      ]);
      expect(r.mail[0]?.text).not.toContain(s.domain);
      expect(await meta(domainIncidentKey(s.org, "https_failing"))).not.toBe(
        null,
      );

      const again = await run(s);
      expect(again.summary.https_failing).toBe(1);
      expect(again.mail).toEqual([]);
      expect(again.opened).toBe(0);

      await fakeSetHttps(s.domain, true);
      const fixed = await run(s);
      expect(fixed.summary.https_failing).toBe(0);
      expect(fixed.closed).toBe(1);
      expect(fixed.mail.map((m) => m.type)).toEqual(["staff.health_alert"]);
      expect(await meta(domainIncidentKey(s.org, "https_failing"))).toBeNull();
      // Nothing ever reached the owner for HTTPS.
      expect(await alertsOf(s.org, "domain.lost_delegation")).toEqual([]);
    } finally {
      await retire(s);
    }
  });

  it("delegation lost: owner urgent alert + email (Owners and Admins) and staff, once", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      await switchBack(s.domain);
      const r = await run(s);
      expect(r.summary.delegation_lost).toBe(1);
      // Email drift is not reported on top of a lost delegation.
      expect(r.summary.email_drift).toBe(0);
      const owners = r.mail.filter((m) => m.type === "domain.lost_delegation");
      expect(owners).toHaveLength(2);
      expect(owners[0]?.subject).toContain(
        `${s.domain} no longer points to CDS`,
      );
      expect(
        r.mail.filter((m) => m.type === "staff.domain_alert").map((m) => m.to),
      ).toEqual([STAFF]);
      const bell = await alertsOf(s.org, "domain.lost_delegation");
      expect(bell.length).toBe(2);
      expect(bell.every((a) => a.level === "urgent")).toBe(true);
      // owner.ts reads this key for the "lost" state.
      expect(
        await meta(`domains:incident:${s.org}:delegation_lost`),
      ).not.toBeNull();

      const again = await run(s);
      expect(again.mail).toEqual([]);
      expect((await alertsOf(s.org, "domain.lost_delegation")).length).toBe(2);

      // Switched back to CDS: closed, nothing to the owner.
      await switchToCds(s.domain);
      const back = await run(s);
      expect(back.summary.delegation_lost).toBe(0);
      expect(back.closed).toBe(1);
      expect(back.mail).toEqual([]);
      expect(
        await meta(`domains:incident:${s.org}:delegation_lost`),
      ).toBeNull();
    } finally {
      await retire(s);
    }
  });

  it("an email record changed outside CDS: email_drift, staff mail once", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      await fakeBreakEmailRecord(s.domain);
      const r = await run(s);
      expect(r.summary.email_drift).toBe(1);
      expect(r.summary.delegation_lost).toBe(0);
      expect(r.mail.map((m) => [m.type, m.to])).toEqual([
        ["staff.health_alert", STAFF],
      ]);
      expect((await run(s)).mail).toEqual([]);
    } finally {
      await retire(s);
    }
  });

  it("expiry: 25 days -> owner 30-day alert once; 5 days -> urgent + email + staff", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      const at = new Date(s.at.getTime() + DAY);
      await fakeExpireIn(s.domain, 25, at);
      const r = await run(s, { at });
      expect(r.summary.expiring_30d).toBe(1);
      expect(r.summary.expiring_7d).toBe(0);
      expect(r.mail.map((m) => [m.type, m.to])).toEqual([
        ["domain.expiry", expect.stringMatching(/^owner-/)],
      ]);
      expect(r.mail[0]?.text).toContain("GoDaddy");
      const first = await alertsOf(s.org, "domain.expiry");
      // One bell each for the Owner and the Admin (domain:read); the email is Owners only.
      expect(first.map((a) => a.level)).toEqual(["normal", "normal"]);
      expect(first[0]?.title).toBe(`Renew ${s.domain} at GoDaddy`);
      expect((await run(s, { at })).mail).toEqual([]);

      await fakeExpireIn(s.domain, 5, at);
      const urgent = await run(s, { at });
      expect(urgent.summary.expiring_7d).toBe(1);
      expect(urgent.summary.expiring_30d).toBe(1);
      expect(urgent.mail.map((m) => m.type).sort()).toEqual([
        "domain.expiry",
        "staff.domain_alert",
      ]);
      const levels = (await alertsOf(s.org, "domain.expiry")).map(
        (a) => a.level,
      );
      expect(levels).toContain("urgent");
      expect((await run(s, { at })).mail).toEqual([]);
    } finally {
      await retire(s);
    }
  });

  it("an old redirect domain whose delegation left CDS: rows dropped, zone moved, audited", async () => {
    if (!inst) return;
    const s = await launched();
    try {
      const old = s.domain;
      const next = await seedDomain();
      const v = await startMove(
        staff(),
        s.org,
        { domain: next, kind: "move", by: staffUser },
        s.deps,
      );
      await switchToCds(next);
      s.at = new Date(s.at.getTime() + 5 * MIN);
      expect((await advanceMove(v.id, s.deps)).status).toBe("done");

      // Still on CDS DNS: the old domain keeps redirecting.
      const kept = await run(s);
      expect(kept.redirectsDropped).toBe(0);
      expect(kept.summary.checked).toBe(1);

      await switchToOther(old);
      const r = await run(s);
      expect(r.redirectsDropped).toBe(1);
      // The old domain is not the live domain: no owner or staff alert for it.
      expect(r.summary.delegation_lost).toBe(0);
      expect(r.mail).toEqual([]);
      const hosts = await pb.collection("org_hosts").getFullList({
        filter: pb.filter("organization = {:org}", { org: s.org }),
      });
      const names = hosts.map((h) => h.hostname as string);
      expect(names).not.toContain(old);
      expect(names).not.toContain(`www.${old}`);
      expect(names).toContain(next);
      const zone = await pb.collection("dns_zones").getFirstListItem(
        pb.filter("org_id = {:org} && domain = {:d}", {
          org: s.org,
          d: old,
        }),
      );
      // WR-A06: the CDS zone serves nobody now: deleted, not left `moved`.
      expect(zone.status).toBe("deleted");
      expect(zone.provider_zone_id).toBe("");
      // A `moved` row left by an earlier version is cleaned up on the next run.
      await pb.collection("dns_zones").update(zone.id, { status: "moved" });
      await run(s);
      expect((await pb.collection("dns_zones").getOne(zone.id)).status).toBe(
        "deleted",
      );
      const audit = await pb.collection("audit_log").getFullList({
        filter: pb.filter(
          "organization = {:org} && action = 'domain.redirect_dropped'",
          { org: s.org },
        ),
      });
      expect(audit).toHaveLength(1);
    } finally {
      await retire(s);
    }
  });

  it("WR-A01: closed mode (production, no CDS_DNS_PROVIDER) records an empty pass instead of throwing", async () => {
    if (!inst) return;
    const saved = {
      env: process.env.CDS_ENV,
      dns: process.env.CDS_DNS_PROVIDER,
    };
    process.env.CDS_ENV = "production";
    delete process.env.CDS_DNS_PROVIDER;
    resetDnsForTests();
    try {
      const r = await runDomainHealth({ now: new Date() });
      expect(r.errors).toBe(0);
      expect(r.summary.checked).toBe(0);
      expect(await domainHealthSummary()).toEqual(r.summary);
    } finally {
      if (saved.env === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved.env;
      if (saved.dns === undefined) delete process.env.CDS_DNS_PROVIDER;
      else process.env.CDS_DNS_PROVIDER = saved.dns;
      resetDnsForTests();
    }
  });
});
