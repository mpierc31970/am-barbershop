// P14 domains attacks (14-09, TEN-03, invariant 1, DOM-10, D172): launch_review_marks is the
// one P14 tenant collection. It is writes: custom, so the generic repo is read-only and org
// B's get of org A's row is NotFound; org B's list never contains org A's row. The suite's
// "left every org A row unchanged" snapshot proves nothing wrote.
//
// 14-33 adds the function-level keys (`launch_review_marks:markPage`, `:reviewPages`,
// `:requestPageChange`: org B's owner against org A's page id) and 14-50 the rest of the P14
// owner surface (P14-P34). Every other P14 table (dns_zones, domain_moves, offboardings,
// dns_fake_state) is a platform table keyed by org_id, covered by those function-level
// attacks; 14-50 also adds those three tables (org_id = A) to the suite's org A snapshot.
//
// 14-50 seed (choice 1): org A gets a fake-world domain with a launch move waiting on the
// owner at the gate (a G5 email-forwarding finding), an `active` CDS zone holding one
// owner-added verification TXT (provider record id kept), and an offboarding in `notice`
// with a handback destination chosen. Org B gets its own small active zone and, lazily, its
// own move, so "own" calls succeed and act only on B.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotFound } from "@cds/core";
import { recordKey, type DnsRecord } from "@cds/core/dns";
import type PocketBase from "pocketbase";
import { expect } from "vitest";
import { resetHandbackLimitsForTests } from "../../src/offboarding/handback";
import {
  mintPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../../src/context";
import { fakeDnsProvider } from "../../src/dns/fake/provider";
import {
  acknowledgeFinding,
  cancelMove,
  moveByCode,
  openMoveFor,
  retakeSnapshot,
  retryStep,
  startMove,
} from "../../src/dns/moves";
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
} from "../../src/dns/owner";
import { mintPreviewLink } from "../../src/dns/preview-links";
import {
  ownerAddRecord,
  ownerApplyEmailSetup,
  ownerDnsRecords,
  ownerEmailSetupPreview,
  ownerRemoveRecord,
  ownerSetPrimaryChoice,
} from "../../src/dns/records";
import { upsertDnsZoneRow } from "../../src/dns/snapshot";
import { ownerSearchStatus } from "../../src/content/sitemap-submit";
import { captureTransport } from "../../src/email/transport";
import { computeAcceptedEmailHash } from "../../src/email/sending-domains/ensure";
import {
  getSendingView,
  setSendingLocalPart,
} from "../../src/intake/business-profile";
import { markPage } from "../../src/launch-review/marks";
import {
  launchReviewView,
  requestPageChange,
  reviewPages,
} from "../../src/launch-review/review";
import {
  chooseHandbackDestination,
  checkHandbackDestination,
  confirmHandbackSwitched,
  handbackView,
  handbackZoneFile,
} from "../../src/offboarding/handback";
import {
  cancelOffboarding,
  leavingNeedsYou,
  offboardingView,
  startOffboarding,
} from "../../src/offboarding/offboardings";
import {
  completeOffboardingStep,
  offboardingChecklist,
  requestOffboardingDownload,
  type OffboardingTickStep,
} from "../../src/offboarding/steps";
import { tenantRepo } from "../../src/repository";
import type { TwoOrgs } from "../fixtures";
import {
  FAKE_OLD_NAMESERVERS,
  presetRecords,
  seedFakeDomain,
  switchToCds,
} from "../helpers/fake-dns-world";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

export const P14_DOMAIN_COLLECTIONS = ["launch_review_marks"] as const;

export type P14DomainCollection = (typeof P14_DOMAIN_COLLECTIONS)[number];

/** 14-50 (choice 3): platform tables keyed by `org_id`, added to the org A snapshot. */
export const P14_PLATFORM_TABLES = [
  "domain_moves",
  "dns_zones",
  "offboardings",
] as const;

