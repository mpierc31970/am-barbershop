// Team and services chokepoint on the real PocketBase 0.39.11 binary: CRUD, reorder, show on
// site, CSV preview / commit / export via the P5 engine (ONB-13, D37, D120, D125, D126;
// invariant 1, TEN-03, PD-21; T-06-52, T-06-53, T-06-54, T-06-55).
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import {
  commitCoreImport,
  deleteService,
  exportCoreCsv,
  listServices,
  listTeam,
  previewCoreImport,
  removeTeamMember,
  reorderServices,
  reorderTeam,
  saveService,
  saveTeamMember,
} from "../src/intake";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

const IP = "127.0.0.1";
let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function ctxAs(orgId: string, role: OrgContext["role"]): OrgContext {
  return mintOrgContext({
    orgId,
    actor: seed.A.owner,
    role,
    grants: [],
    ip: IP,
  });
}

async function bareOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const org = (
    await pb.collection("organizations").create({
      name: "List Co",
      slug: `list-${Math.random().toString(36).slice(2, 10)}`,
      status: "active",
    })
  ).id;
  return { org, ctx: ctxAs(org, "owner") };
}

async function media(org: string, kind: string): Promise<string> {
  return (
    await pb.collection("media_assets").create({
      organization: org,
      kind,
      storage_dir: `tenants/${org}/media/${kind}`,
      original_ext: "jpg",
      source: "intake",
      sort_order: 1,
    })
  ).id;
}

async function importAudits(org: string, action: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("organization = {:o} && action = {:a}", {
      o: org,
      a: action,
    }),
  });
}

const SERVICES_HEADER =
  "Name,Description,Price type,Price,Duration in minutes,Show on site";

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
});

describe("team members (ONB-13, D37)", () => {
  it("adds at the end, shown on the site by default", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const a = await saveTeamMember(ctx, { name: "Maria Lopez", role: "Owner" });
    const b = await saveTeamMember(ctx, { name: "Sam Lee" });
    expect(a.sortOrder).toBe(0);
    expect(b.sortOrder).toBe(1);
    expect(a.is_published).toBe(true);
    expect(a.photoId).toBeNull();
    const row = await pb.collection("team_members").getOne(a.id);
    expect(row.organization).toBe(org);
    expect((await listTeam(ctx)).map((m) => m.name)).toEqual([
      "Maria Lopez",
      "Sam Lee",
    ]);
  });

  it("edit keeps the position and merges only the given keys", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await saveTeamMember(ctx, { name: "First" });
    const m = await saveTeamMember(ctx, { name: "Maria", role: "Owner" });
    const hidden = await saveTeamMember(ctx, { is_published: false }, m.id);
    expect(hidden.sortOrder).toBe(m.sortOrder);
    expect(hidden.name).toBe("Maria");
    expect(hidden.role).toBe("Owner");
    expect(hidden.is_published).toBe(false);
    await expect(saveTeamMember(ctx, { name: "" }, m.id)).rejects.toThrow(
      "Add a name.",
    );
  });

  it("remove deletes; a foreign id is NotFound for edit and remove", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const m = await saveTeamMember(ctx, { name: "Gone Soon" });
    await removeTeamMember(ctx, m.id);
    expect(await listTeam(ctx)).toEqual([]);
    await expect(removeTeamMember(ctx, m.id)).rejects.toThrow(NotFound);
    await expect(
      saveTeamMember(seed.ctxB, { name: "Evil" }, seed.A.teamMember),
    ).rejects.toThrow(NotFound);
    await expect(
      removeTeamMember(seed.ctxB, seed.A.teamMember),
    ).rejects.toThrow(NotFound);
    expect(
      (await pb.collection("team_members").getOne(seed.A.teamMember)).name,
    ).toBe("Staff A");
  });

  it("a photo must be the org's own team photo", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const own = await media(org, "team");
    const logo = await media(org, "logo");
    const foreign = await media(seed.B.org, "team");
    await expect(
      saveTeamMember(ctx, { name: "X", photoId: foreign }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveTeamMember(ctx, { name: "X", photoId: logo }),
    ).rejects.toThrow(InvalidInput);
    expect(await listTeam(ctx)).toEqual([]);
    const m = await saveTeamMember(ctx, { name: "X", photoId: own });
    expect(m.photoId).toBe(own);
    const kept = await saveTeamMember(ctx, { role: "Baker" }, m.id);
    expect(kept.photoId).toBe(own);
    const cleared = await saveTeamMember(ctx, { photoId: null }, m.id);
    expect(cleared.photoId).toBeNull();
  });

  it("WR-C01: a shown member's photo is promoted; a hidden one's is not; a failure never fails the save", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    const photo = await media(org, "team");
    const calls: string[][] = [];
    const promote = async (_c: OrgContext, ids: readonly string[]) => {
      calls.push([...ids]);
      return { promoted: [...ids] };
    };
    const hidden = await saveTeamMember(
      ctx,
      { name: "Hidden", is_published: false, photoId: photo },
      undefined,
      { promote },
    );
    expect(calls).toEqual([]);
    await saveTeamMember(ctx, { name: "No photo" }, undefined, { promote });
    expect(calls).toEqual([]);
    // Turning Show on site on promotes the stored photo.
    await saveTeamMember(ctx, { is_published: true }, hidden.id, { promote });
    expect(calls).toEqual([[photo]]);
    const failing = async () => {
      throw new Error("store down");
    };
    const kept = await saveTeamMember(ctx, { role: "Baker" }, hidden.id, {
      promote: failing,
    });
    expect(kept.role).toBe("Baker");
    expect(kept.photoId).toBe(photo);
  });

  it("reorder rewrites 0..n-1; a non-permutation is InvalidInput", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const a = await saveTeamMember(ctx, { name: "A" });
    const b = await saveTeamMember(ctx, { name: "B" });
    const c = await saveTeamMember(ctx, { name: "C" });
    await reorderTeam(ctx, [c.id, a.id, b.id]);
    const list = await listTeam(ctx);
    expect(list.map((m) => [m.name, m.sortOrder])).toEqual([
      ["C", 0],
      ["A", 1],
      ["B", 2],
    ]);
    await expect(reorderTeam(ctx, [a.id, b.id])).rejects.toThrow(InvalidInput);
    await expect(reorderTeam(ctx, [a.id, a.id, b.id])).rejects.toThrow(
      InvalidInput,
    );
    await expect(
      reorderTeam(ctx, [a.id, b.id, seed.A.teamMember]),
    ).rejects.toThrow(InvalidInput);
  });
});

