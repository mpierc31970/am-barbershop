// 13-20: catalog listings + catalogView on the real PocketBase binary (STAFF-07, D5, D264,
// P13-P7, P13-P21; T-13-20-01..04). Defaults from the manifest, coming_soon / hidden /
// private in the public view, audited saves and moves, screenshots by magic bytes in a
// local-disk store under platform/catalog/<slug>/.
import "@cds/addon-registry/server";
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintPlatformContext } from "../src/context";
import {
  catalogView,
  publicCatalogView,
  readCatalogScreenshot,
  resetCatalogViewCacheForTests,
  staffAddScreenshot,
  staffListListings,
  staffMoveListing,
  staffRemoveScreenshot,
  staffSaveListing,
  type CatalogManifestInput,
} from "../src/staff/catalog-listings";
import { LocalDiskStore } from "../src/storage/local-disk";
import { platformCatalogKey } from "../src/storage/keys";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-15T15:00:00.000Z");

const MANIFESTS: CatalogManifestInput[] = [
  {
    slug: "alpha",
    name: "Alpha",
    summary: "Alpha summary.",
    visibility: "public",
    path: "both",
  },
  {
    slug: "bravo",
    name: "Bravo",
    summary: "Bravo summary.",
    visibility: "public",
    path: "standard",
  },
  {
    slug: "charlie",
    name: "Charlie",
    summary: "Charlie summary.",
    visibility: "public",
    path: "studio",
    premium: true,
  },
  {
    slug: "secret",
    name: "Secret",
    summary: "Private one.",
    visibility: "private",
    path: "both",
  },
];

// 1x1 transparent PNG.
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
);

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let dir: string;
let store: LocalDiskStore;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
  await pb.collection("users").update(s.staff.agentUser, { name: "Lee Park" });
  dir = mkdtempSync(join(tmpdir(), "cds-catalog-"));
  store = new LocalDiskStore(dir);
});

afterAll(async () => {
  await inst?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetCatalogViewCacheForTests();
});

async function audit(action: string) {
  return pb.collection("audit_log").getFullList({
    filter: pb.filter("action = {:a}", { a: action }),
    sort: "created,id",
  });
}

describe("catalogView defaults and visibility (choice 1)", () => {
  it("no listing: manifest summary, available, pickable, sort 1000", async (t) => {
    if (!inst) return t.skip();
    const view = await publicCatalogView(MANIFESTS);
    expect(view.map((e) => e.slug)).toEqual(["alpha", "bravo", "charlie"]);
    const a = view[0]!;
    expect(a).toMatchObject({
      tagline: "Alpha summary.",
      description: "Alpha summary.",
      availability: "available",
      pickable: true,
      sort: 1000,
      screenshots: [],
      private: false,
    });
    expect(view[2]!.premium).toBe(true);
  });

  it("coming_soon shows unpickable; hidden is staff-only; private always wins", async (t) => {
    if (!inst) return t.skip();
    await staffSaveListing(
      s.staff.agent,
      {
        slug: "bravo",
        tagline: "Bravo, now listed",
        description: "",
        availability: "coming_soon",
      },
      MANIFESTS,
    );
    await staffSaveListing(
      s.staff.agent,
      { slug: "charlie", tagline: "", description: "", availability: "hidden" },
      MANIFESTS,
    );
    await staffSaveListing(
      s.staff.superAdmin,
      {
        slug: "secret",
        tagline: "Leak?",
        description: "",
        availability: "available",
      },
      MANIFESTS,
    );
    const pub = await publicCatalogView(MANIFESTS);
    expect(pub.map((e) => e.slug)).toEqual(["alpha", "bravo"]);
    const bravo = pub.find((e) => e.slug === "bravo")!;
    expect(bravo.tagline).toBe("Bravo, now listed");
    expect(bravo.description).toBe("Bravo summary.");
    expect(bravo.pickable).toBe(false);

    const staff = await catalogView(MANIFESTS, { audience: "staff" });
    expect(staff.map((e) => e.slug).sort()).toEqual([
      "alpha",
      "bravo",
      "charlie",
      "secret",
    ]);
    const secret = staff.find((e) => e.slug === "secret")!;
    expect(secret.private).toBe(true);
    expect(secret.pickable).toBe(false);
  });
});

