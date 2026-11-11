// P7 site chrome (nav, footer) attacks. Owner: 07-25 (replaces the body of attacks()). Currently holds
// read-only attacks: the generic repo is read-only and org B's get of org A's row is NotFound.
// Real writer attacks, 07-25 (T-07-25-01, T-07-25-02): every chrome writer driven with org B's
// context and org A's ids or organization is refused, and org A's nav/footer are unchanged
// (read through pb). Org B's visitor read never returns org A's menu.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { InvalidInput, NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  addPageToNav,
  getNav,
  saveFooter,
  saveNav,
} from "../../src/content/chrome";
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
    "site_settings:site-chrome": async () => {
      await readOnlyAttack(env, "site_settings")();
      const seed = env.seed();
      const pb = env.pb();
      const A = seed.A;
      const B = seed.ctxB;
      // Org A's row is never written here: the suite checks every org A row is unchanged.
      const MARK = A.page;
      const rowOf = (org: string) =>
        pb
          .collection("site_settings")
          .getFirstListItem(pb.filter("organization = {:org}", { org }));
      const before = await rowOf(A.org);

      await expect(
        saveNav(B, deps(), { items: [], organization: A.org }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        saveNav(B, deps(), {
          items: [{ id: "x", label: "x", target: `page:${A.page}` }],
        }),
      ).rejects.toThrow(InvalidInput);
      await expect(
        saveNav(B, deps(), {
          items: [],
          cta: { label: "x", target: `popup:${A.popup}` },
        }),
      ).rejects.toThrow(InvalidInput);
      await expect(addPageToNav(B, deps(), A.page)).rejects.toThrow(NotFound);
      await expect(
        saveFooter(B, deps(), { copyright: "x", organization: A.org }),
      ).rejects.toThrow(InvalidInput);
      await saveFooter(B, deps(), { copyright: "B footer" });

      const after = await rowOf(A.org);
      expect(after.nav).toEqual(before.nav);
      expect(after.footer).toEqual(before.footer);
      expect(JSON.stringify(await getNav(B))).not.toContain(MARK);

      const siteB = await siteContextForHost("b.example.com");
      if (!siteB) throw new Error("no site for b.example.com");
      expect(JSON.stringify(await readPublicSiteSettings(siteB))).not.toContain(
        MARK,
      );
    },
  };
}
