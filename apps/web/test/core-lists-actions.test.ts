// 06-20 Task 1: Team and Services actions (ONB-01, ONB-13, D37, D120; T-06-95, T-06-97).
// The session and @cds/db are mocked; the real runAction maps refusals to copy. The actions
// never take a tenant id: the context always comes from the session, and payload keys are
// allow-listed before the chokepoint.
import { Forbidden, InvalidInput } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const CTX = { orgId: "org1", actor: "u1", role: "owner", grants: [] };

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  enforceAgreementGate: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const db = vi.hoisted(() => ({
  saveTeamMember: vi.fn(),
  removeTeamMember: vi.fn(),
  reorderTeam: vi.fn(),
  saveService: vi.fn(),
  deleteService: vi.fn(),
  reorderServices: vi.fn(),
  previewCoreImport: vi.fn(),
  commitCoreImport: vi.fn(),
  exportCoreCsv: vi.fn(),
  coreCsvTemplate: vi.fn(),
  // add-on intake (06-20 Task 2) and the registry's server entry
  saveAddonIntakeFields: vi.fn(),
  previewAddonIntakeImport: vi.fn(),
  commitAddonIntakeImport: vi.fn(),
  saveAddonIntakeRecord: vi.fn(),
  removeAddonIntakeRecord: vi.fn(),
  registerAddonCollections: vi.fn(),
  registerSectionAddonOwners: vi.fn(),
  registerAddonAlertTypes: vi.fn(),
}));
vi.mock("@cds/db", () => db);
// 13-52 (D270): saves and imports pass contentDeps() for the publish scan.
const DEPS = vi.hoisted(() => ({ content: true }));
vi.mock("../lib/content", () => ({ contentDeps: () => DEPS }));

const a = await import("../app/actions/core-lists");
const p = await import("../app/actions/addon-intake");
const { ADDON_REGISTRY } = await import("@cds/addon-registry/server");
const { revalidatePath } = await import("next/cache");

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  sess.getHubSession.mockResolvedValue({
    ctx: CTX,
    email: "a@b.c",
    org: { id: "org1", name: "X", primaryHost: null },
  });
  vi.mocked(revalidatePath).mockClear();
});