/** Org A's P14 platform rows (14-50 choice 1). */
export type P14DomainsA = {
  /** Launch move waiting on the owner at the gate (G5 forwarding finding). */
  moveId: string;
  moveCode: string;
  moveDomain: string;
  /** Active CDS zone; handback destination chosen. */
  zoneDomain: string;
  /** Owner-added verification TXT in the zone (provider record id). */
  recordId: string;
  offboardingId: string;
};

export type P14DomainSeed = {
  rows: Record<P14DomainCollection, { A: string; B: string }>;
  /** 14-50: absent when an older caller seeds without the domain world. */
  domains?: { A: P14DomainsA; B: { zoneDomain: string } };
};

export const P14_ACK_KEY = "G5:email_forwarding";
const VERIFY = "google-site-verification=attack14x50a0123456789";
const VERIFY_B = "google-site-verification=attack14x50b0123456789";
const DKIM =
  "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx7Qm2R1fK9pL0sYtW3vB";

const provider = fakeDnsProvider();
let domainN = 0;

function tag(): string {
  return Math.random().toString(36).slice(2, 8);
}

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

/** GoDaddy email forwarding (a registrar-only service: a G5 finding, waiting on the owner). */
async function forwardingDomain(label: string): Promise<string> {
  domainN += 1;
  const d = `p14x${label}${domainN}-${tag()}.example`;
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

/** An active CDS zone for `org` holding `records` (one CDS SES DKIM in A's case). */
async function activeZone(
  org: string,
  label: string,
  records: (d: string) => DnsRecord[],
  cds: (d: string) => DnsRecord[],
): Promise<string> {
  domainN += 1;
  const d = `p14z${label}${domainN}-${tag()}.test`;
  await seedFakeDomain(d, "google");
  const zone = await provider.createZone(d);
  for (const r of [...records(d), ...cds(d)]) {
    await provider.upsertRecord(zone.zoneId, r);
  }
  await switchToCds(d);
  const listed = await provider.listRecords(zone.zoneId);
  const cdsNames = new Set(cds(d).map((r) => r.name));
  const cdsKeys = listed
    .filter((r) => cdsNames.has(r.name))
    .map((r) => recordKey(r));
  await upsertDnsZoneRow(org, d, {
    status: "active",
    provider: "fake",
    provider_zone_id: zone.zoneId,
    nameservers: zone.nameservers,
    original_nameservers: [...FAKE_OLD_NAMESERVERS],
    registrar: "GoDaddy",
    cds_keys: { cds: cdsKeys, owner: [] },
    accepted_email_hash: computeAcceptedEmailHash(listed, d, cdsKeys),
  });
  return d;
}

const sesDkim = (d: string): DnsRecord[] => [
  {
    type: "CNAME",
    name: `abc123._domainkey.${d}`,
    value: "abc123.dkim.amazonses.com",
    ttl: 3600,
  },
];

async function staffUser(pb: PocketBase): Promise<PlatformContext> {
  const password = `pw-${tag()}-${Date.now()}-x14`;
  const user = await pb.collection("users").create({
    email: `p14-attack-staff-${tag()}@cds.test`,
    password,
    passwordConfirm: password,
    staff_role: "super_admin",
  });
  return mintPlatformContext({
    actor: user.id,
    staffRole: "super_admin",
    ip: "203.0.113.50",
  });
}

/** Org A's domain world (14-50 choice 1). Needs CDS_STORAGE_DIR (move snapshots). */
async function seedDomainsA(
  pb: PocketBase,
  seed: TwoOrgs,
): Promise<P14DomainsA> {
  const { A, ctxA } = seed;
  // 1. Active zone: the old host's Google mail + one CDS SES record.
  const zoneDomain = await activeZone(
    A.org,
    "a",
    (d) => presetRecords(d, "google").filter((r) => r.type !== "CNAME"),
    sesDkim,
  );
  // 2. One owner-added verification TXT (provider record id kept).
  const added = await ownerAddRecord(ctxA, {
    type: "TXT",
    name: "@",
    value: VERIFY,
  });
  // 3. Offboarding in notice (staff start: no emailed code), destination chosen.
  const staff = await staffUser(pb);
  await startOffboarding(staff, A.org, { reason: "14-50 isolation seed" });
  resetHandbackLimitsForTests();
  await chooseHandbackDestination(ctxA, undefined, zoneDomain, {
    kind: "registrar",
  });
  resetHandbackLimitsForTests();
  // 4. Launch move waiting on the owner at the gate (forwarding finding). Review 14 WR-A05:
  // startMove refuses during a notice, and startOffboarding cancels an open move, so the
  // seed pauses the notice row around the start (the attacks need both at once).
  const moveDomain = await forwardingDomain("a");
  const paused = await pb
    .collection("offboardings")
    .getFirstListItem(pb.filter("org_id = {:o}", { o: A.org }));
  await pb
    .collection("offboardings")
    .update(paused.id, { status: "cancelled" });
  const move = await startMove(ctxA, A.org, {
    domain: moveDomain,
    kind: "launch",
    by: A.owner,
  });
  await pb.collection("offboardings").update(paused.id, { status: "notice" });
  const off = await pb
    .collection("offboardings")
    .getFirstListItem(pb.filter("org_id = {:o}", { o: A.org }));
  // The seed must be what the attacks assume, or a refusal would prove nothing.
  const zoneRow = await pb
    .collection("dns_zones")
    .getFirstListItem(
      pb.filter("org_id = {:o} && domain = {:d}", { o: A.org, d: zoneDomain }),
    );
  const destination = (zoneRow.handback as { destination?: string } | null)
    ?.destination;
  if (
    move.status !== "waiting_owner" ||
    move.currentStep !== "gate" ||
    off.status !== "notice" ||
    zoneRow.status !== "active" ||
    destination !== "registrar"
  ) {
    throw new Error(
      "p14-domains: org A's domain world did not seed as planned",
    );
  }
  return {
    moveId: move.id,
    moveCode: move.code,
    moveDomain,
    zoneDomain,
    recordId: added.id,
    offboardingId: off.id,
  };
}

/** One launch_review_marks row per org (superuser inserts). */
async function seedMark(pb: PocketBase, org: string): Promise<string> {
  const row = await pb.collection("launch_review_marks").create({
    organization: org,
    kind: "key_facts",
    page: "",
    status: "done",
    page_version: "",
    at: new Date().toISOString(),
  });
  return row.id;
}

/**
 * One launch_review_marks row per org, plus (14-50) the P14 domain world: org A's move,
 * zone, record and offboarding, and org B's small zone. Sets CDS_STORAGE_DIR to a temp dir
 * when unset (move snapshots), and CDS_STAFF_ALERT_EMAIL when unset.
 */
export async function seedP14Domains(
  pb: PocketBase,
  seed: TwoOrgs,
): Promise<P14DomainSeed> {
  if (!process.env.CDS_STORAGE_DIR) {
    process.env.CDS_STORAGE_DIR = mkdtempSync(join(tmpdir(), "cds-iso-p14-"));
  }
  if (!process.env.CDS_STAFF_ALERT_EMAIL) {
    process.env.CDS_STAFF_ALERT_EMAIL = "staff-alerts@cds.test";
  }
  const rows = {
    launch_review_marks: {
      A: await seedMark(pb, seed.A.org),
      B: await seedMark(pb, seed.B.org),
    },
  };
  // Seeding org A rings org A's bell (offboarding started); those alerts are dropped so the
  // P11 same-org alert attack still sees only its own seeded rows.
  const alertFilter = pb.filter("organization = {:o}", { o: seed.A.org });
  const alertsBefore = new Set(
    (await pb.collection("alerts").getFullList({ filter: alertFilter })).map(
      (r) => r.id,
    ),
  );
  const A = await seedDomainsA(pb, seed);
  for (const r of await pb
    .collection("alerts")
    .getFullList({ filter: alertFilter })) {
    if (!alertsBefore.has(r.id)) await pb.collection("alerts").delete(r.id);
  }
  // Org B: a minimal zone (one A record), so its record ids never reach A's TXT id.
  const zoneB = await activeZone(
    seed.B.org,
    "b",
    (d) => [{ type: "A", name: d, value: "198.18.0.10", ttl: 3600 }],
    () => [],
  );
  return { rows, domains: { A, B: { zoneDomain: zoneB } } };
}

/** Org B's generic list holds its own row and never org A's. */
function listAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const rows = env.seedRecordFor("launch_review_marks");
    const list = await tenantRepo("launch_review_marks").list(env.seed().ctxB);
    const ids = list.items.map((r) => r.id);
    expect(ids).not.toContain(rows.a);
    expect(ids).toContain(rows.b);
  };
}

