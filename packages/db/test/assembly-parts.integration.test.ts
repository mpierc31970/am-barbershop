// P8 (08-11): assembly ledger I/O and the platform-assigned preview host on the real
// PocketBase 0.39.11 binary (TMPL-02; CONTEXT A2-Q3; RESEARCH R-4; T-08-11-02, T-08-11-03).
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { emptyLedger, readLedger, writeLedger } from "../src/assembly/ledger";
import { ensurePreviewHost } from "../src/assembly/preview-host";
import { resetClientForTests, superuser } from "../src/client";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const ID = "abcdefghijklmno";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

beforeAll(async () => {
  vi.stubEnv("CDS_PREVIEW_HOST_SUFFIX", "sites.localhost");
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await inst?.stop();
});

async function newOrg(slug: string): Promise<string> {
  return (
    await pb.collection("organizations").create({
      name: slug,
      slug,
      status: "active",
    })
  ).id;
}

async function hostsOf(org: string) {
  return pb.collection("org_hosts").getFullList({
    filter: pb.filter("organization = {:org}", { org }),
  });
}

describe("ensurePreviewHost (R-4)", () => {
  it("gives a host-less org <slug>.<suffix>, kind preview, primary; a second call writes nothing", async (t) => {
    if (!inst) return t.skip();
    const org = await newOrg("rivera-bakery");
    expect(await ensurePreviewHost(org)).toBe("rivera-bakery.sites.localhost");
    const rows = await hostsOf(org);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      hostname: "rivera-bakery.sites.localhost",
      kind: "preview",
      primary: true,
    });
    const updated = rows[0]!.updated;
    expect(await ensurePreviewHost(org)).toBe("rivera-bakery.sites.localhost");
    const again = await hostsOf(org);
    expect(again).toHaveLength(1);
    expect(again[0]!.updated).toBe(updated);
  });

  it("leaves an org that already has a host alone", async (t) => {
    if (!inst) return t.skip();
    const before = await hostsOf(seed.B.org);
    expect(await ensurePreviewHost(seed.B.org)).toBe("b.example.com");
    const after = await hostsOf(seed.B.org);
    expect(after.map((r) => [r.id, r.updated])).toEqual(
      before.map((r) => [r.id, r.updated]),
    );
  });

  it("never reassigns a hostname another org owns", async (t) => {
    if (!inst) return t.skip();
    const other = await newOrg("someone-else");
    await pb.collection("org_hosts").create({
      hostname: "taken-name.sites.localhost",
      organization: other,
      kind: "preview",
      primary: true,
    });
    const org = await newOrg("taken-name");
    await expect(ensurePreviewHost(org)).rejects.toBeInstanceOf(InvalidInput);
    expect(await hostsOf(org)).toHaveLength(0);
    const owner = await pb
      .collection("org_hosts")
      .getFirstListItem(
        pb.filter("hostname = {:h}", { h: "taken-name.sites.localhost" }),
      );
    expect(owner.organization).toBe(other);
  });

  it("refuses an unknown org id", async (t) => {
    if (!inst) return t.skip();
    await expect(ensurePreviewHost(ID)).rejects.toBeInstanceOf(NotFound);
  });
});

describe("assembly ledger (CONTEXT A2-Q3)", () => {
  it("round-trips under the org's own context; the stored value is validated", async (t) => {
    if (!inst) return t.skip();
    const { rowId, ledger } = await readLedger(seed.ctxA);
    expect(rowId).toBe(seed.A.intake);
    expect(ledger).toEqual(emptyLedger());
    const next = {
      ...emptyLedger(),
      template_id: "standard-v1",
      template_version: 1,
      status: "running" as const,
      attempts: 1,
      pages: { home: { id: ID, slug: "", print: "abc", published: false } },
      evil: "x",
    };
    const saved = await writeLedger(seed.ctxA, rowId, next);
    expect("evil" in saved).toBe(false);
    const read = await readLedger(seed.ctxA);
    expect(read.ledger).toEqual(saved);
    expect(read.ledger.status).toBe("running");
    const raw = await pb.collection("org_intake").getOne(rowId);
    expect(raw.assembly).not.toHaveProperty("evil");
  });

  it("never reads another org's ledger", async (t) => {
    if (!inst) return t.skip();
    const b = await readLedger(seed.ctxB);
    expect(b.rowId).toBe(seed.B.intake);
    expect(b.ledger).toEqual(emptyLedger());
  });

  it("refuses a write to another org's row (cross-tenant write)", async (t) => {
    if (!inst) return t.skip();
    await expect(
      writeLedger(seed.ctxA, seed.B.intake, {
        ...emptyLedger(),
        status: "done",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    const raw = await pb.collection("org_intake").getOne(seed.B.intake);
    expect(raw.assembly ?? null).toBeNull();
  });

  it("refuses an unminted context", async (t) => {
    if (!inst) return t.skip();
    await expect(
      readLedger({ ...seed.ctxA } as typeof seed.ctxA),
    ).rejects.toThrow();
  });
});
