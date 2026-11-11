// 14-32 (CONT-16, D312; T-14-32-03, P14-P34): ownerSearchStatus on the real PocketBase binary.
// The owner of a live org reads its GA4 id, whether Search Console is set (never the site id)
// and the last sitemap submission / IndexNow ping; another org's context sees only its own
// (empty) state; an Editor is refused (`domain:read` is Owner and Admin).
import { Forbidden } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { ownerSearchStatus } from "../src/content/sitemap-submit";
import { mintOrgContext } from "../src/context";
import { seedTwoOrgs, type TwoOrgs } from "./fixtures";
import { bootPb, type PbInstance } from "./pb-harness";

let inst: PbInstance | null = null;
let pb: PocketBase;
let seed: TwoOrgs;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  seed = await seedTwoOrgs(pb);
  await pb.collection("organizations").update(seed.A.org, {
    stage: "live",
    analytics: {
      ga4_measurement_id: "G-ABC123",
      gsc_site_url: "sc-domain:org-a.example",
    },
  });
  await pb.collection("org_indexing").create({
    org_id: seed.A.org,
    last_submit_at: "2026-10-09T10:00:00.000Z",
    last_submit_result: "logged",
    last_ping_at: "2026-10-17T06:00:00.000Z",
    last_ping_result: "ok",
  });
});

afterAll(async () => {
  await inst?.stop();
});

describe("ownerSearchStatus (14-32)", () => {
  it("the owner reads live, the GA4 id, Search Console as a boolean and the last runs", async () => {
    if (!inst) return;
    const s = await ownerSearchStatus(seed.ctxA);
    expect(s).toEqual({
      live: true,
      ga4MeasurementId: "G-ABC123",
      searchConsole: true,
      lastSubmitAt: "2026-10-09T10:00:00.000Z",
      lastSubmitResult: "logged",
      lastPingAt: "2026-10-17T06:00:00.000Z",
      lastPingResult: "ok",
    });
    expect(JSON.stringify(s)).not.toContain("sc-domain");
  });

  it("another org's context never sees org A's state (P14-P34)", async () => {
    if (!inst) return;
    const s = await ownerSearchStatus(seed.ctxB);
    expect(s.ga4MeasurementId).toBeNull();
    expect(s.searchConsole).toBe(false);
    expect(s.lastSubmitAt).toBeNull();
    expect(s.lastPingAt).toBeNull();
  });

  it("an Editor is refused (domain:read is Owner and Admin)", async () => {
    if (!inst) return;
    const editor = mintOrgContext({
      orgId: seed.A.org,
      actor: seed.ctxA.actor,
      role: "editor",
      grants: [],
      ip: "127.0.0.1",
    });
    await expect(ownerSearchStatus(editor)).rejects.toBeInstanceOf(Forbidden);
  });
});
