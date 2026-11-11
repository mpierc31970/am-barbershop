// 08-08: the services and team slices of the core block data loader (TMPL-02, D253,
// RESEARCH Pitfall 9). Pages with a Services or Our team block get published rows only;
// the visitor path reads readPublicServices / readPublicTeam (SiteContext), the builder
// preview reads listPublishedServices / listPublishedTeam (OrgContext, content read, so a
// Viewer sees the published rows too, WR-C02) and sets editorPreview.
// Team photos resolve through the site's media resolver; deleted or unresolved = no photo.
import { Forbidden } from "@cds/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...a: unknown[]) => unknown) =>
    (...a: unknown[]) =>
      fn(...a),
  revalidateTag: () => {},
}));

const db = vi.hoisted(() => ({
  readPublicBusiness: vi.fn(),
  getBusinessProfile: vi.fn(),
  resolvePublicMedia: vi.fn(),
  resolveHubMedia: vi.fn(),
  readPublicServices: vi.fn(),
  readPublicTeam: vi.fn(),
  listPublishedServices: vi.fn(),
  listPublishedTeam: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const live = vi.hoisted(() => ({ getLiveSite: vi.fn() }));
vi.mock("../lib/site-cache", async (orig) => ({
  ...(await orig<typeof import("../lib/site-cache")>()),
  ...live,
}));

const { loadCoreBlockData, previewCoreBlockData, SERVICES_TYPES, TEAM_TYPES } =
  await import("../lib/core-block-data");

const SITE = { orgId: "o1", host: "shop.example.com" } as never;
const CTX = { orgId: "o1" } as never;
const PHOTO = "aaaaaaaaaaaaaa1";
const GONE = "bbbbbbbbbbbbbb2";
const MISSING = "ccccccccccccc03";

const sec = (section_type: string) =>
  ({ id: `s-${section_type}`, section_type, content: {} }) as never;

function pubService(over: Record<string, unknown> = {}) {
  return {
    id: "svc1",
    name: "Deep tissue",
    description: "60 minutes of focus",
    price_display: "fixed",
    price_cents: 9000,
    duration_minutes: 60,
    sort_order: 0,
    ...over,
  };
}

function pubMember(over: Record<string, unknown> = {}) {
  return {
    id: "tm1",
    name: "Ana Rivera",
    role: "Owner",
    bio: "Ten years in practice.",
    photo: "",
    sort_order: 0,
    ...over,
  };
}

function media(id: string, src: string, extra: Record<string, unknown> = {}) {
  return { id, kind: "image", src, alt: "", ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  live.getLiveSite.mockResolvedValue({ banner: null, popups: [] });
  db.readPublicServices.mockResolvedValue([]);
  db.readPublicTeam.mockResolvedValue([]);
  db.listPublishedServices.mockResolvedValue([]);
  db.listPublishedTeam.mockResolvedValue([]);
  db.resolvePublicMedia.mockImplementation(async (_s, ids: string[]) =>
    Object.fromEntries(
      ids
        .filter((id) => id !== MISSING)
        .map((id) => [
          id,
          media(id, `/_media/${id}/w960`, id === GONE ? { deleted: true } : {}),
        ]),
    ),
  );
  db.resolveHubMedia.mockImplementation(async (_c, ids: string[]) =>
    Object.fromEntries(
      ids
        .filter((id) => id !== MISSING)
        .map((id) => [
          id,
          media(
            id,
            `/hub/media/${id}/w960`,
            id === GONE ? { deleted: true } : {},
          ),
        ]),
    ),
  );
});

describe("detection", () => {
  it("exports the bound types", () => {
    expect(SERVICES_TYPES).toEqual(["services"]);
    expect(TEAM_TYPES).toEqual(["team"]);
  });

  it("a page without the blocks reads neither list", async () => {
    const out = await loadCoreBlockData(SITE, [sec("faq"), sec("hours")]);
    expect(db.readPublicServices).not.toHaveBeenCalled();
    expect(db.readPublicTeam).not.toHaveBeenCalled();
    expect(out).not.toHaveProperty("services");
    expect(out).not.toHaveProperty("team");
    expect(out).not.toHaveProperty("editorPreview");
  });
});

describe("loadCoreBlockData services (visitor)", () => {
  it("maps published rows in order to the block shape", async () => {
    db.readPublicServices.mockResolvedValue([
      pubService(),
      pubService({
        id: "svc2",
        name: "Consult",
        price_display: "free",
        price_cents: null,
        duration_minutes: null,
        sort_order: 1,
      }),
    ]);
    const out = await loadCoreBlockData(SITE, [sec("services")]);
    expect(db.readPublicServices).toHaveBeenCalledWith(SITE);
    expect(db.readPublicTeam).not.toHaveBeenCalled();
    expect(out.services).toEqual([
      {
        id: "svc1",
        name: "Deep tissue",
        description: "60 minutes of focus",
        price_type: "fixed",
        price_cents: 9000,
        duration_minutes: 60,
      },
      {
        id: "svc2",
        name: "Consult",
        description: "60 minutes of focus",
        price_type: "free",
        price_cents: null,
        duration_minutes: null,
      },
    ]);
    expect(out).not.toHaveProperty("editorPreview");
  });

  it("an unknown price_display reads as ask (never undefined)", async () => {
    db.readPublicServices.mockResolvedValue([
      pubService({ price_display: "weird" }),
      pubService({ id: "svc2", price_display: "" }),
    ]);
    const out = await loadCoreBlockData(SITE, [sec("services")]);
    expect(out.services!.map((s) => s.price_type)).toEqual(["ask", "ask"]);
  });

  it("a failing read logs without ids and leaves services out", async () => {
    db.readPublicServices.mockRejectedValue(new Error("pb down"));
    const out = await loadCoreBlockData(SITE, [sec("services")]);
    expect(out).not.toHaveProperty("services");
    expect(console.error).toHaveBeenCalledWith(
      "[site] core block data failed",
      "services",
      expect.any(Error),
    );
  });
});

describe("loadCoreBlockData team (visitor)", () => {
  it("maps members and resolves photos through resolvePublicMedia", async () => {
    db.readPublicTeam.mockResolvedValue([
      pubMember({ photo: PHOTO }),
      pubMember({ id: "tm2", name: "Ben", photo: GONE, sort_order: 1 }),
      pubMember({ id: "tm3", name: "Cy", photo: MISSING, sort_order: 2 }),
      pubMember({ id: "tm4", name: "Di", photo: "", sort_order: 3 }),
    ]);
    const out = await loadCoreBlockData(SITE, [sec("team")], {
      pageId: "page1",
    });
    expect(db.readPublicTeam).toHaveBeenCalledWith(SITE);
    expect(db.readPublicServices).not.toHaveBeenCalled();
    expect(db.resolvePublicMedia).toHaveBeenCalledWith(
      SITE,
      [PHOTO, GONE, MISSING],
      { pageId: "page1", protectedPage: false },
    );
    expect(out.team).toEqual([
      {
        id: "tm1",
        name: "Ana Rivera",
        role: "Owner",
        bio: "Ten years in practice.",
        photo: media(PHOTO, `/_media/${PHOTO}/w960`),
      },
      { id: "tm2", name: "Ben", role: "Owner", bio: "Ten years in practice." },
      { id: "tm3", name: "Cy", role: "Owner", bio: "Ten years in practice." },
      { id: "tm4", name: "Di", role: "Owner", bio: "Ten years in practice." },
    ]);
  });

  it("no photos: no resolver call", async () => {
    db.readPublicTeam.mockResolvedValue([pubMember()]);
    const out = await loadCoreBlockData(SITE, [sec("team")]);
    expect(db.resolvePublicMedia).not.toHaveBeenCalled();
    expect(out.team).toHaveLength(1);
    expect(out.team![0]).not.toHaveProperty("photo");
  });

  it("a failing photo resolve keeps the members, without photos", async () => {
    db.readPublicTeam.mockResolvedValue([pubMember({ photo: PHOTO })]);
    db.resolvePublicMedia.mockRejectedValue(new Error("cdn down"));
    const out = await loadCoreBlockData(SITE, [sec("team")]);
    expect(out.team).toEqual([
      {
        id: "tm1",
        name: "Ana Rivera",
        role: "Owner",
        bio: "Ten years in practice.",
      },
    ]);
  });

  it("a failing team read logs and leaves team out", async () => {
    db.readPublicTeam.mockRejectedValue(new Error("pb down"));
    const out = await loadCoreBlockData(SITE, [sec("team")]);
    expect(out).not.toHaveProperty("team");
    expect(console.error).toHaveBeenCalledWith(
      "[site] core block data failed",
      "team",
      expect.any(Error),
    );
  });
});

describe("previewCoreBlockData services and team", () => {
  it("reads the published projection with the OrgContext and sets editorPreview", async () => {
    db.listPublishedServices.mockResolvedValue([
      pubService({
        description: "",
        price_display: "from",
        price_cents: 5000,
        duration_minutes: 30,
      }),
    ]);
    db.listPublishedTeam.mockResolvedValue([
      pubMember({ name: "Ana", bio: "", photo: PHOTO }),
    ]);
    const out = await previewCoreBlockData(CTX, [sec("services"), sec("team")]);
    expect(db.listPublishedServices).toHaveBeenCalledWith(CTX);
    expect(db.listPublishedTeam).toHaveBeenCalledWith(CTX);
    expect(db.readPublicServices).not.toHaveBeenCalled();
    expect(db.readPublicTeam).not.toHaveBeenCalled();
    expect(db.resolveHubMedia).toHaveBeenCalledWith(CTX, [PHOTO]);
    expect(out.editorPreview).toBe(true);
    expect(out.services).toEqual([
      {
        id: "svc1",
        name: "Deep tissue",
        description: "",
        price_type: "from",
        price_cents: 5000,
        duration_minutes: 30,
      },
    ]);
    expect(out.team).toEqual([
      {
        id: "tm1",
        name: "Ana",
        role: "Owner",
        bio: "",
        photo: media(PHOTO, `/hub/media/${PHOTO}/w960`),
      },
    ]);
  });

  it("empty lists still give [] so the editor-only card shows", async () => {
    const out = await previewCoreBlockData(CTX, [sec("services")]);
    expect(out.services).toEqual([]);
    expect(out.editorPreview).toBe(true);
  });

  it("no grant: no services, no log", async () => {
    db.listPublishedServices.mockRejectedValue(new Forbidden());
    db.listPublishedTeam.mockRejectedValue(new Forbidden());
    const out = await previewCoreBlockData(CTX, [sec("services"), sec("team")]);
    expect(out).not.toHaveProperty("services");
    expect(out).not.toHaveProperty("team");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("a page without the blocks reads neither list", async () => {
    const out = await previewCoreBlockData(CTX, [sec("faq")]);
    expect(db.listPublishedServices).not.toHaveBeenCalled();
    expect(db.listPublishedTeam).not.toHaveBeenCalled();
    expect(out.editorPreview).toBe(true);
  });
});
