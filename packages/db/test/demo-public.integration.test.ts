// readDemoSiteUrl (15-07; HUB-01, D209, D293; T-15-07-02) against a throwaway PocketBase.
// No demo org → null; an org with slug "demo" but demo: false → null (never a real tenant);
// the demo org with a preview host → https://<host>/; a demo org with only a custom host →
// null; a failed read → null with the class name logged only.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { superuser } from "../src/client";
import { readDemoSiteUrl } from "../src/demo";
import { DEMO_SLUG } from "../src/demo/seed";
import { bootSeededPb, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;

describe("readDemoSiteUrl (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });

  it("covers absent, not-demo, custom-only and preview cases in order", async (t) => {
    if (!booted) return t.skip();
    expect(await readDemoSiteUrl()).toBeNull();

    const pb = await superuser();
    const org = await pb.collection("organizations").create({
      name: "Bella's Salon",
      slug: DEMO_SLUG,
      status: "active",
      path: "studio",
      stage: "live",
      demo: false,
    });
    await pb.collection("org_hosts").create({
      hostname: "demo.sites.cds.test",
      organization: org.id,
      kind: "preview",
      primary: true,
    });
    expect(await readDemoSiteUrl()).toBeNull();

    await pb.collection("organizations").update(org.id, { demo: true });
    expect(await readDemoSiteUrl()).toBe("https://demo.sites.cds.test/");

    const host = await pb
      .collection("org_hosts")
      .getFirstListItem(
        pb.filter("hostname = {:h}", { h: "demo.sites.cds.test" }),
      );
    await pb.collection("org_hosts").update(host.id, {
      kind: "custom",
      hostname: "bellas.example.test",
    });
    expect(await readDemoSiteUrl()).toBeNull();
  });

  it("a failed read returns null and logs the class name only", async (t) => {
    if (!booted) return t.skip();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const prev = process.env.PB_URL;
    try {
      await booted.inst.stop();
      expect(await readDemoSiteUrl()).toBeNull();
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain("[demo] demo site url unavailable");
    } finally {
      process.env.PB_URL = prev;
      spy.mockRestore();
      booted = null;
    }
  });
});
