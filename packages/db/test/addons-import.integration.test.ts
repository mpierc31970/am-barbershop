// Shared CSV import/export and JSON backups on the real PocketBase 0.39.11 binary, driven
// through the real Testimonials add-on (ADDON-12, ADDON-13, ADDON-14; D120, D125, D126, D187,
// D270; T-05-36..40, T-05-43): server-side re-planning, all-or-nothing batches, both modes,
// dedupe, lossless export round trip, the newest-3 backups under
// tenants/<org>/backups/testimonials/, restore and its org boundary.
// Registers add-on collections before anything reads the composed registry (05-04).
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { AddonNotActive, type AddonRegistry } from "@cds/core/addons";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { parseCsv, serializeCsv } from "@cds/core/csv";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addonRepo } from "../src/addons/addon-repo";
import {
  ADDON_BACKUP_FORMAT,
  ADDON_BACKUP_VERSION,
  ADDON_BACKUPS_KEPT,
  listAddonBackups,
  restoreAddonBackup,
  saveAddonBackup,
} from "../src/addons/backups";
import { standInBillingGate } from "../src/addons/billing";
import {
  addonCsvTemplate,
  exportAddonCsv,
  importAddonRecords,
  previewAddonImport,
  REMOVALS_CHANGED_COPY,
} from "../src/addons/import";
import { installAddon, uninstallAddon } from "../src/addons/installer";
import type { AddonDeps } from "../src/addons/types";
import { resetClientForTests, superuser } from "../src/client";
import { recordingInvalidator } from "../src/content/ports";
import { mintOrgContext } from "../src/context";
import { clearResolverCache } from "../src/resolve";
import { toSnapshot } from "../src/snapshot";
import {
  getObjectStore,
  tenantAddonBackupKey,
  tenantAddonBackupPrefix,
  type ObjectStore,
} from "../src/storage";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const SLUG = "testimonials";
const HELD = "__cds_test_held__";
const HEADER =
  "Quote,Name,About them,Rating,Photo link,Photo description,Featured,Show on site";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;
let storageDir: string;
let store: ObjectStore;
const savedStorageDir = process.env.CDS_STORAGE_DIR;

const sections = composeSectionRegistry(
  CORE_SECTIONS,
  ADDON_REGISTRY.sections(),
);

function deps(addons: AddonRegistry = ADDON_REGISTRY): AddonDeps {
  return {
    sections,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    store,
    addons,
    billing: standInBillingGate(),
  };
}

/** The real registry, except Testimonials' validator lets "Break Me" through over-length. */
function breakingRegistry(): AddonRegistry {
  const real = ADDON_REGISTRY.get(SLUG)!;
  const spec = real.records[SLUG]!;
  const broken = {
    ...real,
    records: {
      ...real.records,
      [SLUG]: {
        ...spec,
        validate: (raw: unknown) => {
          const v = spec.validate(raw);
          return v.author_name === "Break Me"
            ? { ...v, quote: "x".repeat(1200) }
            : v;
        },
      },
    },
  };
  return {
    list: () => ADDON_REGISTRY.list(),
    publicList: () => ADDON_REGISTRY.publicList(),
    get: (slug) => (slug === SLUG ? broken : ADDON_REGISTRY.get(slug)),
    sections: () => ADDON_REGISTRY.sections(),
    ownerOf: (t) => ADDON_REGISTRY.ownerOf(t),
    dependentsOf: (s) => ADDON_REGISTRY.dependentsOf(s),
    conflictsOf: (s) => ADDON_REGISTRY.conflictsOf(s),
  };
}

const csv = (...rows: string[]) => `${HEADER}\r\n${rows.join("\r\n")}\r\n`;

async function rowsOf(orgId: string): Promise<Record<string, unknown>[]> {
  const rows = await pb.collection(SLUG).getFullList({
    filter: pb.filter("organization = {:o}", { o: orgId }),
    sort: "id",
  });
  return rows.map((r) => {
    const snap = toSnapshot(SLUG, r);
    delete snap.created;
    delete snap.updated;
    return snap;
  });
}