describe("services (ONB-01, ONB-13)", () => {
  it("fixed with no price is InvalidInput; free stores no price", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await expect(
      saveService(ctx, { name: "Cut", price_display: "fixed" }),
    ).rejects.toThrow("Add a price, like 45 or 45.00.");
    const free = await saveService(ctx, {
      name: "Consult",
      price_display: "free",
      price_cents: 5000,
    });
    expect(free.price_cents).toBeNull();
    expect(free.sortOrder).toBe(0);
    expect(free.is_published).toBe(true);
  });

  it("edit merges over the stored row; delete and reorder work", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const cut = await saveService(ctx, {
      name: "Cut",
      price_display: "from",
      price_cents: 4500,
      duration_minutes: 60,
    });
    const color = await saveService(ctx, {
      name: "Color",
      price_display: "ask",
    });
    const edited = await saveService(ctx, { price_cents: 5000 }, cut.id);
    expect(edited).toMatchObject({
      name: "Cut",
      price_display: "from",
      price_cents: 5000,
      duration_minutes: 60,
      sortOrder: 0,
    });
    await reorderServices(ctx, [color.id, cut.id]);
    expect((await listServices(ctx)).map((s) => s.name)).toEqual([
      "Color",
      "Cut",
    ]);
    await deleteService(ctx, color.id);
    expect((await listServices(ctx)).map((s) => s.name)).toEqual(["Cut"]);
    await expect(deleteService(seed.ctxB, seed.A.service)).rejects.toThrow(
      NotFound,
    );
  });
});

