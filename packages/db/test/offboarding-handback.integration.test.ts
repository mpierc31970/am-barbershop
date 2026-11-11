// 14-40 (LIFE-01, DOM-05 in reverse; D282, D58, D-UI-P14-22; P14-P34; T-14-40-01..04): the DNS
// handback on the real PocketBase binary over the fake DNS world. The CDS zone is grouped
// (copy exactly / points to CDS / remove), the reverse gate asks the destination's own
// nameservers before the switch (or public DNS after it), the zone is deleted only once the
// delegation moved away and the check passed (or 30 days later), the data download carries
// dns/zone.txt, and an org B owner never reaches org A's handback.
import "@cds/addon-registry/server";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { P14_COPY, recordKey, type DnsRecord } from "@cds/core/dns";
import { unzipSync, strFromU8 } from "fflate";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import {
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeWorldGet, fakeWorldPatch } from "../src/dns/fake-world";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { upsertDnsZoneRow } from "../src/dns/snapshot";
import {
  requestDataDownload,
  runDataDownloads,
} from "../src/downloads/data-download";
import {
  advanceHandbacks,
  checkHandbackDestination,
  chooseHandbackDestination,
  confirmHandbackSwitched,
  exportZoneFile,
  groupHandbackRecords,
  handbackView,
  handbackZoneFile,
  resetHandbackLimitsForTests,
} from "../src/offboarding/handback";
import { startOffboarding } from "../src/offboarding/offboardings";
import {
  staffCancelOffboarding,
  staffOffboardingView,
  staffRerunHandback,
  staffStartOffboarding,
} from "../src/offboarding/staff";
import { startCase, statusLines } from "../scripts/org-offboard";
import { LocalDiskStore } from "../src/storage/local-disk";
import {
  FAKE_OLD_NAMESERVERS,
  FAKE_OTHER_NAMESERVERS,
  presetRecords,
  seedFakeDomain,
  switchBack,
  switchToCds,
  switchToOther,
} from "./helpers/fake-dns-world";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let superAdmin: PlatformContext;
let supportAgent: PlatformContext;
let storageDir = "";
const provider = fakeDnsProvider();
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
};
const NOW = new Date("2026-10-17T15:00:00.000Z");
const DAY = 86_400_000;
const later = (days: number) => new Date(NOW.getTime() + days * DAY);
const EDGE = "198.18.0.99";
const SYS = mintSystemContext({ job: "test" });

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-handback-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  resetDnsForTests();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  const t = randomBytes(3).toString("hex");
  superAdmin = await staffContext(
    booted.inst,
    `hb-super-${t}@cds.test`,
    "super_admin",
  );
  supportAgent = await staffContext(
    booted.inst,
    `hb-agent-${t}@cds.test`,
    "support_agent",
  );
}, 60_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await booted?.inst.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

beforeEach(() => resetHandbackLimitsForTests());

let n = 0;
const tag = () => randomBytes(4).toString("hex");

type Site = {
  org: string;
  domain: string;
  zoneId: string;
  zoneRowId: string;
  owner: OrgContext;
  admin: OrgContext;
};

/** The old host's Google mail records (no site records). */
function googleMail(d: string): DnsRecord[] {
  return presetRecords(d, "google").filter(
    (r) => !(r.type === "A" || r.type === "CNAME"),
  );
}

/** What CDS added: the site records, an SES DKIM and the Let's Encrypt CAA. */
function cdsRecords(d: string): DnsRecord[] {
  return [
    { type: "A", name: d, value: EDGE, ttl: 300 },
    { type: "CNAME", name: `www.${d}`, value: d, ttl: 300 },
    {
      type: "CNAME",
      name: `abc123._domainkey.${d}`,
      value: "abc123.dkim.amazonses.com",
      ttl: 3600,
    },
    { type: "CAA", name: d, value: '0 issue "letsencrypt.org"', ttl: 3600 },
  ];
}

