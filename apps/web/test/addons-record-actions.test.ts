// 05-12 Task 1: generic add-on tab actions (ADDON-08, ADDON-12..14; T-05-58, T-05-60,
// T-05-61; Pitfall 12). The real session module runs against mocked next/headers and
// @cds/db: every refusal happens before any @cds/db call, and every forwarded call carries
// the session ctx, never a client org id.
import { composeAddonRegistry } from "@cds/core/addons";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PRIVATE } from "../../../packages/core/src/addons/__fixtures__/manifests";
import { MANIFESTS } from "../../../packages/addon-registry/src/generated/manifests";

const state = vi.hoisted(() => ({ jar: new Map<string, string>() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      state.jar.has(name) ? { name, value: state.jar.get(name) } : undefined,
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const repo = vi.hoisted(() => ({
  save: vi.fn(),
  setPublished: vi.fn(),
  reorder: vi.fn(),
  remove: vi.fn(),
}));

const db = vi.hoisted(() => ({
  listMemberOrganizations: vi.fn(),
  orgContextFromToken: vi.fn(),
  installAddon: vi.fn(),
  uninstallAddon: vi.fn(),
  activeAddons: vi.fn(),
  listPages: vi.fn(),
  addonRepo: vi.fn(),
  previewAddonImport: vi.fn(),
  importAddonRecords: vi.fn(),
  exportAddonCsv: vi.fn(),
  addonCsvTemplate: vi.fn(),
  listAddonBackups: vi.fn(),
  saveAddonBackup: vi.fn(),
  restoreAddonBackup: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  getBillingGate: vi.fn(() => ({ approve: vi.fn() })),
  getContentScanner: vi.fn(() => ({ scan: vi.fn() })),
  getSearchPinger: vi.fn(() => ({ ping: vi.fn() })),
}));
vi.mock("@cds/db", () => db);

const registry = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@cds/addon-registry/server", () => ({
  get ADDON_REGISTRY() {
    return registry.value;
  },
  ADDON_SERVER: {},
}));
registry.value = composeAddonRegistry([...MANIFESTS, FIXTURE_PRIVATE], {
  fileExists: () => true,
});

const actions = await import("../app/actions/addons");

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const ORG = { id: "org1", name: "Palm", primaryHost: "palm.example" };
const NOT_FOUND = {
  ok: false,
  code: "not_found",
  message: "This was removed or moved. Reload the page to see the latest.",
};
const CSV = "Quote,Name\nHi,Ann\n";
const STAMP = "2026-09-28T10-15-00-123Z";

function noDbCalls(): void {
  for (const fn of [
    db.addonRepo,
    db.previewAddonImport,
    db.importAddonRecords,
    db.exportAddonCsv,
    db.addonCsvTemplate,
    db.listAddonBackups,
    db.saveAddonBackup,
    db.restoreAddonBackup,
  ]) {
    expect(fn).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  state.jar.clear();
  state.jar.set("cds_session", "tok");
  db.listMemberOrganizations.mockResolvedValue({
    userId: "u1",
    email: "owner@palm.example",
    organizations: [ORG],
  });
  db.orgContextFromToken.mockResolvedValue(CTX);
  db.addonRepo.mockReturnValue({ collection: () => repo });
  repo.save.mockResolvedValue({ id: "r1", held: false });
  repo.setPublished.mockResolvedValue({ held: false });
  repo.reorder.mockResolvedValue(undefined);
  repo.remove.mockResolvedValue(undefined);
});