describe("CSV import / export (D120, D125, D126, T-06-55)", () => {
  const good = [
    "Haircut,Wash and cut,Starting at,45.00,60,yes",
    "Beard trim,,Fixed,20,15,yes",
    "Consultation,,Free,,,no",
  ];

  it("preview: 3 valid rows and a Row 5 price-type error", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const csv = [SERVICES_HEADER, ...good, "Mystery,,Maybe,10,,yes"].join("\n");
    const preview = await previewCoreImport(ctx, "services", csv, "add");
    expect(preview.counts.new).toBe(3);
    expect(preview.counts.errors).toBe(1);
    const bad = preview.rows.find((r) => r.status === "error");
    expect(bad?.messages).toEqual([
      "Row 5: Price type must be Fixed, Starting at, Free or Ask.",
    ]);
    await expect(commitCoreImport(ctx, "services", csv, "add")).rejects.toThrow(
      "1 row needs fixing.",
    );
    expect(await listServices(ctx)).toEqual([]);
  });

  it("the record validator runs in the preview (fixed with no price)", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const csv = [SERVICES_HEADER, "Cut,,Fixed,,,yes"].join("\n");
    const preview = await previewCoreImport(ctx, "services", csv, "add");
    expect(preview.counts.errors).toBe(1);
    expect(preview.rows[0]!.messages).toEqual([
      "Row 2: Add a price, like 45 or 45.00.",
    ]);
  });

  it("commit add inserts in one batch with one audit row", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await bareOrg();
    await saveService(ctx, { name: "Existing", price_display: "ask" });
    const csv = [SERVICES_HEADER, ...good].join("\n");
    const res = await commitCoreImport(ctx, "services", csv, "add");
    expect(res).toEqual({ added: 3, updated: 0, removed: 0 });
    const list = await listServices(ctx);
    expect(list.map((s) => [s.name, s.sortOrder])).toEqual([
      ["Existing", 0],
      ["Haircut", 1],
      ["Beard trim", 2],
      ["Consultation", 3],
    ]);
    expect(list[1]).toMatchObject({
      price_display: "from",
      price_cents: 4500,
      duration_minutes: 60,
    });
    expect(list[3]!.is_published).toBe(false);
    expect(await importAudits(org, "services.import")).toHaveLength(1);
  });

  it("replace removes rows not in the file, only once confirmed", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const old = await saveService(ctx, { name: "Old", price_display: "ask" });
    await saveService(ctx, { name: "Haircut", price_display: "ask" });
    const csv = [SERVICES_HEADER, ...good].join("\n");
    const preview = await previewCoreImport(ctx, "services", csv, "replace");
    expect(preview.removals).toEqual([{ id: old.id, title: "Old" }]);
    await expect(
      commitCoreImport(ctx, "services", csv, "replace"),
    ).rejects.toThrow(InvalidInput);
    expect(await listServices(ctx)).toHaveLength(2);
    const res = await commitCoreImport(ctx, "services", csv, "replace", [
      old.id,
    ]);
    expect(res).toEqual({ added: 2, updated: 1, removed: 1 });
    expect((await listServices(ctx)).map((s) => s.name).sort()).toEqual([
      "Beard trim",
      "Consultation",
      "Haircut",
    ]);
  });

  it("export round-trips through preview with 0 errors and 0 changes", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await saveTeamMember(ctx, { name: "Maria Lopez", role: "Owner" });
    await saveTeamMember(ctx, {
      name: "Sam, Jr.",
      bio: 'Says "hi"\nand bakes.',
      is_published: false,
    });
    const csv = await exportCoreCsv(ctx, "team_members");
    const preview = await previewCoreImport(ctx, "team_members", csv, "add");
    expect(preview.counts.errors).toBe(0);
    expect(preview.counts.unchanged).toBe(2);
    expect(preview.changes).toBe(0);
  });

  it("formula cells are neutralised on export", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    const csv = ["Name,Role", '=HYPERLINK("http://x"),Owner'].join("\n");
    await commitCoreImport(ctx, "team_members", csv, "add");
    const out = await exportCoreCsv(ctx, "team_members");
    expect(out).toContain("'=HYPERLINK");
    const again = await previewCoreImport(ctx, "team_members", out, "add");
    expect(again.counts.unchanged).toBe(1);
  });

  it("oversize text and unknown lists are refused", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await bareOrg();
    await expect(
      previewCoreImport(ctx, "team_members", "x".repeat(2_000_001), "add"),
    ).rejects.toThrow(InvalidInput);
    await expect(
      previewCoreImport(ctx, "pages" as never, "Name\nA", "add"),
    ).rejects.toThrow(InvalidInput);
    await expect(
      previewCoreImport(ctx, "team_members", "Name\nA", "merge" as never),
    ).rejects.toThrow(InvalidInput);
  });

  it("imports only the caller's org", async (t) => {
    if (!inst) return t.skip();
    const csv = ["Name", "Staff A", "New B"].join("\n");
    const res = await commitCoreImport(seed.ctxB, "team_members", csv, "add");
    expect(res.added).toBe(2);
    expect((await listTeam(seed.ctxA)).map((m) => m.name)).toEqual(["Staff A"]);
  });
});

describe("roles (PD-21, T-06-52)", () => {
  it("Editor reads and exports but cannot write or import", async (t) => {
    if (!inst) return t.skip();
    const editor = ctxAs(seed.A.org, "editor");
    expect((await listTeam(editor)).length).toBeGreaterThan(0);
    expect(await listServices(editor)).toHaveLength(1);
    expect(await exportCoreCsv(editor, "services")).toContain("Service A");
    await expect(saveTeamMember(editor, { name: "E" })).rejects.toThrow(
      Forbidden,
    );
    await expect(
      saveService(editor, { name: "E", price_display: "ask" }),
    ).rejects.toThrow(Forbidden);
    await expect(reorderTeam(editor, [seed.A.teamMember])).rejects.toThrow(
      Forbidden,
    );
    await expect(
      previewCoreImport(editor, "team_members", "Name\nA", "add"),
    ).rejects.toThrow(Forbidden);
  });

  it("Viewer cannot read", async (t) => {
    if (!inst) return t.skip();
    const viewer = ctxAs(seed.A.org, "viewer");
    await expect(listTeam(viewer)).rejects.toThrow(Forbidden);
    await expect(listServices(viewer)).rejects.toThrow(Forbidden);
    await expect(exportCoreCsv(viewer, "team_members")).rejects.toThrow(
      Forbidden,
    );
  });
});
