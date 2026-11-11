// packages/db/src/dns/fake/store.ts (P14, DOM-03; 14-10 choice 2).
// The fake DNS world's store: one `dns_fake_state` row per domain, `data` = the FakeWorld
// JSON. Platform collection, API rules null; read and written only here, through the
// superuser client with bound filters (invariant 1). Every function refuses in production
// first (T-14-10-01): the fake world is a dev/test stand-in and never answers there.
import { randomBytes } from "node:crypto";
import type { DnsRecord } from "@cds/core/dns";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../../client";
import type { ProviderRecord, ZoneStatus } from "../ports";

const COLLECTION = "dns_fake_state";

export type FakeDelegation = "old" | "cds" | "other";
export type FakeSesStatus = "none" | "pending" | "verified" | "failed";

/** One domain's whole outside world (14-10 interface contract). */
export type FakeWorld = {
  domain: string;
  registrar: string | null;
  expiresAt: string | null;
  dnssec: boolean;
  delegatedTo: FakeDelegation;
  oldNameservers: string[];
  oldZone: DnsRecord[];
  cdsZoneId: string | null;
  cdsNameservers: string[];
  cdsZone: ProviderRecord[];
  cdsStatus: ZoneStatus;
  otherNameservers: string[];
  otherZone: DnsRecord[];
  /** Replace, in the PUBLIC view only, every record of the same type + name. */
  publicOverrides: DnsRecord[];
  https: "ok" | "fail";
  certDaysLeft: number;
  ses: { status: FakeSesStatus; tokens: string[] };
};

/** The fake world is refused in production (T-14-10-01). */
export class FakeDnsRefused extends Error {
  constructor() {
    super("The fake DNS world is not available in production");
    this.name = "FakeDnsRefused";
  }
}

export function refuseInProduction(): void {
  if (process.env.CDS_ENV === "production") throw new FakeDnsRefused();
}

export const FAKE_CDS_NAMESERVERS: readonly string[] = Object.freeze([
  "ada.ns.cloudflare.test",
  "bob.ns.cloudflare.test",
]);

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.$/, "");
}

/** A world with nothing in it: delegated to the old host, HTTPS failing, no SES. */
export function emptyFakeWorld(domain: string): FakeWorld {
  return {
    domain: normalizeDomain(domain),
    registrar: null,
    expiresAt: null,
    dnssec: false,
    delegatedTo: "old",
    oldNameservers: [],
    oldZone: [],
    cdsZoneId: null,
    cdsNameservers: [],
    cdsZone: [],
    cdsStatus: "pending",
    otherNameservers: [],
    otherZone: [],
    publicOverrides: [],
    https: "fail",
    certDaysLeft: 0,
    ses: { status: "none", tokens: [] },
  };
}

export function fakeZoneId(): string {
  return `fz_${randomBytes(8).toString("hex")}`;
}

function isNotFound(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 404;
}

function toWorld(r: RecordModel): FakeWorld {
  const d = (r.data ?? {}) as Partial<FakeWorld>;
  return { ...emptyFakeWorld(String(r.domain)), ...d };
}

async function findRow(domain: string): Promise<RecordModel | null> {
  return withSuperuser(async (pb) => {
    try {
      return await pb
        .collection(COLLECTION)
        .getFirstListItem(pb.filter("domain = {:d}", { d: domain }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  });
}

export async function storeGet(domain: string): Promise<FakeWorld | null> {
  refuseInProduction();
  const row = await findRow(normalizeDomain(domain));
  return row ? toWorld(row) : null;
}

export async function storePut(world: FakeWorld): Promise<FakeWorld> {
  refuseInProduction();
  const w: FakeWorld = { ...world, domain: normalizeDomain(world.domain) };
  const row = await findRow(w.domain);
  await withSuperuser((pb) =>
    row
      ? pb.collection(COLLECTION).update(row.id, { data: w })
      : pb.collection(COLLECTION).create({ domain: w.domain, data: w }),
  );
  return w;
}

export async function storeList(): Promise<FakeWorld[]> {
  refuseInProduction();
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({ sort: "domain" }),
  );
  return rows.map(toWorld);
}

export async function storeDelete(domain: string): Promise<void> {
  refuseInProduction();
  const row = await findRow(normalizeDomain(domain));
  if (!row) return;
  await withSuperuser((pb) => pb.collection(COLLECTION).delete(row.id));
}

/** The world that holds a CDS zone id, or null. */
export async function storeByZoneId(zoneId: string): Promise<FakeWorld | null> {
  refuseInProduction();
  const all = await storeList();
  return all.find((w) => w.cdsZoneId === zoneId) ?? null;
}

/** A provider record as a plain DnsRecord (drops the host's id). */
export function withoutId(r: ProviderRecord): DnsRecord {
  const out: DnsRecord = { type: r.type, name: r.name, value: r.value };
  if (r.priority !== undefined) out.priority = r.priority;
  if (r.ttl !== undefined) out.ttl = r.ttl;
  if (r.sources) out.sources = [...r.sources];
  return out;
}
