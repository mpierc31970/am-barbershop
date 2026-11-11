// 14-37 (DOM-08; T-14-37-01..03): the staff domain surface on the real PocketBase binary over
// the fake DNS world. Both roles view, retry and re-take; only super_admin cancels, overrides
// and moves; every action leaves its audit row naming the organization.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden } from "@cds/core";
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
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { advanceMove, startMove, type MoveDeps } from "../src/dns/moves";
import { readDnsZoneRow } from "../src/dns/snapshot";
import {
  staffAddZoneFile,
  staffCancelMove,
  staffDomainView,
  staffOverrideGate,
  staffRetakeSnapshot,
  staffRetryStep,
  staffStartMove,
} from "../src/dns/staff";
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

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domain-staff-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
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

type Site = { org: string; owner: string; ctx: OrgContext; name: string };

async function site(opts: { liveOn?: string } = {}): Promise<Site> {
  n += 1;
  const t = tag();
  const name = `Staff Dom ${n}`;
  const org = (
    await pb.collection("organizations").create({
      name,
      slug: `staff-dom-${n}-${t}`,
      status: "active",
      ...(opts.liveOn ? { stage: "live" } : {}),
    })
  ).id;
  await pb.collection("org_hosts").create({
    hostname: `staff-dom-${n}-${t}.sites.localhost`,
    organization: org,
    kind: "preview",
    primary: !opts.liveOn,
  });
  if (opts.liveOn) {
    await pb.collection("org_hosts").create({
      hostname: opts.liveOn,
      organization: org,
      kind: "custom",
      primary: true,
      verified_at: "2026-10-01 10:00:00.000Z",
    });
  }
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
    name,
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

let domainN = 0;
async function domain(
  preset: FakeDomainPreset,
  drop?: (r: DnsRecord) => boolean,
): Promise<string> {
  domainN += 1;
  const d = `staffdom${domainN}-${tag()}.example`;
  const records = [...presetRecords(d, preset), dmarc(d)].filter(
    (r) => !drop?.(r),
  );
  await seedFakeDomain(d, preset, { oldZone: records });
  return d;
}

type Clock = { at: Date; deps: MoveDeps };
function clock(start = "2026-10-17T10:00:00.000Z"): Clock {
  const c: Clock = {
    at: new Date(start),
    deps: { provider, transport: captureTransport() },
  };
  c.deps.now = () => c.at;
  return c;
}

async function auditFor(org: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
    sort: "created,id",
  });
}

