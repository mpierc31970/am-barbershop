// 14-13 (DOM-05; T-14-13-01, T-14-13-02): snapshots from three sources and the read-back gate
// on the real PocketBase binary over the fake DNS world.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatBind, recordKey, type DnsRecord } from "@cds/core/dns";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests } from "../src/client";
import { resetDnsForTests } from "../src/dns/factory";
import { fakeDnsProvider } from "../src/dns/fake/provider";
import { runGate } from "../src/dns/gate-runner";
import type { DnsProvider } from "../src/dns/ports";
import {
  readDnsZoneRow,
  readSnapshot,
  takeSnapshot,
  upsertDnsZoneRow,
} from "../src/dns/snapshot";
import { getObjectStore } from "../src/storage";
import { presetRecords, seedFakeDomain } from "./helpers/fake-dns-world";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let storageDir = "";
const savedStorageDir = process.env.CDS_STORAGE_DIR;
const ORG = "snaporg00000001";
const provider = fakeDnsProvider();

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-dns-snapshot-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  resetDnsForTests();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

const find = (rs: DnsRecord[], type: string, name: string) =>
  rs.filter((r) => r.type === type && r.name === name);

const dmarc = (d: string): DnsRecord => ({
  type: "TXT",
  name: `_dmarc.${d}`,
  value: "v=DMARC1; p=none",
  ttl: 3600,
});

/** Create the fake CDS zone, record it on the row, and copy the snapshot into it. */
async function copyIntoCds(d: string, records: DnsRecord[]): Promise<string> {
  const z = await provider.createZone(d);
  await upsertDnsZoneRow(ORG, d, {
    provider: "fake",
    provider_zone_id: z.zoneId,
    nameservers: z.nameservers,
  });
  await provider.importBind(z.zoneId, formatBind(d, records));
  return z.zoneId;
}

describe("takeSnapshot (14-13 Task 1)", () => {
  it("sweeps a Google domain from its own nameservers and stores the JSON + row", async () => {
    if (!inst) return;
    const d = "rivera-snap.example";
    await seedFakeDomain(d, "google", {
      oldZone: [...presetRecords(d, "google"), dmarc(d)],
    });
    const at = new Date("2026-10-17T10:00:00.000Z");
    const { key, snapshot, zoneRowId } = await takeSnapshot(ORG, d, {
      now: at,
    });
    expect(key).toMatch(
      new RegExp(
        `tenants/${ORG}/dns/snapshots/2026-10-17T10-00-00-000Z\\.json$`,
      ),
    );
    const r = snapshot.records;
    expect(find(r, "MX", d)[0]?.sources).toEqual(["sweep"]);
    expect(
      r.find((x) => x.type === "TXT" && x.value.startsWith("v=spf1"))?.sources,
    ).toEqual(["sweep"]);
    expect(find(r, "TXT", `google._domainkey.${d}`)).toHaveLength(1);
    expect(find(r, "TXT", `_dmarc.${d}`)).toHaveLength(1);
    expect(r.some((x) => x.type === "NS" || x.type === "SOA")).toBe(false);
    expect(snapshot.originalNameservers).toEqual([
      "ns1.oldhost.test",
      "ns2.oldhost.test",
    ]);
    expect(snapshot.wildcard).toBe(false);
    expect(snapshot.dnssec).toBe(false);
    expect(snapshot.registrar).toBe("GoDaddy");

    const stored = await getObjectStore().get(key);
    expect(stored).not.toBeNull();
    const row = await readDnsZoneRow(ORG, d);
    expect(row?.id).toBe(zoneRowId);
    expect(row?.snapshotKey).toBe(key);
    expect(row?.status).toBe("pending");
    expect(row?.dnssec).toBe("off");
    expect(row?.registrar).toBe("GoDaddy");
    expect(row?.originalNameservers).toEqual(snapshot.originalNameservers);
    expect(await readSnapshot(ORG, key)).toEqual(snapshot);
    // A key outside the org's snapshot prefix is refused.
    await expect(readSnapshot("otherorg0000001", key)).rejects.toMatchObject({
      name: "NotFound",
    });
  });

  it("adds zone-file records the sweep cannot see and merges sources", async () => {
    if (!inst) return;
    const d = "zonefile-snap.example";
    await seedFakeDomain(d, "google");
    const zoneFile = [
      `$ORIGIN ${d}.`,
      "$TTL 3600",
      `@ IN MX 1 smtp.google.com.`,
      `files2 IN A 198.18.0.20`,
      `s2024._domainkey IN TXT "v=DKIM1; k=rsa; p=MIIBzonefileonlykey"`,
      `internal IN TXT "hello-zone-file"`,
    ].join("\n");
    const { snapshot } = await takeSnapshot(ORG, d, { zoneFile });
    const r = snapshot.records;
    expect(find(r, "A", `files2.${d}`)[0]?.sources).toEqual(["zone_file"]);
    expect(find(r, "TXT", `s2024._domainkey.${d}`)[0]?.sources).toEqual([
      "zone_file",
    ]);
    expect(find(r, "TXT", `internal.${d}`)[0]?.sources).toEqual(["zone_file"]);
    expect(find(r, "MX", d)[0]?.sources).toEqual(["zone_file", "sweep"]);
    expect(snapshot.sources).toEqual(["zone_file", "sweep"]);
    // Deduped: one MX.
    expect(find(r, "MX", d)).toHaveLength(1);
  });

  it("records a wildcard once and invents no hosts", async () => {
    if (!inst) return;
    const d = "wild-snap.example";
    await seedFakeDomain(d, "wildcard");
    const { snapshot } = await takeSnapshot(ORG, d, {
      deps: { probeLabel: () => "0a1b2c3d" },
    });
    expect(snapshot.wildcard).toBe(true);
    expect(snapshot.records.filter((x) => x.name === `*.${d}`)).toHaveLength(1);
    const names = new Set(snapshot.records.map((x) => x.name));
    expect([...names].sort()).toEqual([`*.${d}`, d, `www.${d}`].sort());
  });

  it("serialises only Snapshot fields (no ids, tokens or provider data)", async () => {
    if (!inst) return;
    const d = "fields-snap.example";
    await seedFakeDomain(d, "none");
    const leaky = {
      ...fakeDnsProvider(),
      name: "cloudflare" as const,
      async scanRecords() {
        return [
          {
            type: "TXT",
            name: `scan.${d}`,
            value: "scan-only",
            id: "cf-record-id",
            zone_id: "cf-zone-id",
            token: "secret-token",
            proxied: true,
          } as unknown as DnsRecord,
        ];
      },
    } satisfies DnsProvider;
    const { key, snapshot } = await takeSnapshot(ORG, d, {
      zoneId: "cf-zone-id",
      deps: { provider: leaky },
    });
    expect(find(snapshot.records, "TXT", `scan.${d}`)[0]?.sources).toEqual([
      "scan",
    ]);
    const json = new TextDecoder().decode(
      (await getObjectStore().get(key)) as Uint8Array,
    );
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "v",
        "domain",
        "takenAt",
        "sources",
        "wildcard",
        "records",
        "registrar",
        "dnssec",
        "originalNameservers",
      ].sort(),
    );
    for (const rec of parsed.records as Record<string, unknown>[]) {
      for (const k of Object.keys(rec)) {
        expect([
          "type",
          "name",
          "value",
          "priority",
          "ttl",
          "sources",
        ]).toContain(k);
      }
    }
    expect(json).not.toMatch(/secret-token|cf-record-id|cf-zone-id|proxied/);
  });
});

