// 14-24 Task 2 (ONB-10; P14-P19, P14-P39; T-14-24-01/02/04): own-domain sending records on
// the fake DNS world over the real PocketBase binary. Once a CDS zone is active: three DKIM
// CNAMEs + send.<d> MX/TXT (+ _dmarc p=none only when absent: 6 or 5 records); the apex SPF is never touched;
// every key joins cds_keys.cds and the accepted email hash is unchanged.
import { formatBind, recordKey, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { withOrgLock } from "../src/content/lock";
import { __clearDemoCacheForTests } from "../src/demo/flag";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeSetSesStatus, fakeWorldGet } from "../src/dns/fake-world";
import { captureTransport } from "../src/email/transport";
import {
  advanceSendingDomains,
  computeAcceptedEmailHash,
  ensureSendingDomain,
  removeSendingDomain,
  SENDING_DMARC_VALUE,
  sendingRecords,
} from "../src/email/sending-domains/ensure";
import { resetSendingDomainsForTests } from "../src/email/sending-domains/factory";
import {
  presetRecords,
  seedFakeDomain,
  switchToCds,
  type FakeDomainPreset,
} from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
const provider = fakeDnsProvider();
let n = 0;
const saved = {
  CDS_ENV: process.env.CDS_ENV,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_SENDING_DOMAINS: process.env.CDS_SENDING_DOMAINS,
};

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  delete process.env.CDS_SENDING_DOMAINS;
  resetSendingDomainsForTests();
});

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetSendingDomainsForTests();
  await inst?.stop();
});

type Setup = {
  orgId: string;
  domain: string;
  zoneId: string;
  zoneRow: string;
  profile: string;
};

async function setup(
  preset: FakeDomainPreset,
  extra: DnsRecord[] = [],
  opts: { demo?: boolean } = {},
): Promise<Setup> {
  n += 1;
  const domain = `send${n}.example`;
  const org = await pb.collection("organizations").create({
    name: `Sending ${n}`,
    slug: `sending-${n}-${Date.now().toString(36)}`,
    status: "active",
    ...(opts.demo ? { demo: true } : {}),
  });
  const profile = await pb
    .collection("business_profile")
    .create({ organization: org.id, hours: {}, sending_local_part: "hello" });
  await seedFakeDomain(domain, preset);
  const { zoneId } = await provider.createZone(domain);
  await provider.importBind(
    zoneId,
    formatBind(domain, [...presetRecords(domain, preset), ...extra]),
  );
  await switchToCds(domain);
  const records = await provider.listRecords(zoneId);
  const zone = await pb.collection("dns_zones").create({
    org_id: org.id,
    domain,
    provider: "fake",
    provider_zone_id: zoneId,
    status: "active",
    cds_keys: { cds: [], owner: [] },
    accepted_email_hash: computeAcceptedEmailHash(records, domain, []),
  });
  return {
    orgId: org.id,
    domain,
    zoneId,
    zoneRow: zone.id,
    profile: profile.id,
  };
}

const apexSpf = (rs: DnsRecord[], d: string) =>
  JSON.stringify(
    rs.filter(
      (r) => r.name === d && r.type === "TXT" && r.value.startsWith("v=spf1"),
    ),
  );