/** 14-33 (choice 7): org B's owner marking org A's page id is NotFound; nothing written. */
function markPageAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const s = env.seed();
    await expect(markPage(s.ctxB, s.A.page, "looks_good")).rejects.toThrow(
      NotFound,
    );
    await expect(markPage(s.ctxB, s.A.page, "needs_change")).rejects.toThrow(
      NotFound,
    );
    const rows = await env
      .pb()
      .collection("launch_review_marks")
      .getFullList({
        filter: env.pb().filter("page = {:p}", { p: s.A.page }),
      });
    expect(rows).toHaveLength(0);
  };
}

/** 14-33: org B's review pages and view never list org A's pages. */
function reviewPagesAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const s = env.seed();
    const ids = (await reviewPages(s.ctxB)).map((p) => p.id);
    expect(ids).not.toContain(s.A.page);
    const view = await launchReviewView(s.ctxB);
    expect(view.pages.map((p) => p.id)).not.toContain(s.A.page);
  };
}

/** 14-33: org B's change request on org A's page id is NotFound; no ticket is filed. */
function requestPageChangeAttack(env: AttackEnv): () => Promise<void> {
  return async () => {
    const s = env.seed();
    await expect(
      requestPageChange(s.ctxB, s.A.page, "Change the phone number please."),
    ).rejects.toThrow(NotFound);
    const tickets = await env
      .pb()
      .collection("support_threads")
      .getFullList({
        filter: env.pb().filter("subject ~ 'Change on'", {}),
      });
    expect(tickets).toHaveLength(0);
  };
}

