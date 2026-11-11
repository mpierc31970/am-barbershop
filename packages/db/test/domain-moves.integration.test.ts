// 14-22 (DOM-08, DOM-05; T-14-22-01..06): the domain move state machine, steps 1-5, on the
// real PocketBase binary over the fake DNS world, with an injected clock. Steps run as the
// owner would see them: snapshot -> zone -> gate -> nameservers (owner) -> delegation.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { P14_COPY, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  mintOrgContext,
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { __clearDemoCacheForTests } from "../src/demo/flag";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import {
  fakeBreakEmailRecord,
  fakeSetDnssec,
  fakeWorldGet,
  fakeWorldPatch,
} from "../src/dns/fake-world";
import {
  acknowledgeFinding,
  advanceMove,
  advanceMoves,
  cancelMove,
  getMove,
  moveByCode,
  openMoveFor,
  overrideGateRule,
  retakeSnapshot,
  retryStep,
  startMove,
  type MoveDeps,
} from "../src/dns/moves";
import type { RegistryLookup } from "../src/dns/ports";
import {
  DnsSweepAtCds,
  readDnsZoneRow,
  takeSnapshot,
} from "../src/dns/snapshot";
import { captureTransport } from "../src/email/transport";
import {
  presetRecords,
  seedFakeDomain,
  switchToCds,
  type FakeDomainPreset,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let storageDir = "";
let n = 0;
let staffUser = "";
const provider = fakeDnsProvider();
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
};
const STAFF_TO = "staff-alerts@cds.test";

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domain-moves-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = STAFF_TO;
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

type Site = {
  org: string;
  owner: string;
  ownerEmail: string;
  adminEmail: string;
  ctx: OrgContext;
};

