// 14-14 (DOM-06, D13; T-14-14-01..03): the control plane alone decides which hosts the edge
// may serve and certify. Real PocketBase binary; two orgs.
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import {
  cdsHostProof,
  clearEdgeCache,
  edgeAllowed,
  edgeAllowedHosts,
  edgeAskAllowed,
  edgeRouterName,
  edgeRoutes,
  forgetHost,
  verifyCdsHostProof,
} from "../src/dns/edge";
import { clearResolverCache, resolveOrganization } from "../src/resolve";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
const tag = Math.random().toString(36).slice(2, 8);
const VERIFIED = "2026-10-01 10:00:00.000Z";

let orgA = "";
let orgB = "";
let orgClosed = "";
const H = {
  previewA: `edge-a-${tag}.sites.localhost`,
  customUnverified: `unverified-${tag}.example`,
  customVerified: `crumb-${tag}.example`,
  redirectVerified: `old-crumb-${tag}.example`,
  previewB: `edge-b-${tag}.sites.localhost`,
  foreignPreview: `foreign-${tag}.example`,
  closedCustom: `closed-${tag}.example`,
};

async function org(slug: string, status: string): Promise<string> {
  return (
    await pb.collection("organizations").create({
      name: slug,
      slug,
      status,
      stage: "live",
    })
  ).id;
}

async function host(
  hostname: string,
  organization: string,
  kind: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await pb
    .collection("org_hosts")
    .create({ hostname, organization, kind, primary: false, ...extra });
}

const SERVICE = "https-0-testapp@docker";

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  orgA = await org(`edge-a-${tag}`, "active");
  orgB = await org(`edge-b-${tag}`, "active");
  orgClosed = await org(`edge-c-${tag}`, "disabled");
  await host(H.previewA, orgA, "preview", { primary: true });
  await host(H.customUnverified, orgA, "custom");
  await host(H.customVerified, orgA, "custom", { verified_at: VERIFIED });
  await host(H.redirectVerified, orgA, "redirect", {
    verified_at: VERIFIED,
    redirect_to: H.customVerified,
  });
  await host(H.previewB, orgB, "preview", { primary: true });
  // A hand-made preview row outside the platform preview suffix: refused by the guard.
  await host(H.foreignPreview, orgB, "preview");
  await host(H.closedCustom, orgClosed, "custom", { verified_at: VERIFIED });
});

beforeEach(() => {
  clearEdgeCache();
  clearResolverCache();
});

afterAll(async () => {
  await inst?.stop();
});

describe("edgeAllowed (14-14)", () => {
  it("allows a platform preview row", async () => {
    if (!inst) return;
    expect(await edgeAllowed(H.previewA)).toBe(true);
    expect(await edgeAllowed(H.previewA.toUpperCase() + ":443")).toBe(true);
  });

  it("denies a custom row without verified_at, allows it once verified", async () => {
    if (!inst) return;
    expect(await edgeAllowed(H.customUnverified)).toBe(false);
    expect(await edgeAllowed(H.customVerified)).toBe(true);
    expect(await edgeAllowed(H.redirectVerified)).toBe(true);
  });

  it("never matches by suffix: www.<custom> without a row is denied", async () => {
    if (!inst) return;
    expect(await edgeAllowed(`www.${H.customVerified}`)).toBe(false);
    expect(await edgeAllowed(`x.${H.previewA}`)).toBe(false);
    expect(await edgeAllowed("nope.sites.localhost")).toBe(false);
  });

  it("denies a closed org, a foreign preview row, platform hosts and junk", async () => {
    if (!inst) return;
    expect(await edgeAllowed(H.closedCustom)).toBe(false);
    expect(await edgeAllowed(H.foreignPreview)).toBe(false);
    expect(await edgeAllowed("localhost")).toBe(false);
    expect(await edgeAllowed("")).toBe(false);
    expect(await edgeAllowed(null)).toBe(false);
    expect(await edgeAllowed("a`) || Host(`evil.example")).toBe(false);
  });

  it("forgetHost applies a change at once (edge and resolver caches)", async () => {
    if (!inst) return;
    const h = `later-${tag}.example`;
    await host(h, orgB, "custom");
    const row = await pb
      .collection("org_hosts")
      .getFirstListItem(pb.filter("hostname = {:h}", { h }));
    try {
      expect(await edgeAllowed(h)).toBe(false);
      expect((await resolveOrganization(h))?.hostKind).toBe("custom");
      await pb.collection("org_hosts").update(row.id, {
        kind: "redirect",
        verified_at: VERIFIED,
        redirect_to: H.previewB,
      });
      // Both caches still hold the old answer...
      expect(await edgeAllowed(h)).toBe(false);
      expect((await resolveOrganization(h))?.hostKind).toBe("custom");
      // ...until forgetHost drops it.
      forgetHost(h);
      expect(await edgeAllowed(h)).toBe(true);
      const r = await resolveOrganization(h);
      expect(r?.hostKind).toBe("redirect");
      expect(r?.redirectTo).toBe(H.previewB);
    } finally {
      await pb.collection("org_hosts").delete(row.id);
      forgetHost(h);
    }
  });
});

