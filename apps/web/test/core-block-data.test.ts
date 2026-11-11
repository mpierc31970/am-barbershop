// Core block data loader (07-07; D253, D156; T-07-07-05, T-07-07-08): hours, social and map
// blocks get the org's public business projection; nothing is read for other pages; one
// failed read never blanks the page.
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
  getMapEmbed: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { BUSINESS_BOUND_TYPES, loadCoreBlockData, previewCoreBlockData } =
  await import("../lib/core-block-data");

const SITE = { orgId: "o1", host: "shop.example.com" } as never;
const CTX = { orgId: "o1" } as never;
const BUSINESS = {
  name: "Rivera Bakery",
  phone: "512-555-0100",
  public_email: "hi@rivera.example",
  address: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
  time_zone: "America/Chicago",
  hours: null,
  socials: [],
};

function sec(section_type: unknown, id = "s1") {
  return { id, section_type, content: {} } as never;
}

let err: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  err = vi.spyOn(console, "error").mockImplementation(() => {});
  db.readPublicBusiness.mockResolvedValue(BUSINESS);
  db.getMapEmbed.mockReturnValue({ keyed: false, frameKey: undefined });
});

describe("loadCoreBlockData (visitor)", () => {
  it("lists the business-bound types", () => {
    expect([...BUSINESS_BOUND_TYPES]).toEqual(["hours", "social", "map"]);
    expect(Object.isFrozen(BUSINESS_BOUND_TYPES)).toBe(true);
  });

  it("no hours/social/map section: media only, no business read", async () => {
    const out = await loadCoreBlockData(SITE, [
      sec("hero"),
      sec("columns"),
      sec("faq"),
    ]);
    expect(out).toEqual({ media: {} });
    expect(db.readPublicBusiness).not.toHaveBeenCalled();
  });

  it.each(["hours", "social", "map"])(
    "a %s section reads the business once",
    async (type) => {
      const out = await loadCoreBlockData(SITE, [
        sec(type, "a"),
        sec("map", "b"),
      ]);
      expect(out).toEqual({ business: BUSINESS, media: {} });
      expect(db.readPublicBusiness).toHaveBeenCalledTimes(1);
      expect(db.readPublicBusiness).toHaveBeenCalledWith(SITE);
    },
  );

  it("a failed read logs and returns media only (the page still renders)", async () => {
    db.readPublicBusiness.mockRejectedValue(new Error("pb down"));
    const out = await loadCoreBlockData(SITE, [sec("hours")]);
    expect(out).toEqual({ media: {} });
    expect(err).toHaveBeenCalledWith(
      "[site] core block data failed",
      "business",
      expect.any(Error),
    );
  });

  it("an org without a profile gives no business", async () => {
    db.readPublicBusiness.mockResolvedValue(null);
    expect(await loadCoreBlockData(SITE, [sec("hours")])).toEqual({
      media: {},
    });
  });

  it("ignores malformed sections", async () => {
    const proto = JSON.parse('{"__proto__": {"section_type": "hours"}}');
    const out = await loadCoreBlockData(SITE, [
      null,
      5,
      "hours",
      sec(7),
      sec(["hours"]),
      sec("__proto__"),
      proto,
    ] as never);
    expect(out).toEqual({ media: {} });
    expect(db.readPublicBusiness).not.toHaveBeenCalled();
    expect(await loadCoreBlockData(SITE, "x" as never)).toEqual({ media: {} });
  });

  it("returns fresh objects", async () => {
    const a = await loadCoreBlockData(SITE, []);
    const b = await loadCoreBlockData(SITE, []);
    expect(a).not.toBe(b);
    expect(a.media).not.toBe(b.media);
  });
});

