// 14-29 (DOM-02, DOM-04, DOM-08; T-14-29-01..04): the owner's domain view and actions on the
// real PocketBase binary over the fake DNS world, with an injected clock. The view is an
// allowlist: no record sources, no provider zone ids, no failure words in owner fields.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { P14_COPY, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sourceKeyIsNeedsYouKind } from "../src/alerts/list";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeBreakEmailRecord } from "../src/dns/fake-world";
import {
  acknowledgeFinding,
  advanceMove,
  startMove,
  type MoveDeps,
} from "../src/dns/moves";
import {
  domainNeedsYou,
  ownerAcknowledge,
  ownerCheckNameservers,
  ownerConnectDomain,
  ownerDomainView,
  ownerSendNameserverSteps,
  ownerUploadZoneFile,
  ownerUseDifferentDomain,
  resetOwnerDomainLimitsForTests,
  type OwnerDomainView,
} from "../src/dns/owner";
import { captureTransport } from "../src/email/transport";
import { listNeedsYou } from "../src/today";
import {
  FAKE_OLD_NAMESERVERS,
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let n = 0;
const provider = fakeDnsProvider();
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_ENV: process.env.CDS_ENV,
  CDS_DNS_PROVIDER: process.env.CDS_DNS_PROVIDER,
};

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domain-owner-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  delete process.env.CDS_DNS_PROVIDER;
  resetDnsForTests();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetDnsForTests();
  await inst?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const tag = () => randomBytes(4).toString("hex");

type Site = {
  org: string;
  owner: string;
  ownerEmail: string;
  previewHost: string;
  ctx: OrgContext;
  admin: OrgContext;
};