describe("staff listing writes (choice 2)", () => {
  it("support_agent save writes updated_by and an audit row; staff list names them", async (t) => {
    if (!inst) return t.skip();
    const before = (await audit("catalog.listing_saved")).length;
    const saved = await staffSaveListing(
      s.staff.agent,
      {
        slug: "alpha",
        tagline: "  Alpha tag  ",
        description: "Long text.",
        availability: "available",
      },
      MANIFESTS,
    );
    expect(saved.tagline).toBe("Alpha tag");
    const rows = await audit("catalog.listing_saved");
    expect(rows).toHaveLength(before + 1);
    const last = rows[rows.length - 1]!;
    expect(last.meta).toEqual({ slug: "alpha", availability: "available" });
    expect(last.organization).toBe("");
    const list = await staffListListings(s.staff.agent, MANIFESTS);
    const alpha = list.find((e) => e.slug === "alpha")!;
    expect(alpha.updatedByName).toBe("Lee Park");
    expect(alpha.taglineOverride).toBe("Alpha tag");
    expect(alpha.summary).toBe("Alpha summary.");
  });

  it("refuses unknown slugs, bad availability, long copy and non-staff contexts", async (t) => {
    if (!inst) return t.skip();
    await expect(
      staffSaveListing(
        s.staff.agent,
        {
          slug: "nope",
          tagline: "",
          description: "",
          availability: "available",
        },
        MANIFESTS,
      ),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      staffSaveListing(
        s.staff.agent,
        { slug: "alpha", tagline: "", description: "", availability: "gone" },
        MANIFESTS,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffSaveListing(
        s.staff.agent,
        {
          slug: "alpha",
          tagline: "x".repeat(121),
          description: "",
          availability: "available",
        },
        MANIFESTS,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffSaveListing(
        s.A.ctx.owner as never,
        {
          slug: "alpha",
          tagline: "",
          description: "",
          availability: "available",
        },
        MANIFESTS,
      ),
    ).rejects.toThrow();
    const unknownRole = mintPlatformContext({
      actor: s.staff.agentUser,
      staffRole: "nobody" as never,
      ip: "127.0.0.1",
    });
    await expect(
      staffListListings(unknownRole, MANIFESTS),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  it("move down swaps sort with the next entry; moving the last down is a no-op", async (t) => {
    if (!inst) return t.skip();
    const start = await staffListListings(s.staff.agent, MANIFESTS);
    const order = start.map((e) => e.slug);
    const i = order.indexOf("alpha");
    const next = order[i + 1]!;
    const moved = await staffMoveListing(
      s.staff.agent,
      "alpha",
      "down",
      MANIFESTS,
    );
    const after = moved.map((e) => e.slug);
    expect(after.indexOf("alpha")).toBe(i + 1);
    expect(after.indexOf(next)).toBe(i);
    const a = moved.find((e) => e.slug === "alpha")!;
    const n = moved.find((e) => e.slug === next)!;
    expect(a.sort).toBeGreaterThan(n.sort);
    const audits = await audit("catalog.listing_moved");
    expect(audits[audits.length - 1]!.meta).toMatchObject({
      slug: "alpha",
      direction: "down",
      swappedWith: next,
    });
    const last = after[after.length - 1]!;
    const count = audits.length;
    await staffMoveListing(s.staff.agent, last, "down", MANIFESTS);
    expect(await audit("catalog.listing_moved")).toHaveLength(count);
    // the public view follows the new order
    const staffView = (await catalogView(MANIFESTS, { audience: "staff" })).map(
      (e) => e.slug,
    );
    expect(staffView).toEqual(after);
  });
});

describe("screenshots (choice 2, T-13-20-01, T-13-20-02)", () => {
  it("adds a 1x1 png under platform/catalog/<slug>/, reads it back, removes it", async (t) => {
    if (!inst) return t.skip();
    const shot = await staffAddScreenshot(
      s.staff.agent,
      {
        slug: "alpha",
        bytes: PNG_1X1,
        contentType: "image/png",
        alt: "Home page",
      },
      MANIFESTS,
      { store },
    );
    expect(shot).toMatchObject({ w: 1, h: 1, alt: "Home page" });
    expect(shot.url).toBe(`/_catalog/alpha/${shot.id}.png`);
    const key = platformCatalogKey("alpha", shot.id, "png");
    expect(key).toMatch(/platform\/catalog\/alpha\//);
    expect(await store.get(key)).not.toBeNull();
    const raw = await pb
      .collection("addon_listings")
      .getFirstListItem(pb.filter("slug = 'alpha'"));
    expect(raw.screenshots[0].object_key).toBe(key);
    expect(raw.screenshots[0]).not.toHaveProperty("key");

    const served = await readCatalogScreenshot("alpha", `${shot.id}.png`, {
      store,
    });
    expect(served?.contentType).toBe("image/png");
    await expect(
      readCatalogScreenshot("alpha", "../x.png", { store }),
    ).rejects.toBeInstanceOf(NotFound);

    const view = await publicCatalogView(MANIFESTS);
    expect(view.find((e) => e.slug === "alpha")!.screenshots).toHaveLength(1);

    await staffRemoveScreenshot(
      s.staff.agent,
      { slug: "alpha", id: shot.id },
      MANIFESTS,
      { store },
    );
    expect(await store.get(key)).toBeNull();
    expect((await audit("catalog.screenshot_added")).length).toBeGreaterThan(0);
    expect((await audit("catalog.screenshot_removed")).length).toBe(1);
  });

  it("refuses a text file renamed .png, oversize files and missing alt text", async (t) => {
    if (!inst) return t.skip();
    const txt = new TextEncoder().encode(
      "just some text pretending to be a png",
    );
    await expect(
      staffAddScreenshot(
        s.staff.agent,
        { slug: "bravo", bytes: txt, contentType: "image/png", alt: "x" },
        MANIFESTS,
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG_1X1);
    await expect(
      staffAddScreenshot(
        s.staff.agent,
        { slug: "bravo", bytes: big, alt: "x" },
        MANIFESTS,
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    await expect(
      staffAddScreenshot(
        s.staff.agent,
        { slug: "bravo", bytes: PNG_1X1, alt: "  " },
        MANIFESTS,
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("a 7th screenshot is refused; reorder + alt edit through save", async (t) => {
    if (!inst) return t.skip();
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const shot = await staffAddScreenshot(
        s.staff.agent,
        { slug: "charlie", bytes: PNG_1X1, alt: `Shot ${i + 1}` },
        MANIFESTS,
        { store },
      );
      ids.push(shot.id);
    }
    await expect(
      staffAddScreenshot(
        s.staff.agent,
        { slug: "charlie", bytes: PNG_1X1, alt: "Seventh" },
        MANIFESTS,
        { store },
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
    const reversed = [...ids].reverse();
    const saved = await staffSaveListing(
      s.staff.agent,
      {
        slug: "charlie",
        tagline: "",
        description: "",
        availability: "hidden",
        screenshots: reversed.map((id, i) => ({ id, alt: `New ${i}` })),
      },
      MANIFESTS,
    );
    expect(saved.screenshots.map((x) => x.id)).toEqual(reversed);
    expect(saved.screenshots[0]!.alt).toBe("New 0");
    await expect(
      staffSaveListing(
        s.staff.agent,
        {
          slug: "charlie",
          tagline: "",
          description: "",
          availability: "hidden",
          screenshots: reversed.slice(1).map((id) => ({ id, alt: "x" })),
        },
        MANIFESTS,
      ),
    ).rejects.toBeInstanceOf(InvalidInput);
  });

  it("platformCatalogKey refuses ../x", () => {
    expect(() => platformCatalogKey("../x", "abc", "png")).toThrow(
      InvalidInput,
    );
  });
});