describe("slug and collection allowlist (T-05-58)", () => {
  it("refuses an unknown slug before any @cds/db call", async () => {
    expect(
      await actions.saveAddonRecordAction("no-such", "testimonials", {}),
    ).toEqual(NOT_FOUND);
    expect(await actions.listBackupsAction("no-such")).toEqual(NOT_FOUND);
    expect(await actions.exportCsvAction("no-such", "testimonials")).toEqual(
      NOT_FOUND,
    );
    noDbCalls();
  });

  it('refuses "__proto__", "constructor" and non-string slugs', async () => {
    for (const slug of ["__proto__", "constructor", 42, null, ["x"]]) {
      expect(
        await actions.removeAddonRecordAction(slug, "testimonials", "r1"),
      ).toEqual(NOT_FOUND);
      expect(await actions.saveBackupAction(slug)).toEqual(NOT_FOUND);
    }
    noDbCalls();
  });

  it("refuses a collection the slug did not declare", async () => {
    for (const c of ["pages", "credentials", "__proto__", "toString", 1]) {
      expect(
        await actions.saveAddonRecordAction("testimonials", c, { quote: "x" }),
      ).toEqual(NOT_FOUND);
      expect(
        await actions.importPreviewAction("testimonials", c, CSV, "update"),
      ).toEqual(NOT_FOUND);
      expect(await actions.templateCsvAction("testimonials", c)).toEqual(
        NOT_FOUND,
      );
    }
    noDbCalls();
  });

  it("accepts a private add-on (the chokepoint enforces active + grants)", async () => {
    expect(Object.keys(FIXTURE_PRIVATE.collections)).toEqual([]);
    db.listAddonBackups.mockResolvedValue([]);
    const r = await actions.listBackupsAction("fixture-private");
    expect(r).toEqual({ ok: true, data: [] });
    expect(db.listAddonBackups).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "fixture-private",
    );
    // It declares no collections, so no record action reaches it.
    expect(
      await actions.removeAddonRecordAction(
        "fixture-private",
        "testimonials",
        "r1",
      ),
    ).toEqual(NOT_FOUND);
    expect(db.addonRepo).not.toHaveBeenCalled();
  });
});

