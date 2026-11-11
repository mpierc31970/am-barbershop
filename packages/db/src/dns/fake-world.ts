// packages/db/src/dns/fake-world.ts (P14, DOM-03, DOM-04).
// Owner: 14-10 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The fake DNS world (14-10 choices 2-5), barrel-exported for `/test-dns` (14-44) and tests:
// read/write one domain's world, plus named actions that play the outside world (the owner
// changing nameservers, someone breaking an email record, DNSSEC, HTTPS, SES, expiry). Every
// function refuses in production first (T-14-10-01).
import { fqdn, type DnsRecord } from "@cds/core/dns";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { fakeZoneStatusOf } from "./fake/provider";
import {
  emptyFakeWorld,
  normalizeDomain,
  refuseInProduction,
  storeDelete,
  storeGet,
  storeList,
  storePut,
  withoutId,
  type FakeDelegation,
  type FakeSesStatus,
  type FakeWorld,
} from "./fake/store";

export type { FakeDelegation, FakeSesStatus, FakeWorld };
export { FakeDnsRefused, FAKE_CDS_NAMESERVERS } from "./fake/store";
export { fakeNameserverIp } from "./fake/resolver";
export { setFakeProberProof, type FakeProofHook } from "./fake/prober";

const DAY_MS = 86_400_000;

/** A world with nothing in it (delegated to the old host, HTTPS failing). */
export function fakeWorldEmpty(domain: string): FakeWorld {
  refuseInProduction();
  return emptyFakeWorld(domain);
}

export async function fakeWorldGet(domain: string): Promise<FakeWorld | null> {
  refuseInProduction();
  return storeGet(domain);
}

/** Create or replace one domain's world. */
export async function fakeWorldPut(world: FakeWorld): Promise<FakeWorld> {
  refuseInProduction();
  return storePut(world);
}

/** Shallow-merge a patch into a world (created empty when missing). */
export async function fakeWorldPatch(
  domain: string,
  patch: Partial<Omit<FakeWorld, "domain">>,
): Promise<FakeWorld> {
  refuseInProduction();
  const d = normalizeDomain(domain);
  const w = (await storeGet(d)) ?? emptyFakeWorld(d);
  return storePut({ ...w, ...patch, domain: d });
}

export async function fakeWorldList(): Promise<FakeWorld[]> {
  refuseInProduction();
  return storeList();
}

export async function fakeWorldDelete(domain: string): Promise<void> {
  refuseInProduction();
  await storeDelete(domain);
}

/** One fake world the caller's org holds a CDS zone for (`/test-dns`, 14-44). */
export type FakeWorldForOrg = {
  world: FakeWorld;
  /** The org's `dns_zones.status` for this domain. */
  zoneStatus: "pending" | "active" | "moved";
};

/**
 * The fake worlds of the caller's own org (14-44 deviation, T-14-44-02): every `dns_zones`
 * row with `org_id = ctx.orgId`, provider `fake` and status pending/active/moved that has a
 * world. The org comes from the context only (invariant 1); `/test-dns` uses this list as its
 * ownership check, so a member can never flip another org's world.
 */
export async function fakeWorldsForOrg(
  ctx: OrgContext,
): Promise<FakeWorldForOrg[]> {
  refuseInProduction();
  assertOrgContext(ctx);
  const rows = await withSuperuser((pb) =>
    pb.collection("dns_zones").getFullList({
      filter: pb.filter(
        "org_id = {:org} && provider = 'fake' && (status = 'pending' || status = 'active' || status = 'moved')",
        { org: ctx.orgId },
      ),
      sort: "domain,-updated",
    }),
  );
  const out: FakeWorldForOrg[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const domain = String(row.domain).trim().toLowerCase();
    if (seen.has(domain)) continue;
    seen.add(domain);
    const world = await storeGet(domain);
    if (!world) continue;
    out.push({
      world,
      zoneStatus: row.status as FakeWorldForOrg["zoneStatus"],
    });
  }
  return out;
}

async function mustGet(domain: string): Promise<FakeWorld> {
  const w = await storeGet(domain);
  if (!w) throw new Error("fake DNS world: unknown domain");
  return w;
}

/** The owner changes nameservers at the registrar. The CDS zone status follows. */
export async function fakeChangeNameservers(
  domain: string,
  to: FakeDelegation,
): Promise<FakeWorld> {
  refuseInProduction();
  const w = await mustGet(domain);
  w.delegatedTo = to;
  w.cdsStatus = fakeZoneStatusOf(w);
  return storePut(w);
}

/**
 * Someone breaks an email record in the PUBLIC view: the first MX (else the SPF TXT, else a
 * new MX) gets a public override with a wrong value. Authoritative reads are unchanged.
 * Returns the override written.
 */
export async function fakeBreakEmailRecord(domain: string): Promise<DnsRecord> {
  refuseInProduction();
  const w = await mustGet(domain);
  const zone: DnsRecord[] =
    w.delegatedTo === "cds"
      ? w.cdsZone.map(withoutId)
      : w.delegatedTo === "old"
        ? w.oldZone
        : w.otherZone;
  const mx = zone.find((r) => r.type === "MX");
  const spf = zone.find(
    (r) => r.type === "TXT" && r.value.toLowerCase().startsWith("v=spf1"),
  );
  const broken: DnsRecord = mx
    ? {
        type: "MX",
        name: fqdn(mx.name),
        value: "broken.mail.invalid",
        priority: 10,
      }
    : spf
      ? { type: "TXT", name: fqdn(spf.name), value: "v=spf1 -all" }
      : {
          type: "MX",
          name: w.domain,
          value: "broken.mail.invalid",
          priority: 10,
        };
  w.publicOverrides = [...w.publicOverrides, broken];
  await storePut(w);
  return broken;
}

export async function fakeSetDnssec(
  domain: string,
  on: boolean,
): Promise<FakeWorld> {
  refuseInProduction();
  const w = await mustGet(domain);
  w.dnssec = on;
  return storePut(w);
}

export async function fakeSetHttps(
  domain: string,
  ok: boolean,
): Promise<FakeWorld> {
  refuseInProduction();
  const w = await mustGet(domain);
  w.https = ok ? "ok" : "fail";
  if (ok && w.certDaysLeft <= 0) w.certDaysLeft = 89;
  return storePut(w);
}

/** SES identity status; pending/verified get three DKIM tokens when there are none yet. */
export async function fakeSetSesStatus(
  domain: string,
  s: FakeSesStatus,
): Promise<FakeWorld> {
  refuseInProduction();
  const w = await mustGet(domain);
  const tokens =
    s === "none"
      ? []
      : w.ses.tokens.length > 0
        ? w.ses.tokens
        : ["fakedkim1", "fakedkim2", "fakedkim3"].map(
            (t) => `${t}${w.domain.replace(/[^a-z0-9]/g, "")}`,
          );
  w.ses = { status: s, tokens };
  return storePut(w);
}

/** The registration expires `days` from `now` (injectable clock). */
export async function fakeExpireIn(
  domain: string,
  days: number,
  now: Date = new Date(),
): Promise<FakeWorld> {
  refuseInProduction();
  const w = await mustGet(domain);
  w.expiresAt = new Date(now.getTime() + days * DAY_MS).toISOString();
  return storePut(w);
}