describe("staff domain functions (14-37)", () => {
  it("support_agent views, retries and re-takes; is refused cancel, override and start", async () => {
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
    const agent = staff("support_agent");

    const view = await staffDomainView(agent, s.org);
    expect(view.move?.toHost).toBe(d);
    expect(view.summary.domain).toBe(d);
    expect(view.summary.zone?.status).toBe("pending");
    expect(view.summary.nameservers.length).toBeGreaterThan(0);
    expect(view.hosts.some((h) => h.kind === "preview" && h.primary)).toBe(
      true,
    );

    c.at = new Date(c.at.getTime() + 6 * 60_000);
    const retried = await staffRetryStep(agent, s.org, c.deps);
    expect(retried.currentStep).toBe("nameservers");
    const retaken = await staffRetakeSnapshot(agent, s.org, c.deps);
    expect(retaken.steps.find((x) => x.key === "snapshot")?.status).toBe(
      "done",
    );

    await expect(
      staffCancelMove(agent, s.org, "Owner asked to stop it.", c.deps),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      staffOverrideGate(
        agent,
        s.org,
        "G2",
        "Mail provider is fine really.",
        c.deps,
      ),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      staffStartMove(agent, s.org, {
        domain: "other.example",
        reason: "Owner rebranded.",
      }),
    ).rejects.toBeInstanceOf(Forbidden);

    const actions = (await auditFor(s.org)).map((r) => r.action);
    expect(actions).toContain("domain.retry");
    expect(actions).toContain("domain.snapshot_retaken");
    expect(actions).not.toContain("domain.cancelled");

    // A zone file goes through the same parsing as the owner's upload.
    await expect(staffAddZoneFile(agent, s.org, "   ", c.deps)).rejects.toThrow(
      P14_COPY.ZONE_UNREADABLE,
    );
    // An unknown org is NotFound for staff.
    await expect(staffDomainView(agent, "zzzzzzzzzzzzzzz")).rejects.toThrow(
      "site not found",
    );
  });

  it("view carries sources and per-record results from the read-back copy", async () => {
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
    // Remove the verification TXT from the CDS copy: it reads back as missing.
    const row = await readDnsZoneRow(s.org, d);
    const verif = (await provider.listRecords(row!.providerZoneId!)).find(
      (r) => r.type === "TXT" && r.value.startsWith("google-site-verification"),
    );
    await provider.deleteRecord(row!.providerZoneId!, verif!.id);

    const view = await staffDomainView(staff("support_agent"), s.org);
    expect(view.move?.id).toBe(v.id);
    const gate = view.gate!;
    expect(gate.readBackFrom).toBe(row!.nameservers[0]);
    expect(gate.recordCount).toBeGreaterThan(0);
    expect(gate.rules.map((r) => r.rule)).toEqual(
      expect.arrayContaining(["G1", "G2", "G3", "G6"]),
    );
    expect(gate.rules.find((r) => r.rule === "G3")?.hardBlock).toBe(true);
    const mx = gate.records.find((r) => r.type === "MX");
    expect(mx?.group).toBe("email");
    expect(mx?.result).toBe("match");
    expect(mx?.sources.length).toBeGreaterThan(0);
    const missing = gate.records.find(
      (r) =>
        r.type === "TXT" && r.original?.startsWith("google-site-verification"),
    );
    expect(missing?.result).toBe("missing");
    expect(missing?.group).toBe("verification");
    // Email records come first.
    expect(gate.records[0]?.group).toBe("email");
    expect(view.postSwitch.open).toBe(false);
  });

  it("super_admin override of G2 is recorded with its reason; G3 can never be overridden", async () => {
    if (!inst) return;
    const s = await site();
    const d = await domain("google", (r) =>
      r.name.startsWith("google._domainkey."),
    );
    const c = clock();
    const v = await startMove(
      s.ctx,
      s.org,
      { domain: d, kind: "launch", by: s.owner },
      c.deps,
    );
    expect(v.currentStep).toBe("gate");
    const g2 = v.findings?.find((f) => f.rule === "G2");
    expect(g2?.pass).toBe(false);
    expect(g2?.overridable).toBe(true);

    const before = await staffDomainView(staff(), s.org);
    const g2row = before.gate?.rules.find((r) => r.rule === "G2");
    expect(g2row?.result).toBe("fail");
    expect(g2row?.overridable).toBe(true);

    await expect(
      staffOverrideGate(staff(), s.org, "G2", "short", c.deps),
    ).rejects.toThrow("10 to 500");
    const reason = "Owner confirmed DKIM is not used for this mailbox.";
    const after = await staffOverrideGate(staff(), s.org, "G2", reason, c.deps);
    expect(after.overrides).toEqual([
      expect.objectContaining({ rule: "G2", by: staffUser, reason }),
    ]);
    expect(after.steps.find((x) => x.key === "gate")?.status).toBe("done");
    const view = await staffDomainView(staff(), s.org);
    expect(view.gate?.rules.find((r) => r.rule === "G2")).toMatchObject({
      result: "overridden",
      overriddenBy: staffUser,
      reason,
    });
    const audit = (await auditFor(s.org)).find(
      (r) => r.action === "domain.override",
    );
    expect(audit?.organization).toBe(s.org);

    // G3: DNSSEC on is a hard block, never overridable.
    const s2 = await site();
    const d2 = await domain("dnssec");
    const v2 = await startMove(
      s2.ctx,
      s2.org,
      { domain: d2, kind: "launch", by: s2.owner },
      c.deps,
    );
    expect(v2.currentStep).toBe("gate");
    await expect(
      staffOverrideGate(
        staff(),
        s2.org,
        "G3",
        "Owner says DNSSEC is off now.",
        c.deps,
      ),
    ).rejects.toThrow(P14_COPY.NO_OVERRIDE);
    expect(
      (await auditFor(s2.org)).some((r) => r.action === "domain.override"),
    ).toBe(false);
  });

  it("cancel after delegation keeps the CDS zone", async () => {
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
    await switchToCds(d);
    const prepared = await advanceMove(v.id, { ...c.deps, force: true });
    expect(prepared.status).toBe("prepared");

    const x = await staffCancelMove(
      staff(),
      s.org,
      "Owner wants a different domain.",
      c.deps,
    );
    expect(x.status).toBe("cancelled");
    expect(x.cancelNote).toBe(P14_COPY.CANCEL_DELEGATED);
    const zone = await readDnsZoneRow(s.org, d);
    expect(zone?.status).toBe("active");
    expect(zone?.providerZoneId).toBeTruthy();
    const audit = (await auditFor(s.org)).find(
      (r) => r.action === "domain.cancelled",
    );
    expect(audit?.organization).toBe(s.org);
    expect(audit?.actor).toBe(staffUser);

    // Nothing open any more: retry has nothing to act on.
    await expect(staffRetryStep(staff(), s.org, c.deps)).rejects.toThrow(
      P14_COPY.STAFF_NO_DOMAIN,
    );
  });

  it("start move on a live site creates a `move` from the old custom domain", async () => {
    if (!inst) return;
    const old = `old-${tag()}.example`;
    const s = await site({ liveOn: old });
    const d = await domain("google");
    const c = clock();

    await expect(
      staffStartMove(staff(), s.org, { domain: d, reason: "short" }, c.deps),
    ).rejects.toThrow("10 to 500");
    const r = await staffStartMove(
      staff(),
      s.org,
      {
        domain: d,
        reason: "The business renamed itself; move to the new name.",
      },
      c.deps,
    );
    expect(r.move.kind).toBe("move");
    expect(r.move.fromHost).toBe(old);
    expect(r.move.toHost).toBe(d);
    expect(r.message).toBe(
      `Move started. ${s.name}'s owner was asked to connect ${d}.`,
    );
    const rec = await pb.collection("domain_moves").getOne(r.move.id);
    expect(rec.kind).toBe("move");
    expect(rec.from_host).toBe(old);

    const audit = await auditFor(s.org);
    const started = audit.find((a) => a.action === "domain.started");
    const requested = audit.find((a) => a.action === "domain.move_requested");
    expect(started?.organization).toBe(s.org);
    expect(requested?.organization).toBe(s.org);
    expect(requested?.meta).toMatchObject({
      code: r.move.code,
      reason: "The business renamed itself; move to the new name.",
    });

    // A second start while one is open is refused; the old domain still serves.
    await expect(
      staffStartMove(
        staff(),
        s.org,
        { domain: d, reason: "Trying again right away." },
        c.deps,
      ),
    ).rejects.toThrow("already connecting");
    const view = await staffDomainView(staff(), s.org);
    expect(view.summary.primaryHost).toBe(old);
    expect(view.live).toBe(true);

    // A site that isn't live can't be moved.
    const notLive = await site();
    await expect(
      staffStartMove(
        staff(),
        notLive.org,
        { domain: d, reason: "Owner wants this one." },
        c.deps,
      ),
    ).rejects.toThrow("Only a live site");
  });
});