async function site(
  opts: { stage?: string; demo?: boolean } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Owner Domain ${n}`,
      slug: `owner-dom-${n}-${t}`,
      status: "active",
      stage: opts.stage ?? "being_built",
      ...(opts.demo ? { demo: true } : {}),
    })
  ).id;
  const previewHost = `owner-dom-${n}-${t}.sites.localhost`;
  await pb.collection("org_hosts").create({
    hostname: previewHost,
    organization: org,
    kind: "preview",
    primary: true,
  });
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const email = `${role}-${t}@cds.test`;
    const id = (
      await pb.collection("users").create({
        email,
        password,
        passwordConfirm: password,
        name: role === "owner" ? "Maria" : "Ada",
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return { id, email };
  };
  const owner = await member("owner");
  const admin = await member("admin");
  const mk = (actor: string, role: "owner" | "admin") =>
    mintOrgContext({ orgId: org, actor, role, grants: [], ip: "1.1.1.1" });
  return {
    org,
    owner: owner.id,
    ownerEmail: owner.email,
    previewHost,
    ctx: mk(owner.id, "owner"),
    admin: mk(admin.id, "admin"),
  };
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

let domainN = 0;
async function googleDomain(): Promise<string> {
  domainN += 1;
  const d = `owner${domainN}-${tag()}.example`;
  await seedFakeDomain(d, "google", {
    oldZone: [...presetRecords(d, "google"), dmarc(d)],
  });
  return d;
}

/** GoDaddy email forwarding (a registrar-only service: G5). */
async function forwardingDomain(): Promise<string> {
  domainN += 1;
  const d = `ownerfwd${domainN}-${tag()}.example`;
  await seedFakeDomain(d, "none", {
    oldZone: [
      ...presetRecords(d, "none"),
      {
        type: "MX",
        name: d,
        value: "mailstore1.secureserver.net",
        priority: 10,
        ttl: 3600,
      },
      {
        type: "TXT",
        name: d,
        value: "v=spf1 include:secureserver.net -all",
        ttl: 3600,
      },
      dmarc(d),
    ],
  });
  return d;
}

type Clock = {
  at: Date;
  deps: MoveDeps;
  mail: ReturnType<typeof captureTransport>;
};
function clock(start = "2026-10-17T10:00:00.000Z"): Clock {
  const mail = captureTransport();
  const c: Clock = {
    at: new Date(start),
    mail,
    deps: { provider, transport: mail },
  };
  c.deps.now = () => c.at;
  return c;
}

/** T-14-29-01: the serialised view never carries staff-only fields or failure words. */
function expectOwnerSafe(v: OwnerDomainView): void {
  const json = JSON.stringify(v);
  expect(json).not.toContain("sources");
  expect(json).not.toContain("provider_zone_id");
  expect(json).not.toContain("providerZoneId");
  expect(json.toLowerCase()).not.toContain("failed");
  expect(json.toLowerCase()).not.toContain("cutover");
}

describe("ownerDomainView (14-29 Task 1)", () => {
  it("S0: no domain yet shows the preview address; Admin reads with canAct false", async () => {
    if (!inst) return;
    const s = await site();
    const v = await ownerDomainView(s.ctx);
    expect(v.state).toBe("none");
    expect(v.previewHost).toBe(s.previewHost);
    expect(v.domain).toBeNull();
    expect(v.canAct).toBe(true);
    const a = await ownerDomainView(s.admin);
    expect(a.state).toBe("none");
    expect(a.canAct).toBe(false);
    expectOwnerSafe(v);
  });

  it("S-closed in production without a DNS provider", async () => {
    if (!inst) return;
    const s = await site();
    process.env.CDS_ENV = "production";
    try {
      expect((await ownerDomainView(s.ctx)).state).toBe("closed");
    } finally {
      if (saved.CDS_ENV === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved.CDS_ENV;
    }
  });

  it("the demo org reads as no domain and cannot act", async () => {
    if (!inst) return;
    const s = await site({ demo: true });
    const v = await ownerDomainView(s.ctx);
    expect(v.state).toBe("none");
    expect(v.canAct).toBe(false);
  });

  it("S2 forwarding finding -> S3 nameservers -> S5 connected, owner-safe throughout", async () => {
    if (!inst) return;
    const s = await site();
    const d = await forwardingDomain();
    const c = clock();
    const m = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    const f = await ownerDomainView(s.ctx, c.at, c.deps);
    expect(f.state).toBe("findings");
    expect(f.domain).toBe(d);
    expect(f.registrar).toEqual({ id: "godaddy", name: "GoDaddy" });
    expect(f.findings).toEqual([
      {
        kind: "email_forwarding",
        registrar: "GoDaddy",
        ackKey: "G5:email_forwarding",
        hardBlock: false,
      },
    ]);
    // Records grouped with Your email first; forwarding MX are still copied (CR-B01).
    expect(f.records.length).toBeGreaterThan(0);
    expect(f.records[0]?.group).toBe("email");
    expect(
      f.records.some(
        (r) =>
          r.type === "MX" && r.value.includes("mailstore1.secureserver.net"),
      ),
    ).toBe(true);
    expect(f.records.every((r) => r.status === "copied")).toBe(true);
    expectOwnerSafe(f);
    const admin = await ownerDomainView(s.admin, c.at, c.deps);
    expect(admin.state).toBe("findings");
    expect(admin.canAct).toBe(false);

    await acknowledgeFinding(s.ctx, m.id, "G5:email_forwarding", c.deps);
    const ns = await ownerDomainView(s.ctx, c.at, c.deps);
    expect(ns.state).toBe("nameservers");
    expect(ns.findings).toEqual([]);
    expect(ns.nameservers).toHaveLength(2);
    expect(ns.oldNameservers).toEqual([...FAKE_OLD_NAMESERVERS]);
    expect(ns.steps.map((x) => x.status)).toEqual([
      "done",
      "now",
      "todo",
      "todo",
      "todo",
      "todo",
    ]);
    expect(ns.steps[4]?.label).toBe(`Switching to ${d}`);
    expectOwnerSafe(ns);

    await switchToCds(d);
    c.at = new Date(c.at.getTime() + 10 * 60_000);
    await advanceMove(m.id, c.deps);
    const ok = await ownerDomainView(s.ctx, c.at, c.deps);
    expect(ok.state).toBe("connected");
    expect(ok.history).toBe(
      "Records copied 17 Oct · Nameservers changed 17 Oct",
    );
    expect(ok.expiry).toBe("ok");
    expect(ok.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expectOwnerSafe(ok);
  });

  it("S7: an email mismatch after the switch shows switch back with the old nameservers", async () => {
    if (!inst) return;
    const s = await site();
    const d = await googleDomain();
    const c = clock();
    const m = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    await switchToCds(d);
    await fakeBreakEmailRecord(d);
    await advanceMove(m.id, { ...c.deps, force: true });
    const v = await ownerDomainView(s.ctx, c.at, c.deps);
    expect(v.state).toBe("switch_back");
    expect(v.oldNameservers).toEqual([...FAKE_OLD_NAMESERVERS]);
    expect(v.email.provider).toBe("Google Workspace");
    expectOwnerSafe(v);
  });

  it("S6 live, S8 lost (open incident) and the expiry overlay", async () => {
    if (!inst) return;
    const s = await site({ stage: "live" });
    domainN += 1;
    const d = `ownerlive${domainN}-${tag()}.example`;
    await pb.collection("org_hosts").create({
      hostname: d,
      organization: s.org,
      kind: "custom",
      primary: true,
      verified_at: new Date().toISOString(),
    });
    const now = new Date("2026-10-17T10:00:00.000Z");
    await pb.collection("dns_zones").create({
      org_id: s.org,
      domain: d,
      provider: "fake",
      status: "active",
      nameservers: ["ns1.cds.test", "ns2.cds.test"],
      registrar: "NameCheap, Inc.",
      expires_at: new Date(now.getTime() + 5 * 86_400_000).toISOString(),
    });
    const live = await ownerDomainView(s.ctx, now);
    expect(live.state).toBe("live");
    expect(live.domain).toBe(d);
    expect(live.registrar?.name).toBe("Namecheap");
    expect(live.expiry).toBe("7d");
    const later = await ownerDomainView(
      s.ctx,
      new Date(now.getTime() - 20 * 86_400_000),
    );
    expect(later.expiry).toBe("30d");

    await pb.collection("platform_meta").create({
      key: `domains:incident:${s.org}:delegation_lost`,
      value: JSON.stringify({ opened_at: now.toISOString() }),
    });
    const lost = await ownerDomainView(s.ctx, now);
    expect(lost.state).toBe("lost");
    expect(lost.nameservers).toEqual(["ns1.cds.test", "ns2.cds.test"]);
    expectOwnerSafe(lost);
  });
});

const ny = async (ctx: OrgContext, c: Clock) =>
  (await domainNeedsYou(ctx, c.at, c.deps)).map((i) => i.key);

describe("owner actions and Needs you (14-29 Task 2)", () => {
  it("connect -> forwarding ack -> nameservers -> check now (rate limited) -> connected", async () => {
    if (!inst) return;
    resetOwnerDomainLimitsForTests();
    const s = await site();
    const d = await forwardingDomain();
    const c = clock();

    expect(await ny(s.ctx, c)).toEqual(["domain:connect"]);
    const listed = await listNeedsYou(s.ctx, {
      today: [],
      registry: ADDON_REGISTRY,
      now: c.at,
    });
    expect(listed.failed).toEqual([]);
    expect(listed.items.find((i) => i.key === "domain:connect")).toMatchObject({
      title: "Connect your domain",
      href: "/hub/settings?tab=domain",
      section: "settings",
      tab: "domain",
    });
    // Admins never get the owner's domain items.
    const adminList = await listNeedsYou(s.admin, {
      today: [],
      registry: ADDON_REGISTRY,
      now: c.at,
    });
    expect(adminList.items.some((i) => i.key.startsWith("domain:"))).toBe(
      false,
    );

    // T-14-29-04: Admin cannot start a connect.
    await expect(ownerConnectDomain(s.admin, d, c.deps)).rejects.toMatchObject({
      name: "Forbidden",
    });

    // A pasted URL is normalised; the forwarding finding waits for the owner.
    const f = await ownerConnectDomain(s.ctx, `https://www.${d}/`, c.deps);
    expect(f.state).toBe("findings");
    expect(f.domain).toBe(d);
    expect(await ny(s.ctx, c)).toEqual(["domain:forwarding"]);

    // Zone file errors map to owner copy; a good file adds its records to the copy.
    await expect(
      ownerUploadZoneFile(s.ctx, "x".repeat(256 * 1024 + 1), c.deps),
    ).rejects.toMatchObject({ reason: "zone_too_big" });
    await expect(
      ownerUploadZoneFile(
        s.ctx,
        "$ORIGIN other.example.\n@ 3600 IN A 198.18.0.20\n",
        c.deps,
      ),
    ).rejects.toMatchObject({
      reason: "zone_wrong_domain",
      message: P14_COPY.ZONE_WRONG_DOMAIN({
        fileDomain: "other.example",
        domain: d,
      }),
    });
    const up = await ownerUploadZoneFile(
      s.ctx,
      `$ORIGIN ${d}.\nextra 3600 IN TXT "hello-zone"\n`,
      c.deps,
    );
    expect(up.added).toBe(1);
    expect(up.message).toBe(P14_COPY.ZONE_ADDED({ count: 1 }));
    expect(up.view.records.some((r) => r.value === "hello-zone")).toBe(true);

    const ns = await ownerAcknowledge(s.ctx, "G5:email_forwarding", c.deps);
    expect(ns.state).toBe("nameservers");
    expect(await ny(s.ctx, c)).toEqual(["domain:nameservers"]);
    // Too late for a different domain once the nameserver step started.
    await expect(ownerUseDifferentDomain(s.ctx, c.deps)).rejects.toMatchObject({
      reason: "too_late",
    });

    // Send the steps: a bad address and a long note are refused; a good one logs one mail.
    await expect(
      ownerSendNameserverSteps(s.ctx, { to: "not-an-email" }, c.deps),
    ).rejects.toMatchObject({ reason: "email_invalid" });
    await expect(
      ownerSendNameserverSteps(
        s.ctx,
        { to: "sam@example.com", note: "x".repeat(501) },
        c.deps,
      ),
    ).rejects.toMatchObject({ reason: "note_too_long" });
    await ownerSendNameserverSteps(
      s.ctx,
      { to: "Sam@Example.com", note: "Thanks Sam" },
      c.deps,
    );
    const steps = c.mail.sent.filter(
      (m) => m.type === "domain.nameserver_steps",
    );
    expect(steps.map((m) => m.to)).toEqual(["sam@example.com"]);
    const sentRows = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:org} && action = 'domain.steps_sent'",
        { org: s.org },
      ),
    });
    expect(sentRows).toHaveLength(1);
    expect(JSON.stringify(sentRows[0]?.meta)).not.toContain("example.com");

    // "I've changed them" before the switch: still waiting (NS-NOT-YET).
    const first = await ownerCheckNameservers(s.ctx, c.deps);
    expect(first.state).toBe("waiting");
    expect(first.notYet).toBe(true);
    expect(first.view.lastCheckedAt).not.toBeNull();
    expect(first.view.waitingSince).not.toBeNull();
    await expect(ownerCheckNameservers(s.ctx, c.deps)).rejects.toMatchObject({
      name: "RateLimited",
    });
    expect(await ny(s.ctx, c)).toEqual(["domain:nameservers"]);

    resetOwnerDomainLimitsForTests();
    await switchToCds(d);
    const done = await ownerCheckNameservers(s.ctx, c.deps);
    expect(done.state).toBe("connected");
    expect(done.notYet).toBe(false);
    expect(await ny(s.ctx, c)).toEqual([]);
    expectOwnerSafe(done.view);
    // Nothing waits on the owner any more.
    await expect(
      ownerSendNameserverSteps(s.ctx, { to: "sam@example.com" }, c.deps),
    ).rejects.toMatchObject({ reason: "nothing_open" });
  });

  it("refusals: invalid input, not registered, Cloudflare registrar, demo, live site", async () => {
    if (!inst) return;
    const s = await site();
    const c = clock();
    await expect(
      ownerConnectDomain(s.ctx, "not a domain", c.deps),
    ).rejects.toMatchObject({
      reason: "invalid",
      message: P14_COPY.DOM_INVALID,
    });
    await expect(
      ownerConnectDomain(s.ctx, "shop.riverabakery.com", c.deps),
    ).rejects.toMatchObject({ reason: "subdomain" });
    const unseeded = `nobody-${tag()}.example`;
    await expect(
      ownerConnectDomain(s.ctx, unseeded, c.deps),
    ).rejects.toMatchObject({
      reason: "not_registered",
      message: P14_COPY.DOM_NOT_REGISTERED({ domain: unseeded }),
    });
    domainN += 1;
    const cf = `ownercf${domainN}-${tag()}.example`;
    await seedFakeDomain(cf, "google", { registrar: "Cloudflare, Inc." });
    await expect(ownerConnectDomain(s.ctx, cf, c.deps)).rejects.toMatchObject({
      reason: "cf_registrar",
    });

    const demo = await site({ demo: true });
    await expect(
      ownerConnectDomain(demo.ctx, await googleDomain(), c.deps),
    ).rejects.toMatchObject({ reason: "demo" });

    const live = await site({ stage: "live" });
    await expect(
      ownerConnectDomain(live.ctx, await googleDomain(), c.deps),
    ).rejects.toMatchObject({
      reason: "move_help",
      message: P14_COPY.DOM_MOVE_HELP,
    });
    expect(await ny(live.ctx, c)).toEqual([]);
  });

  it("use a different domain before the nameserver step returns to S0", async () => {
    if (!inst) return;
    const s = await site();
    const d = await forwardingDomain();
    const c = clock();
    expect((await ownerConnectDomain(s.ctx, d, c.deps)).state).toBe("findings");
    const back = await ownerUseDifferentDomain(s.ctx, c.deps);
    expect(back.state).toBe("none");
    expect(await ny(s.ctx, c)).toEqual(["domain:connect"]);
  });

  it("switch back: urgent Needs-you item; checking while still at CDS keeps S7", async () => {
    if (!inst) return;
    resetOwnerDomainLimitsForTests();
    const s = await site();
    const d = await googleDomain();
    const c = clock();
    expect((await ownerConnectDomain(s.ctx, d, c.deps)).state).toBe(
      "nameservers",
    );
    await switchToCds(d);
    await fakeBreakEmailRecord(d);
    const r = await ownerCheckNameservers(s.ctx, c.deps);
    expect(r.state).toBe("switch_back");
    const items = await domainNeedsYou(s.ctx, c.at, c.deps);
    expect(items).toEqual([
      expect.objectContaining({
        key: "domain:switch_back",
        level: "urgent",
        title: "Switch your nameservers back",
        sub: "Your email is safer at GoDaddy.",
      }),
    ]);
    resetOwnerDomainLimitsForTests();
    const again = await ownerCheckNameservers(s.ctx, c.deps);
    expect(again.state).toBe("switch_back");
    // Domain alerts are plain alerts: never cleared as Needs-you mirrors.
    expect(
      sourceKeyIsNeedsYouKind("domain.switch_back", "domain:M-1:switch_back:1"),
    ).toBe(false);
  });

  it("lost delegation and renew items for a live site", async () => {
    if (!inst) return;
    const s = await site({ stage: "live" });
    domainN += 1;
    const d = `ownerlost${domainN}-${tag()}.example`;
    await pb.collection("org_hosts").create({
      hostname: d,
      organization: s.org,
      kind: "custom",
      primary: true,
      verified_at: new Date().toISOString(),
    });
    const c = clock();
    await pb.collection("dns_zones").create({
      org_id: s.org,
      domain: d,
      provider: "fake",
      status: "active",
      nameservers: ["ns1.cds.test", "ns2.cds.test"],
      registrar: "GoDaddy.com, LLC",
      expires_at: new Date(c.at.getTime() + 3 * 86_400_000).toISOString(),
    });
    await pb.collection("platform_meta").create({
      key: `domains:incident:${s.org}:delegation_lost`,
      value: "{}",
    });
    const items = await domainNeedsYou(s.ctx, c.at, c.deps);
    expect(items.map((i) => [i.key, i.level])).toEqual([
      ["domain:lost", "urgent"],
      ["domain:renew", "urgent"],
    ]);
    expect(items[1]?.title).toBe(`Renew ${d} at GoDaddy`);
    expect(items[1]?.sub).toBe("Expires 20 Oct.");
  });

  it("P14-P34: org B's acknowledge never touches org A's move", async () => {
    if (!inst) return;
    const a = await site();
    const b = await site();
    const c = clock();
    const d = await forwardingDomain();
    await ownerConnectDomain(a.ctx, d, c.deps);
    const before = await pb
      .collection("domain_moves")
      .getFirstListItem(pb.filter("org_id = {:org}", { org: a.org }));
    await expect(
      ownerAcknowledge(b.ctx, "G5:email_forwarding", c.deps),
    ).rejects.toMatchObject({ reason: "nothing_open" });
    await expect(ownerCheckNameservers(b.ctx, c.deps)).rejects.toMatchObject({
      reason: "nothing_open",
    });
    const after = await pb.collection("domain_moves").getOne(before.id);
    expect(after.acks).toEqual(before.acks);
    expect(after.updated).toBe(before.updated);
    expect((await ownerDomainView(b.ctx, c.at, c.deps)).state).toBe("none");
  });
});
