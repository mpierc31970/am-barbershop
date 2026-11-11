// 13-29: the hourly review:run job on the real PocketBase binary (STAFF-23, STAFF-22; D215,
// D248, P13-P26). Queued scans heal (clean -> resolved, held -> open + hold, still failing ->
// rescan_attempts + 1), Monday spot checks open once per ISO week, notices past fix_by go
// offline, dry runs write nothing, a held lock reads busy, counts carry no org id.
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { readManifest } from "../src/content/manifest";
import {
  recordingInvalidator,
  type ContentScanner,
} from "../src/content/ports";
import { captureTransport } from "../src/email/transport";
import {
  REVIEW_JOB_COUNTS_KEY,
  REVIEW_JOB_SUCCESS_KEY,
  REVIEW_RESCAN_GAVE_UP_REASON,
  REVIEW_RESCAN_MAX_ATTEMPTS,
  runReviewJob,
} from "../src/jobs/review";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../src/platform-meta";
import { clearResolverCache } from "../src/resolve";
import { tenantSiteManifestKey } from "../src/storage";
import { LocalDiskStore } from "../src/storage/local-disk";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const MON = new Date("2026-10-12T22:00:00.000Z"); // Mon 12 Oct, 5:00 pm Chicago
const TUE = new Date("2026-10-13T22:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let dir = "";
let store: LocalDiskStore;
let throwPage = "";
let cleanFlag = "";
let heldFlag = "";
let failFlag = "";

/** Decides by page title: "Held words" -> held, "Throw me" -> outage, anything else clean. */
const scanner: ContentScanner = {
  async scan(input) {
    if (input.texts.some((t) => t.includes("Throw me"))) {
      throw new Error("provider down");
    }
    if (input.texts.some((t) => t.includes("Held words"))) {
      return { verdict: "held", reasons: ['Text: matched "replica"'] };
    }
    return { verdict: "clean", reasons: [] };
  },
};

async function queued(orgId: string, pageId: string): Promise<string> {
  const r = await pb.collection("content_flags").create({
    organization: orgId,
    target_collection: "pages",
    target_id: pageId,
    verdict: "error",
    reasons: ["scanner unavailable"],
    status: "queued",
    source: "scan",
    rescan_attempts: 0,
  });
  return r.id;
}

async function flag(id: string) {
  return pb.collection("content_flags").getOne(id);
}

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  clearResolverCache();
  pb = await superuser();
  s = await seedSupport(pb, { now: MON });
  dir = await mkdtemp(join(tmpdir(), "cds-review-job-"));
  store = new LocalDiskStore(dir);
  await pb.collection("organizations").update(s.A.org, {
    stage: "live",
    launched_at: new Date(MON.getTime() - 5 * DAY).toISOString(),
  });
  await pb.collection("organizations").update(s.B.org, {
    stage: "live",
    launched_at: new Date(MON.getTime() - 90 * DAY).toISOString(),
  });
  await pb.collection("pages").update(s.A.livePage, { title: "Held words" });
  await pb.collection("pages").update(s.B.livePage, { title: "Clean words" });
  throwPage = (
    await pb.collection("pages").create({
      organization: s.A.org,
      slug: "throw",
      title: "Throw me",
      status: "published",
      kind: "builder",
    })
  ).id;
  // A's About page is live in its manifest.
  await store.put(
    tenantSiteManifestKey(s.A.org),
    JSON.stringify({
      version: 1,
      pages: {
        about: {
          id: s.A.livePage,
          title: "Held words",
          published_at: MON.toISOString(),
          protected: false,
        },
      },
      redirects: {},
      updated_at: MON.toISOString(),
    }),
  );
  cleanFlag = await queued(s.B.org, s.B.livePage);
  heldFlag = await queued(s.A.org, s.A.livePage);
  failFlag = await queued(s.A.org, throwPage);
});