describe("runGate (14-13 Task 2)", () => {
  it("passes once the snapshot is copied into the CDS zone", async () => {
    if (!inst) return;
    const d = "gate-pass.example";
    await seedFakeDomain(d, "google", {
      oldZone: [...presetRecords(d, "google"), dmarc(d)],
    });
    const now = new Date();
    const { snapshot } = await takeSnapshot(ORG, d, { now });
    await copyIntoCds(d, snapshot.records);
    const res = await runGate(ORG, d, { now });
    expect(res.findings.map((f) => [f.rule, f.pass])).toEqual([
      ["G1", true],
      ["G2", true],
      ["G3", true],
      ["G4", true],
      ["G5", true],
      ["G6", true],
      ["G7", true],
    ]);
    expect(res.passed).toBe(true);
    expect(res.addedCaa).toBe(false);
  });

  it("fails G1 as a hard block when a DKIM is missing at the CDS nameservers", async () => {
    if (!inst) return;
    const d = "gate-readback.example";
    await seedFakeDomain(d, "google");
    const now = new Date();
    const { key, snapshot } = await takeSnapshot(ORG, d, { now });
    const zoneId = await copyIntoCds(d, snapshot.records);
    const dkim = (await provider.listRecords(zoneId)).find((r) =>
      r.name.startsWith("google._domainkey."),
    );
    expect(dkim).toBeDefined();
    await provider.deleteRecord(zoneId, dkim!.id);

    const res = await runGate(ORG, d, { now });
    const g1 = res.findings.find((f) => f.rule === "G1");
    expect(g1?.pass).toBe(false);
    expect(g1?.hardBlock).toBe(true);
    expect(res.hardBlocked).toBe(true);
    expect(res.passed).toBe(false);
    // The snapshot JSON is unchanged: the gate saw the nameservers, not the snapshot.
    expect(await readSnapshot(ORG, key)).toEqual(snapshot);
  });

  it("adds the Let's Encrypt CAA when the snapshot only allows another CA", async () => {
    if (!inst) return;
    const d = "gate-caa.example";
    const caa: DnsRecord = {
      type: "CAA",
      name: d,
      value: '0 issue "digicert.com"',
      ttl: 3600,
    };
    await seedFakeDomain(d, "google", {
      oldZone: [...presetRecords(d, "google"), caa],
    });
    const now = new Date();
    const { snapshot } = await takeSnapshot(ORG, d, { now });
    expect(snapshot.records.some((r) => r.type === "CAA")).toBe(true);
    await copyIntoCds(d, snapshot.records);

    const first = await runGate(ORG, d, { now });
    expect(first.addedCaa).toBe(true);
    expect(first.findings.find((f) => f.rule === "G4")?.pass).toBe(true);
    expect(first.passed).toBe(true);
    const row = await readDnsZoneRow(ORG, d);
    expect(row?.cdsKeys.cds).toContain(
      recordKey({ type: "CAA", name: d, value: '0 issue "letsencrypt.org"' }),
    );

    const again = await runGate(ORG, d, { now });
    expect(again.addedCaa).toBe(false);
    expect(again.findings.find((f) => f.rule === "G4")?.pass).toBe(true);
  });

  it("refuses when the CDS zone does not exist yet", async () => {
    if (!inst) return;
    const d = "gate-nozone.example";
    await seedFakeDomain(d, "none");
    await takeSnapshot(ORG, d);
    await expect(runGate(ORG, d)).rejects.toMatchObject({
      name: "InvalidInput",
    });
  });
});