// ---------------------------------------------------------------------------------------
// 14-50: function-level attacks for the P14 owner surface (P14-P34)
// ---------------------------------------------------------------------------------------

type DomainSeed = NonNullable<P14DomainSeed["domains"]>;

/** Refused with NotFound (the run may throw synchronously or reject). */
async function notFound(run: () => Promise<unknown>): Promise<void> {
  await expect(Promise.resolve().then(run)).rejects.toBeInstanceOf(NotFound);
}

/** Refused (any error class): used where the function never names another org. */
async function refused(run: () => Promise<unknown>): Promise<void> {
  await expect(Promise.resolve().then(run)).rejects.toBeInstanceOf(Error);
}

function mentionsA(value: unknown, d: DomainSeed): boolean {
  const json = JSON.stringify(value);
  return (
    json.includes(d.A.moveDomain) ||
    json.includes(d.A.zoneDomain) ||
    json.includes(d.A.moveId) ||
    json.includes(VERIFY)
  );
}

/** Org A's move row, read straight from PocketBase (status, step, acks). */
async function moveRowA(env: AttackEnv, d: DomainSeed) {
  const r = await env.pb().collection("domain_moves").getOne(d.A.moveId);
  return {
    status: r.status,
    current_step: r.current_step,
    acks: r.acks,
    steps: r.steps,
    updated: r.updated,
  };
}

/** Org A's zone listing at the (fake) DNS host. */
async function zoneListingA(env: AttackEnv, d: DomainSeed) {
  const row = await env
    .pb()
    .collection("dns_zones")
    .getFirstListItem(
      env.pb().filter("org_id = {:o} && domain = {:d}", {
        o: env.seed().A.org,
        d: d.A.zoneDomain,
      }),
    );
  const listed = await provider.listRecords(String(row.provider_zone_id));
  return listed.map((r) => `${r.id}|${r.type}|${r.name}|${r.value}`).sort();
}

