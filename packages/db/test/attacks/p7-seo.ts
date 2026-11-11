// P7 page SEO attacks. Owner: 07-30 (T-07-30-04, T-07-30-05; invariant 1, TEN-03).
// Writer attacks: org B can never set org A's media as a page or site share image, never write
// org A's site icon objects, and never read org A's services or team through a site context.
// The read-only base attack (generic repo read-only, B's get of A's row NotFound) stays first.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InvalidInput, NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { expect } from "vitest";
import { saveSiteSettings } from "../../src/content/chrome";
import { updatePage } from "../../src/content/pages";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import {
  readPublicServices,
  readPublicTeam,
  readSiteIcons,
  refreshSiteIcons,
} from "../../src/content/seo";
import { siteContextForHost } from "../../src/content/site-context";
import { tenantSiteAssetKey } from "../../src/storage";
import { LocalDiskStore } from "../../src/storage/local-disk";
import { readOnlyAttack, type AttackEnv, type AttackMap } from "./env";

const registry = composeSectionRegistry(CORE_SECTIONS, []);

function deps(): ContentDeps {
  return {
    sections: registry,
    invalidator: recordingInvalidator(),
    pinger: { ping: () => Promise.resolve() },
    scanner: { scan: () => Promise.resolve({ verdict: "clean", reasons: [] }) },
  };
}

async function site(host: string) {
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    "pages:seo": async () => {
      await readOnlyAttack(env, "pages")();
      const seed = env.seed();
      await expect(
        updatePage(seed.ctxB, seed.A.page, { seo: { meta_title: "Owned" } }),
      ).rejects.toThrow(NotFound);
      await expect(
        updatePage(seed.ctxB, seed.B.page, {
          seo: { share_image: seed.A.media },
        }),
      ).rejects.toThrow(InvalidInput);
    },

    "site_settings:seo": async () => {
      const seed = env.seed();
      const pb = env.pb();
      const rowOf = (org: string) =>
        pb
          .collection("site_settings")
          .getFirstListItem(pb.filter("organization = {:org}", { org }));
      const before = JSON.stringify((await rowOf(seed.A.org)).seo ?? null);
      await expect(
        saveSiteSettings(seed.ctxB, deps(), { share_image: seed.A.media }),
      ).rejects.toThrow(InvalidInput);
      expect(JSON.stringify((await rowOf(seed.A.org)).seo ?? null)).toBe(
        before,
      );
      const bSeo = (await rowOf(seed.B.org)).seo as Record<
        string,
        unknown
      > | null;
      expect(bSeo?.share_image ?? "").not.toBe(seed.A.media);
    },

    "media_assets:site-icons": async () => {
      const seed = env.seed();
      const publicStore = new LocalDiskStore(
        mkdtempSync(join(tmpdir(), "cds-seo-attack-")),
      );
      await refreshSiteIcons(seed.ctxB, { publicStore });
      expect(
        await publicStore.get(tenantSiteAssetKey(seed.B.org, "manifest.json")),
      ).not.toBeNull();
      for (const name of [
        "icon-32.png",
        "share.png",
        "manifest.json",
      ] as const) {
        expect(
          await publicStore.get(tenantSiteAssetKey(seed.A.org, name)),
        ).toBeNull();
      }
      const siteB = await site("b.example.com");
      const siteA = await site("a.example.com");
      expect(await readSiteIcons(siteB, { publicStore })).not.toBeNull();
      expect(await readSiteIcons(siteA, { publicStore })).toBeNull();
    },

    "services:public-read": async () => {
      const seed = env.seed();
      const pb = env.pb();
      // Both seeded rows are published (fixtures.ts).
      {
        const siteB = await site("b.example.com");
        const names = (await readPublicServices(siteB)).map((s) => s.name);
        expect(names).toContain("Service B");
        const aName = (await pb.collection("services").getOne(seed.A.service))
          .name;
        expect(names).not.toContain(aName);
        await expect(
          readPublicServices({
            orgId: seed.A.org,
            host: "a.example.com",
          } as never),
        ).rejects.toThrow();
      }
    },

    "team_members:public-read": async () => {
      const seed = env.seed();
      const pb = env.pb();
      // Both seeded rows are published (fixtures.ts).
      {
        const siteB = await site("b.example.com");
        const names = (await readPublicTeam(siteB)).map((t) => t.name);
        expect(names).toContain("Staff B");
        const aName = (
          await pb.collection("team_members").getOne(seed.A.teamMember)
        ).name;
        expect(names).not.toContain(aName);
        await expect(
          readPublicTeam({ orgId: seed.A.org, host: "a.example.com" } as never),
        ).rejects.toThrow();
      }
    },
  };
}
