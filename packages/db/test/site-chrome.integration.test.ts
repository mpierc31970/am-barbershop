// Site menu and footer on the real PocketBase 0.39.11 binary (CONT-13; D248, D253; 07-25
// choices 1-3, 13; invariant 1, TEN-03; T-07-25-01..05, T-07-25-08).
import { Forbidden, InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  addPageToNav,
  getFooter,
  getNav,
  readPublicLogoId,
  saveFooter,
  saveNav,
} from "../src/content/chrome";
import {
  liveTag,
  recordingInvalidator,
  type ContentDeps,
} from "../src/content/ports";
import { saveBanner } from "../src/content/site-settings";
import {
  readPublicSiteSettings,
  siteContextForHost,
  type SiteContext,
} from "../src/content/site-context";
import { mintOrgContext } from "../src/context";
import { clearResolverCache } from "../src/resolve";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { seedMediaRow } from "./media-seed";
import { bootPb, type PbInstance } from "./pb-harness";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

function deps(verdict: "clean" | "held" = "clean") {
  const invalidator = recordingInvalidator();
  const d: ContentDeps = {
    sections: registry,
    invalidator,
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict, reasons: [] }) },
  };
  return { d, invalidator };
}

async function site(host: string): Promise<SiteContext> {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

async function storedNav(org: string): Promise<unknown> {
  const row = await pb
    .collection("site_settings")
    .getFirstListItem(pb.filter("organization = {:org}", { org }));
  return row.nav;
}

async function newPage(org: string, slug: string, title: string) {
  return (
    await pb.collection("pages").create({
      organization: org,
      slug,
      title,
      status: "draft",
      kind: "builder",
    })
  ).id;
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
});

afterAll(async () => {
  await inst?.stop();
  clearResolverCache();
});

describe("saveNav / getNav", () => {
  it("round-trips and invalidates the live tag", async (t) => {
    if (!inst) return t.skip();
    const { d, invalidator } = deps();
    const input = {
      items: [
        {
          id: "home",
          label: "Home",
          target: `page:${seed.A.page}`,
          children: [
            {
              id: "shop",
              label: "Shop",
              target: "https://shop.test/",
              new_tab: true,
            },
          ],
        },
      ],
      cta: { label: "", target: `popup:${seed.A.popup}` },
    };
    const res = await saveNav(seed.ctxA, d, input);
    expect(res.held).toBe(false);
    expect(await getNav(seed.ctxA)).toEqual(res.nav);
    expect(res.nav.cta).toEqual({
      label: "Book now",
      target: `popup:${seed.A.popup}`,
    });
    expect(invalidator.tags).toContain(liveTag(seed.A.org));
  });

  it("a held save stores held: true; a clean re-save clears it", async (t) => {
    if (!inst) return t.skip();
    const body = {
      items: [{ id: "h", label: "Home", target: `page:${seed.A.page}` }],
    };
    await saveNav(seed.ctxA, deps("held").d, body);
    const pub = await readPublicSiteSettings(await site("a.example.com"));
    expect(pub.nav?.held).toBe(true);
    await saveNav(seed.ctxA, deps().d, body);
    expect((await getNav(seed.ctxA))?.held).toBe(false);
  });

  it("refuses org B's page, an unknown id and a viewer", async (t) => {
    if (!inst) return t.skip();
    const before = await storedNav(seed.A.org);
    await expect(
      saveNav(seed.ctxA, deps().d, {
        items: [{ id: "x", label: "X", target: `page:${seed.B.page}` }],
      }),
    ).rejects.toThrow(InvalidInput);
    await expect(
      saveNav(seed.ctxA, deps().d, {
        items: [{ id: "x", label: "X", target: "page:zzzzzzzzzzzzzzz" }],
      }),
    ).rejects.toThrow(InvalidInput);
    expect(await storedNav(seed.A.org)).toEqual(before);
    const viewer = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.A.owner,
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(saveNav(viewer, deps().d, { items: [] })).rejects.toThrow(
      Forbidden,
    );
  });
});

describe("addPageToNav", () => {
  it("appends once, stops at 8 and refuses a foreign page", async (t) => {
    if (!inst) return t.skip();
    await saveNav(seed.ctxA, deps().d, { items: [] });
    const p = await newPage(seed.A.org, "about-nav", "About");
    expect(await addPageToNav(seed.ctxA, deps().d, p)).toEqual({ added: true });
    expect(await addPageToNav(seed.ctxA, deps().d, p)).toEqual({
      added: false,
      reason: "exists",
    });
    const nav = await getNav(seed.ctxA);
    expect(nav?.items.map((i) => i.label)).toEqual(["About"]);
    await saveNav(seed.ctxA, deps().d, {
      items: Array.from({ length: 8 }, (_, i) => ({
        id: `u${i}`,
        label: `L${i}`,
        target: "https://x.test/",
      })),
    });
    expect(await addPageToNav(seed.ctxA, deps().d, p)).toEqual({
      added: false,
      reason: "full",
    });
    await expect(
      addPageToNav(seed.ctxA, deps().d, seed.B.page),
    ).rejects.toThrow(NotFound);
  });
});

describe("saveFooter / public reads", () => {
  it("round-trips the footer and invalidates", async (t) => {
    if (!inst) return t.skip();
    const { d, invalidator } = deps();
    const res = await saveFooter(seed.ctxA, d, {
      show_hours: false,
      extra_links: [
        { id: "p", label: "Privacy", target: `page:${seed.A.page}` },
      ],
      copyright: "© {year} A",
    });
    expect(await getFooter(seed.ctxA)).toEqual(res.footer);
    expect(res.footer.show_hours).toBe(false);
    expect(invalidator.tags).toContain(liveTag(seed.A.org));
    await expect(
      saveFooter(seed.ctxA, deps().d, {
        extra_links: [{ id: "p", label: "X", target: `page:${seed.B.page}` }],
      }),
    ).rejects.toThrow(InvalidInput);
  });

  it("a malformed stored nav/footer reads as null; the banner still reads", async (t) => {
    if (!inst) return t.skip();
    await saveBanner(seed.ctxB, deps().d, { enabled: true, message: "Hi B" });
    const row = await pb
      .collection("site_settings")
      .getFirstListItem(
        pb.filter("organization = {:org}", { org: seed.B.org }),
      );
    await pb.collection("site_settings").update(row.id, {
      nav: { items: "nope", cta: { target: "javascript:x" } },
      footer: { extra_links: Array.from({ length: 9 }, () => ({})) },
    });
    expect(await getNav(seed.ctxB)).toBeNull();
    expect(await getFooter(seed.ctxB)).toBeNull();
    const pub = await readPublicSiteSettings(await site("b.example.com"));
    expect(pub.nav).toBeNull();
    expect(pub.footer).toBeNull();
    expect(pub.banner?.message).toBe("Hi B");
  });

  it("readPublicLogoId returns the org's ready logo only", async (t) => {
    if (!inst) return t.skip();
    const siteA = await site("a.example.com");
    const siteB = await site("b.example.com");
    const logoA = await seedMediaRow(seed.A.org, { kind: "logo" });
    await seedMediaRow(seed.A.org, { kind: "logo", status: "processing" });
    expect(await readPublicLogoId(siteA)).toBe(logoA);
    expect(await readPublicLogoId(siteB)).not.toBe(logoA);
  });
});