/** Org B's fresh launch move, waiting on its owner at the gate (cancels any open one). */
async function freshMoveB(env: AttackEnv): Promise<{ id: string }> {
  const s = env.seed();
  const open = await openMoveFor(s.ctxB);
  if (open) await cancelMove(s.ctxB, open.id, "14-50 attack reset");
  const domain = await forwardingDomain("b");
  const m = await startMove(s.ctxB, s.B.org, {
    domain,
    kind: "launch",
    by: s.B.owner,
  });
  return { id: m.id };
}

function moveAttacks(env: AttackEnv, dom: () => DomainSeed): AttackMap {
  const ctx = (): OrgContext => env.seed().ctxB;
  return {
    "domain_moves:startMove": async () => {
      const s = env.seed();
      const d = dom();
      const before = await moveRowA(env, d);
      // Org B naming org A's id, or another launch move "for" org A.
      await notFound(() =>
        startMove(ctx(), s.A.org, {
          domain: `p14x-evil-${tag()}.example`,
          kind: "launch",
          by: s.B.owner,
        }),
      );
      // Org B starting a move on org A's active domain is DOM-TAKEN (P14-P23).
      const open = await openMoveFor(ctx());
      if (open) await cancelMove(ctx(), open.id, "14-50 attack reset");
      await refused(() =>
        startMove(ctx(), s.B.org, {
          domain: d.A.zoneDomain,
          kind: "launch",
          by: s.B.owner,
        }),
      );
      expect(await openMoveFor(ctx())).toBeNull();
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:openMoveFor": async () => {
      const s = env.seed();
      const d = dom();
      await notFound(() => openMoveFor(ctx(), s.A.org));
      const own = await openMoveFor(ctx());
      expect(own?.id ?? null).not.toBe(d.A.moveId);
      // moveByCode is staff-only: an OrgContext is refused even for a real code.
      await notFound(() =>
        moveByCode(ctx() as unknown as PlatformContext, d.A.moveCode),
      );
    },
    "domain_moves:acknowledgeFinding": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await notFound(() => acknowledgeFinding(ctx(), d.A.moveId, P14_ACK_KEY));
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:retryStep": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await notFound(() => retryStep(ctx(), d.A.moveId));
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:cancelMove": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await notFound(() => cancelMove(ctx(), d.A.moveId, "not my move"));
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:retakeSnapshot": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await notFound(() => retakeSnapshot(ctx(), d.A.moveId));
      expect(await moveRowA(env, d)).toEqual(before);
    },
    // 14-29 owner functions take no id: they act only on org B's own move.
    "domain_moves:ownerDomainView": async () => {
      const d = dom();
      await freshMoveB(env);
      const v = await ownerDomainView(ctx());
      expect(v.domain).not.toBe(d.A.moveDomain);
      expect(mentionsA(v, d)).toBe(false);
      expect(mentionsA(await domainNeedsYou(ctx()), d)).toBe(false);
    },
    "domain_moves:ownerAcknowledge": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      const own = await freshMoveB(env);
      // The same finding key: only org B's own move takes the acknowledgement.
      const v = await ownerAcknowledge(ctx(), P14_ACK_KEY);
      expect(mentionsA(v, d)).toBe(false);
      const ownRow = await env.pb().collection("domain_moves").getOne(own.id);
      expect(JSON.stringify(ownRow.acks)).toContain(P14_ACK_KEY);
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:ownerCheckNameservers": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await freshMoveB(env);
      resetOwnerDomainLimitsForTests();
      const out = await ownerCheckNameservers(ctx());
      expect(mentionsA(out, d)).toBe(false);
      resetOwnerDomainLimitsForTests();
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:ownerSendNameserverSteps": async () => {
      const d = dom();
      await freshMoveB(env);
      // Acknowledged, org B's move asks for its own nameservers.
      await ownerAcknowledge(ctx(), P14_ACK_KEY);
      resetOwnerDomainLimitsForTests();
      const mail = captureTransport();
      await ownerSendNameserverSteps(
        ctx(),
        { to: "helper-b@cds.test" },
        { transport: mail },
      );
      resetOwnerDomainLimitsForTests();
      expect(mail.sent.length).toBeGreaterThan(0);
      expect(mentionsA(mail.sent, d)).toBe(false);
    },
    "domain_moves:ownerUploadZoneFile": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      await freshMoveB(env);
      // A zone file for org A's domain never lands on org A's move or zone.
      const text = [
        `$ORIGIN ${d.A.moveDomain}.`,
        `@ 3600 IN TXT "${VERIFY_B}"`,
      ].join("\n");
      await refused(() => ownerUploadZoneFile(ctx(), text));
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:ownerConnectDomain": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      const open = await openMoveFor(ctx());
      if (open) await cancelMove(ctx(), open.id, "14-50 attack reset");
      // Org A's active (CDS-delegated) domain is taken for org B.
      await refused(() => ownerConnectDomain(ctx(), d.A.zoneDomain));
      expect(await openMoveFor(ctx())).toBeNull();
      expect(await moveRowA(env, d)).toEqual(before);
    },
    "domain_moves:ownerUseDifferentDomain": async () => {
      const d = dom();
      const before = await moveRowA(env, d);
      const own = await freshMoveB(env);
      await ownerUseDifferentDomain(ctx());
      const ownRow = await env.pb().collection("domain_moves").getOne(own.id);
      expect(ownRow.status).toBe("cancelled");
      expect(await moveRowA(env, d)).toEqual(before);
      // With nothing open, org B is refused (nothing_open), never redirected to org A's.
      await refused(() => ownerUseDifferentDomain(ctx()));
      expect(await moveRowA(env, d)).toEqual(before);
    },
  };
}

