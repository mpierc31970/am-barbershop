// P7 site settings (seo, language, settings) attacks. Owner: 07-26 (replaces the body of attacks()). Currently holds
// read-only attacks: the generic repo is read-only and org B's get of org A's row is NotFound.
// Real writer attacks, 07-26 (T-07-26-01, T-07-26-08): saveSiteSettings driven with org B's
// context and org A's organization is refused; org B's own save writes only org B's row (org
// A's language / settings / seo read back unchanged through pb); org B's reads never return
// org A's values.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { InvalidInput } from "@cds/core";
import { expect } from "vitest";
import { getSiteSettings, saveSiteSettings } from "../../src/content/chrome";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import {
  readPublicSiteSettings,
  siteContextForHost,
} from "../../src/content/site-context";
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

export function attacks(env: AttackEnv): AttackMap {
  return {
    "site_settings:site-settings": async () => {
      await readOnlyAttack(env, "site_settings")();
      const seed = env.seed();
      const pb = env.pb();
      const A = seed.A;
      const B = seed.ctxB;
      const rowOf = (org: string) =>
        pb
          .collection("site_settings")
          .getFirstListItem(pb.filter("organization = {:org}", { org }));
      const before = await rowOf(A.org);
      const aGroup = JSON.stringify({
        language: before.language,
        settings: before.settings,
        seo: before.seo,
      });

      await expect(
        saveSiteSettings(B, deps(), { organization: A.org, language: "fr" }),
      ).rejects.toThrow(InvalidInput);
      await saveSiteSettings(B, deps(), {
        language: "fr",
        show_translate: true,
      });

      const after = await rowOf(A.org);
      expect(
        JSON.stringify({
          language: after.language,
          settings: after.settings,
          seo: after.seo,
        }),
      ).toBe(aGroup);
      expect((await rowOf(B.orgId)).language).toBe("fr");

      const bView = await getSiteSettings(B);
      expect(bView.language).toBe("fr");
      const siteB = await siteContextForHost("b.example.com");
      if (!siteB) throw new Error("no site for b.example.com");
      const pubB = await readPublicSiteSettings(siteB);
      expect(pubB.settings.language).toBe("fr");
      expect(pubB.settings.show_translate).toBe(true);
    },
  };
}