describe("argument checks", () => {
  it("refuses text over 2,000,000 chars and non-string text", async () => {
    const big = "a".repeat(2_000_001);
    const r = await actions.importCommitAction(
      "testimonials",
      "testimonials",
      big,
      "update",
    );
    expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    const r2 = await actions.importPreviewAction(
      "testimonials",
      "testimonials",
      { length: 1 },
      "update",
    );
    expect(r2).toMatchObject({ ok: false, code: "invalid_input" });
    noDbCalls();
  });

  it("refuses a bad import mode", async () => {
    for (const mode of ["merge", "", null, "REPLACE"]) {
      const r = await actions.importCommitAction(
        "testimonials",
        "testimonials",
        CSV,
        mode,
      );
      expect(r).toEqual({
        ok: false,
        code: "invalid_input",
        message: "Choose Update only what changed or Replace all.",
      });
    }
    noDbCalls();
  });

  it("refuses a malformed confirmed-removals list (A-WR-03)", async () => {
    for (const bad of ["abc", [1], ["../x"], { 0: "a" }]) {
      const r = await actions.importCommitAction(
        "testimonials",
        "testimonials",
        CSV,
        "replace",
        bad,
      );
      expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    }
    noDbCalls();
  });

  it("refuses non-string ids, a non-array reorder and a non-boolean toggle", async () => {
    expect(
      await actions.removeAddonRecordAction("testimonials", "testimonials", {
        id: "r1",
      }),
    ).toEqual(NOT_FOUND);
    expect(
      await actions.restoreBackupAction("testimonials", { key: "x" }),
    ).toEqual(NOT_FOUND);
    expect(
      await actions.reorderAddonRecordsAction(
        "testimonials",
        "testimonials",
        "r1,r2",
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.reorderAddonRecordsAction("testimonials", "testimonials", [
        "r1",
        2,
      ]),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.setAddonRecordPublishedAction(
        "testimonials",
        "testimonials",
        "r1",
        "yes",
      ),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    noDbCalls();
  });

  it("refuses a non-plain record payload", async () => {
    for (const input of [null, "x", ["a"], new Date()]) {
      const r = await actions.saveAddonRecordAction(
        "testimonials",
        "testimonials",
        input,
      );
      expect(r).toMatchObject({ ok: false, code: "invalid_input" });
    }
    noDbCalls();
  });

  it("without a session is signed_out and never reaches @cds/db", async () => {
    state.jar.clear();
    const r = await actions.saveAddonRecordAction(
      "testimonials",
      "testimonials",
      { quote: "x" },
    );
    expect(r).toMatchObject({ ok: false, code: "signed_out" });
    noDbCalls();
  });
});

describe("forwarding with the session ctx (never a client org id)", () => {
  it("record actions go through addonRepo(ctx, deps, slug).collection(c)", async () => {
    const collection = vi.fn(() => repo);
    db.addonRepo.mockReturnValue({ collection });
    const save = await actions.saveAddonRecordAction(
      "testimonials",
      "testimonials",
      { quote: "Hi", author_name: "Ann", organization: "evil", id: "r1" },
    );
    expect(save).toEqual({ ok: true, data: { id: "r1", held: false } });
    expect(repo.save).toHaveBeenCalledWith({
      quote: "Hi",
      author_name: "Ann",
      id: "r1",
    });
    await actions.setAddonRecordPublishedAction(
      "testimonials",
      "testimonials",
      "r1",
      false,
    );
    expect(repo.setPublished).toHaveBeenCalledWith("r1", false);
    await actions.reorderAddonRecordsAction("credentials", "credentials", [
      "b",
      "a",
    ]);
    expect(repo.reorder).toHaveBeenCalledWith(["b", "a"]);
    const del = await actions.removeAddonRecordAction(
      "testimonials",
      "testimonials",
      "r1",
    );
    expect(del).toEqual({ ok: true, data: null });
    expect(repo.remove).toHaveBeenCalledWith("r1");
    for (const call of db.addonRepo.mock.calls) {
      expect(call[0]).toBe(CTX);
    }
    expect(db.addonRepo.mock.calls.map((c) => c[2])).toEqual([
      "testimonials",
      "testimonials",
      "credentials",
      "testimonials",
    ]);
    expect(collection.mock.calls.map((c) => (c as unknown[])[0])).toEqual([
      "testimonials",
      "testimonials",
      "credentials",
      "testimonials",
    ]);
  });

  it("import preview and commit forward ctx, slug, collection, text and mode", async () => {
    db.previewAddonImport.mockResolvedValue({ counts: {} });
    db.importAddonRecords.mockResolvedValue({
      added: 1,
      updated: 0,
      removed: 0,
      backupId: STAMP,
    });
    await actions.importPreviewAction(
      "testimonials",
      "testimonials",
      CSV,
      "replace",
    );
    expect(db.previewAddonImport).toHaveBeenCalledWith(
      CTX,
      expect.objectContaining({ addons: registry.value }),
      "testimonials",
      "testimonials",
      CSV,
      "replace",
    );
    const r = await actions.importCommitAction(
      "testimonials",
      "testimonials",
      CSV,
      "update",
    );
    expect(r).toEqual({
      ok: true,
      data: { added: 1, updated: 0, removed: 0, backupId: STAMP },
    });
    expect(db.importAddonRecords.mock.calls[0]![0]).toBe(CTX);
    const ids = ["abcdefghijklmno"];
    await actions.importCommitAction(
      "testimonials",
      "testimonials",
      CSV,
      "replace",
      ids,
    );
    expect(db.importAddonRecords.mock.calls[1]!.slice(4)).toEqual([
      CSV,
      "replace",
      ids,
    ]);
  });

  it("export, template and backups forward the session ctx", async () => {
    db.exportAddonCsv.mockResolvedValue({ filename: "t.csv", csv: "x" });
    db.addonCsvTemplate.mockReturnValue({
      filename: "t-template.csv",
      csv: "",
    });
    db.listAddonBackups.mockResolvedValue([]);
    db.saveAddonBackup.mockResolvedValue({
      id: STAMP,
      reason: "manual",
      createdAt: "2026-09-28T10:15:00.123Z",
      count: 2,
    });
    db.restoreAddonBackup.mockResolvedValue({ restored: 2 });

    expect(
      await actions.exportCsvAction("testimonials", "testimonials"),
    ).toEqual({ ok: true, data: { filename: "t.csv", csv: "x" } });
    expect(db.exportAddonCsv).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "testimonials",
      "testimonials",
    );
    expect(
      (await actions.templateCsvAction("credentials", "credentials")).ok,
    ).toBe(true);
    expect(db.addonCsvTemplate).toHaveBeenCalledWith(
      expect.anything(),
      "credentials",
      "credentials",
    );
    await actions.listBackupsAction("testimonials");
    expect(db.listAddonBackups).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "testimonials",
    );
    await actions.saveBackupAction("testimonials");
    expect(db.saveAddonBackup).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "testimonials",
      "manual",
    );
    expect(await actions.restoreBackupAction("testimonials", STAMP)).toEqual({
      ok: true,
      data: null,
    });
    expect(db.restoreAddonBackup).toHaveBeenCalledWith(
      CTX,
      expect.anything(),
      "testimonials",
      STAMP,
    );
  });

  it("maps a chokepoint refusal to its copy (AddonNotActive)", async () => {
    const { AddonNotActive } = await import("@cds/core/addons");
    repo.save.mockRejectedValue(
      new AddonNotActive(
        "Testimonials is off. Add it back from Get add-ons to change it.",
      ),
    );
    const r = await actions.saveAddonRecordAction(
      "testimonials",
      "testimonials",
      { quote: "x" },
    );
    expect(r).toEqual({
      ok: false,
      code: "addon_not_active",
      message:
        "Testimonials is off. Add it back from Get add-ons to change it.",
    });
  });
});