const SOA = (d: string): DnsRecord => ({
  type: "SOA",
  name: d,
  value: `ns1.otherhost.test. hostmaster.${d}. 1 7200 3600 1209600 300`,
});

/** An org leaving CDS with an active CDS zone: Google mail + CDS's site/SES/CAA records. */
async function site(opts: { start?: boolean } = {}): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Handback ${n}`,
      slug: `handback-${n}-${t}`,
      status: "active",
      stage: "live",
    })
  ).id;
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const id = (
      await pb.collection("users").create({
        email: `${role}-hb-${t}@cds.test`,
        password,
        passwordConfirm: password,
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return id;
  };
  const ownerId = await member("owner");
  const adminId = await member("admin");
  const domain = `handback-${n}-${t}.test`;
  await seedFakeDomain(domain, "google", {}, NOW);
  const zone = await provider.createZone(domain);
  for (const r of [...googleMail(domain), ...cdsRecords(domain)]) {
    await provider.upsertRecord(zone.zoneId, r);
  }
  await switchToCds(domain);
  const cdsKeys = cdsRecords(domain).map((r) => recordKey(r));
  const row = await upsertDnsZoneRow(org, domain, {
    status: "active",
    provider: "fake",
    provider_zone_id: zone.zoneId,
    nameservers: zone.nameservers,
    original_nameservers: [...FAKE_OLD_NAMESERVERS],
    registrar: "GoDaddy",
    cds_keys: { cds: cdsKeys, owner: [] },
  });
  const mk = (actor: string, role: "owner" | "admin") =>
    mintOrgContext({ orgId: org, actor, role, grants: [], ip: "1.1.1.1" });
  if (opts.start !== false) {
    await startOffboarding(
      superAdmin,
      org,
      { reason: "Test handback" },
      { now: NOW },
    );
  }
  return {
    org,
    domain,
    zoneId: zone.zoneId,
    zoneRowId: row.id,
    owner: mk(ownerId, "owner"),
    admin: mk(adminId, "admin"),
  };
}

/** The destination host's zone: the Google mail records, the old site, optionally an SOA. */
async function otherHas(
  s: Site,
  opts: { soa: boolean; dropDkim?: boolean },
): Promise<void> {
  const mail = googleMail(s.domain).filter(
    (r) => !(opts.dropDkim && r.name.includes("_domainkey")),
  );
  await fakeWorldPatch(s.domain, {
    otherZone: [
      ...presetRecords(s.domain, "none"),
      ...mail,
      ...(opts.soa ? [SOA(s.domain)] : []),
    ],
  });
}

async function zoneRow(s: Site) {
  return pb.collection("dns_zones").getOne(s.zoneRowId);
}

async function offSteps(org: string) {
  const r = await pb
    .collection("offboardings")
    .getFirstListItem(pb.filter("org_id = {:o}", { o: org }));
  return r.steps as Record<string, { status: string }>;
}

async function audits(org: string, action: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action = {:a}", {
      o: org,
      a: action,
    }),
  });
}

const other = (): [string, string] => [
  FAKE_OTHER_NAMESERVERS[0]!,
  FAKE_OTHER_NAMESERVERS[1]!,
];

describe("handback export and groups (choice 1)", () => {
  it("groups the CDS zone and writes the zone file to the org's handback prefix", async () => {
    if (!booted) return;
    const s = await site();
    const view = await handbackView(s.owner);
    expect(view.zones).toHaveLength(1);
    const z = view.zones[0]!;
    expect(z.status).toBe("open");
    expect(z.results).toEqual([]);
    expect(z.groups.copy_exactly.map((r) => r.type)).toEqual([
      "MX",
      "TXT",
      "TXT",
      "TXT",
    ]);
    expect(z.groups.copy_exactly[0]!.type).toBe("MX");
    expect(
      z.groups.copy_exactly.some((r) => r.name.includes("google._domainkey")),
    ).toBe(true);
    expect(z.groups.points_to_cds.map((r) => r.type).sort()).toEqual([
      "A",
      "CNAME",
    ]);
    expect(z.groups.remove.map((r) => r.type).sort()).toEqual(["CAA", "CNAME"]);
    expect(z.cdsNameservers.length).toBe(2);

    const file = await exportZoneFile(s.org, s.zoneRowId, { now: NOW });
    expect(file.key).toContain(`tenants/${s.org}/dns/handback/${s.domain}-`);
    expect(file.text).toContain(
      "Points to CDS: change when your new site is ready",
    );
    expect(file.text).toContain("CDS sending records: remove");
    expect(file.text).toContain("google._domainkey");
    expect(file.text).toContain("$ORIGIN");
    // Another org's zone row id is NotFound (T-14-40-04).
    const b = await site({ start: false });
    await expect(exportZoneFile(b.org, s.zoneRowId)).rejects.toBeInstanceOf(
      NotFound,
    );
    const dl = await handbackZoneFile(s.admin, undefined, s.domain);
    expect(dl.filename).toBe(`${s.domain}-zone.txt`);

    // Pure grouping: no cds_keys -> everything is copy exactly.
    const g = groupHandbackRecords(s.domain, cdsRecords(s.domain), []);
    expect(g.copy_exactly).toHaveLength(4);
  });
});

describe("reverse gate before the switch (choices 2-3)", () => {
  it("another host with a full copy is ready to switch; one DKIM missing is a mismatch", async () => {
    if (!booted) return;
    const s = await site();
    await otherHas(s, { soa: true });
    const ok = await chooseHandbackDestination(s.owner, undefined, s.domain, {
      kind: "other",
      nameservers: other(),
    });
    expect(ok.status).toBe("ready_to_switch");
    expect(ok.canCheckBefore).toBe(true);
    expect(ok.destination).toBe("other");
    expect(ok.results).toHaveLength(4);
    expect(ok.results.every((r) => r.found)).toBe(true);
    expect(ok.checkPassed).toBe(true);
    expect(
      await audits(s.org, "offboarding.handback_destination"),
    ).toHaveLength(1);

    // The DKIM goes missing at the destination: mismatch, switch not offered.
    await otherHas(s, { soa: true, dropDkim: true });
    const bad = await checkHandbackDestination(s.owner, undefined, s.domain);
    expect(bad.status).toBe("mismatch");
    expect(bad.emailMissing).toBe(1);
    expect(bad.message).toBe(P14_COPY.HANDBACK_MISMATCH({ count: 1 }));
    expect(bad.results.filter((r) => !r.found)).toHaveLength(1);
    await expect(
      confirmHandbackSwitched(s.owner, undefined, s.domain),
    ).rejects.toBeInstanceOf(InvalidInput);

    // Fixed: ready again, then "I've changed them" -> waiting.
    await otherHas(s, { soa: true });
    expect(
      (await checkHandbackDestination(s.owner, undefined, s.domain)).status,
    ).toBe("ready_to_switch");
    const w = await confirmHandbackSwitched(s.owner, undefined, s.domain);
    expect(w.status).toBe("waiting");
    expect(w.switchedAt).not.toBeNull();
  });

  it("refuses bad nameservers, CDS's own, an Admin and a support agent's destination choice", async () => {
    if (!booted) return;
    const s = await site();
    await expect(
      chooseHandbackDestination(s.owner, undefined, s.domain, {
        kind: "other",
        nameservers: ["not a host", "ns2.otherhost.test"],
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    const z = (await handbackView(s.owner)).zones[0]!;
    await expect(
      chooseHandbackDestination(s.owner, undefined, s.domain, {
        kind: "other",
        nameservers: [z.cdsNameservers[0]!, "ns2.otherhost.test"],
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      chooseHandbackDestination(s.admin, undefined, s.domain, {
        kind: "registrar",
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      chooseHandbackDestination(supportAgent, s.org, s.domain, {
        kind: "registrar",
      }),
    ).rejects.toBeInstanceOf(Forbidden);
    // Not leaving: refused.
    const idle = await site({ start: false });
    await expect(
      chooseHandbackDestination(idle.owner, undefined, idle.domain, {
        kind: "registrar",
      }),
    ).rejects.toThrow("Leaving CDS hasn't started");
  });

  it("CR-A02: refuses the registrar destination when the recorded original nameservers are CDS's own", async () => {
    if (!booted) return;
    const s = await site();
    const row = await zoneRow(s);
    await pb.collection("dns_zones").update(s.zoneRowId, {
      original_nameservers: row.nameservers,
    });
    await expect(
      chooseHandbackDestination(s.owner, undefined, s.domain, {
        kind: "registrar",
      }),
    ).rejects.toThrow("We don't know your registrar's nameservers");
  });
});

describe("after the switch (choices 3-4)", () => {
  it("registrar DNS: checked after the switch, done, checklist unlocked, zone deleted", async () => {
    if (!booted) return;
    const s = await site();
    const before = await offSteps(s.org);
    expect(before.dns_handback!.status).toBe("open");
    expect(before.download!.status).toBe("locked");

    const v = await chooseHandbackDestination(s.owner, undefined, s.domain, {
      kind: "registrar",
    });
    expect(v.destinationNameservers).toEqual([...FAKE_OLD_NAMESERVERS]);
    expect(v.canCheckBefore).toBe(false);
    expect(v.status).toBe("ready_to_switch");
    expect(v.message).toBe(P14_COPY.HANDBACK_AFTER({ registrar: "GoDaddy" }));
    await confirmHandbackSwitched(s.owner, undefined, s.domain);

    // Still delegated to CDS: never deleted, whatever the date (T-14-40-03).
    await advanceHandbacks({ now: later(40) });
    expect((await zoneRow(s)).status).toBe("active");
    expect((await fakeWorldGet(s.domain))!.cdsZoneId).toBe(s.zoneId);

    await switchBack(s.domain);
    const res = await advanceHandbacks({ now: NOW });
    expect(res.done).toBeGreaterThanOrEqual(1);
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    const row = await zoneRow(s);
    expect(row.status).toBe("deleted");
    expect(row.handback.status).toBe("done");
    expect(row.handback.checkPassed).toBe(true);
    expect((await fakeWorldGet(s.domain))!.cdsZoneId).toBeNull();
    const steps = await offSteps(s.org);
    expect(steps.dns_handback!.status).toBe("done");
    expect(steps.download!.status).toBe("open");
    expect(steps.close!.status).toBe("open");
    expect(steps.zone_deleted!.status).toBe("done");
    expect(await audits(s.org, "offboarding.zone_deleted")).toHaveLength(1);
    // The done handback still shows after the zone is gone.
    const after = await handbackView(s.owner);
    expect(after.zones[0]!.status).toBe("done");
    expect(after.zones[0]!.message).toBe(P14_COPY.HANDBACK_DONE);
  });

  it("a mismatch after the switch keeps the zone; switching back keeps it; fixed -> done", async () => {
    if (!booted) return;
    const s = await site();
    await otherHas(s, { soa: false, dropDkim: true });
    const v = await chooseHandbackDestination(s.owner, undefined, s.domain, {
      kind: "other",
      nameservers: other(),
    });
    expect(v.canCheckBefore).toBe(false);
    expect(v.status).toBe("ready_to_switch");
    await confirmHandbackSwitched(s.owner, undefined, s.domain);
    await switchToOther(s.domain);

    const r1 = await advanceHandbacks({ now: NOW });
    expect(r1.mismatches).toBeGreaterThanOrEqual(1);
    let row = await zoneRow(s);
    expect(row.status).toBe("active");
    expect(row.handback.status).toBe("mismatch");
    expect(row.handback.movedAwayAt).toBeTruthy();
    expect((await fakeWorldGet(s.domain))!.cdsZoneId).toBe(s.zoneId);
    expect(await audits(s.org, "offboarding.handback_mismatch")).toHaveLength(
      1,
    );
    const mv = (await handbackView(s.owner)).zones[0]!;
    expect(mv.status).toBe("mismatch");
    expect(mv.cdsNameservers.length).toBe(2);
    expect((await offSteps(s.org)).dns_handback!.status).toBe("open");

    // Switch back to CDS: the zone stays, the 30-day clock resets.
    await switchToCds(s.domain);
    await advanceHandbacks({ now: later(1) });
    row = await zoneRow(s);
    expect(row.status).toBe("active");
    expect(row.handback.movedAwayAt).toBeFalsy();
    await advanceHandbacks({ now: later(45) });
    expect((await zoneRow(s)).status).toBe("active");

    // DKIM added at the new host, switch again: done and deleted.
    await otherHas(s, { soa: false });
    await switchToOther(s.domain);
    await advanceHandbacks({ now: later(2) });
    row = await zoneRow(s);
    expect(row.status).toBe("deleted");
    expect(row.handback.status).toBe("done");
    expect((await offSteps(s.org)).dns_handback!.status).toBe("done");
  });

  it("deletes the zone 30 days after the move away even when the check never passed", async () => {
    if (!booted) return;
    const s = await site();
    await otherHas(s, { soa: false, dropDkim: true });
    await chooseHandbackDestination(s.owner, undefined, s.domain, {
      kind: "other",
      nameservers: other(),
    });
    await switchToOther(s.domain);
    await advanceHandbacks({ now: NOW });
    expect((await zoneRow(s)).status).toBe("active");
    await advanceHandbacks({ now: later(29) });
    expect((await zoneRow(s)).status).toBe("active");
    // A dry run counts, writes nothing.
    const dry = await advanceHandbacks({ now: later(31), dryRun: true });
    expect(dry.deleted).toBeGreaterThanOrEqual(1);
    expect((await zoneRow(s)).status).toBe("active");
    await advanceHandbacks({ now: later(31) });
    const row = await zoneRow(s);
    expect(row.status).toBe("deleted");
    expect(row.handback.status).toBe("mismatch");
    expect((await offSteps(s.org)).zone_deleted!.status).toBe("done");
  });
});

describe("data download (choice 5)", () => {
  it("the zip gains dns/zone.txt while a CDS zone exists; a failed export adds a README line", async () => {
    if (!booted) return;
    const root = await mkdtemp(join(tmpdir(), "cds-hb-store-"));
    const store = new LocalDiskStore(root);
    try {
      const s = await site({ start: false });
      const { id } = await requestDataDownload(s.owner, {
        run: false,
        now: NOW,
        store,
      });
      await runDataDownloads(SYS, { org: s.org, store, now: NOW });
      const r = await pb.collection("data_exports").getOne(id);
      expect(r.status).toBe("ready");
      const files = unzipSync((await store.get(r.object_key))!);
      expect(Object.keys(files)).toContain("dns/zone.txt");
      expect(strFromU8(files["dns/zone.txt"]!)).toContain("google._domainkey");
      expect(strFromU8(files["README.txt"]!)).toContain("dns/zone.txt");

      // A zone the provider can't export: no file, a README line, the zip still builds.
      const b = await site({ start: false });
      await pb
        .collection("dns_zones")
        .update(b.zoneRowId, { provider_zone_id: "fz_missing" });
      const { id: id2 } = await requestDataDownload(b.owner, {
        run: false,
        now: NOW,
        store,
      });
      await runDataDownloads(SYS, { org: b.org, store, now: NOW });
      const r2 = await pb.collection("data_exports").getOne(id2);
      expect(r2.status).toBe("ready");
      const files2 = unzipSync((await store.get(r2.object_key))!);
      expect(Object.keys(files2)).not.toContain("dns/zone.txt");
      expect(strFromU8(files2["README.txt"]!)).toContain(
        "couldn't be added this time",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("org scoping (P14-P34)", () => {
  it("an org B owner gets NotFound for org A's id or domain and changes nothing", async () => {
    if (!booted) return;
    const a = await site();
    const b = await site();
    const before = (await zoneRow(a)).handback;
    const attempts: (() => Promise<unknown>)[] = [
      () => handbackView(b.owner, a.org),
      () =>
        chooseHandbackDestination(b.owner, a.org, a.domain, {
          kind: "registrar",
        }),
      () =>
        chooseHandbackDestination(b.owner, undefined, a.domain, {
          kind: "registrar",
        }),
      () => checkHandbackDestination(b.owner, a.org, a.domain),
      () => checkHandbackDestination(b.owner, undefined, a.domain),
      () => confirmHandbackSwitched(b.owner, a.org, a.domain),
      () => confirmHandbackSwitched(b.owner, undefined, a.domain),
      () => handbackZoneFile(b.owner, undefined, a.domain),
    ];
    for (const run of attempts) {
      await expect(Promise.resolve().then(run)).rejects.toBeInstanceOf(
        NotFound,
      );
    }
    expect((await zoneRow(a)).handback).toEqual(before);
    expect(
      await audits(a.org, "offboarding.handback_destination"),
    ).toHaveLength(0);
  });
});

describe("staff offboarding (choices 6-7)", () => {
  it("support agents view and re-run; only a super_admin starts or cancels, with a reason", async () => {
    if (!booted) return;
    const s = await site({ start: false });
    const idle = await staffOffboardingView(supportAgent, s.org, { now: NOW });
    expect(idle.offboarding).toBeNull();
    expect(idle.handbackNeeded).toBe(true);
    expect(statusLines(idle)).toEqual([
      P14_COPY.STAFF_NOT_LEAVING({ business: idle.business }),
    ]);
    expect(startCase(idle).join(" | ")).toContain(
      "DNS handback:    needed (CDS zone active)",
    );

    await expect(
      staffStartOffboarding(supportAgent, s.org, { reason: "Owner asked" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      staffStartOffboarding(superAdmin, s.org, { reason: "no" }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffStartOffboarding(superAdmin, "zzzzzzzzzzzzzzz", {
        reason: "Owner asked",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    const started = await staffStartOffboarding(
      superAdmin,
      s.org,
      { reason: "Owner asked by phone" },
      { now: NOW },
    );
    expect(started.status).toBe("notice");
    expect(await audits(s.org, "offboarding.started")).toHaveLength(1);

    const v = await staffOffboardingView(supportAgent, s.org, {
      now: later(7),
    });
    const lines = statusLines(v);
    expect(lines).toContain("Notice ends 2026-11-16 (23 days)");
    expect(lines.some((l) => l.startsWith("[open]") && l.includes("DNS"))).toBe(
      true,
    );
    expect(lines.some((l) => l.startsWith("[locked]"))).toBe(true);
    expect(lines.some((l) => l.startsWith("DNS handback " + s.domain))).toBe(
      true,
    );

    // Re-run before a destination: refused; after one: both roles, audited.
    await expect(
      staffRerunHandback(supportAgent, s.org),
    ).rejects.toBeInstanceOf(InvalidInput);
    await chooseHandbackDestination(s.owner, undefined, s.domain, {
      kind: "registrar",
    });
    const rerun = await staffRerunHandback(supportAgent, s.org);
    expect(rerun.map((z) => z.status)).toEqual(["ready_to_switch"]);
    expect(await audits(s.org, "offboarding.handback_rerun")).toHaveLength(1);

    await expect(
      staffCancelOffboarding(supportAgent, s.org, "Changed mind"),
    ).rejects.toBeInstanceOf(Forbidden);
    const c = await staffCancelOffboarding(superAdmin, s.org, "Changed mind", {
      now: later(1),
    });
    expect(c.view.status).toBe("cancelled");
    expect(await audits(s.org, "offboarding.cancelled")).toHaveLength(1);
  });
});