describe("ensureSendingDomain (14-24 choices 4-6)", () => {
  it("writes 6 records (3 DKIM + send. MX/TXT + _dmarc), leaves the apex SPF byte-identical and keeps the email hash", async () => {
    if (!inst) return;
    const s = await setup("google");
    const before = await provider.listRecords(s.zoneId);
    const zoneBefore = await pb.collection("dns_zones").getOne(s.zoneRow);

    const r = await ensureSendingDomain(s.orgId, {
      provider,
      region: "us-east-1",
    });
    expect(r).toBe("written");

    const after = await provider.listRecords(s.zoneId);
    expect(after.length - before.length).toBe(6);
    expect(apexSpf(after, s.domain)).toBe(apexSpf(before, s.domain));
    expect(apexSpf(after, s.domain)).not.toBe("[]");

    const world = await fakeWorldGet(s.domain);
    const expected = sendingRecords(s.domain, world!.ses.tokens, "us-east-1", {
      withDmarc: true,
    });
    const keys = expected.map((x) => recordKey(x));
    const afterKeys = new Set(after.map((x) => recordKey(x)));
    for (const k of keys) expect(afterKeys.has(k)).toBe(true);
    expect(expected.some((x) => x.value === SENDING_DMARC_VALUE)).toBe(true);

    const zone = await pb.collection("dns_zones").getOne(s.zoneRow);
    expect([...zone.cds_keys.cds].sort()).toEqual([...keys].sort());
    expect(zone.accepted_email_hash).toBe(zoneBefore.accepted_email_hash);
    expect(computeAcceptedEmailHash(after, s.domain, zone.cds_keys.cds)).toBe(
      zoneBefore.accepted_email_hash,
    );

    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_domain).toBe(s.domain);
    expect(p.sending_status).toBe("pending");
    expect(p.sending_domain_verified).toBe(false);

    // A second run polls: still pending.
    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("pending");
  });

  it("leaves an existing _dmarc untouched (5 records written)", async () => {
    if (!inst) return;
    const dmarc: DnsRecord = {
      type: "TXT",
      name: "",
      value: "v=DMARC1; p=reject; rua=mailto:dmarc@owner.test",
      ttl: 3600,
    };
    const s0 = n + 1;
    dmarc.name = `_dmarc.send${s0}.example`;
    const s = await setup("google", [dmarc]);
    const before = await provider.listRecords(s.zoneId);
    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("written");
    const after = await provider.listRecords(s.zoneId);
    expect(after.length - before.length).toBe(5);
    const dm = after.filter((r) => r.name === `_dmarc.${s.domain}`);
    expect(dm.map((r) => r.value)).toEqual([dmarc.value]);
  });

  it("verified -> profile verified + flag true", async () => {
    if (!inst) return;
    const s = await setup("none");
    await ensureSendingDomain(s.orgId, { provider });
    await fakeSetSesStatus(s.domain, "verified");
    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("verified");
    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_status).toBe("verified");
    expect(p.sending_domain_verified).toBe(true);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'email.sending_verified'",
        {
          o: s.orgId,
        },
      ),
    });
    expect(audit).toHaveLength(1);
  });

  it("pending 73 h after writing -> failed + one staff alert", async () => {
    if (!inst) return;
    const s = await setup("titan");
    const t0 = new Date("2026-10-01T12:00:00Z");
    await ensureSendingDomain(s.orgId, { provider, now: t0 });
    const transport = captureTransport();
    const at72 = new Date(t0.getTime() + 71 * 3_600_000);
    expect(
      await ensureSendingDomain(s.orgId, { provider, now: at72, transport }),
    ).toBe("pending");
    const at73 = new Date(t0.getTime() + 73 * 3_600_000);
    expect(
      await ensureSendingDomain(s.orgId, { provider, now: at73, transport }),
    ).toBe("failed");
    expect(transport.sent.map((m) => [m.type, m.to])).toEqual([
      ["staff.domain_alert", "staff-alerts@cds.test"],
    ]);
    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_status).toBe("failed");
    // Failed stays failed: no second alert.
    expect(
      await ensureSendingDomain(s.orgId, { provider, now: at73, transport }),
    ).toBe("failed");
    expect(transport.sent).toHaveLength(1);
  });

  it("remove reverts records, keys, identity and profile (local part kept)", async () => {
    if (!inst) return;
    const s = await setup("google");
    const before = await provider.listRecords(s.zoneId);
    const hash0 = (await pb.collection("dns_zones").getOne(s.zoneRow))
      .accepted_email_hash;
    await ensureSendingDomain(s.orgId, { provider });
    await removeSendingDomain(s.orgId, { provider });
    const after = await provider.listRecords(s.zoneId);
    expect(after.map((r) => recordKey(r)).sort()).toEqual(
      before.map((r) => recordKey(r)).sort(),
    );
    const zone = await pb.collection("dns_zones").getOne(s.zoneRow);
    expect(zone.cds_keys.cds).toEqual([]);
    expect(zone.accepted_email_hash).toBe(hash0);
    expect((await fakeWorldGet(s.domain))!.ses.status).toBe("none");
    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_domain).toBe("");
    expect(p.sending_status).toBe("none");
    expect(p.sending_domain_verified).toBe(false);
    expect(p.sending_local_part).toBe("hello");
  });

  it("WR-A08: an owner key written while the job runs is kept (both take the org lock)", async () => {
    if (!inst) return;
    const s = await setup("google");
    const ownerKey = "CNAME verify.example x ";
    let reached!: () => void;
    const atList = new Promise<void>((r) => (reached = r));
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    // The job pauses at its first zone listing, after it has read the zone row.
    const slow = {
      ...provider,
      listRecords: async (id: string) => {
        reached();
        await gate;
        return provider.listRecords(id);
      },
    };
    const job = ensureSendingDomain(s.orgId, { provider: slow });
    await atList;
    // An owner record flow: read-modify-write of cds_keys under the org lock.
    const owner = withOrgLock(s.orgId, async () => {
      const z = await pb.collection("dns_zones").getOne(s.zoneRow);
      await pb.collection("dns_zones").update(s.zoneRow, {
        cds_keys: { ...z.cds_keys, owner: [...z.cds_keys.owner, ownerKey] },
      });
    });
    await new Promise((r) => setTimeout(r, 150));
    open();
    expect(await job).toBe("written");
    await owner;
    const zone = await pb.collection("dns_zones").getOne(s.zoneRow);
    expect(zone.cds_keys.owner).toEqual([ownerKey]);
    expect(zone.cds_keys.cds.length).toBeGreaterThan(0);
  });

  it("WR-A09: a new active domain removes the old SES identity and the old zone's sending records", async () => {
    if (!inst) return;
    const s = await setup("google");
    const before = await provider.listRecords(s.zoneId);
    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("written");
    expect((await fakeWorldGet(s.domain))!.ses.status).not.toBe("none");

    // A post-launch move: the new domain's zone is the org's active one now.
    n += 1;
    const next = `send${n}.example`;
    await seedFakeDomain(next, "google");
    const { zoneId } = await provider.createZone(next);
    await provider.importBind(
      zoneId,
      formatBind(next, presetRecords(next, "google")),
    );
    await switchToCds(next);
    await pb.collection("dns_zones").update(s.zoneRow, { status: "moved" });
    await pb.collection("dns_zones").create({
      org_id: s.orgId,
      domain: next,
      provider: "fake",
      provider_zone_id: zoneId,
      status: "active",
      cds_keys: { cds: [], owner: [] },
      accepted_email_hash: computeAcceptedEmailHash(
        await provider.listRecords(zoneId),
        next,
        [],
      ),
    });

    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("written");
    // The old identity is gone and the old zone is back to what it was.
    expect((await fakeWorldGet(s.domain))!.ses.status).toBe("none");
    const old = await provider.listRecords(s.zoneId);
    expect(old.map((r) => recordKey(r)).sort()).toEqual(
      before.map((r) => recordKey(r)).sort(),
    );
    expect(
      (await pb.collection("dns_zones").getOne(s.zoneRow)).cds_keys.cds,
    ).toEqual([]);
    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_domain).toBe(next);
    expect(p.sending_status).toBe("pending");
  });

  it("skips the demo org and an org without an active zone", async () => {
    if (!inst) return;
    const s = await setup("google", [], { demo: true });
    __clearDemoCacheForTests();
    const before = await provider.listRecords(s.zoneId);
    expect(await ensureSendingDomain(s.orgId, { provider })).toBe("skipped");
    expect(await provider.listRecords(s.zoneId)).toHaveLength(before.length);

    const t = await setup("google");
    await pb.collection("dns_zones").update(t.zoneRow, { status: "pending" });
    expect(await ensureSendingDomain(t.orgId, { provider })).toBe("skipped");
  });

  it("production with CDS_SENDING_DOMAINS unset (closed) writes nothing", async () => {
    if (!inst) return;
    const s = await setup("google");
    const before = await provider.listRecords(s.zoneId);
    process.env.CDS_ENV = "production";
    try {
      expect(await ensureSendingDomain(s.orgId)).toBe("skipped");
      expect(await advanceSendingDomains()).toEqual({
        updated: 0,
        verified: 0,
        failed: 0,
      });
    } finally {
      if (saved.CDS_ENV === undefined) delete process.env.CDS_ENV;
      else process.env.CDS_ENV = saved.CDS_ENV;
    }
    expect(await provider.listRecords(s.zoneId)).toHaveLength(before.length);
    const p = await pb.collection("business_profile").getOne(s.profile);
    expect(p.sending_status || "none").toBe("none");
  });

  it("advanceSendingDomains writes, then verifies, skipping verified orgs", async () => {
    if (!inst) return;
    const s = await setup("zoho");
    const dry = await advanceSendingDomains({
      dryRun: true,
      deps: { provider },
    });
    expect(dry.updated).toBeGreaterThanOrEqual(1);
    expect(
      (await pb.collection("business_profile").getOne(s.profile))
        .sending_status || "none",
    ).toBe("none");
    const first = await advanceSendingDomains({ deps: { provider } });
    expect(first.updated).toBeGreaterThanOrEqual(1);
    await fakeSetSesStatus(s.domain, "verified");
    const second = await advanceSendingDomains({ deps: { provider } });
    expect(second.verified).toBeGreaterThanOrEqual(1);
    expect(
      (await pb.collection("business_profile").getOne(s.profile))
        .sending_status,
    ).toBe("verified");
  });
});