describe("previewCoreBlockData (builder preview)", () => {
  const PROFILE = {
    id: "bp1",
    orgName: "Rivera Bakery",
    phone: "512-555-0100",
    public_email: "hi@rivera.example",
    address: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
    time_zone: "America/Chicago",
    hours: null,
    socials: [
      { platform: "instagram", url: "https://instagram.com/rivera" },
      { platform: "x", url: "javascript:alert(1)" },
    ],
    ga4_id: "G-SECRET",
    legal_name: "Rivera LLC",
    privacy_contact: "privacy@rivera.example",
    about: "private about",
  };

  it("projects the profile to the public fields only", async () => {
    db.getBusinessProfile.mockResolvedValue(PROFILE);
    const out = await previewCoreBlockData(CTX, [sec("social")]);
    expect(db.getBusinessProfile).toHaveBeenCalledWith(CTX);
    expect(Object.keys(out.business!).sort()).toEqual(
      [
        "address",
        "business_type",
        "hours",
        "name",
        "phone",
        "public_email",
        "socials",
        "time_zone",
      ].sort(),
    );
    expect(out.business).toMatchObject({
      name: "Rivera Bakery",
      socials: [{ platform: "instagram", url: "https://instagram.com/rivera" }],
    });
    expect(JSON.stringify(out)).not.toMatch(/G-SECRET|Rivera LLC|privacy@/);
  });

  it("no business-bound section: no read", async () => {
    expect(await previewCoreBlockData(CTX, [sec("table")])).toEqual({
      media: {},
      editorPreview: true,
    });
    expect(db.getBusinessProfile).not.toHaveBeenCalled();
  });

  it("Forbidden gives no business, silently", async () => {
    db.getBusinessProfile.mockRejectedValue(new Forbidden("no grant"));
    expect(await previewCoreBlockData(CTX, [sec("hours")])).toEqual({
      media: {},
      editorPreview: true,
    });
    expect(err).not.toHaveBeenCalled();
  });

  it("no profile row yet (id '') gives no business", async () => {
    db.getBusinessProfile.mockResolvedValue({ ...PROFILE, id: "" });
    expect(await previewCoreBlockData(CTX, [sec("map")])).toEqual({
      media: {},
      editorPreview: true,
    });
  });
});

describe("mapKey and share (07-24; CONT-24, CONT-27)", () => {
  const KEY = "AIzaSyA-valid_key_1234567890abcdef";
  const PAGE = { url: "https://shop.example.com/menu", title: "Menu" };
  function social(show_share: unknown, id = "s9") {
    return { id, section_type: "social", content: { show_share } } as never;
  }

  it("a map section gets the frame key when keyed", async () => {
    db.getMapEmbed.mockReturnValue({ keyed: true, frameKey: KEY });
    const out = await loadCoreBlockData(SITE, [sec("map")]);
    expect(out.mapKey).toBe(KEY);
  });

  it("keyless: no mapKey", async () => {
    const out = await loadCoreBlockData(SITE, [sec("map")]);
    expect(out).not.toHaveProperty("mapKey");
  });

  it("no map section: no mapKey and no key read", async () => {
    db.getMapEmbed.mockReturnValue({ keyed: true, frameKey: KEY });
    const out = await loadCoreBlockData(SITE, [sec("hours")]);
    expect(out).not.toHaveProperty("mapKey");
    expect(db.getMapEmbed).not.toHaveBeenCalled();
  });

  it("a failing key read never blanks the page", async () => {
    db.getMapEmbed.mockImplementation(() => {
      throw new Error("boom");
    });
    const out = await loadCoreBlockData(SITE, [sec("map")]);
    expect(out).toEqual({ business: BUSINESS, media: {} });
  });

  it("a social section with share on gets the page share data", async () => {
    const out = await loadCoreBlockData(SITE, [social(true)], { page: PAGE });
    expect(out.share).toEqual(PAGE);
    expect(out.share).not.toBe(PAGE);
  });

  it("share off, no social section, or no page opts: no share", async () => {
    expect(
      await loadCoreBlockData(SITE, [social(false)], { page: PAGE }),
    ).not.toHaveProperty("share");
    expect(
      await loadCoreBlockData(SITE, [sec("hours")], { page: PAGE }),
    ).not.toHaveProperty("share");
    expect(await loadCoreBlockData(SITE, [social(true)])).not.toHaveProperty(
      "share",
    );
  });

  it("preview gets mapKey but never share", async () => {
    db.getMapEmbed.mockReturnValue({ keyed: true, frameKey: KEY });
    db.getBusinessProfile.mockResolvedValue({ id: "" });
    const out = await previewCoreBlockData(CTX, [sec("map"), social(true)]);
    expect(out.mapKey).toBe(KEY);
    expect(out).not.toHaveProperty("share");
  });
});
