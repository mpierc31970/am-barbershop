// 13-23: the one review queue read model on the real PocketBase binary (STAFF-23, STAFF-26;
// D248, D292, P13-P8, P13-P10). Flags + holds + fit holds on one tab (held first, aged in
// business days against the 2-day promise), cases on the others, gauges for 13-29 / 13-40.
import "@cds/addon-registry/server";
import { businessDeadline } from "@cds/core/support";
import { queueFor } from "@cds/core/staff";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { clearResolverCache } from "../src/resolve";
import {
  listReviewQueue,
  reviewGauges,
  staffCreateCase,
} from "../src/staff/review";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let hostA: string;
let now: Date;
let heldFlag = "";
let unsureFlag = "";
let queuedFlag = "";
let reportRef = "";

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb);
  hostA = String(
    (await pb.collection("org_hosts").getOne(s.base.A.host)).hostname,
  );

  await pb.collection("pages").update(s.A.livePage, { status: "held" });
  const held = await pb.collection("content_flags").create({
    organization: s.A.org,
    target_collection: "pages",
    target_id: s.A.livePage,
    verdict: "held",
    reasons: ['Text: matched "replica"'],
    status: "open",
  });
  heldFlag = held.id;
  unsureFlag = (
    await pb.collection("content_flags").create({
      organization: s.B.org,
      target_collection: "testimonials",
      target_id: "abcdefghijklmno",
      verdict: "unsure",
      reasons: ['Text: matched "cure"'],
      status: "open",
    })
  ).id;
  queuedFlag = (
    await pb.collection("content_flags").create({
      organization: s.B.org,
      target_collection: "pages",
      target_id: s.B.livePage,
      verdict: "error",
      reasons: ["scanner unavailable"],
      status: "queued",
      source: "scan",
      rescan_attempts: 0,
    })
  ).id;
  // A resolved flag never shows on the open tab.
  await pb.collection("content_flags").create({
    organization: s.B.org,
    target_collection: "pages",
    target_id: s.B.livePage,
    verdict: "unsure",
    reasons: ["old"],
    status: "resolved",
  });
  // Org B waits in fit review.
  await pb.collection("organizations").update(s.B.org, { stage: "fit_review" });
  // "Now" is exactly 3 business days after the hold was flagged.
  now = businessDeadline(new Date(String(held.created).replace(" ", "T")), 3);
  reportRef = (
    await staffCreateCase(
      s.staff.agent,
      {
        kind: "report",
        targetUrl: `https://${hostA}/about`,
        category: "scam",
        description: "Fake discounts",
      },
      { now },
    )
  ).ref;
});

afterAll(async () => {
  await inst?.stop();
});

describe("flags & holds tab", () => {
  it("lists the held page first (3 business days, past promise), then flags, then queued, then the fit hold", async (t) => {
    if (!inst) return t.skip();
    const items = await listReviewQueue(s.staff.agent, { tab: "flags", now });
    for (const i of items) expect(queueFor(i.kind)).toBe("review_queue");
    const first = items[0];
    expect(first?.ref).toBe(heldFlag);
    expect(first?.kind).toBe("scan_hold");
    expect(first?.heldBusinessDays).toBe(3);
    expect(first?.pastPromise).toBe(true);
    expect(first?.target.title).toMatch(/^Page · /);
    expect(first?.target.url).toContain(hostA);
    const refs = items.map((i) => i.ref);
    expect(refs.indexOf(unsureFlag)).toBeLessThan(refs.indexOf(queuedFlag));
    expect(items.find((i) => i.ref === unsureFlag)?.kind).toBe("scan_flag");
    expect(items.find((i) => i.ref === queuedFlag)?.status).toBe("queued");
    const fit = items.find((i) => i.kind === "fit_hold");
    expect(fit?.orgId).toBe(s.B.org);
    expect(fit?.readOnly).toBe(true);
    expect(fit?.href).toBe("/staff/pipeline?tab=fit");
    expect(items.some((i) => i.reasons.includes("old"))).toBe(false);
  });

  it("done lists resolved flags", async (t) => {
    if (!inst) return t.skip();
    const done = await listReviewQueue(s.staff.agent, {
      tab: "flags",
      status: "done",
      now,
    });
    expect(done.length).toBe(1);
    expect(done[0]?.status).toBe("resolved");
  });
});

describe("cases tabs", () => {
  it("reports tab lists the report case as R-n; spot tab is empty", async (t) => {
    if (!inst) return t.skip();
    const reports = await listReviewQueue(s.staff.superAdmin, {
      tab: "reports",
      now,
    });
    expect(reports.length).toBe(1);
    expect(reports[0]?.ref).toBe(reportRef);
    expect(reports[0]?.ref).toMatch(/^R-\d+$/);
    expect(reports[0]?.kind).toBe("report");
    expect(reports[0]?.case?.reporterEmail).toBe("");
    expect(await listReviewQueue(s.staff.agent, { tab: "spot", now })).toEqual(
      [],
    );
  });
});

describe("gauges and access", () => {
  it("reviewGauges counts the held page and the queued scan", async (t) => {
    if (!inst) return t.skip();
    expect(await reviewGauges(now)).toEqual({
      held_pages: 1,
      held_oldest_business_days: 3,
      held_past_promise: 1,
      queued_scans: 1,
    });
  });

  it("refuses a member context and an unknown tab", async (t) => {
    if (!inst) return t.skip();
    await expect(
      listReviewQueue(
        s.A.ctx.owner as unknown as Parameters<typeof listReviewQueue>[0],
        { tab: "flags", now },
      ),
    ).rejects.toThrow();
    await expect(
      listReviewQueue(s.staff.agent, {
        tab: "bogus" as unknown as "flags",
        now,
      }),
    ).rejects.toThrow();
  });
});