describe("team actions", () => {
  it("saveTeamMemberAction forwards only allow-listed keys with the session context", async () => {
    db.saveTeamMember.mockResolvedValue({ id: "m1", name: "Maria Lopez" });
    const res = await a.saveTeamMemberAction(
      {
        name: "Maria Lopez",
        role: "Owner",
        bio: "",
        is_published: true,
        photoId: null,
        organization: "org2",
        sort_order: 99,
      },
      "m1",
    );
    expect(res).toEqual({ ok: true, data: { id: "m1", name: "Maria Lopez" } });
    expect(db.saveTeamMember).toHaveBeenCalledWith(
      CTX,
      {
        name: "Maria Lopez",
        role: "Owner",
        bio: "",
        is_published: true,
        photoId: null,
      },
      "m1",
      DEPS,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/hub", "layout");
  });

  it("adding passes no id", async () => {
    db.saveTeamMember.mockResolvedValue({ id: "m2" });
    await a.saveTeamMemberAction({ name: "Ana" });
    expect(db.saveTeamMember).toHaveBeenCalledWith(
      CTX,
      { name: "Ana" },
      undefined,
      DEPS,
    );
  });

  it("a malformed id never reaches the chokepoint", async () => {
    const res = await a.removeTeamMemberAction("../org2/m1");
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.removeTeamMember).not.toHaveBeenCalled();
    const res2 = await a.saveTeamMemberAction({ name: "A" }, "x y");
    expect(res2).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveTeamMember).not.toHaveBeenCalled();
  });

  it("setTeamPublishedAction sends only is_published; a non-boolean is refused", async () => {
    db.saveTeamMember.mockResolvedValue({ id: "m1", is_published: false });
    await a.setTeamPublishedAction("m1", false);
    expect(db.saveTeamMember).toHaveBeenCalledWith(
      CTX,
      { is_published: false },
      "m1",
      DEPS,
    );
    db.saveTeamMember.mockClear();
    const res = await a.setTeamPublishedAction("m1", "yes");
    expect(res).toMatchObject({
      ok: false,
      message: "Show on site must be on or off.",
    });
    expect(db.saveTeamMember).not.toHaveBeenCalled();
  });

  it("an InvalidInput refusal returns its copy and refreshes nothing", async () => {
    db.saveTeamMember.mockRejectedValue(new InvalidInput("Add a name."));
    const res = await a.saveTeamMemberAction({ name: "" });
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "Add a name.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("an Editor gets the Forbidden copy", async () => {
    db.removeTeamMember.mockRejectedValue(new Forbidden("business write"));
    const res = await a.removeTeamMemberAction("m1");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("reorder refuses anything but a list of ids", async () => {
    expect(await a.reorderTeamAction("m1,m2")).toMatchObject({ ok: false });
    expect(await a.reorderTeamAction(["m1", "../x"])).toMatchObject({
      ok: false,
    });
    expect(db.reorderTeam).not.toHaveBeenCalled();
    db.reorderTeam.mockResolvedValue(undefined);
    expect(await a.reorderTeamAction(["m2", "m1"])).toEqual({
      ok: true,
      data: null,
    });
    expect(db.reorderTeam).toHaveBeenCalledWith(CTX, ["m2", "m1"]);
  });
});

describe("service actions", () => {
  it("a typed amount becomes cents with the spreadsheet's price rule", async () => {
    db.saveService.mockResolvedValue({ id: "s1" });
    await a.saveServiceAction({
      name: "Haircut",
      price_display: "from",
      price: "$45",
      duration_minutes: 60,
    });
    expect(db.saveService).toHaveBeenCalledWith(
      CTX,
      {
        name: "Haircut",
        price_display: "from",
        price_cents: 4500,
        duration_minutes: 60,
      },
      undefined,
      DEPS,
    );
    db.saveService.mockClear();
    await a.saveServiceAction({ name: "Trim", price: "45.50" }, "s1");
    expect(db.saveService.mock.calls[0]![1]).toMatchObject({
      price_cents: 4550,
    });
  });

  it("an unreadable amount is refused before the chokepoint", async () => {
    const res = await a.saveServiceAction({
      name: "Haircut",
      price_display: "fixed",
      price: "forty",
    });
    expect(res).toMatchObject({
      ok: false,
      message: "Price must be a number, like 45 or 45.00.",
    });
    expect(db.saveService).not.toHaveBeenCalled();
  });

  it("a Free service sends no price (the validator drops it)", async () => {
    db.saveService.mockResolvedValue({ id: "s1" });
    await a.saveServiceAction({
      name: "Consult",
      price_display: "free",
      price: "",
    });
    expect(db.saveService.mock.calls[0]![1]).toEqual({
      name: "Consult",
      price_display: "free",
      price_cents: null,
    });
  });

  it("delete and publish go through the chokepoint", async () => {
    db.deleteService.mockResolvedValue(undefined);
    db.saveService.mockResolvedValue({ id: "s1" });
    expect(await a.deleteServiceAction("s1")).toEqual({ ok: true, data: null });
    expect(db.deleteService).toHaveBeenCalledWith(CTX, "s1");
    await a.setServicePublishedAction("s1", true);
    expect(db.saveService).toHaveBeenCalledWith(
      CTX,
      { is_published: true },
      "s1",
      DEPS,
    );
  });
});

describe("spreadsheet actions", () => {
  it("preview passes kind, text and mode; an unknown kind or mode is refused", async () => {
    db.previewCoreImport.mockResolvedValue({ mode: "update" });
    const res = await a.previewCoreImportAction(
      "services",
      "Name\nCut",
      "update",
    );
    expect(res).toEqual({ ok: true, data: { mode: "update" } });
    expect(db.previewCoreImport).toHaveBeenCalledWith(
      CTX,
      "services",
      "Name\nCut",
      "update",
    );
    db.previewCoreImport.mockClear();
    expect(
      await a.previewCoreImportAction("users", "x", "update"),
    ).toMatchObject({ ok: false });
    expect(
      await a.previewCoreImportAction("services", "x", "merge"),
    ).toMatchObject({ ok: false });
    expect(db.previewCoreImport).not.toHaveBeenCalled();
  });

  it("commit returns the counts with no backup (no Undo in P6)", async () => {
    db.commitCoreImport.mockResolvedValue({ added: 3, updated: 1, removed: 0 });
    const res = await a.commitCoreImportAction(
      "team_members",
      "Name\nAna",
      "replace",
      ["abc123"],
    );
    expect(res).toEqual({
      ok: true,
      data: { added: 3, updated: 1, removed: 0, backupId: "" },
    });
    expect(db.commitCoreImport).toHaveBeenCalledWith(
      CTX,
      "team_members",
      "Name\nAna",
      "replace",
      ["abc123"],
      DEPS,
    );
  });

  it("export and template name the file", async () => {
    db.exportCoreCsv.mockResolvedValue("id,Name\n");
    db.coreCsvTemplate.mockReturnValue("Name\n");
    expect(await a.exportCoreCsvAction("team_members")).toEqual({
      ok: true,
      data: { filename: "team.csv", csv: "id,Name\n" },
    });
    expect(await a.templateCoreCsvAction("services")).toEqual({
      ok: true,
      data: { filename: "services-template.csv", csv: "Name\n" },
    });
  });
});

describe("add-on intake actions (invariant 3)", () => {
  it("Add one by one reads the add-on's columns with their own parse rules", async () => {
    db.saveAddonIntakeRecord.mockResolvedValue({ count: 3, key: "k1" });
    const res = await p.saveAddonIntakeRecordAction("testimonials", {
      quote: "Best bread in town.",
      author_name: "Maria L.",
      rating: "5",
      organization: "org2",
    });
    expect(res).toEqual({ ok: true, data: { count: 3, key: "k1" } });
    const [ctx, registry, slug, input, key, at] =
      db.saveAddonIntakeRecord.mock.calls[0]!;
    expect(ctx).toBe(CTX);
    expect(registry).toBe(ADDON_REGISTRY);
    expect(slug).toBe("testimonials");
    expect(key).toBeUndefined();
    expect(at).toBeUndefined();
    expect(input).toMatchObject({
      quote: "Best bread in town.",
      author_name: "Maria L.",
      rating: 5,
    });
    expect(input).not.toHaveProperty("organization");
  });

  it("a missing required column or a bad value is refused before the chokepoint", async () => {
    expect(
      await p.saveAddonIntakeRecordAction("testimonials", {
        author_name: "Maria L.",
      }),
    ).toMatchObject({ ok: false, message: "Add the quote." });
    expect(
      await p.saveAddonIntakeRecordAction("testimonials", {
        quote: "Hi",
        author_name: "Ana",
        rating: "eleven",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.saveAddonIntakeRecord).not.toHaveBeenCalled();
  });

  it("the dialog's update mode is intake's add; the registry and session go through", async () => {
    db.previewAddonIntakeImport.mockResolvedValue({ mode: "update" });
    db.commitAddonIntakeImport.mockResolvedValue({ count: 12 });
    await p.previewAddonIntakeImportAction(
      "testimonials",
      "Quote,Hi",
      "update",
    );
    expect(db.previewAddonIntakeImport).toHaveBeenCalledWith(
      CTX,
      ADDON_REGISTRY,
      "testimonials",
      "Quote,Hi",
      "add",
    );
    expect(
      await p.commitAddonIntakeImportAction("testimonials", "x", "replace"),
    ).toEqual({ ok: true, data: { count: 12 } });
    expect(db.commitAddonIntakeImport.mock.calls[0]![4]).toBe("replace");
    expect(
      await p.commitAddonIntakeImportAction("testimonials", "x", "merge"),
    ).toMatchObject({ ok: false });
  });

  it("B-WR-08: rows are addressed by key; edit passes the key, Undo passes a position", async () => {
    db.saveAddonIntakeRecord.mockResolvedValue({ count: 2, key: "abc123" });
    db.removeAddonIntakeRecord.mockResolvedValue({ count: 1, index: 0 });
    const row = { quote: "Hi there.", author_name: "Ana" };
    await p.saveAddonIntakeRecordAction("testimonials", row, "abc123");
    expect(db.saveAddonIntakeRecord.mock.calls[0]!.slice(4)).toEqual([
      "abc123",
      undefined,
    ]);
    await p.saveAddonIntakeRecordAction("testimonials", row, undefined, 0);
    expect(db.saveAddonIntakeRecord.mock.calls[1]!.slice(4)).toEqual([
      undefined,
      0,
    ]);
    expect(
      await p.removeAddonIntakeRecordAction("testimonials", "abc123"),
    ).toEqual({ ok: true, data: { count: 1, index: 0 } });
    expect(db.removeAddonIntakeRecord).toHaveBeenCalledWith(
      CTX,
      ADDON_REGISTRY,
      "testimonials",
      "abc123",
    );
  });

  it("an unknown slug, a bad key or a non-object is refused", async () => {
    expect(await p.removeAddonIntakeRecordAction("../x", "k1")).toMatchObject({
      ok: false,
    });
    for (const bad of [0, -1, "", "no spaces", "x".repeat(33), null]) {
      expect(
        await p.removeAddonIntakeRecordAction("testimonials", bad),
      ).toMatchObject({ ok: false });
    }
    expect(
      await p.saveAddonIntakeRecordAction(
        "testimonials",
        { quote: "Hi there.", author_name: "Ana" },
        3,
      ),
    ).toMatchObject({ ok: false });
    expect(db.saveAddonIntakeRecord).not.toHaveBeenCalled();
    expect(
      await p.saveAddonIntakeFieldsAction("testimonials", "about=1"),
    ).toMatchObject({ ok: false });
    expect(db.removeAddonIntakeRecord).not.toHaveBeenCalled();
    expect(db.saveAddonIntakeFields).not.toHaveBeenCalled();
  });

  it("the template is the add-on's own spreadsheet columns", async () => {
    const res = await p.templateAddonIntakeCsvAction("testimonials");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.filename).toBe("testimonials-template.csv");
      expect(res.data.csv.split(/\r?\n/)[0]).toContain("Quote");
    }
  });
});