async function site(
  opts: { demo?: boolean; live?: boolean } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Moves ${n}`,
      slug: `moves-${n}-${t}`,
      status: "active",
      ...(opts.live ? { stage: "live" } : {}),
      ...(opts.demo ? { demo: true } : {}),
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: `moves-${n}-${t}.sites.localhost`,
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
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return { id, email };
  };
  const owner = await member("owner");
  const admin = await member("admin");
  return {
    org,
    owner: owner.id,
    ownerEmail: owner.email,
    adminEmail: admin.email,
    ctx: mintOrgContext({
      orgId: org,
      actor: owner.id,
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

let domainN = 0;
async function domain(
  preset: FakeDomainPreset,
  extra: Partial<Parameters<typeof seedFakeDomain>[2]> = {},
): Promise<string> {
  domainN += 1;
  const d = `move${domainN}-${tag()}.example`;
  await seedFakeDomain(d, preset, {
    oldZone: [...presetRecords(d, preset), dmarc(d)],
    ...extra,
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
const later = (c: Clock, ms: number) => {
  c.at = new Date(c.at.getTime() + ms);
};
const MIN = 60_000;
const HOUR = 3_600_000;

async function auditRows(moveId: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("target_id = {:id}", { id: moveId }),
    sort: "created,id",
  });
}

async function customHosts(org: string) {
  return pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org} && kind != 'preview'", { org }),
  });
}

const stepStatus = (v: { steps: { key: string; status: string }[] }) =>
  Object.fromEntries(v.steps.map((s) => [s.key, s.status]));

const nullDnssec: RegistryLookup = {
  lookup: async () => ({
    found: true,
    registrar: "GoDaddy",
    expiresAt: null,
    dnssec: null,
  }),
};

describe("startMove and steps 1-3 (14-22 Task 1)", () => {
  it("Google domain: snapshot, zone and gate done; the owner's nameserver step waits", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.code).toMatch(/^M-\d+$/);
    expect(v.kind).toBe("launch");
    expect(v.toHost).toBe(d);
    expect(v.fromHost).toMatch(/\.sites\.localhost$/);
    expect(stepStatus(v)).toMatchObject({
      snapshot: "done",
      zone: "done",
      gate: "done",
      nameservers: "waiting_owner",
      delegation: "waiting",
    });
    expect(v.status).toBe("waiting_owner");
    expect(v.currentStep).toBe("nameservers");
    expect(v.steps.find((x) => x.key === "nameservers")?.detail).toBe(
      "waiting_ns",
    );
    expect(v.findings?.every((f) => f.pass)).toBe(true);

    const row = await readDnsZoneRow(s.org, d);
    expect(row?.providerZoneId).toBeTruthy();
    expect(row?.nameservers.length).toBe(2);
    expect(row?.status).toBe("pending");
    // apex/www site records copied at TTL 300 (choice 3).
    const zone = await provider.listRecords(row!.providerZoneId!);
    expect(zone.find((r) => r.type === "A" && r.name === d)?.ttl).toBe(300);
    expect(
      zone.find((r) => r.type === "CNAME" && r.name === `www.${d}`)?.ttl,
    ).toBe(300);
    expect(zone.find((r) => r.type === "MX")?.ttl).toBe(3600);

    // P14-P4: no custom host row before delegation.
    expect(await customHosts(s.org)).toHaveLength(0);
    // records_copied email to the owner (not the admin).
    const copied = c.mail.sent.filter(
      (m) => m.type === "domain.records_copied",
    );
    expect(copied.map((m) => m.to)).toEqual([s.ownerEmail]);

    // One audit row per transition: started, 3 x step_done, step_waiting_owner.
    const rows = await auditRows(v.id);
    expect(rows.map((r) => r.action)).toEqual([
      "domain.started",
      "domain.step_done",
      "domain.step_done",
      "domain.step_done",
      "domain.step_waiting_owner",
    ]);
    for (const r of rows) {
      expect(JSON.stringify(r.meta ?? {})).not.toContain("smtp.google.com");
    }

    // Idempotency: not due -> nothing runs; forced -> same waiting state, no new audit row.
    await advanceMove(v.id, c.deps);
    await advanceMove(v.id, { ...c.deps, force: true });
    expect(await auditRows(v.id)).toHaveLength(5);
    const again = await getMove(s.ctx, v.id);
    expect(stepStatus(again)).toEqual(stepStatus(v));
    expect(
      c.mail.sent.filter((m) => m.type === "domain.records_copied"),
    ).toHaveLength(1);

    // Reads.
    expect((await openMoveFor(s.ctx))?.id).toBe(v.id);
    expect((await moveByCode(staff("support_agent"), v.code)).id).toBe(v.id);

    // A second start is refused.
    await expect(
      startMove(
        s.ctx,
        s.org,
        { domain: d, kind: "launch", by: s.owner },
        c.deps,
      ),
    ).rejects.toThrow("This site is already connecting a domain.");
  });

  it("DNSSEC on waits for the owner at the gate; turning it off passes", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("dnssec");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    expect(v.status).toBe("waiting_owner");
    expect(v.steps.find((x) => x.key === "gate")?.detail).toBe("owner:G3");
    await expect(
      overrideGateRule(staff(), v.id, "G3", "Owner says it is off already."),
    ).rejects.toThrow(P14_COPY.NO_OVERRIDE);

    await fakeSetDnssec(d, false);
    const after = await advanceMove(v.id, { ...c.deps, force: true });
    expect(stepStatus(after).gate).toBe("done");
    expect(after.currentStep).toBe("nameservers");
  });

  it("two SPF records are a hard block the owner fixes; a staff override of G6 is refused", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("two_spf");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    expect(v.status).toBe("waiting_owner");
    expect(v.steps.find((x) => x.key === "gate")?.detail).toContain("G6");
    const g6 = v.findings?.find((f) => f.rule === "G6");
    expect(g6?.hardBlock).toBe(true);
    await expect(
      overrideGateRule(
        staff(),
        v.id,
        "G6",
        "Staff wants to push this through.",
      ),
    ).rejects.toThrow(P14_COPY.NO_OVERRIDE);
    expect(
      (await auditRows(v.id)).some((r) => r.action === "domain.override"),
    ).toBe(false);
  });

  it("registrar email forwarding waits for the owner's acknowledgement", async () => {
    if (!inst) return;
    const s = await site();
    domainN += 1;
    const d = `fwd${domainN}-${tag()}.example`;
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
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    expect(v.status).toBe("waiting_owner");
    expect(v.steps.find((x) => x.key === "gate")?.detail).toContain("G5");
    await expect(
      acknowledgeFinding(s.ctx, v.id, "G5:anything"),
    ).rejects.toMatchObject({ name: "InvalidInput" });
    const acked = await acknowledgeFinding(
      s.ctx,
      v.id,
      "G5:email_forwarding",
      c.deps,
    );
    expect(acked.acks.map((a) => a.key)).toEqual(["G5:email_forwarding"]);
    expect(stepStatus(acked).gate).toBe("done");
    // The forwarding MX is still copied into the CDS zone (CR-B01).
    const fwdRow = await readDnsZoneRow(s.org, d);
    const fwdZone = await provider.listRecords(fwdRow!.providerZoneId!);
    expect(
      fwdZone.some(
        (r) =>
          r.type === "MX" &&
          r.value.toLowerCase().includes("mailstore1.secureserver.net"),
      ),
    ).toBe(true);
    expect(acked.currentStep).toBe("nameservers");
    expect(
      (await auditRows(v.id)).filter((r) => r.action === "domain.ack"),
    ).toHaveLength(1);
  });

  it("DNSSEC unknown waits (never passes), alerts staff once after 6 tries and cannot be overridden", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    c.deps.registry = nullDnssec;
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    expect(v.status).toBe("running");
    const gate = v.steps.find((x) => x.key === "gate");
    expect(gate?.status).toBe("waiting");
    expect(gate?.detail).toBe("dnssec_unknown");
    expect(gate?.nextAttemptAt).toBe(
      new Date(c.at.getTime() + 5 * MIN).toISOString(),
    );
    for (let i = 0; i < 6; i++) {
      later(c, 5 * MIN);
      await advanceMove(v.id, c.deps);
    }
    const after = await getMove(s.ctx, v.id);
    expect(after.steps.find((x) => x.key === "gate")?.unknownCount).toBe(7);
    expect(stepStatus(after).gate).toBe("waiting");
    const alerts = c.mail.sent.filter(
      (m) => m.type === "staff.domain_alert" && m.to === STAFF_TO,
    );
    expect(alerts).toHaveLength(1);
    await expect(
      overrideGateRule(staff(), v.id, "G3", "DNSSEC is surely off by now."),
    ).rejects.toThrow(P14_COPY.NO_OVERRIDE);
    // Only one audit row for the waiting state (repeats are not transitions).
    expect(
      (await auditRows(v.id)).filter((r) => r.action === "domain.step_waiting"),
    ).toHaveLength(1);
  });

  it("a DKIM missing at the CDS nameservers sends the gate to CDS review", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("dnssec");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    const row = await readDnsZoneRow(s.org, d);
    const dkim = (await provider.listRecords(row!.providerZoneId!)).find((r) =>
      r.name.startsWith("google._domainkey."),
    );
    await provider.deleteRecord(row!.providerZoneId!, dkim!.id);
    await fakeSetDnssec(d, false);
    const after = await advanceMove(v.id, { ...c.deps, force: true });
    const gate = after.steps.find((x) => x.key === "gate");
    expect(gate?.status).toBe("waiting");
    expect(gate?.detail).toBe("cds_review");
    expect(after.findings?.find((f) => f.rule === "G1")?.hardBlock).toBe(true);
    const alerts = c.mail.sent.filter((m) => m.type === "staff.domain_alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.text).not.toContain("v=DKIM1");
    // G1 on an email record is never overridable.
    await expect(
      overrideGateRule(staff(), v.id, "G1", "The DKIM is not needed anymore."),
    ).rejects.toThrow(P14_COPY.NO_OVERRIDE);
    // The staff fix path: re-take the snapshot, which re-copies and re-gates.
    const fixed = await retakeSnapshot(
      staff("support_agent"),
      v.id,
      {},
      { ...c.deps },
    );
    expect(stepStatus(fixed).gate).toBe("done");
  });

  it("refuses a demo site, a post-launch move from the owner, and a domain another site holds", async () => {
    if (!inst) return;
    const c = clock();
    const demo = await site({ demo: true });
    __clearDemoCacheForTests();
    const d1 = await domain("google");
    await expect(
      startMove(
        demo.ctx,
        demo.org,
        { domain: d1, kind: "launch", by: demo.owner },
        c.deps,
      ),
    ).rejects.toMatchObject({ name: "InvalidInput" });

    const live = await site({ live: true });
    await expect(
      startMove(
        live.ctx,
        live.org,
        { domain: d1, kind: "move", by: live.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_MOVE_HELP);
    await expect(
      startMove(
        live.ctx,
        live.org,
        { domain: d1, kind: "launch", by: live.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_MOVE_HELP);

    // DOM-TAKEN: another org's verified host row, or its active zone.
    const other = await site();
    const d2 = await domain("google");
    await pb.collection("org_hosts").create({
      hostname: d2,
      organization: other.org,
      kind: "custom",
      primary: false,
      verified_at: "2026-10-01 00:00:00.000Z",
    });
    const s = await site();
    await expect(
      startMove(
        s.ctx,
        s.org,
        { domain: d2, kind: "launch", by: s.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_TAKEN);
    const d3 = await domain("google");
    await pb.collection("dns_zones").create({
      org_id: other.org,
      domain: d3,
      status: "active",
    });
    await expect(
      startMove(
        s.ctx,
        s.org,
        { domain: d3, kind: "launch", by: s.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_TAKEN);
    // Bad input.
    await expect(
      startMove(
        s.ctx,
        s.org,
        { domain: "shop.rivera.example", kind: "launch", by: s.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_SUBDOMAIN);
  });

  it("org B's context never reaches org A's move (P14-P34)", async () => {
    if (!inst) return;
    const a = await site();
    const b = await site();
    const d = await domain("dnssec");
    const c = clock();
    const v = await startMove(
      a.ctx,
      a.org,
      { domain: d, kind: "launch", by: a.owner },
      c.deps,
    );
    const before = await pb.collection("domain_moves").getOne(v.id);

    const db = await domain("google");
    await expect(
      startMove(
        b.ctx,
        a.org,
        { domain: db, kind: "launch", by: b.owner },
        c.deps,
      ),
    ).rejects.toMatchObject({ name: "NotFound" });
    await expect(
      acknowledgeFinding(b.ctx, v.id, "G5:email_forwarding", c.deps),
    ).rejects.toMatchObject({ name: "NotFound" });
    await expect(retryStep(b.ctx, v.id, c.deps)).rejects.toMatchObject({
      name: "NotFound",
    });
    await expect(
      cancelMove(b.ctx, v.id, "not mine", c.deps),
    ).rejects.toMatchObject({
      name: "NotFound",
    });
    await expect(retakeSnapshot(b.ctx, v.id, {}, c.deps)).rejects.toMatchObject(
      {
        name: "NotFound",
      },
    );
    await expect(getMove(b.ctx, v.id)).rejects.toMatchObject({
      name: "NotFound",
    });
    await expect(openMoveFor(b.ctx, a.org)).rejects.toMatchObject({
      name: "NotFound",
    });

    const after = await pb.collection("domain_moves").getOne(v.id);
    expect(after.updated).toBe(before.updated);
    expect(after.steps).toEqual(before.steps);
    expect(after.acks).toEqual(before.acks);
    expect(await openMoveFor(b.ctx)).toBeNull();
  });
});

describe("steps 4-5, retry, cancel, advanceMoves (14-22 Task 2)", () => {
  it("switching to CDS prepares a launch move; DOM-TAKEN for others; cancel keeps the zone", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("nameservers");
    // The owner's "I've changed them" before the switch: still waiting, nothing new audited.
    await advanceMove(v.id, { ...c.deps, force: true });

    await switchToCds(d);
    later(c, 5 * MIN);
    const p = await advanceMove(v.id, c.deps);
    expect(p.status).toBe("prepared");
    expect(p.prepared).toBe(true);
    expect(stepStatus(p)).toMatchObject({
      nameservers: "done",
      delegation: "done",
      site_records: "waiting",
    });
    const row = await readDnsZoneRow(s.org, d);
    expect(row?.status).toBe("active");
    const raw = await pb.collection("dns_zones").getOne(row!.id);
    expect(raw.accepted_email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(raw.delegated_at).not.toBe("");
    expect(await customHosts(s.org)).toHaveLength(0);
    expect(
      c.mail.sent.filter((m) => m.type === "domain.connected").map((m) => m.to),
    ).toEqual([s.ownerEmail]);
    const bell = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && type = 'domain.connected'", {
        org: s.org,
      }),
    });
    expect(bell.length).toBeGreaterThan(0);

    expect((await auditRows(v.id)).map((r) => r.action)).toEqual([
      "domain.started",
      "domain.step_done",
      "domain.step_done",
      "domain.step_done",
      "domain.step_waiting_owner",
      "domain.step_done",
      "domain.prepared",
    ]);
    // A prepared move does not run again.
    await advanceMove(v.id, { ...c.deps, force: true });
    expect(await auditRows(v.id)).toHaveLength(7);

    // P14-P23: the domain is now taken for every other site.
    const other = await site();
    await expect(
      startMove(
        other.ctx,
        other.org,
        { domain: d, kind: "launch", by: other.owner },
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.DOM_TAKEN);

    // Cancel after delegation: the zone stays (hand it back first), org_hosts untouched.
    await expect(cancelMove(s.ctx, v.id, "no", c.deps)).rejects.toMatchObject({
      name: "InvalidInput",
    });
    const cancelled = await cancelMove(s.ctx, v.id, "Changed my mind", c.deps);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelNote).toBe(P14_COPY.CANCEL_DELEGATED);
    expect((await readDnsZoneRow(s.org, d))?.status).toBe("active");
    expect((await fakeWorldGet(d))?.cdsZoneId).toBeTruthy();
    const hosts = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:org}", { org: s.org }),
    });
    expect(hosts).toHaveLength(1);
    expect(await openMoveFor(s.ctx)).toBeNull();
  });

  it("an email record that differs after the switch fails with switch-back mail; retry after fixing prepares", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    const oldBefore = (await fakeWorldGet(d))?.oldZone;
    await switchToCds(d);
    await fakeBreakEmailRecord(d);
    const f = await advanceMove(v.id, { ...c.deps, force: true });
    expect(f.status).toBe("failed");
    expect(f.failedStep).toBe("delegation");
    expect(f.steps.find((x) => x.key === "delegation")?.detail).toBe(
      "post_switch_mismatch",
    );
    expect((await readDnsZoneRow(s.org, d))?.status).toBe("pending");

    const back = c.mail.sent.filter((m) => m.type === "domain.switch_back");
    expect(back.map((m) => m.to).sort()).toEqual(
      [s.adminEmail, s.ownerEmail].sort(),
    );
    expect(
      c.mail.sent.filter(
        (m) => m.type === "staff.domain_alert" && m.to === STAFF_TO,
      ),
    ).toHaveLength(1);
    const urgent = await pb.collection("alerts").getFullList({
      filter: pb.filter(
        "organization = {:org} && type = 'domain.switch_back'",
        {
          org: s.org,
        },
      ),
    });
    expect(urgent.length).toBeGreaterThan(0);
    // CDS never touched the old zone (D58).
    expect((await fakeWorldGet(d))?.oldZone).toEqual(oldBefore);
    // A failed move is not advanced by the job.
    await advanceMove(v.id, { ...c.deps, force: true });
    expect((await getMove(s.ctx, v.id)).status).toBe("failed");

    await fakeWorldPatch(d, { publicOverrides: [] });
    const ok = await retryStep(s.ctx, v.id, c.deps);
    expect(ok.status).toBe("prepared");
    const actions = (await auditRows(v.id)).map((r) => r.action);
    expect(actions.filter((a) => a === "domain.step_failed")).toHaveLength(1);
    expect(actions.filter((a) => a === "domain.retry")).toHaveLength(1);
    expect(actions.at(-1)).toBe("domain.prepared");
    // Nothing left to retry.
    await expect(retryStep(s.ctx, v.id, c.deps)).rejects.toMatchObject({
      name: "InvalidInput",
    });
  });

  it("a snapshot older than 24 h at the nameserver step is re-taken (G7)", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    const before = await readDnsZoneRow(s.org, d);
    later(c, 25 * HOUR);
    const after = await advanceMove(v.id, c.deps);
    const row = await readDnsZoneRow(s.org, d);
    expect(row?.snapshotKey).not.toBe(before?.snapshotKey);
    expect(Date.parse(row!.snapshotAt!)).toBe(c.at.getTime());
    expect(after.currentStep).toBe("nameservers");
    expect(after.status).toBe("waiting_owner");
  });

  it("CR-A02: a stale snapshot after the owner switched is not re-taken from CDS's own zone", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    const before = await readDnsZoneRow(s.org, d);
    expect(before?.originalNameservers.length).toBeGreaterThan(0);
    await switchToCds(d);
    later(c, 25 * HOUR);
    const after = await advanceMove(v.id, c.deps);
    expect(stepStatus(after).nameservers).toBe("done");
    const row = await readDnsZoneRow(s.org, d);
    // No new sweep: the snapshot and the old host's nameservers are the pre-switch ones.
    expect(row?.snapshotKey).toBe(before?.snapshotKey);
    expect(row?.originalNameservers).toEqual(before?.originalNameservers);
    const cds = new Set(row?.nameservers ?? []);
    expect(row?.originalNameservers.some((n) => cds.has(n))).toBe(false);
  });

  it("CR-A02: takeSnapshot refuses to sweep a pending CDS zone the domain already points at", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect((await readDnsZoneRow(s.org, d))?.status).toBe("pending");
    await switchToCds(d);
    await expect(
      takeSnapshot(s.org, d, { deps: c.deps, now: c.at }),
    ).rejects.toBeInstanceOf(DnsSweepAtCds);
  });

  it("a stale snapshot whose re-gate fails goes back to the gate step", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    await fakeSetDnssec(d, true);
    later(c, 25 * HOUR);
    const after = await advanceMove(v.id, c.deps);
    expect(after.currentStep).toBe("gate");
    expect(after.status).toBe("waiting_owner");
    expect(stepStatus(after).nameservers).toBe("waiting");
  });

  it("cancel before the switch deletes the CDS zone", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect((await fakeWorldGet(d))?.cdsZoneId).toBeTruthy();
    const x = await cancelMove(staff(), v.id, "Owner asked to stop", c.deps);
    expect(x.status).toBe("cancelled");
    expect(x.cancelNote).toBeNull();
    expect((await fakeWorldGet(d))?.cdsZoneId).toBeFalsy();
    const row = await readDnsZoneRow(s.org, d);
    expect(row?.status).toBe("deleted");
    expect(row?.providerZoneId).toBeNull();
    await expect(
      cancelMove(staff(), v.id, "Again please", c.deps),
    ).rejects.toMatchObject({
      name: "InvalidInput",
    });
    // support_agent may not cancel (domain_move is super_admin).
    const s2 = await site();
    const d2 = await domain("google");
    const v2 = await startMove(
      s2.ctx,
      s2.org,
      { domain: d2, kind: "launch", by: s2.owner },
      c.deps,
    );
    await expect(
      cancelMove(staff("support_agent"), v2.id, "Not allowed", c.deps),
    ).rejects.toMatchObject({ name: "Forbidden" });
    // After a cancel a new start is allowed again (zone recreated).
    const again = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(again.currentStep).toBe("nameservers");
    expect((await readDnsZoneRow(s.org, d))?.status).toBe("pending");
  });

  it("CR-A01: cancel keeps the CDS zone once the domain points at it (step 5 failed, or switched before the job ran)", async () => {
    if (!inst) return;
    // (a) Step 5 failed with the switch-back state: nameservers already at CDS.
    const s = await site();
    const d = await domain("google");
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    await switchToCds(d);
    await fakeBreakEmailRecord(d);
    const f = await advanceMove(v.id, { ...c.deps, force: true });
    expect(f.failedStep).toBe("delegation");
    const x = await cancelMove(staff(), v.id, "Owner asked to stop", c.deps);
    expect(x.status).toBe("cancelled");
    expect(x.cancelNote).toBe(P14_COPY.CANCEL_DELEGATED);
    expect((await fakeWorldGet(d))?.cdsZoneId).toBeTruthy();
    expect((await readDnsZoneRow(s.org, d))?.status).toBe("active");

    // (b) The owner switched, but the 5-minute job has not run: step 4 is still waiting.
    const s2 = await site();
    const d2 = await domain("google");
    const v2 = await startMove(
      s2.ctx,
      s2.org,
      { domain: d2, kind: "launch", by: s2.owner },
      c.deps,
    );
    expect(v2.currentStep).toBe("nameservers");
    await switchToCds(d2);
    const y = await cancelMove(staff(), v2.id, "Owner asked to stop", c.deps);
    expect(y.cancelNote).toBe(P14_COPY.CANCEL_DELEGATED);
    expect((await fakeWorldGet(d2))?.cdsZoneId).toBeTruthy();
    const row = await readDnsZoneRow(s2.org, d2);
    expect(row?.status).toBe("active");
    expect(row?.providerZoneId).toBeTruthy();
  });

  it("WR-A04: another org's pending zone is never adopted; a launch move left at step 4 for 30 days expires", async () => {
    if (!inst) return;
    const c = clock("2031-03-01T10:00:00.000Z");
    const a = await site();
    const d = await domain("google");
    const va = await startMove(
      a.ctx,
      a.org,
      { domain: d, kind: "launch", by: a.owner },
      c.deps,
    );
    expect(va.currentStep).toBe("nameservers");
    // Org B names the same domain while A's zone is only pending: the zone A holds is
    // not handed to B (the fake provider answers with the same zone id, like 1061 + lookup).
    const b = await site();
    const vb = await startMove(
      b.ctx,
      b.org,
      { domain: d, kind: "launch", by: b.owner },
      c.deps,
    );
    expect(vb.status).toBe("failed");
    expect(vb.steps.find((x) => x.key === "zone")?.detail).toBe(
      "zone_exists_elsewhere",
    );
    expect((await readDnsZoneRow(b.org, d))?.providerZoneId ?? null).toBeNull();

    // 31 days later A never switched: the job cancels A's move and deletes its unused zone.
    const before = c.mail.sent.length;
    const r = await advanceMoves({
      now: new Date(c.at.getTime() + 31 * 24 * HOUR),
      deps: c.deps,
    });
    expect(r.expired).toBeGreaterThanOrEqual(1);
    const after = await getMove(a.ctx, va.id);
    expect(after.status).toBe("cancelled");
    expect((await readDnsZoneRow(a.org, d))?.status).toBe("deleted");
    expect((await fakeWorldGet(d))?.cdsZoneId).toBeFalsy();
    expect(
      c.mail.sent
        .slice(before)
        .filter((m) => m.type === "staff.domain_alert" && m.to === STAFF_TO),
    ).not.toHaveLength(0);
  });

  it("advanceMoves advances due moves only; dryRun counts", async () => {
    if (!inst) return;
    const s1 = await site();
    const s2 = await site();
    const d1 = await domain("google");
    const d2 = await domain("google");
    const c = clock("2030-01-01T10:00:00.000Z");
    const v1 = await startMove(
      s1.ctx,
      s1.org,
      { domain: d1, kind: "launch", by: s1.owner },
      c.deps,
    );
    const v2 = await startMove(
      s2.ctx,
      s2.org,
      { domain: d2, kind: "launch", by: s2.owner },
      c.deps,
    );
    await switchToCds(d1);

    // Not due yet: nothing moves.
    const early = await advanceMoves({
      now: new Date(c.at.getTime() + MIN),
      deps: c.deps,
    });
    expect((await getMove(s1.ctx, v1.id)).status).toBe("waiting_owner");
    void early;

    later(c, 6 * MIN);
    const dry = await advanceMoves({ now: c.at, dryRun: true, deps: c.deps });
    expect(dry.advanced).toBeGreaterThanOrEqual(2);
    expect((await getMove(s1.ctx, v1.id)).status).toBe("waiting_owner");

    const res = await advanceMoves({ now: c.at, deps: c.deps });
    expect(res.advanced).toBeGreaterThanOrEqual(2);
    expect(res.waitingOwner).toBeGreaterThanOrEqual(1);
    expect((await getMove(s1.ctx, v1.id)).status).toBe("prepared");
    expect((await getMove(s2.ctx, v2.id)).status).toBe("waiting_owner");
  });
});
