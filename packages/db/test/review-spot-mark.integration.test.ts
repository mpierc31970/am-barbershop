// 13-38: marking spot-check pages OK / Issue on the real PocketBase binary (STAFF-23, D248).
// One page state per call, a staff note kept only on Issue, an audit row with the organization,
// refusals for a non-spot case, an unknown page and a closed case.
import "@cds/addon-registry/server";
import { InvalidInput, NotFound } from "@cds/core";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { clearResolverCache } from "../src/resolve";
import {
  spotCheckPages,
  staffCaseOutcome,
  staffCreateCase,
  staffMarkSpotPage,
} from "../src/staff/review";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const AT = new Date("2026-10-12T15:00:00.000Z");

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb, { now: AT });
});

afterAll(async () => {
  await inst?.stop();
});

async function spotCase(seq: number): Promise<string> {
  await pb.collection("review_cases").create({
    seq,
    kind: "spot_check",
    category: "spot_check",
    org_id: s.A.org,
    target_url: "https://example.test/",
    status: "open",
    steps: [{ step: "received", at: AT.toISOString(), by: "" }],
    pages: [{ page_id: s.A.livePage, title: "Home", state: "unchecked" }],
    due_at: AT.toISOString(),
    created_by: "",
  });
  return `R-${seq}`;
}

describe("staffMarkSpotPage", () => {
  it("marks a page OK then Issue with a note, audited with the organization", async (t) => {
    if (!inst) return t.skip();
    const ref = await spotCase(9101);
    const ok = await staffMarkSpotPage(s.staff.agent, ref, {
      pageId: s.A.livePage,
      state: "ok",
      note: "ignored on ok",
      now: AT,
    });
    expect(spotCheckPages(ok.pages)).toEqual([
      {
        pageId: s.A.livePage,
        title: "Home",
        state: "ok",
        at: AT.toISOString(),
        by: s.staff.agent.actor,
      },
    ]);
    const issue = await staffMarkSpotPage(s.staff.agent, ref, {
      pageId: s.A.livePage,
      state: "issue",
      note: "Hero claims a cure.",
      now: AT,
    });
    expect(spotCheckPages(issue.pages)[0]).toMatchObject({
      state: "issue",
      note: "Hero claims a cure.",
    });
    expect(issue.status).toBe("open");
    const audits = await pb.collection("audit_log").getFullList({
      filter: pb.filter("action = 'review.spot_page' && target_id = {:t}", {
        t: issue.id,
      }),
    });
    expect(audits.length).toBe(2);
    expect(audits.every((a) => a.organization === s.A.org)).toBe(true);
  });

  it("refuses an unknown page, a report case and a closed spot check", async (t) => {
    if (!inst) return t.skip();
    const ref = await spotCase(9102);
    await expect(
      staffMarkSpotPage(s.staff.agent, ref, {
        pageId: "zzzzzzzzzzzzzzz",
        state: "ok",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    const report = await staffCreateCase(
      s.staff.agent,
      {
        kind: "report",
        orgId: s.A.org,
        targetUrl: "https://example.test/about",
        category: "scam",
        description: "Fake codes.",
      },
      { now: AT },
    );
    await expect(
      staffMarkSpotPage(s.staff.agent, report.ref, {
        pageId: s.A.livePage,
        state: "ok",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
    await staffCaseOutcome(s.staff.agent, ref, "cleared", { now: AT });
    await expect(
      staffMarkSpotPage(s.staff.agent, ref, {
        pageId: s.A.livePage,
        state: "ok",
      }),
    ).rejects.toBeInstanceOf(InvalidInput);
  });
});