describe("edgeAskAllowed (WR-A11)", () => {
  it("answers from the allowed-host snapshot, same rule as edgeAllowed; forgetHost refreshes it", async () => {
    if (!inst) return;
    expect(await edgeAskAllowed(H.previewA)).toBe(true);
    expect(await edgeAskAllowed(H.customVerified)).toBe(true);
    expect(await edgeAskAllowed(H.customUnverified)).toBe(false);
    expect(await edgeAskAllowed(H.closedCustom)).toBe(false);
    expect(await edgeAskAllowed(`random-${tag}.attacker.example`)).toBe(false);
    const h = `ask-later-${tag}.example`;
    await host(h, orgB, "custom", { verified_at: VERIFIED });
    try {
      // The snapshot is still the old one...
      expect(await edgeAskAllowed(h)).toBe(false);
      // ...until forgetHost drops it (cutover calls it for every changed host).
      forgetHost(h);
      expect(await edgeAskAllowed(h)).toBe(true);
    } finally {
      const row = await pb
        .collection("org_hosts")
        .getFirstListItem(pb.filter("hostname = {:h}", { h }));
      await pb.collection("org_hosts").delete(row.id);
      forgetHost(h);
    }
  });
});

describe("edgeRoutes (14-14, P14-P7)", () => {
  const allowed = () =>
    [H.previewA, H.customVerified, H.redirectVerified, H.previewB].sort();

  it("lists exactly the allowed hosts", async () => {
    if (!inst) return;
    const hosts = (await edgeAllowedHosts()).filter((h) => h.includes(tag));
    expect(hosts).toEqual(allowed());
  });

  it("emits one https and one http router per host with stable names", async () => {
    if (!inst) return;
    const a = await edgeRoutes({ service: SERVICE });
    const b = await edgeRoutes({ service: SERVICE });
    expect(Object.keys(a.http.routers)).toEqual(Object.keys(b.http.routers));
    const name = edgeRouterName(H.customVerified);
    expect(name).toMatch(/^cds-h-[0-9a-f]{8}$/);
    expect(a.http.routers[name]).toEqual({
      rule: `Host(\`${H.customVerified}\`)`,
      entryPoints: ["https"],
      service: SERVICE,
      tls: { certResolver: "letsencrypt" },
    });
    expect(a.http.routers[`${name}-http`]).toEqual({
      rule: `Host(\`${H.customVerified}\`)`,
      entryPoints: ["http"],
      middlewares: ["redirect-to-https@docker"],
      service: "http-0-testapp@docker",
    });
    const mine = Object.values(a.http.routers)
      .map((r) => /Host\(`(.+)`\)/.exec(r.rule)?.[1] ?? "")
      .filter((h) => h.includes(tag));
    expect([...new Set(mine)].sort()).toEqual(allowed());
    expect(mine.length).toBe(allowed().length * 2);
  });

  it("bumps the router name when platform_meta holds a retry count", async () => {
    if (!inst) return;
    const key = `edge:retry:${H.customVerified}`;
    const meta = await pb
      .collection("platform_meta")
      .create({ key, value: "2" });
    const out = await edgeRoutes({
      service: SERVICE,
      httpMiddleware: "m@file",
    });
    const name = `${edgeRouterName(H.customVerified)}-r2`;
    expect(out.http.routers[name]?.service).toBe(SERVICE);
    expect(out.http.routers[`${name}-http`]?.middlewares).toEqual(["m@file"]);
    expect(out.http.routers[edgeRouterName(H.customVerified)]).toBeUndefined();
    await pb.collection("platform_meta").delete(meta.id);
  });

  it("throws without a service", async () => {
    if (!inst) return;
    const saved = process.env.CDS_EDGE_SERVICE;
    delete process.env.CDS_EDGE_SERVICE;
    await expect(edgeRoutes()).rejects.toThrow(/CDS_EDGE_SERVICE/);
    if (saved !== undefined) process.env.CDS_EDGE_SERVICE = saved;
  });
});

describe("cds-host proof (14-14)", () => {
  it("verifies for the right org and fails for another", () => {
    const p = cdsHostProof(H.customVerified, "org000000000001");
    expect(p).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifyCdsHostProof(H.customVerified, "org000000000001", p)).toBe(
      true,
    );
    expect(
      verifyCdsHostProof(H.customVerified.toUpperCase(), "org000000000001", p),
    ).toBe(true);
    expect(verifyCdsHostProof(H.customVerified, "org000000000002", p)).toBe(
      false,
    );
    expect(verifyCdsHostProof(H.previewA, "org000000000001", p)).toBe(false);
    expect(verifyCdsHostProof(H.customVerified, "org000000000001", "x")).toBe(
      false,
    );
    expect(verifyCdsHostProof(null, "org000000000001", p)).toBe(false);
  });
});