async function backupKeys(orgId: string): Promise<string[]> {
  return (await store.list(tenantAddonBackupPrefix(orgId, SLUG))).map(
    (o) => o.key,
  );
}

async function backupRows(
  orgId: string,
  id: string,
): Promise<Record<string, unknown>[]> {
  const key = (await backupKeys(orgId)).find((k) => k.endsWith(`${id}.json`));
  const bytes = await store.get(key!);
  const body = JSON.parse(new TextDecoder().decode(bytes!)) as {
    collections: Record<string, Record<string, unknown>[]>;
  };
  return body.collections[SLUG]!.map((r) => {
    const out = { ...r };
    delete out.created;
    delete out.updated;
    return out;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

beforeAll(async () => {
  storageDir = mkdtempSync(join(tmpdir(), "cds-addon-import-"));
  process.env.CDS_STORAGE_DIR = storageDir;
  store = getObjectStore();
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await installAddon(seed.ctxA, deps(), SLUG);
  await installAddon(seed.ctxB, deps(), SLUG);
});

afterAll(async () => {
  await inst?.stop();
  if (savedStorageDir === undefined) delete process.env.CDS_STORAGE_DIR;
  else process.env.CDS_STORAGE_DIR = savedStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
});

const MESSY =
  "﻿Quote,Name,About them,Rating\r\n" +
  '"Great, fast service",Ann Lee,"Owner, Lee Co",5\r\n' +
  '"She said ""wow""",Bob Ray,,4\r\n' +
  '"Great, fast service",Ann Lee,,5\r\n' +
  "Too many stars,Cy Dee,,7\r\n";

const FIVE = csv(
  '"Great, fast service",Ann Lee,"Owner, Lee Co",5,,,yes,yes',
  '"She said ""wow""",Bob Ray,,4,,,no,yes',
  "Kind and quick,Cy Dee,,,,,no,yes",
  "Would book again,Dee Fox,Regular,3,,,no,no",
  "Best in town,Eve Gray,,5,,,no,yes",
);

describe("add-on CSV import, export and backups (Testimonials)", () => {
  let restoredFrom = "";

  it("previews a messy file (BOM, CRLF, quotes) with a duplicate and a row error, and refuses to import it", async (t) => {
    if (!inst) return t.skip();
    const before = await rowsOf(seed.A.org);
    const preview = await previewAddonImport(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      MESSY,
      "update",
    );
    expect(preview.counts).toMatchObject({
      new: 2,
      duplicates: 1,
      errors: 1,
    });
    const errorRow = preview.rows.find((r) => r.status === "error")!;
    expect(errorRow.messages).toContain(
      "Row 5: Rating must be a number from 1 to 5.",
    );
    const quoted = preview.rows.find((r) => r.rowNumber === 3)!;
    expect(quoted.cells.quote).toBe('She said "wow"');

    await expect(
      importAddonRecords(seed.ctxA, deps(), SLUG, SLUG, MESSY, "update"),
    ).rejects.toThrow(
      "1 row needs fixing. Nothing is imported until every row is fixed.",
    );
    expect(await rowsOf(seed.A.org)).toEqual(before);
    expect(await backupKeys(seed.A.org)).toEqual([]);
  });

  it("previews a cross-field record error (photo without description) as a row error (B-WR-01)", async (t) => {
    if (!inst) return t.skip();
    const text = csv(
      "Lovely,Fay Hill,,5,,,no,yes",
      "Great,Gus Ivy,,4,https://example.com/g.jpg,,no,yes",
    );
    const preview = await previewAddonImport(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      text,
      "update",
    );
    expect(preview.counts).toMatchObject({ new: 1, errors: 1 });
    expect(preview.changes).toBe(1);
    const bad = preview.rows.find((r) => r.rowNumber === 3)!;
    expect(bad.status).toBe("error");
    expect(bad.messages).toEqual([
      "Row 3: Describe the photo for people who can't see it.",
    ]);
    await expect(
      importAddonRecords(seed.ctxA, deps(), SLUG, SLUG, text, "update"),
    ).rejects.toThrow("1 row needs fixing.");
    expect(await backupKeys(seed.A.org)).toEqual([]);
  });

  it("refuses oversized text and non-writers on the server, whatever the browser checked", async (t) => {
    if (!inst) return t.skip();
    const big = csv(`${"a".repeat(1_600_000)},Big,,,,,,`);
    await expect(
      previewAddonImport(seed.ctxA, deps(), SLUG, SLUG, big, "update"),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      importAddonRecords(seed.ctxA, deps(), SLUG, SLUG, big, "update"),
    ).rejects.toThrow("This file is too big");
    const viewer = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(
      importAddonRecords(viewer, deps(), SLUG, SLUG, FIVE, "update"),
    ).rejects.toBeInstanceOf(Forbidden);
    expect(await backupKeys(seed.A.org)).toEqual([]);
  });

  it("imports a fixed 5-row file and writes a before-import backup first", async (t) => {
    if (!inst) return t.skip();
    const before = await rowsOf(seed.A.org);
    const res = await importAddonRecords(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      FIVE,
      "update",
    );
    expect(res).toMatchObject({ added: 5, updated: 0, removed: 0 });
    const keys = await backupKeys(seed.A.org);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(`tenants/${seed.A.org}/backups/testimonials/`);
    expect(keys[0]).toMatch(new RegExp(`${res.backupId}\\.json$`));
    // The backup holds the state BEFORE the import.
    expect(await backupRows(seed.A.org, res.backupId)).toEqual(before);

    const rows = await pb.collection(SLUG).getFullList({
      filter: pb.filter("organization = {:o}", { o: seed.A.org }),
      sort: "sort_order",
    });
    expect(rows).toHaveLength(6);
    expect(rows.slice(1).map((r) => r.author_name)).toEqual([
      "Ann Lee",
      "Bob Ray",
      "Cy Dee",
      "Dee Fox",
      "Eve Gray",
    ]);
    expect(rows.slice(1).every((r) => r.source === "import")).toBe(true);
    const dee = rows.find((r) => r.author_name === "Dee Fox")!;
    expect(dee.is_published).toBe(false);
    expect(dee.rating).toBe(3);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'addon.import'", {
        o: seed.A.org,
      }),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ added: 5, mode: "update" });
  });

  it("export -> re-import in update mode changes nothing; a blank rating exports blank", async (t) => {
    if (!inst) return t.skip();
    const exp = await exportAddonCsv(seed.ctxA, deps(), SLUG, SLUG);
    expect(exp.filename).toMatch(/^testimonials-\d{4}-\d{2}-\d{2}\.csv$/);
    const parsed = parseCsv(exp.csv);
    if (!parsed.ok) throw new Error("export did not parse");
    expect(parsed.header).toEqual(["id", ...HEADER.split(",")]);
    const fixture = parsed.rows.find((r) => r[2] === "Customer A")!;
    expect(fixture[4]).toBe(""); // PB stores no rating as 0; it exports blank

    const preview = await previewAddonImport(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      exp.csv,
      "update",
    );
    expect(preview.counts).toEqual({
      new: 0,
      updated: 0,
      unchanged: 6,
      duplicates: 0,
      errors: 0,
    });
    expect(preview.changes).toBe(0);
    const before = await rowsOf(seed.A.org);
    const res = await importAddonRecords(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      exp.csv,
      "update",
    );
    expect(res).toMatchObject({ added: 0, updated: 0, removed: 0 });
    expect(await rowsOf(seed.A.org)).toEqual(before);

    const tpl = addonCsvTemplate(deps(), SLUG, SLUG);
    expect(tpl.filename).toBe("testimonials-template.csv");
    expect(tpl.csv).toContain(HEADER);
  });

  it("an edited export updates one row and adds one", async (t) => {
    if (!inst) return t.skip();
    const exp = await exportAddonCsv(seed.ctxA, deps(), SLUG, SLUG);
    const parsed = parseCsv(exp.csv);
    if (!parsed.ok) throw new Error("export did not parse");
    const bob = parsed.rows.find((r) => r[2] === "Bob Ray")!;
    bob[1] = "She said wow, twice";
    const rows = [
      ...parsed.rows,
      ["", "New friend", "Fay Hill", "", "", "", "", "no", "yes"],
    ];
    const text = serializeCsv(parsed.header, rows);
    const res = await importAddonRecords(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      text,
      "update",
    );
    expect(res).toMatchObject({ added: 1, updated: 1, removed: 0 });
    const updated = await pb.collection(SLUG).getOne(bob[0]!);
    expect(updated.quote).toBe("She said wow, twice");
    expect(updated.author_name).toBe("Bob Ray");
    expect(updated.rating).toBe(4);
    expect(updated.source).toBe("import");
  });

  it("Replace all removes exactly the records not in the file", async (t) => {
    if (!inst) return t.skip();
    const exp = await exportAddonCsv(seed.ctxA, deps(), SLUG, SLUG);
    const parsed = parseCsv(exp.csv);
    if (!parsed.ok) throw new Error("export did not parse");
    const keep = parsed.rows.slice(0, 3);
    const gone = parsed.rows.slice(3).map((r) => r[0]!);
    const text = serializeCsv(parsed.header, keep);

    const preview = await previewAddonImport(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      text,
      "replace",
    );
    expect(preview.removals.map((r) => r.id).sort()).toEqual([...gone].sort());
    const confirmed = preview.removals.map((r) => r.id);

    // Without the confirmed set, or with a different one, nothing is removed (D126).
    const before = await rowsOf(seed.A.org);
    for (const bad of [
      undefined,
      [],
      confirmed.slice(1),
      [...confirmed, "zzzzzzzzzzzzzz9"],
    ]) {
      await expect(
        importAddonRecords(seed.ctxA, deps(), SLUG, SLUG, text, "replace", bad),
      ).rejects.toThrow(REMOVALS_CHANGED_COPY);
    }
    expect(await rowsOf(seed.A.org)).toEqual(before);

    // A record added after the preview was never confirmed: the commit is refused
    // instead of deleting it (A-WR-03).
    const late = await pb.collection(SLUG).create({
      organization: seed.A.org,
      quote: "Added by another admin",
      author_name: "Late Lou",
      source: "manual",
      is_published: true,
      sort_order: 99,
    });
    await expect(
      importAddonRecords(
        seed.ctxA,
        deps(),
        SLUG,
        SLUG,
        text,
        "replace",
        confirmed,
      ),
    ).rejects.toThrow(REMOVALS_CHANGED_COPY);
    expect((await pb.collection(SLUG).getOne(late.id)).author_name).toBe(
      "Late Lou",
    );
    await pb.collection(SLUG).delete(late.id);

    const res = await importAddonRecords(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      text,
      "replace",
      confirmed,
    );
    expect(res).toMatchObject({ added: 0, updated: 0, removed: gone.length });
    const left = (await rowsOf(seed.A.org)).map((r) => r.id).sort();
    expect(left).toEqual(keep.map((r) => r[0]!).sort());
  });

  it("keeps only the newest 3 backups, newest first", async (t) => {
    if (!inst) return t.skip();
    const ids: string[] = [];
    for (const name of ["Gus One", "Hal Two", "Ida Three", "Jo Four"]) {
      const res = await importAddonRecords(
        seed.ctxA,
        deps(),
        SLUG,
        SLUG,
        csv(`Lovely work,${name},,,,,no,yes`),
        "update",
      );
      expect(res.added).toBe(1);
      ids.push(res.backupId);
    }
    const list = await listAddonBackups(seed.ctxA, deps(), SLUG);
    expect(list).toHaveLength(ADDON_BACKUPS_KEPT);
    expect(list.map((b) => b.id)).toEqual([ids[3], ids[2], ids[1]]);
    expect(list.every((b) => b.reason === "before-import")).toBe(true);
    const times = list.map((b) => Date.parse(b.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(await backupKeys(seed.A.org)).toHaveLength(3);
    restoredFrom = list[2]!.id;
  });

  it("restoring the oldest listed backup puts the records back exactly, after a before-restore backup", async (t) => {
    if (!inst) return t.skip();
    const expected = await backupRows(seed.A.org, restoredFrom);
    const beforeRestore = await rowsOf(seed.A.org);
    const res = await restoreAddonBackup(seed.ctxA, deps(), SLUG, restoredFrom);
    expect(res.restored).toBe(expected.length);
    expect(await rowsOf(seed.A.org)).toEqual(expected);

    const list = await listAddonBackups(seed.ctxA, deps(), SLUG);
    expect(list[0]!.reason).toBe("before-restore");
    expect(await backupRows(seed.A.org, list[0]!.id)).toEqual(beforeRestore);
    expect(await backupKeys(seed.A.org)).toHaveLength(3);
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'addon.backup.restore'",
        { o: seed.A.org },
      ),
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.meta).toMatchObject({ backupId: restoredFrom });
  });

  it("refuses an unlisted id, a foreign org's id and a key-shaped id; nothing changes", async (t) => {
    if (!inst) return t.skip();
    const bBackup = await saveAddonBackup(seed.ctxB, deps(), SLUG);
    expect(bBackup.reason).toBe("manual");
    const aIds = (await listAddonBackups(seed.ctxA, deps(), SLUG)).map(
      (b) => b.id,
    );
    expect(aIds).not.toContain(bBackup.id);
    const before = await rowsOf(seed.A.org);
    const keysBefore = await backupKeys(seed.A.org);
    for (const id of [
      "2020-01-01T00-00-00-000Z",
      bBackup.id,
      `../../${seed.B.org}/backups/testimonials/${bBackup.id}`,
      `dev/tenants/${seed.B.org}/backups/testimonials/${bBackup.id}.json`,
    ]) {
      await expect(
        restoreAddonBackup(seed.ctxA, deps(), SLUG, id),
      ).rejects.toBeInstanceOf(NotFound);
    }
    expect(await rowsOf(seed.A.org)).toEqual(before);
    expect(await backupKeys(seed.A.org)).toEqual(keysBefore);
  });

  it("a batch PocketBase rejects leaves every record unchanged (all or nothing)", async (t) => {
    if (!inst) return t.skip();
    const before = await rowsOf(seed.A.org);
    const text = csv(
      "Fine words,Good Row,,,,,no,yes",
      "Too long once stubbed,Break Me,,,,,no,yes",
    );
    await expect(
      importAddonRecords(
        seed.ctxA,
        deps(breakingRegistry()),
        SLUG,
        SLUG,
        text,
        "update",
      ),
    ).rejects.toThrow();
    expect(await rowsOf(seed.A.org)).toEqual(before);
    // The batch never committed, so neither did its audit row.
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("organization = {:o} && action = 'addon.import'", {
        o: seed.A.org,
      }),
    });
    expect(
      audits.every((a) => (a.meta as { added?: number }).added !== 2),
    ).toBe(true);
  });

  it("a row with held content imports hidden with an open hold", async (t) => {
    if (!inst) return t.skip();
    const res = await importAddonRecords(
      seed.ctxA,
      deps(),
      SLUG,
      SLUG,
      csv(
        `Visit ${HELD} today,Spam Sam,,,,,no,yes`,
        "Honest praise,Kim Low,,,,,no,yes",
      ),
      "update",
    );
    expect(res.added).toBe(2);
    const spam = await pb
      .collection(SLUG)
      .getFirstListItem(pb.filter("author_name = 'Spam Sam'"));
    const kim = await pb
      .collection(SLUG)
      .getFirstListItem(pb.filter("author_name = 'Kim Low'"));
    expect(spam.is_published).toBe(false);
    expect(kim.is_published).toBe(true);
    const holds = await addonRepo(seed.ctxA, deps(), SLUG)
      .collection(SLUG)
      .openHolds();
    expect(holds).toContain(spam.id);
    expect(holds).not.toContain(kim.id);
  });

  it("after removal the import and restore are refused, but backups and export still work", async (t) => {
    if (!inst) return t.skip();
    await uninstallAddon(seed.ctxA, deps(), SLUG);
    await expect(
      importAddonRecords(seed.ctxA, deps(), SLUG, SLUG, FIVE, "update"),
    ).rejects.toBeInstanceOf(AddonNotActive);
    const list = await listAddonBackups(seed.ctxA, deps(), SLUG);
    expect(list).toHaveLength(3);
    await expect(
      restoreAddonBackup(seed.ctxA, deps(), SLUG, list[0]!.id),
    ).rejects.toBeInstanceOf(AddonNotActive);
    const exp = await exportAddonCsv(seed.ctxA, deps(), SLUG, SLUG);
    expect(exp.csv).toContain("Kim Low");
    await installAddon(seed.ctxA, deps(), SLUG);
  });

  it("org B cannot list, restore or export org A's backups or records", async (t) => {
    if (!inst) return t.skip();
    const aList = await listAddonBackups(seed.ctxA, deps(), SLUG);
    const bList = await listAddonBackups(seed.ctxB, deps(), SLUG);
    expect(bList).toHaveLength(1);
    for (const b of bList) {
      expect(aList.map((a) => a.id)).not.toContain(b.id);
    }
    const aBefore = await rowsOf(seed.A.org);
    const bBefore = await rowsOf(seed.B.org);
    await expect(
      restoreAddonBackup(seed.ctxB, deps(), SLUG, aList[0]!.id),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await rowsOf(seed.A.org)).toEqual(aBefore);
    expect(await rowsOf(seed.B.org)).toEqual(bBefore);
    const bExport = await exportAddonCsv(seed.ctxB, deps(), SLUG, SLUG);
    expect(bExport.csv).toContain("Customer B");
    expect(bExport.csv).not.toContain("Customer A");
    expect(bExport.csv).not.toContain("Kim Low");
  });
});