function recordAttacks(env: AttackEnv, dom: () => DomainSeed): AttackMap {
  const ctx = (): OrgContext => env.seed().ctxB;
  return {
    "dns_zones:ownerDnsRecords": async () => {
      const d = dom();
      const v = await ownerDnsRecords(ctx());
      expect(v?.domain).toBe(d.B.zoneDomain);
      const ids = (v?.groups ?? []).flatMap((g) => g.records.map((r) => r.id));
      expect(JSON.stringify(v)).not.toContain(VERIFY);
      expect(JSON.stringify(v)).not.toContain(d.A.zoneDomain);
      expect(ids).not.toContain(d.A.recordId);
    },
    "dns_zones:ownerRemoveRecord": async () => {
      const d = dom();
      const before = await zoneListingA(env, d);
      // The provider id is per-zone: it must not exist in org B's zone for this to prove scoping.
      const own = await ownerDnsRecords(ctx());
      const bIds = (own?.groups ?? []).flatMap((g) =>
        g.records.map((r) => r.id),
      );
      expect(bIds).not.toContain(d.A.recordId);
      await notFound(() => ownerRemoveRecord(ctx(), d.A.recordId));
      expect(await zoneListingA(env, d)).toEqual(before);
    },
    "dns_zones:ownerAddRecord": async () => {
      const d = dom();
      const before = await zoneListingA(env, d);
      // A name spelled after org A's domain is only ever a name inside org B's own zone.
      const spelled = await ownerAddRecord(ctx(), {
        type: "TXT",
        name: `x14.${d.A.zoneDomain}`,
        value: VERIFY_B,
      });
      expect(spelled.name.endsWith(`.${d.B.zoneDomain}`)).toBe(true);
      expect(await zoneListingA(env, d)).toEqual(before);
      await ownerRemoveRecord(ctx(), spelled.id);
      // B's own write lands only in B's zone.
      const row = await ownerAddRecord(ctx(), {
        type: "TXT",
        name: "@",
        value: VERIFY_B,
      });
      expect(row.name).not.toContain(d.A.zoneDomain);
      expect(await zoneListingA(env, d)).toEqual(before);
      const mine = await ownerDnsRecords(ctx());
      expect(JSON.stringify(mine)).toContain(VERIFY_B);
    },
    "dns_zones:ownerEmailSetupPreview": async () => {
      const d = dom();
      const p = await ownerEmailSetupPreview(ctx(), "google", {
        verification: VERIFY_B,
        dkim: DKIM,
      });
      expect(JSON.stringify(p)).not.toContain(d.A.zoneDomain);
    },
    "dns_zones:ownerApplyEmailSetup": async () => {
      const d = dom();
      const before = await zoneListingA(env, d);
      const p = await ownerApplyEmailSetup(
        ctx(),
        "google",
        { verification: VERIFY_B, dkim: DKIM },
        { replaceConfirmed: true },
      );
      expect(JSON.stringify(p)).not.toContain(d.A.zoneDomain);
      expect(await zoneListingA(env, d)).toEqual(before);
    },
    "dns_zones:ownerSetPrimaryChoice": async () => {
      const d = dom();
      const before = await zoneListingA(env, d);
      const hostsA = await env
        .pb()
        .collection("org_hosts")
        .getFullList({
          filter: env
            .pb()
            .filter("organization = {:o}", { o: env.seed().A.org }),
          sort: "id",
        });
      const out = await ownerSetPrimaryChoice(ctx(), "apex");
      expect(JSON.stringify(out)).not.toContain(d.A.zoneDomain);
      expect(await zoneListingA(env, d)).toEqual(before);
      const after = await env
        .pb()
        .collection("org_hosts")
        .getFullList({
          filter: env
            .pb()
            .filter("organization = {:o}", { o: env.seed().A.org }),
          sort: "id",
        });
      expect(after).toEqual(hostsA);
    },
  };
}

