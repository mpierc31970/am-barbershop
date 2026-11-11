// 14-41 (DOM-08, DOM-01, ONB-10, LIFE-01; P14-P18; T-14-41-02/03): the every-5-minutes
// `domains:run` job on the real PocketBase binary over the fake DNS world, with an injected
// clock. One run advances a move waiting on delegation after the owner's switch, backfills a
// hostless org, syncs a verified SES identity, closes an offboarding past its notice and runs
// domain health once per UTC day; the heartbeat and counts carry no org id; a held lock reads
// busy; a dry run writes nothing.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBind, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { superuser } from "../src/client";
import {
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../src/context";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { fakeSetSesStatus } from "../src/dns/fake-world";
import { getMove, startMove, type MoveDeps } from "../src/dns/moves";
import { computeAcceptedEmailHash } from "../src/email/sending-domains/ensure";
import { resetSendingDomainsForTests } from "../src/email/sending-domains/factory";
import type { SendingDomains } from "../src/email/sending-domains/ports";
import { captureTransport } from "../src/email/transport";
import {
  DOMAINS_JOB_COUNTS_KEY,
  DOMAINS_JOB_LOCK_KEY,
  DOMAINS_JOB_SUCCESS_KEY,
  domainsHealthClaimKey,
  domainsHealthRanAt,
  runDomainsJob,
  type DomainsJobOptions,
} from "../src/jobs/domains";
import { startOffboarding } from "../src/offboarding/offboardings";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../src/platform-meta";
import { createBillingSpy } from "./fake-billing-spy";
import {
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "./helpers/fake-dns-world";
import { bootSeededPb, staffContext, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
let pb: PocketBase;
let superAdmin: PlatformContext;
let storageDir = "";
const provider = fakeDnsProvider();
const saved = {
  CDS_STORAGE_DIR: process.env.CDS_STORAGE_DIR,
  CDS_STAFF_ALERT_EMAIL: process.env.CDS_STAFF_ALERT_EMAIL,
  CDS_SENDING_DOMAINS: process.env.CDS_SENDING_DOMAINS,
};
const MIN = 60_000;
const DAY = 86_400_000;

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-domains-job-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  delete process.env.CDS_SENDING_DOMAINS;
  resetDnsForTests();
  resetSendingDomainsForTests();
  booted = await bootSeededPb();
  if (!booted) return;
  pb = await superuser();
  superAdmin = await staffContext(
    booted.inst,
    `domjob-super-${tag()}@cds.test`,
    "super_admin",
  );
}, 60_000);

afterAll(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetSendingDomainsForTests();
  await booted?.inst.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

const tag = () => randomBytes(4).toString("hex");
let n = 0;

async function org(
  opts: { host?: boolean; stage?: string } = {},
): Promise<{ id: string; slug: string; hostname: string }> {
  n += 1;
  const slug = `domjob-${n}-${tag()}`;
  const id = (
    await pb.collection("organizations").create({
      name: `Domains job ${n}`,
      slug,
      status: "active",
      ...(opts.stage ? { stage: opts.stage } : {}),
    })
  ).id;
  const hostname = `${slug}.sites.localhost`;
  if (opts.host !== false) {
    await pb.collection("org_hosts").create({
      hostname,
      organization: id,
      kind: "preview",
      primary: true,
    });
  }
  return { id, slug, hostname };
}

async function ownerOf(orgId: string): Promise<OrgContext> {
  const password = randomBytes(18).toString("hex");
  const id = (
    await pb.collection("users").create({
      email: `owner-${tag()}@cds.test`,
      password,
      passwordConfirm: password,
    })
  ).id;
  await pb
    .collection("memberships")
    .create({ user: id, organization: orgId, role: "owner" });
  return mintOrgContext({
    orgId,
    actor: id,
    role: "owner",
    grants: [],
    ip: "203.0.113.9",
  });
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

function sendingStub(): SendingDomains {
  return {
    name: "fake",
    createIdentity: () =>
      Promise.resolve({ dkimTokens: [], mailFrom: "send.example.com" }),
    status: () => Promise.resolve("verified"),
    deleteIdentity: () => Promise.resolve(),
  } as unknown as SendingDomains;
}

async function hostsOf(orgId: string) {
  return pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
  });
}

describe("domains:run (14-41)", () => {
  // One clock for the whole story; 03:00 UTC so health stays off until asked for.
  let at = new Date("2031-03-03T03:00:00.000Z");
  const mail = captureTransport();
  const moveDeps: MoveDeps = { provider, transport: mail, now: () => at };
  const deps = (): DomainsJobOptions["deps"] => ({
    moves: moveDeps,
    sending: { provider },
    handbacks: { provider, transport: mail },
    offboarding: {
      billing: createBillingSpy(),
      transport: mail,
      sending: sendingStub(),
      provider,
    },
    health: { provider },
  });
  const later = (ms: number) => {
    at = new Date(at.getTime() + ms);
  };

  let moveOrg = "";
  let moveId = "";
  let moveOwner: OrgContext;
  let hostless = { id: "", slug: "", hostname: "" };
  let sendOrg = "";
  let sendDomain = "";
  let sendProfile = "";
  let leavingOrg = "";

  it("one run advances moves, backfills, writes sending records; no org id in the counts", async (ctx) => {
    if (!booted) return ctx.skip();

    // A move waiting on the owner's nameserver change.
    const m = await org();
    moveOrg = m.id;
    moveOwner = await ownerOf(m.id);
    const d = `domjob-${tag()}.example`;
    await seedFakeDomain(d, "google", {
      oldZone: [...presetRecords(d, "google"), dmarc(d)],
    });
    const v = await startMove(
      moveOwner,
      m.id,
      { domain: d, kind: "launch", by: moveOwner.actor },
      moveDeps,
    );
    moveId = v.id;
    expect(v.status).toBe("waiting_owner");
    await switchToCds(d);

    // A hostless org (DOM-01 backfill).
    hostless = await org({ host: false });

    // An org with an active CDS zone and no sending identity yet (ONB-10).
    const s = await org();
    sendOrg = s.id;
    sendDomain = `domjob-send-${tag()}.example`;
    sendProfile = (
      await pb.collection("business_profile").create({
        organization: s.id,
        hours: {},
        sending_local_part: "hello",
      })
    ).id;
    await seedFakeDomain(sendDomain, "none");
    const { zoneId } = await provider.createZone(sendDomain);
    await provider.importBind(
      zoneId,
      formatBind(sendDomain, presetRecords(sendDomain, "none")),
    );
    await switchToCds(sendDomain);
    const records = await provider.listRecords(zoneId);
    await pb.collection("dns_zones").create({
      org_id: s.id,
      domain: sendDomain,
      provider: "fake",
      provider_zone_id: zoneId,
      status: "active",
      cds_keys: { cds: [], owner: [] },
      accepted_email_hash: computeAcceptedEmailHash(records, sendDomain, []),
    });

    later(6 * MIN);
    const r = await runDomainsJob({ now: at, deps: deps() });
    expect(r.busy).toBe(false);
    expect(r.dryRun).toBe(false);
    expect(r.failedSteps).toEqual([]);
    expect(r.movesAdvanced).toBeGreaterThanOrEqual(1);
    expect(r.backfilled).toBeGreaterThanOrEqual(1);
    expect(r.sendingUpdated).toBeGreaterThanOrEqual(1);
    expect(r.healthRan).toBe(false);
    expect(typeof r.ms).toBe("number");

    expect((await getMove(moveOwner, moveId)).status).toBe("prepared");
    const hosts = await hostsOf(hostless.id);
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toMatchObject({ kind: "preview", primary: true });
    expect(
      (await pb.collection("business_profile").getOne(sendProfile))
        .sending_status,
    ).toBe("pending");

    // Heartbeat + counts (T-14-41-02): counts only.
    expect(await readPlatformMeta(DOMAINS_JOB_SUCCESS_KEY)).toBe(
      at.toISOString(),
    );
    const raw = (await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY)) ?? "";
    const counts = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(counts).sort()).toEqual(
      [
        "dryRun",
        "busy",
        "backfilled",
        "movesAdvanced",
        "movesWaitingOwner",
        "movesFailed",
        "movesExpired",
        "sendingUpdated",
        "handbacksChecked",
        "offboardingsClosed",
        "healthRan",
        "failedSteps",
        "ms",
      ].sort(),
    );
    for (const secret of [moveOrg, sendOrg, hostless.id, d, sendDomain]) {
      expect(raw).not.toContain(secret);
    }
    // The lock is released.
    expect(await readPlatformMeta(DOMAINS_JOB_LOCK_KEY)).toBeNull();
  });

  it("the next run syncs a verified SES identity", async (ctx) => {
    if (!booted) return ctx.skip();
    await fakeSetSesStatus(sendDomain, "verified");
    later(5 * MIN);
    const r = await runDomainsJob({ now: at, deps: deps() });
    expect(r.failedSteps).toEqual([]);
    expect(r.sendingUpdated).toBeGreaterThanOrEqual(1);
    const p = await pb.collection("business_profile").getOne(sendProfile);
    expect(p.sending_status).toBe("verified");
    expect(p.sending_domain_verified).toBe(true);
  });

  it("a dry run writes nothing: no host, no lock, no heartbeat, no claim", async (ctx) => {
    if (!booted) return ctx.skip();
    const dryHostless = await org({ host: false });
    const before = await readPlatformMeta(DOMAINS_JOB_SUCCESS_KEY);
    const countsBefore = await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY);
    const dryAt = new Date(at.getTime() + 4 * 3_600_000); // 07:xx UTC
    const r = await runDomainsJob({ now: dryAt, dryRun: true, deps: deps() });
    expect(r.dryRun).toBe(true);
    expect(r.backfilled).toBeGreaterThanOrEqual(1);
    expect(r.healthRan).toBe(true);
    expect(await hostsOf(dryHostless.id)).toHaveLength(0);
    expect(await readPlatformMeta(DOMAINS_JOB_SUCCESS_KEY)).toBe(before);
    expect(await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY)).toBe(countsBefore);
    expect(await readPlatformMeta(domainsHealthClaimKey(dryAt))).toBeNull();
    // Leave nothing hostless for later runs to count.
    await pb.collection("organizations").update(dryHostless.id, {
      status: "disabled",
    });
  });

  it("a held lock reads busy and writes nothing (T-14-41-03)", async (ctx) => {
    if (!booted) return ctx.skip();
    const token = await acquirePlatformLock(DOMAINS_JOB_LOCK_KEY, {
      now: at,
      staleMs: 10 * MIN,
    });
    expect(token).not.toBeNull();
    const before = await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY);
    try {
      const busyHostless = await org({ host: false });
      const r = await runDomainsJob({
        now: new Date(at.getTime() + MIN),
        deps: deps(),
      });
      expect(r.busy).toBe(true);
      expect(r.backfilled).toBe(0);
      expect(await hostsOf(busyHostless.id)).toHaveLength(0);
      expect(await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY)).toBe(before);
      // A stale lock (over 10 min) is taken over.
      const r2 = await runDomainsJob({
        now: new Date(at.getTime() + 11 * MIN),
        deps: deps(),
      });
      expect(r2.busy).toBe(false);
      expect(await hostsOf(busyHostless.id)).toHaveLength(1);
    } finally {
      await releasePlatformLock(DOMAINS_JOB_LOCK_KEY, token!);
    }
  });

  it("health runs once per UTC day after 06:00 (second run the same day skips)", async (ctx) => {
    if (!booted) return ctx.skip();
    at = new Date("2031-03-03T06:05:00.000Z");
    expect(await domainsHealthRanAt(at)).toBeNull();
    const first = await runDomainsJob({ now: at, deps: deps() });
    expect(first.healthRan).toBe(true);
    expect(first.failedSteps).toEqual([]);
    expect((await domainsHealthRanAt(at))?.toISOString()).toBe(
      at.toISOString(),
    );

    later(5 * MIN);
    const second = await runDomainsJob({ now: at, deps: deps() });
    expect(second.healthRan).toBe(false);

    // The next UTC day, before 06:00: still off; after 06:00 it runs again.
    at = new Date("2031-03-04T05:55:00.000Z");
    expect((await runDomainsJob({ now: at, deps: deps() })).healthRan).toBe(
      false,
    );
    at = new Date("2031-03-04T06:00:00.000Z");
    expect((await runDomainsJob({ now: at, deps: deps() })).healthRan).toBe(
      true,
    );
  });

  it("closes an offboarding past its notice", async (ctx) => {
    if (!booted) return ctx.skip();
    const l = await org({ stage: "live" });
    leavingOrg = l.id;
    await ownerOf(l.id);
    const start = new Date("2031-03-04T06:30:00.000Z");
    await startOffboarding(
      superAdmin,
      l.id,
      { reason: "Customer asked by email" },
      { now: start },
    );
    at = new Date(start.getTime() + 31 * DAY);
    const r = await runDomainsJob({ now: at, deps: deps() });
    expect(r.failedSteps).toEqual([]);
    expect(r.offboardingsClosed).toBeGreaterThanOrEqual(1);
    const o = await pb.collection("organizations").getOne(leavingOrg);
    expect(o.status).toBe("disabled");
    expect(String(o.closed_at)).not.toBe("");
    const row = await pb
      .collection("offboardings")
      .getFirstListItem(pb.filter("org_id = {:o}", { o: leavingOrg }));
    expect(row.status).toBe("closed");
    expect(await readPlatformMeta(DOMAINS_JOB_COUNTS_KEY)).not.toContain(
      leavingOrg,
    );
  });
});
