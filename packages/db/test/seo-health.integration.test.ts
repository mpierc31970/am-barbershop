// 11-18: SEO health from published pages (D188, DASH-11). The manifest and published page
// JSON are written straight into a throwaway local store, the way the publish chain leaves
// them, so the score reads published content only.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Forbidden } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { mintOrgContext, type OrgContext } from "../src/context";
import { seoHealthFor } from "../src/reports/seo-health";
import { tenantPublishedPageKey, tenantSiteManifestKey } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let dir: string;
let store: LocalDiskStore;

const tag = () => randomBytes(4).toString("hex");
const GOOD_DESC =
  "We help small teams build calm, fast websites that bring in real customers.";

async function newOrg(): Promise<{ org: string; ctx: OrgContext }> {
  const t = tag();
  const org = (
    await pb.collection("organizations").create({
      name: `Seo ${t}`,
      slug: `seo-${t}`,
      status: "active",
      path: "standard",
    })
  ).id;
  return {
    org,
    ctx: mintOrgContext({
      orgId: org,
      actor: "aaaaaaaaaaaaaaa",
      role: "viewer",
      grants: [],
      ip: "127.0.0.1",
    }),
  };
}

type PageSpec = {
  id: string;
  slug: string;
  title: string;
  desc?: string;
  sections: { section_type: string; content: unknown }[];
  protected?: boolean;
};

async function publish(
  org: string,
  pages: PageSpec[],
  redirects: Record<string, string> = {},
): Promise<void> {
  const manifest = {
    version: 1,
    pages: Object.fromEntries(
      pages.map((p) => [
        p.slug,
        {
          id: p.id,
          title: p.title,
          published_at: "2026-10-01T00:00:00.000Z",
          protected: p.protected === true,
        },
      ]),
    ),
    redirects,
    updated_at: "2026-10-02T12:00:00.000Z",
  };
  await store.put(tenantSiteManifestKey(org), JSON.stringify(manifest));
  for (const p of pages) {
    await store.put(
      tenantPublishedPageKey(org, p.id),
      JSON.stringify({
        version: 1,
        page: {
          id: p.id,
          slug: p.slug,
          title: p.title,
          seo: p.desc ? { meta_description: p.desc } : {},
          password_protected: p.protected === true,
        },
        sections: p.sections.map((s, i) => ({
          id: `s${i}${p.id}`,
          row_layout: "full",
          settings: { background_variant: "main" },
          ...s,
        })),
        published_at: "2026-10-01T00:00:00.000Z",
      }),
    );
  }
}

const pid = () => randomBytes(8).toString("hex").slice(0, 15);

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  dir = mkdtempSync(join(tmpdir(), "cds-seo-health-"));
  store = new LocalDiskStore(dir);
});

afterAll(async () => {
  await inst?.stop();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("seoHealthFor (D188)", () => {
  it("names the page missing its description and counts a link to a removed page as broken", async (t) => {
    if (!inst) return t.skip();
    const { org, ctx } = await newOrg();
    const home = pid();
    const about = pid();
    await publish(
      org,
      [
        {
          id: home,
          slug: "home",
          title: "Calm websites for teams",
          desc: GOOD_DESC,
          sections: [
            {
              section_type: "hero",
              content: {
                heading: "Welcome",
                image_url: "https://example.com/a.jpg",
                image_alt: "Our studio",
                cta_primary_link: "/about",
              },
            },
          ],
        },
        {
          id: about,
          slug: "about",
          title: "About us and our story",
          sections: [
            {
              section_type: "columns",
              content: {
                columns: [
                  {
                    id: "c1",
                    items: [
                      {
                        id: "i1",
                        kind: "text",
                        html: '<p><a href="/old-page">Old</a> <a href="/">Home</a> <a href="/privacy">Privacy</a> <a href="/moved">Moved</a></p>',
                      },
                      {
                        id: "i2",
                        kind: "button",
                        text: "Gone",
                        link: "/removed",
                      },
                      {
                        id: "i3",
                        kind: "image",
                        url: "https://example.com/b.jpg",
                        alt: "",
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        {
          id: pid(),
          slug: "system-404",
          title: "",
          sections: [],
        },
      ],
      { moved: "about" },
    );

    const r = await seoHealthFor(ctx, { store });
    expect(r.pages).toBe(2);
    expect(r.checkedAt).toBe("2026-10-02T12:00:00.000Z");
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(100);
    const description = r.fixes.find((f) => f.rule === "description");
    expect(description).toEqual({
      pageId: about,
      rule: "description",
      message: "Add a description to About us and our story",
    });
    const links = r.fixes.find((f) => f.rule === "links");
    expect(links?.pageId).toBe(about);
    expect(links?.message).toBe("Fix 2 broken links on About us and our story");
    expect(r.fixes.find((f) => f.rule === "alt")).toEqual({
      pageId: about,
      rule: "alt",
      message: "Add alt text to 1 image on About us and our story",
    });
    expect(r.fixes.some((f) => f.pageId === home)).toBe(false);
  });

  it("an org with no published pages scores from the sitemap rule only", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await newOrg();
    const r = await seoHealthFor(ctx, { store });
    expect(r.pages).toBe(0);
    expect(r.score).toBe(95);
    expect(r.fixes).toEqual([
      expect.objectContaining({ pageId: null, rule: "sitemap" }),
    ]);
  });

  it("reads only the caller's org and skips protected pages", async (t) => {
    if (!inst) return t.skip();
    const { ctx } = await newOrg();
    const { org: other } = await newOrg();
    await publish(other, [
      { id: pid(), slug: "home", title: "x", sections: [] },
    ]);
    expect((await seoHealthFor(ctx, { store })).pages).toBe(0);

    const { org, ctx: ctx2 } = await newOrg();
    await publish(org, [
      {
        id: pid(),
        slug: "home",
        title: "Calm websites for teams",
        desc: GOOD_DESC,
        sections: [{ section_type: "hero", content: { heading: "Hi" } }],
      },
      { id: pid(), slug: "members", title: "", sections: [], protected: true },
    ]);
    const r = await seoHealthFor(ctx2, { store });
    expect(r.pages).toBe(1);
    expect(r.score).toBe(100);
    expect(r.fixes).toEqual([]);
  });

  it("refuses a context without content read", async (t) => {
    if (!inst) return t.skip();
    const { org } = await newOrg();
    const renter = mintOrgContext({
      orgId: org,
      actor: "aaaaaaaaaaaaaaa",
      role: "renter",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(seoHealthFor(renter, { store })).rejects.toBeInstanceOf(
      Forbidden,
    );
  });
});
