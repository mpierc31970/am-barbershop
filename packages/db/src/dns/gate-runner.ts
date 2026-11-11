// packages/db/src/dns/gate-runner.ts (P14, DOM-05, DOM-04).
// Owner: 14-13 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The data side of the zone gate (14-13 choice 3). G1 compares the snapshot with the copy
// READ BACK from the CDS zone's assigned nameservers, asked by IP: the host's API listing is
// never used for the gate (T-14-13-01), so a record missing behind the API echo still fails.
// G4: when the snapshot's CAA set would refuse Let's Encrypt, runGate adds `0 issue
// "letsencrypt.org"` through the provider (classified `cds` via dns_zones.cds_keys,
// P14-P39), reads back again and re-gates once. Callers re-run the gate before every step
// that depends on the copy (DOM-05).
import { InvalidInput, NotFound } from "@cds/core";
import {
  dedupeRecords,
  fqdn,
  normalizeRecord,
  recordKey,
  registrarFromRdapName,
  zoneGate,
  type DnsRecord,
  type GateFinding,
  type GateRule,
  type RType,
} from "@cds/core/dns";
import type { ObjectStore } from "../storage";
import { getDnsProvider, getDnsResolver, getRegistryLookup } from "./factory";
import { mapLimited } from "./limit";
import type { DnsProvider, DnsResolver, RegistryLookup } from "./ports";
import {
  DNS_QUERY_CONCURRENCY,
  latestSnapshot,
  upsertDnsZoneRow,
  type DnsZoneRow,
} from "./snapshot";

/** The CDS nameservers could not be reached by IP (no address for any of them). */
export class ReadBackUnavailable extends Error {
  constructor() {
    super("The CDS nameservers could not be reached");
    this.name = "ReadBackUnavailable";
  }
}

export type GateRunDeps = {
  resolver?: DnsResolver;
  registry?: RegistryLookup;
  provider?: DnsProvider;
  store?: ObjectStore;
};

export type GateRunResult = {
  findings: GateFinding[];
  passed: boolean;
  hardBlocked: boolean;
  tooManyRecords: boolean;
  /** runGate wrote the Let's Encrypt CAA record into the CDS zone this run. */
  addedCaa: boolean;
};

/**
 * Read the copy back from the zone's assigned nameservers (by IP) for every (name, type)
 * pair in `records`, plus the apex CAA. Never the provider's API listing.
 */
export async function readBackCopy(
  zone: Pick<DnsZoneRow, "domain" | "nameservers">,
  opts: { records: readonly DnsRecord[]; resolver?: DnsResolver },
): Promise<DnsRecord[]> {
  const resolver = opts.resolver ?? getDnsResolver();
  const d = fqdn(zone.domain);
  if (zone.nameservers.length === 0) throw new ReadBackUnavailable();
  const ipLists = await Promise.all(
    zone.nameservers.map((n) => resolver.ipsFor(n)),
  );
  const servers = [...new Set(ipLists.flat())];
  if (servers.length === 0) throw new ReadBackUnavailable();

  const pairs = new Map<string, { name: string; type: RType }>();
  const add = (name: string, type: RType): void => {
    pairs.set(`${type}\u0000${name}`, { name, type });
  };
  for (const r of opts.records) {
    if (r.type === "SOA") continue;
    const name = fqdn(r.name);
    if (r.type === "NS" && name === d) continue;
    add(name, r.type);
  }
  add(d, "CAA");

  const answers = await mapLimited(
    [...pairs.values()],
    DNS_QUERY_CONCURRENCY,
    async (p) => {
      const a = await resolver.resolve(p.name, p.type, { servers });
      return a.status === "ok" ? a.records : [];
    },
  );
  return dedupeRecords(answers.flat().map((r) => normalizeRecord(r)));
}

/**
 * Run the gate for `orgId`'s latest snapshot of `domain` against the read-back copy
 * (14-13 choice 3). `acks` are owner G5 acknowledgements, `overrides` staff overrides (the
 * caller authorizes and audits them). The CDS zone must exist (provider_zone_id and
 * nameservers on the dns_zones row).
 */
export async function runGate(
  orgId: string,
  domain: string,
  opts: {
    acks?: ReadonlySet<string>;
    overrides?: ReadonlySet<GateRule>;
    deps?: GateRunDeps;
    now?: Date;
  } = {},
): Promise<GateRunResult> {
  const deps = opts.deps ?? {};
  const now = opts.now ?? new Date();
  const latest = await latestSnapshot(orgId, domain, { store: deps.store });
  if (!latest) throw new NotFound();
  const { snapshot, row } = latest;
  if (!row.providerZoneId || row.nameservers.length === 0) {
    throw new InvalidInput("The CDS zone does not exist yet");
  }
  const resolver = deps.resolver ?? getDnsResolver();
  const info = await (deps.registry ?? getRegistryLookup()).lookup(
    snapshot.domain,
  );

  const gate = (copy: DnsRecord[]) =>
    zoneGate({
      domain: snapshot.domain,
      snapshot: snapshot.records,
      copy,
      takenAt: new Date(snapshot.takenAt),
      now,
      dnssec: info.dnssec,
      zoneFileUploaded: snapshot.sources.includes("zone_file"),
      acks: opts.acks ?? new Set<string>(),
      overrides: opts.overrides ?? new Set<GateRule>(),
      registrar: registrarFromRdapName(snapshot.registrar ?? info.registrar),
    });

  const read = () => readBackCopy(row, { records: snapshot.records, resolver });
  let result = gate(await read());
  let addedCaa = false;

  const g4 = result.findings.find((f) => f.rule === "G4");
  const addRecord =
    g4 && !g4.pass && g4.detail.rule === "G4" ? g4.detail.addRecord : null;
  if (addRecord) {
    const provider = deps.provider ?? getDnsProvider();
    const rec: DnsRecord = { ...addRecord, ttl: 3600, sources: ["cds"] };
    await provider.upsertRecord(row.providerZoneId, rec);
    const cds = [...new Set([...row.cdsKeys.cds, recordKey(rec)])];
    await upsertDnsZoneRow(orgId, snapshot.domain, {
      cds_keys: { cds, owner: row.cdsKeys.owner },
    });
    addedCaa = true;
    result = gate(await read());
  }

  return {
    findings: result.findings,
    passed: result.passed,
    hardBlocked: result.hardBlocked,
    tooManyRecords: result.tooManyRecords,
    addedCaa,
  };
}
