// 14-28 (DOM-03; T-14-28-01..04, P14-P34): owner DNS self-service on the real PocketBase
// binary over the fake DNS world: the classified read view, verification add/remove, roles,
// impersonation, guided email setup (Google over Zoho) and the main-address choice.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, NotFound } from "@cds/core";
import { P14_COPY, recordKey, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import {
  OwnerRecordRefused,
  ownerAddRecord,
  ownerApplyEmailSetup,
  ownerDnsRecords,
  ownerEmailSetupPreview,
  ownerRemoveRecord,
  ownerSetPrimaryChoice,
} from "../src/dns/records";
import { readDnsZoneRow, upsertDnsZoneRow } from "../src/dns/snapshot";
import { computeAcceptedEmailHash } from "../src/email/sending-domains/ensure";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
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
const saved = { CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR };

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-dns-records-"));
  process.env.CDS_STORAGE_DIR = storageDir;
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
  domain: string;
  zoneId: string;
  ctx: OrgContext;
  admin: OrgContext;
  impersonated: OrgContext;
};

const SES_DKIM = (d: string): DnsRecord => ({
  type: "CNAME",
  name: `abc123._domainkey.${d}`,
  value: "abc123.dkim.amazonses.com",
  ttl: 3600,
});

/** An org with an active CDS zone holding the preset's records plus one CDS SES record. */
async function site(
  preset: FakeDomainPreset,
  opts: { live?: boolean; records?: (d: string) => DnsRecord[] } = {},
): Promise<Site> {
  n += 1;
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Records ${n}`,
      slug: `records-${n}-${t}`,
      status: "active",
      ...(opts.live ? { stage: "live" } : {}),
    })
  ).id;
  const member = async (role: string) => {
    const password = randomBytes(18).toString("hex");
    const id = (
      await pb.collection("users").create({
        email: `${role}-${t}@cds.test`,
        password,
        passwordConfirm: password,
      })
    ).id;
    await pb
      .collection("memberships")
      .create({ user: id, organization: org, role });
    return id;
  };
  const owner = await member("owner");
  const admin = await member("admin");
  const domain = `records-${n}-${t}.test`;
  await seedFakeDomain(domain, preset);
  const zone = await provider.createZone(domain);
  const ses = SES_DKIM(domain);
  for (const r of opts.records?.(domain) ?? [
    ...presetRecords(domain, preset),
    ses,
  ]) {
    await provider.upsertRecord(zone.zoneId, r);
  }
  await switchToCds(domain);
  const listed = await provider.listRecords(zone.zoneId);
  const cdsKeys = listed
    .filter((r) => r.name === ses.name)
    .map((r) => recordKey(r));
  await upsertDnsZoneRow(org, domain, {
    status: "active",
    provider: "fake",
    provider_zone_id: zone.zoneId,
    nameservers: zone.nameservers,
    cds_keys: { cds: cdsKeys, owner: [] },
    accepted_email_hash: computeAcceptedEmailHash(listed, domain, cdsKeys),
  });
  const mk = (actor: string, role: "owner" | "admin", imp?: string) =>
    mintOrgContext({
      orgId: org,
      actor,
      role,
      grants: [],
      ip: "1.1.1.1",
      ...(imp ? { impersonator: imp } : {}),
    });
  return {
    org,
    owner,
    domain,
    zoneId: zone.zoneId,
    ctx: mk(owner, "owner"),
    admin: mk(admin, "admin"),
    impersonated: mk(owner, "owner", staffUser),
  };
}

async function audits(org: string, action: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org} && action = {:a}", {
      org,
      a: action,
    }),
    sort: "created",
  });
}

async function refusal(p: Promise<unknown>): Promise<OwnerRecordRefused> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OwnerRecordRefused);
  return err as OwnerRecordRefused;
}

const VERIFY = "google-site-verification=abcdefghij0123456789";

describe("owner DNS records (14-28)", () => {
  it("lists every record grouped and labelled", async () => {
    if (!inst) return;
    const s = await site("google");
    const view = await ownerDnsRecords(s.ctx);
    expect(view).not.toBeNull();
    expect(view!.domain).toBe(s.domain);
    expect(view!.canEdit).toBe(true);
    expect(view!.groups.map((g) => g.key)).toEqual([
      "email",
      "verification",
      "site",
      "sending",
      "other",
    ]);
    const g = Object.fromEntries(view!.groups.map((x) => [x.key, x.records]));
    expect(g.email!.map((r) => r.type).sort()).toEqual(["MX", "TXT", "TXT"]);
    expect(g.email!.every((r) => r.label === "email" && !r.removable)).toBe(
      true,
    );
    expect(g.verification!.map((r) => r.value)).toEqual([
      "google-site-verification=fakeverification123",
    ]);
    expect(g.verification![0]!.label).toBe("yours");
    expect(g.verification![0]!.removable).toBe(true);
    expect(g.site!.map((r) => r.type).sort()).toEqual(["A", "CNAME"]);
    expect(g.site!.every((r) => r.label === "cds" && !r.removable)).toBe(true);
    expect(g.sending!.map((r) => r.name)).toEqual([
      `abc123._domainkey.${s.domain}`,
    ]);
    expect(g.sending![0]!.label).toBe("cds");
    expect(g.other).toEqual([]);

    // Admin reads the same list, without edit rights.
    const adminView = await ownerDnsRecords(s.admin);
    expect(adminView!.canEdit).toBe(false);
    expect(adminView!.groups).toEqual(view!.groups);
  });

  it("returns null without a zone", async () => {
    if (!inst) return;
    const s = await site("none");
    await pb
      .collection("dns_zones")
      .update((await readDnsZoneRow(s.org, s.domain))!.id, {
        status: "deleted",
      });
    expect(await ownerDnsRecords(s.ctx)).toBeNull();
  });

  it("adds a verification TXT (audited without its value) and removes it", async () => {
    if (!inst) return;
    const s = await site("google");
    const row = await ownerAddRecord(s.ctx, {
      type: "TXT",
      name: "@",
      value: `"${VERIFY}"`,
    });
    expect(row).toMatchObject({
      type: "TXT",
      name: s.domain,
      value: VERIFY,
      label: "yours",
      removable: true,
      pending: true,
    });
    const [added] = await audits(s.org, "dns.record_added");
    expect(added!.meta).toEqual({ type: "TXT", name: s.domain });
    expect(JSON.stringify(added!.meta)).not.toContain(VERIFY);
    expect(added!.actor).toBe(s.owner);

    // A site A record can never be removed.
    const view = await ownerDnsRecords(s.ctx);
    const siteA = view!.groups
      .find((g) => g.key === "site")!
      .records.find((r) => r.type === "A")!;
    const r1 = await refusal(ownerRemoveRecord(s.ctx, siteA.id));
    expect(r1.reason).toBe("protected");
    // Nor an email record.
    const mx = view!.groups
      .find((g) => g.key === "email")!
      .records.find((r) => r.type === "MX")!;
    await refusal(ownerRemoveRecord(s.ctx, mx.id));

    await ownerRemoveRecord(s.ctx, row.id);
    const after = await provider.listRecords(s.zoneId);
    expect(after.some((r) => r.value === VERIFY)).toBe(false);
    expect(after.some((r) => r.id === siteA.id)).toBe(true);
    const [removed] = await audits(s.org, "dns.record_removed");
    expect(removed!.meta).toEqual({ type: "TXT", name: s.domain });
  });

  it("refuses protected names, SPF and email-class records", async () => {
    if (!inst) return;
    const s = await site("google");
    const r1 = await refusal(
      ownerAddRecord(s.ctx, {
        type: "CNAME",
        name: "@",
        value: "elsewhere.example.com",
      }),
    );
    expect(r1.reason).toBe("protected");
    expect(r1.message).toBe(P14_COPY.REC_PROTECTED);
    const r2 = await refusal(
      ownerAddRecord(s.ctx, {
        type: "TXT",
        name: "@",
        value: "v=spf1 include:evil.example ~all",
      }),
    );
    expect(r2.reason).toBe("spf");
    expect(r2.message).toBe(P14_COPY.REC_SPF);
    // `_bimi` passes the name policy but reads as email: the class re-check refuses it.
    const r3 = await refusal(
      ownerAddRecord(s.ctx, {
        type: "TXT",
        name: "default._bimi",
        value: "v=BIMI1; l=https://x.example/l.svg",
      }),
    );
    expect(r3.reason).toBe("class");
    expect(await audits(s.org, "dns.record_added")).toHaveLength(0);
  });

  it("an owner-added CNAME is removable; Admin may not write", async () => {
    if (!inst) return;
    const s = await site("none");
    const row = await ownerAddRecord(s.ctx, {
      type: "CNAME",
      name: "em123",
      value: "u123.wl.sendgrid.net.",
    });
    expect(row).toMatchObject({ type: "CNAME", removable: true });
    const zone = await readDnsZoneRow(s.org, s.domain);
    expect(zone!.cdsKeys.owner).toHaveLength(1);
    const view = await ownerDnsRecords(s.ctx);
    const ver = view!.groups.find((g) => g.key === "verification")!.records;
    expect(ver.map((r) => r.name)).toEqual([`em123.${s.domain}`]);

    await expect(
      ownerAddRecord(s.admin, { type: "TXT", name: "@", value: VERIFY }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(ownerRemoveRecord(s.admin, row.id)).rejects.toBeInstanceOf(
      Forbidden,
    );

    await ownerRemoveRecord(s.ctx, row.id);
    expect((await readDnsZoneRow(s.org, s.domain))!.cdsKeys.owner).toEqual([]);
  });

  it("impersonating staff may write and are audited as staff", async () => {
    if (!inst) return;
    const s = await site("google");
    await ownerAddRecord(s.impersonated, {
      type: "TXT",
      name: "@",
      value: VERIFY,
    });
    const [row] = await audits(s.org, "dns.record_added");
    expect(row!.impersonator).toBe(staffUser);
  });

  it("org B cannot remove org A's record (P14-P34)", async () => {
    if (!inst) return;
    const a = await site("google");
    const b = await site("none", {
      records: (d) => [{ type: "A", name: d, value: "198.18.0.10", ttl: 3600 }],
    });
    const added = await ownerAddRecord(a.ctx, {
      type: "TXT",
      name: "@",
      value: VERIFY,
    });
    const bListing = await provider.listRecords(b.zoneId);
    expect(bListing.some((r) => r.id === added.id)).toBe(false);
    await expect(ownerRemoveRecord(b.ctx, added.id)).rejects.toBeInstanceOf(
      NotFound,
    );
    const aListing = await provider.listRecords(a.zoneId);
    expect(aListing.some((r) => r.id === added.id && r.value === VERIFY)).toBe(
      true,
    );
    expect(await audits(b.org, "dns.record_removed")).toHaveLength(0);
  });
});

describe("email setup and main address (14-28)", () => {
  const DKIM =
    "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx7Qm2R1fK9pL0sYtW3vB";

  it("Google over Zoho needs the replace confirmation, then writes one MX set and one SPF", async () => {
    if (!inst) return;
    const s = await site("zoho");
    const preview = await ownerEmailSetupPreview(s.ctx, "google", {
      verification: VERIFY,
      dkim: DKIM,
    });
    expect(preview.replacesProvider).toBe("Zoho Mail");
    expect(preview.currentProvider).toBe("Zoho Mail");
    const before = await provider.listRecords(s.zoneId);

    await expect(
      ownerApplyEmailSetup(
        s.ctx,
        "google",
        { verification: VERIFY, dkim: DKIM },
        { replaceConfirmed: false },
      ),
    ).rejects.toThrow(/This replaces your current email at Zoho Mail/);
    expect(await provider.listRecords(s.zoneId)).toEqual(before);

    // Admin may preview but never apply.
    await expect(
      ownerApplyEmailSetup(
        s.admin,
        "google",
        { verification: VERIFY, dkim: DKIM },
        { replaceConfirmed: true },
      ),
    ).rejects.toBeInstanceOf(Forbidden);

    await ownerApplyEmailSetup(
      s.ctx,
      "google",
      { verification: VERIFY, dkim: DKIM },
      { replaceConfirmed: true },
    );
    const after = await provider.listRecords(s.zoneId);
    const mx = after.filter((r) => r.type === "MX");
    expect(mx.map((r) => r.value)).toEqual(["smtp.google.com"]);
    const spf = after.filter(
      (r) => r.type === "TXT" && r.name === s.domain && /^v=spf1/.test(r.value),
    );
    expect(spf).toHaveLength(1);
    const v = spf[0]!.value;
    expect(v.match(/include:zoho\.com/g)).toHaveLength(1);
    expect(v.match(/include:_spf\.google\.com/g)).toHaveLength(1);
    expect(
      after.some(
        (r) => r.name === `google._domainkey.${s.domain}` && r.value === DKIM,
      ),
    ).toBe(true);
    expect(after.some((r) => r.value === VERIFY)).toBe(true);
    // The site and CDS records are untouched.
    expect(after.some((r) => r.type === "A")).toBe(true);
    expect(after.some((r) => r.name.startsWith("abc123._domainkey"))).toBe(
      true,
    );

    // The accepted hash matches the zone: health drift stays at 0.
    const zone = await pb
      .collection("dns_zones")
      .getOne((await readDnsZoneRow(s.org, s.domain))!.id);
    expect(zone.accepted_email_hash).toBe(
      computeAcceptedEmailHash(after, s.domain, [
        ...((zone.cds_keys as { cds: string[] }).cds ?? []),
      ]),
    );
    expect(zone.accepted_at).not.toBe("");
    const [audit] = await audits(s.org, "dns.email_setup");
    expect(audit!.meta).toMatchObject({ preset: "google" });
    expect(JSON.stringify(audit!.meta)).not.toContain("DKIM1");
  });

  it("a provider failure stops and reports EMAIL-WRITE-FAILED", async () => {
    if (!inst) return;
    const s = await site("none");
    let calls = 0;
    const flaky = {
      ...provider,
      async upsertRecord(zoneId: string, r: DnsRecord) {
        calls++;
        if (calls === 2) throw new Error("boom");
        return provider.upsertRecord(zoneId, r);
      },
    };
    await expect(
      ownerApplyEmailSetup(
        s.ctx,
        "zoho",
        {},
        { replaceConfirmed: false },
        { provider: flaky },
      ),
    ).rejects.toThrow(P14_COPY.EMAIL_WRITE_FAILED);
    const [failed] = await audits(s.org, "dns.email_setup_failed");
    expect(failed!.meta).toMatchObject({ preset: "zoho", written: 1 });
  });

  it("main address: before launch it is stored on the move", async () => {
    if (!inst) return;
    const s = await site("none");
    const move = await pb.collection("domain_moves").create({
      seq: 700000 + n,
      org_id: s.org,
      kind: "launch",
      to_host: s.domain,
      status: "prepared",
      primary_choice: "apex",
    });
    const r = await ownerSetPrimaryChoice(s.ctx, "www");
    expect(r).toEqual({ choice: "www", swapped: false, primary: null });
    expect(
      (await pb.collection("domain_moves").getOne(move.id)).primary_choice,
    ).toBe("www");
    await expect(ownerSetPrimaryChoice(s.admin, "apex")).rejects.toBeInstanceOf(
      Forbidden,
    );
  });

  it("main address after launch swaps the rows; www resolves as custom", async () => {
    if (!inst) return;
    const s = await site("none", { live: true });
    const at = new Date().toISOString();
    const www = `www.${s.domain}`;
    await pb.collection("org_hosts").create({
      hostname: `records-prev-${n}-${tag()}.sites.localhost`,
      organization: s.org,
      kind: "preview",
      primary: false,
    });
    await pb.collection("org_hosts").create({
      hostname: s.domain,
      organization: s.org,
      kind: "custom",
      primary: true,
      verified_at: at,
    });
    await pb.collection("org_hosts").create({
      hostname: www,
      organization: s.org,
      kind: "redirect",
      redirect_to: s.domain,
      primary: false,
      verified_at: at,
    });
    await pb.collection("domain_moves").create({
      seq: 800000 + n,
      org_id: s.org,
      kind: "launch",
      to_host: s.domain,
      status: "done",
      primary_choice: "apex",
    });
    clearResolverCache();
    expect((await resolveOrganization(www))?.hostKind).toBe("redirect");

    const r = await ownerSetPrimaryChoice(s.ctx, "www");
    expect(r).toEqual({ choice: "www", swapped: true, primary: www });
    const wwwRes = await resolveOrganization(www);
    expect(wwwRes?.hostKind).toBe("custom");
    expect(wwwRes?.primaryHost).toBe(www);
    const apexRes = await resolveOrganization(s.domain);
    expect(apexRes?.hostKind).toBe("redirect");
    expect(apexRes?.redirectTo).toBe(www);
    const prim = await pb.collection("org_hosts").getFullList({
      filter: pb.filter("organization = {:o} && primary = true", { o: s.org }),
    });
    expect(prim.map((h) => h.hostname)).toEqual([www]);
    const [audit] = await audits(s.org, "domain.primary_changed");
    expect(audit!.meta).toMatchObject({ choice: "www", live: true });
  });
});