function offboardingAttacks(env: AttackEnv, dom: () => DomainSeed): AttackMap {
  const ctx = (): OrgContext => env.seed().ctxB;
  const offA = async (d: DomainSeed) => {
    const r = await env
      .pb()
      .collection("offboardings")
      .getOne(d.A.offboardingId);
    return { status: r.status, steps: r.steps, updated: r.updated };
  };
  const step: OffboardingTickStep = "download";
  return {
    "offboardings:startOffboarding": async () => {
      const s = env.seed();
      const d = dom();
      const before = await offA(d);
      await notFound(() =>
        startOffboarding(ctx(), s.A.org, {
          reasonCategory: "other",
          code: { otpId: "x", code: "000000" },
        } as never),
      );
      expect(await offA(d)).toEqual(before);
    },
    "offboardings:cancelOffboarding": async () => {
      const s = env.seed();
      const d = dom();
      const before = await offA(d);
      await notFound(() => cancelOffboarding(ctx(), s.A.org));
      // Org B has no notice of its own: refused, never redirected to org A's.
      await refused(() => cancelOffboarding(ctx(), undefined));
      expect(await offA(d)).toEqual(before);
    },
    "offboardings:offboardingView": async () => {
      const s = env.seed();
      await notFound(() => offboardingView(ctx(), s.A.org));
      expect(await offboardingView(ctx())).toBeNull();
      expect(await leavingNeedsYou(ctx())).toEqual([]);
    },
    "offboardings:offboardingChecklist": async () => {
      const s = env.seed();
      const d = dom();
      await notFound(() =>
        offboardingChecklist(ctx(), s.A.org, { manifests: [] }),
      );
      const own = await offboardingChecklist(ctx(), undefined, {
        manifests: [],
      });
      expect(mentionsA(own, d)).toBe(false);
    },
    "offboardings:completeOffboardingStep": async () => {
      const s = env.seed();
      const d = dom();
      const before = await offA(d);
      await notFound(() => completeOffboardingStep(ctx(), s.A.org, step));
      expect(await offA(d)).toEqual(before);
    },
    "offboardings:requestOffboardingDownload": async () => {
      const s = env.seed();
      const d = dom();
      const before = await offA(d);
      await notFound(() => requestOffboardingDownload(ctx(), s.A.org));
      expect(await offA(d)).toEqual(before);
    },
  };
}

