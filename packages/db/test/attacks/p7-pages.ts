// P7 protected pages + 404 attacks. Owner: 07-32 (T-07-32-02, T-07-32-06; invariant 1, TEN-03).
// Writer attacks: org B can never set, verify, read or clear org A's page password, open
// org A's 404 page, or remove org A's page from org A's menu. A gate cookie minted for one
// org never opens another's page. The read-only base attack stays first.
import { NotFound } from "@cds/core";
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import { expect } from "vitest";
import { removePageFromNav } from "../../src/content/chrome";
import {
  recordingInvalidator,
  type ContentDeps,
} from "../../src/content/ports";
import {
  ensureNotFoundPage,
  gateCookieValid,
  getNotFoundPage,
  mintGateCookie,
  readPageGate,
  setPagePassword,
  verifyPagePassword,
} from "../../src/content/protected";
import { siteContextForHost } from "../../src/content/site-context";
import { resetPageGateLimitsForTests } from "../../src/rate-limit";
import { clearResolverCache } from "../../src/resolve";
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
  clearResolverCache();
  const s = await siteContextForHost(host);
  if (!s) throw new Error(`no site for ${host}`);
  return s;
}

export function attacks(env: AttackEnv): AttackMap {
  return {
    "pages:protected": async () => {
      await readOnlyAttack(env, "pages")();
      const seed = env.seed();
      const pb = env.pb();
      const rowA = () => pb.collection("pages").getOne(seed.A.page);
      const before = await rowA();
      await expect(
        setPagePassword(
          seed.ctxB,
          seed.A.page,
          { password: "owned-it" },
          deps(),
        ),
      ).rejects.toThrow(NotFound);
      await expect(
        setPagePassword(seed.ctxB, seed.A.page, { password: null }, deps()),
      ).rejects.toThrow(NotFound);
      const after = await rowA();
      expect(after.password_hash).toBe(before.password_hash);
      expect(after.password_version).toBe(before.password_version);
      expect(after.password_protected).toBe(before.password_protected);

      const siteA = await site("a.example.com");
      const siteB = await site("b.example.com");
      expect(await readPageGate(siteB, seed.A.page)).toBeNull();
      expect(await readPageGate(siteA, seed.A.page)).not.toBeNull();
      resetPageGateLimitsForTests();
      await expect(
        verifyPagePassword(siteB, seed.A.page, "guess-one", { ip: "9.9.9.9" }),
      ).rejects.toThrow(NotFound);

      const now = new Date();
      const forB = mintGateCookie({
        orgId: seed.B.org,
        pageId: seed.A.page,
        version: 0,
        now,
      });
      expect(
        gateCookieValid({
          orgId: seed.A.org,
          pageId: seed.A.page,
          version: 0,
          value: forB.value,
          now,
        }),
      ).toBe(false);
    },

    "pages:not-found": async () => {
      // Never writes org A rows: the suite checks every org A row is unchanged.
      const seed = env.seed();
      const pb = env.pb();
      const aBefore = await getNotFoundPage(seed.ctxA);
      const b = await ensureNotFoundPage(seed.ctxB);
      expect((await pb.collection("pages").getOne(b.id)).organization).toBe(
        seed.B.org,
      );
      expect((await getNotFoundPage(seed.ctxB))!.id).toBe(b.id);
      expect(await getNotFoundPage(seed.ctxA)).toEqual(aBefore);
      expect((await getNotFoundPage(seed.ctxA))?.id).not.toBe(b.id);
    },

    "site_settings:nav-remove": async () => {
      const seed = env.seed();
      const pb = env.pb();
      const navOf = async (org: string) =>
        JSON.stringify(
          (
            await pb
              .collection("site_settings")
              .getFirstListItem(pb.filter("organization = {:org}", { org }))
          ).nav ?? null,
        );
      const before = await navOf(seed.A.org);
      await expect(
        removePageFromNav(seed.ctxB, deps(), seed.A.page),
      ).rejects.toThrow(NotFound);
      expect(await navOf(seed.A.org)).toBe(before);
    },
  };
}