afterAll(async () => {
  await inst?.stop();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("dry run and lock", () => {
  it("dry run counts and writes nothing; counts carry no org id", async (t) => {
    if (!inst) return t.skip();
    const r = await runReviewJob({ now: TUE, dryRun: true, scanner, store });
    expect(r.dryRun).toBe(true);
    expect(r.busy).toBe(false);
    expect(r.rescanned).toBe(3);
    expect(r.failedSteps).toEqual([]);
    expect((await flag(cleanFlag)).status).toBe("queued");
    expect((await flag(heldFlag)).rescan_attempts).toBe(0);
    expect(await readPlatformMeta(REVIEW_JOB_SUCCESS_KEY)).toBeNull();
    expect(await readPlatformMeta(REVIEW_JOB_COUNTS_KEY)).toBeNull();
    const json = JSON.stringify(r);
    for (const id of [s.A.org, s.B.org, s.A.livePage, s.B.livePage]) {
      expect(json).not.toContain(id);
    }
  });

  it("a run that finds the lock held is busy and does nothing", async (t) => {
    if (!inst) return t.skip();
    const token = await acquirePlatformLock("lock:review-job", {
      now: new Date(),
      staleMs: 30 * 60_000,
    });
    expect(token).not.toBeNull();
    try {
      const r = await runReviewJob({ now: TUE, scanner, store });
      expect(r.busy).toBe(true);
      expect(r.rescanned).toBe(0);
      expect((await flag(cleanFlag)).status).toBe("queued");
    } finally {
      await releasePlatformLock("lock:review-job", token!);
    }
  });
});

describe("rescan queued", () => {
  it("clean resolves, held opens and holds the page, still failing counts an attempt", async (t) => {
    if (!inst) return t.skip();
    const invalidator = recordingInvalidator();
    const r = await runReviewJob({
      now: TUE,
      scanner,
      store,
      invalidator,
      transport: captureTransport(),
    });
    expect(r.failedSteps).toEqual([]);
    expect(r.rescanned).toBe(2);
    expect(r.stillQueued).toBe(1);
    expect(r.spotChecksOpened).toBe(0); // Tuesday

    expect((await flag(cleanFlag)).status).toBe("resolved");

    const held = await flag(heldFlag);
    expect(held.status).toBe("open");
    expect(held.verdict).toBe("held");
    expect(held.reasons).toEqual(['Text: matched "replica"']);
    const page = await pb.collection("pages").getOne(s.A.livePage);
    expect(page.status).toBe("held");
    const manifest = await readManifest(store, s.A.org, TUE);
    expect(manifest.pages.about).toBeUndefined();
    const audit = await pb.collection("audit_log").getFullList({
      filter: pb.filter(
        "organization = {:o} && action = 'page.publish_held' && target_id = {:p}",
        { o: s.A.org, p: s.A.livePage },
      ),
    });
    expect(audit.length).toBe(1);

    const fail = await flag(failFlag);
    expect(fail.status).toBe("queued");
    expect(fail.rescan_attempts).toBe(1);

    expect(await readPlatformMeta(REVIEW_JOB_SUCCESS_KEY)).toBe(
      TUE.toISOString(),
    );
    const counts = JSON.parse(
      (await readPlatformMeta(REVIEW_JOB_COUNTS_KEY)) ?? "{}",
    );
    expect(counts).toMatchObject({
      dryRun: false,
      busy: false,
      rescanned: 2,
      stillQueued: 1,
      autoSuspended: 0,
      spotChecksOpened: 0,
    });
    expect(Object.keys(counts).sort()).toEqual(
      [
        "autoSuspended",
        "busy",
        "dryRun",
        "failedSteps",
        "heldPastPromise",
        "rescanned",
        "spotChecksOpened",
        "stillQueued",
      ].sort(),
    );
    const raw = (await readPlatformMeta(REVIEW_JOB_COUNTS_KEY)) ?? "";
    expect(raw).not.toContain(s.A.org);
    expect(raw).not.toContain(s.B.org);
  });

  it("a flag that never answers goes to the review queue after the attempt cap (WR-A11)", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("content_flags").update(failFlag, {
      rescan_attempts: REVIEW_RESCAN_MAX_ATTEMPTS - 1,
    });
    const r = await runReviewJob({
      now: new Date(TUE.getTime() + 60 * 60_000),
      scanner,
      store,
      invalidator: recordingInvalidator(),
      transport: captureTransport(),
    });
    expect(r.failedSteps).toEqual([]);
    expect(r.stillQueued).toBe(0);
    const fail = await flag(failFlag);
    expect(fail.status).toBe("open");
    expect(fail.verdict).toBe("error");
    expect(fail.rescan_attempts).toBe(REVIEW_RESCAN_MAX_ATTEMPTS);
    expect(fail.reasons).toContain(REVIEW_RESCAN_GAVE_UP_REASON);
  });
});

describe("spot checks", () => {
  it("a Monday run opens one spot_check case per live site listing changed pages; the second Monday run opens none", async (t) => {
    if (!inst) return t.skip();
    const first = await runReviewJob({
      now: MON,
      scanner,
      store,
      rng: () => 0,
    });
    expect(first.spotChecksOpened).toBe(2);
    const cases = await pb.collection("review_cases").getFullList({
      filter: "kind = 'spot_check'",
      sort: "seq",
    });
    expect(cases.length).toBe(2);
    expect(cases.map((c) => c.org_id).sort()).toEqual(
      [s.A.org, s.B.org].sort(),
    );
    // A launched 5 days ago: picked first, so it holds the first number.
    expect(cases[0]!.org_id).toBe(s.A.org);
    for (const c of cases) {
      expect(c.category).toBe("spot_check");
      expect(c.status).toBe("open");
      expect(c.steps[0].step).toBe("received");
      expect(Array.isArray(c.pages)).toBe(true);
      expect(c.pages.length).toBeGreaterThan(0);
      for (const p of c.pages) expect(p.state).toBe("unchecked");
    }
    const aPages = cases[0]!.pages.map((p: { page_id: string }) => p.page_id);
    expect(aPages).toContain(throwPage);
    const audit = await pb.collection("audit_log").getFullList({
      filter: "action = 'review.case_created'",
    });
    expect(audit.length).toBeGreaterThanOrEqual(2);

    const again = await runReviewJob({
      now: new Date(MON.getTime() + HOUR),
      scanner,
      store,
    });
    expect(again.spotChecksOpened).toBe(0);
    const tue = await runReviewJob({ now: TUE, scanner, store });
    expect(tue.spotChecksOpened).toBe(0);
    const after = await pb.collection("review_cases").getList(1, 1, {
      filter: "kind = 'spot_check'",
    });
    expect(after.totalItems).toBe(2);
  });
});

describe("auto-suspend", () => {
  it("a notice past fix_by is suspended by the job", async (t) => {
    if (!inst) return t.skip();
    await pb.collection("organizations").update(s.B.org, {
      suspended_at: "",
      suspension: {
        mode: "notice",
        category: "guideline",
        message: "Remove the replica page.",
        note: "",
        at: new Date(TUE.getTime() - 4 * DAY).toISOString(),
        fix_by: new Date(TUE.getTime() - HOUR).toISOString(),
        by: s.staff.agentUser,
      },
    });
    const dry = await runReviewJob({ now: TUE, dryRun: true, scanner, store });
    expect(dry.autoSuspended).toBe(1);
    expect(
      (await pb.collection("organizations").getOne(s.B.org)).suspended_at,
    ).toBe("");
    const transport = captureTransport();
    const r = await runReviewJob({
      now: TUE,
      scanner,
      store,
      transport,
      invalidator: recordingInvalidator(),
    });
    expect(r.autoSuspended).toBe(1);
    const row = await pb.collection("organizations").getOne(s.B.org);
    expect(row.suspended_at).not.toBe("");
    expect(row.suspension.mode).toBe("notice_expired");
    expect(transport.sent.some((m) => m.type === "site.suspended")).toBe(true);
  });
});