describe("restore screens every row (A-WR-02, D270)", () => {
  it("a published row with held content comes back hidden with an open hold", async (t) => {
    if (!inst) return t.skip();
    const spamId = "rstheld00000001";
    const cleanId = "rstclean0000001";
    const row = (id: string, quote: string) => ({
      id,
      organization: seed.B.org,
      quote,
      author_name: `Author ${id}`,
      author_detail: "",
      rating: 0,
      photo_url: "",
      photo_alt: "",
      source: "manual",
      featured: false,
      is_published: true,
      sort_order: 1,
    });
    // A backup that holds content the scanner now holds (written directly: the older
    // keyword list let it through, or staff moderated it since).
    const at = new Date(Date.now() + 60_000);
    await store.put(
      tenantAddonBackupKey(seed.B.org, SLUG, at),
      JSON.stringify({
        format: ADDON_BACKUP_FORMAT,
        version: ADDON_BACKUP_VERSION,
        addon: SLUG,
        reason: "manual",
        createdAt: at.toISOString(),
        collections: {
          [SLUG]: [
            row(spamId, `Visit ${HELD} now`),
            row(cleanId, "Lovely people"),
          ],
        },
      }),
      "application/json",
    );
    const list = await listAddonBackups(seed.ctxB, deps(), SLUG);
    const res = await restoreAddonBackup(seed.ctxB, deps(), SLUG, list[0]!.id);
    expect(res.restored).toBe(2);
    expect((await pb.collection(SLUG).getOne(spamId)).is_published).toBe(false);
    expect((await pb.collection(SLUG).getOne(cleanId)).is_published).toBe(true);
    const holds = await addonRepo(seed.ctxB, deps(), SLUG)
      .collection(SLUG)
      .openHolds();
    expect(holds).toContain(spamId);
    expect(holds).not.toContain(cleanId);
  });
});