function handbackAttacks(env: AttackEnv, dom: () => DomainSeed): AttackMap {
  const ctx = (): OrgContext => env.seed().ctxB;
  const zoneA = async (d: DomainSeed) => {
    const r = await env
      .pb()
      .collection("dns_zones")
      .getFirstListItem(
        env.pb().filter("org_id = {:o} && domain = {:d}", {
          o: env.seed().A.org,
          d: d.A.zoneDomain,
        }),
      );
    return { status: r.status, handback: r.handback, updated: r.updated };
  };
  const both = (
    run: (orgId: string | undefined, domain: string) => Promise<unknown>,
  ) => {
    return async () => {
      const s = env.seed();
      const d = dom();
      const before = await zoneA(d);
      resetHandbackLimitsForTests();
      await notFound(() => run(s.A.org, d.A.zoneDomain));
      await notFound(() => run(undefined, d.A.zoneDomain));
      resetHandbackLimitsForTests();
      expect(await zoneA(d)).toEqual(before);
    };
  };
  return {
    "dns_zones:handbackView": async () => {
      const s = env.seed();
      const d = dom();
      await notFound(() => handbackView(ctx(), s.A.org));
      const own = await handbackView(ctx());
      expect(mentionsA(own, d)).toBe(false);
    },
    "dns_zones:chooseHandbackDestination": both((org, domain) =>
      chooseHandbackDestination(ctx(), org, domain, { kind: "registrar" }),
    ),
    "dns_zones:checkHandbackDestination": both((org, domain) =>
      checkHandbackDestination(ctx(), org, domain),
    ),
    "dns_zones:confirmHandbackSwitched": both((org, domain) =>
      confirmHandbackSwitched(ctx(), org, domain),
    ),
    "dns_zones:handbackZoneFile": both((org, domain) =>
      handbackZoneFile(ctx(), org, domain),
    ),
  };
}

function otherOwnerAttacks(env: AttackEnv, dom: () => DomainSeed): AttackMap {
  const ctx = (): OrgContext => env.seed().ctxB;
  return {
    // 14-20: a preview link for org A's page is NotFound for org B.
    "pages:mintPreviewLink": async () => {
      const s = env.seed();
      await notFound(() => mintPreviewLink(ctx(), s.A.page));
    },
    // 14-25: sending view and local part read and write org B's own profile only.
    "business_profile:sendingDomain": async () => {
      const d = dom();
      const v = await getSendingView(ctx());
      expect(mentionsA(v, d)).toBe(false);
      const set = await setSendingLocalPart(ctx(), "hello");
      expect(mentionsA(set, d)).toBe(false);
      const rowA = await env
        .pb()
        .collection("business_profile")
        .getFirstListItem(
          env.pb().filter("organization = {:o}", { o: env.seed().A.org }),
        );
      expect(rowA.sending_local_part ?? "").not.toBe("hello");
    },
    // 14-32: the search status reads org B's own org only.
    "org_indexing:ownerSearchStatus": async () => {
      const d = dom();
      const v = await ownerSearchStatus(ctx());
      expect(mentionsA(v, d)).toBe(false);
    },
  };
}

export function attacks(
  env: AttackEnv,
  domains?: () => P14DomainSeed | undefined,
): AttackMap {
  const base: AttackMap = {
    launch_review_marks: readOnlyAttack(env, "launch_review_marks"),
    "launch_review_marks:list": listAttack(env),
    "launch_review_marks:markPage": markPageAttack(env),
    "launch_review_marks:reviewPages": reviewPagesAttack(env),
    "launch_review_marks:requestPageChange": requestPageChangeAttack(env),
  };
  if (!domains) return base;
  const dom = (): DomainSeed => {
    const d = domains()?.domains;
    if (!d) throw new Error("p14-domains: the domain world was not seeded");
    return d;
  };
  return {
    ...base,
    ...moveAttacks(env, dom),
    ...recordAttacks(env, dom),
    ...offboardingAttacks(env, dom),
    ...handbackAttacks(env, dom),
    ...otherOwnerAttacks(env, dom),
  };
}
