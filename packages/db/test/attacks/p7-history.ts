// P7 site settings history attacks. Owner: 07-29 (replaces the body of attacks()). Currently holds
// read-only attacks: the generic repo is read-only and org B's get of org A's row is NotFound.
// Real writer attacks, 07-29 (T-07-29-01, T-07-29-02): org B can never list, read or restore
// org A's site-part history, a version id crafted from A's key never reaches A's files, and
// a viewer of A cannot restore. Afterwards A's nav, footer, banner and settings and A's file
// list are unchanged.
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { Forbidden, NotFound } from "@cds/core";
import { expect } from "vitest";
import {
  listSiteSettingsVersions,
  restoreSiteSettingsVersion,
} from "../../src/content/history";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import { mintOrgContext } from "../../src/context";
import {
  getObjectStore,
  tenantSitePartVersionKey,
  tenantSitePartVersionPrefix,
} from "../../src/storage";
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
    "site_settings:history": async () => {
      await readOnlyAttack(env, "site_settings")();
      const seed = env.seed();
      const pb = env.pb();
      const A = seed.A;
      const ctxA = seed.ctxA;
      const B = seed.ctxB;
      const store = getObjectStore();
      const rowOf = (org: string) =>
        pb
          .collection("site_settings")
          .getFirstListItem(pb.filter("organization = {:org}", { org }));
      const partsOf = (r: Record<string, unknown>) => ({
        nav: r.nav,
        footer: r.footer,
        banner: r.banner,
        language: r.language,
        settings: r.settings,
        seo: r.seo,
      });
      const filesOf = async (org: string) =>
        (await store.list(tenantSitePartVersionPrefix(org, "nav")))
          .map((o) => o.key)
          .sort();

      // Seed A's history as files in A's own prefix (the suite requires every org A row
      // to stay byte-identical, so A's writers are not called here); removed at the end.
      const seeded: string[] = [];
      for (const [i, label] of ["History A", "History A2"].entries()) {
        const at = new Date(Date.UTC(2026, 0, 5, 0, 0, 0, i));
        const key = tenantSitePartVersionKey(A.org, "nav", at);
        await store.put(
          key,
          JSON.stringify({
            v: 1,
            part: "nav",
            at: at.toISOString(),
            by: { actor: ctxA.actor, staff: false },
            row: {
              nav: {
                items: [{ id: "h" + i, label, target: "page:" + A.page }],
              },
            },
          }),
          "application/json",
        );
        seeded.push(key);
      }
      const before = partsOf(await rowOf(A.org));
      const filesBefore = await filesOf(A.org);
      const aList = await listSiteSettingsVersions(ctxA, "nav");
      const aNewest = aList[0]!.id;
      const aOlder = aList[aList.length - 1]!.id;

      const bList = await listSiteSettingsVersions(B, "nav");
      for (const v of aList) {
        expect(bList.map((x) => x.id)).not.toContain(v.id);
      }
      await expect(
        restoreSiteSettingsVersion(B, deps(), "nav", aNewest),
      ).rejects.toThrow(NotFound);
      await expect(
        restoreSiteSettingsVersion(B, deps(), "nav", aOlder),
      ).rejects.toThrow(NotFound);
      await expect(
        restoreSiteSettingsVersion(
          B,
          deps(),
          "nav",
          `${tenantSitePartVersionPrefix(A.org, "nav")}${aOlder}.json`,
        ),
      ).rejects.toThrow(NotFound);
      await expect(
        restoreSiteSettingsVersion(
          B,
          deps(),
          "nav",
          `../../${A.org}/${aOlder}`,
        ),
      ).rejects.toThrow(NotFound);
      const viewerA = mintOrgContext({
        orgId: A.org,
        actor: ctxA.actor,
        role: "viewer",
        grants: [],
        ip: ctxA.ip,
      });
      await expect(
        restoreSiteSettingsVersion(viewerA, deps(), "nav", aOlder),
      ).rejects.toThrow(Forbidden);

      expect(partsOf(await rowOf(A.org))).toEqual(before);
      expect(await filesOf(A.org)).toEqual(filesBefore);

      for (const key of seeded) await store.delete(key);
    },
  };
}
