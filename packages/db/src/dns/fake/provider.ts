// packages/db/src/dns/fake/provider.ts (P14, DOM-03; 14-10 choice 3).
// The fake DNS host: the CDS zone lives inside the domain's FakeWorld. Zone ids `fz_<hex>`,
// record ids `fr_<n>`, nameservers ada/bob.ns.cloudflare.test. Status follows delegation:
// `active` while delegatedTo = cds, `moved` once delegated away after being active.
// NS records at the apex are refused (delegation is the owner's registrar's job, D56).
import { InvalidInput, NotFound } from "@cds/core";
import {
  formatBind,
  normalizeRecord,
  parseBind,
  recordKey,
  type DnsRecord,
} from "@cds/core/dns";
import type { DnsProvider, ProviderRecord, ZoneStatus } from "../ports";
import {
  emptyFakeWorld,
  FAKE_CDS_NAMESERVERS,
  fakeZoneId,
  normalizeDomain,
  refuseInProduction,
  storeByZoneId,
  storeGet,
  storePut,
  withoutId,
  type FakeWorld,
} from "./store";

/** Types where one name holds one record (an upsert replaces it). */
const SINGLE_VALUE = new Set(["CNAME", "SOA"]);

/** `active` while delegated to CDS; `moved` once delegated away after being active. */
export function fakeZoneStatusOf(w: FakeWorld): ZoneStatus {
  if (!w.cdsZoneId) return "pending";
  if (w.delegatedTo === "cds") return "active";
  if (w.cdsStatus === "active" || w.cdsStatus === "moved") return "moved";
  return "pending";
}

async function worldFor(zoneId: string): Promise<FakeWorld> {
  const w = await storeByZoneId(zoneId);
  if (!w) throw new NotFound("zone not found");
  return w;
}

function nextRecordId(zone: readonly ProviderRecord[]): string {
  let max = 0;
  for (const r of zone) {
    const n = Number(r.id.replace(/^fr_/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `fr_${max + 1}`;
}

function sameSlot(a: DnsRecord, b: DnsRecord): boolean {
  if (SINGLE_VALUE.has(a.type)) return a.type === b.type && a.name === b.name;
  return recordKey(a) === recordKey(b);
}

/** Upsert into a zone array in place; returns the stored record and whether it was new. */
function upsertInto(
  w: FakeWorld,
  raw: DnsRecord,
): { rec: ProviderRecord; added: boolean } {
  const r = normalizeRecord(raw);
  if (r.type === "NS" && r.name === w.domain) {
    throw new InvalidInput("NS records at the zone apex are not writable");
  }
  if (r.name !== w.domain && !r.name.endsWith(`.${w.domain}`)) {
    throw new InvalidInput("record is outside the zone");
  }
  const i = w.cdsZone.findIndex((x) => sameSlot(x, r));
  if (i >= 0) {
    const rec: ProviderRecord = {
      ...r,
      id: (w.cdsZone[i] as ProviderRecord).id,
    };
    w.cdsZone[i] = rec;
    return { rec, added: false };
  }
  const rec: ProviderRecord = { ...r, id: nextRecordId(w.cdsZone) };
  w.cdsZone.push(rec);
  return { rec, added: true };
}

export function fakeDnsProvider(): DnsProvider {
  return {
    name: "fake",

    async createZone(domain) {
      refuseInProduction();
      const d = normalizeDomain(domain);
      const w = (await storeGet(d)) ?? emptyFakeWorld(d);
      if (!w.cdsZoneId) {
        w.cdsZoneId = fakeZoneId();
        w.cdsNameservers = [...FAKE_CDS_NAMESERVERS];
        w.cdsZone = [];
        w.cdsStatus = "pending";
      }
      w.cdsStatus = fakeZoneStatusOf(w);
      await storePut(w);
      return {
        zoneId: w.cdsZoneId,
        nameservers: [...w.cdsNameservers],
        status: w.cdsStatus,
      };
    },

    async zoneStatus(zoneId) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      const s = fakeZoneStatusOf(w);
      if (s !== w.cdsStatus) {
        w.cdsStatus = s;
        await storePut(w);
      }
      return s;
    },

    async listRecords(zoneId) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      return w.cdsZone.map((r) => ({ ...r }));
    },

    async upsertRecord(zoneId, r) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      const { rec } = upsertInto(w, r);
      await storePut(w);
      return { ...rec };
    },

    async deleteRecord(zoneId, recordId) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      const before = w.cdsZone.length;
      w.cdsZone = w.cdsZone.filter((r) => r.id !== recordId);
      if (w.cdsZone.length !== before) await storePut(w);
    },

    async importBind(zoneId, zoneFile) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      let added = 0;
      let skipped = 0;
      for (const r of parseBind(zoneFile, w.domain)) {
        if (r.type === "SOA" || (r.type === "NS" && r.name === w.domain)) {
          skipped++;
          continue;
        }
        if (upsertInto(w, r).added) added++;
        else skipped++;
      }
      await storePut(w);
      return { added, skipped };
    },

    async exportBind(zoneId) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      return formatBind(w.domain, w.cdsZone.map(withoutId));
    },

    async scanRecords(zoneId) {
      refuseInProduction();
      await worldFor(zoneId);
      return [];
    },

    async deleteZone(zoneId) {
      refuseInProduction();
      const w = await worldFor(zoneId);
      w.cdsZoneId = null;
      w.cdsNameservers = [];
      w.cdsZone = [];
      w.cdsStatus = "pending";
      await storePut(w);
    },
  };
}
