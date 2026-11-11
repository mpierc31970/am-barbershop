// The hourly media job and mediaStatus() against a real PocketBase (07-27; CONT-19, CONT-20,
// D278, D221; T-07-27-08, T-07-27-11). App delivery by default; Bunny is faked with a fake
// delivery + fetch + store stat. Temp roots are empty (the temp sweep has its own unit test).
import { composeSectionRegistry, CORE_SECTIONS } from "@cds/core/content";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { superuser } from "../src/client";
import { mintSystemContext } from "../src/context";
import { runMediaJobs } from "../src/jobs/media";
import { CDN_DOWN_SINCE_KEY, writeCdnDownSince } from "../src/media/cdn/mode";
import type { MediaDelivery } from "../src/media/ports";
import { mediaStatus } from "../src/media/ops/status";
import { readPlatformMeta, writePlatformMeta } from "../src/platform-meta";
import { recordingInvalidator } from "../src/content/ports";
import { seedMediaRow } from "./media-seed";

/** Step 6 (07-28): the GC needs the composed registry; the route passes the app's. */
const GC = {
  sections: composeSectionRegistry(CORE_SECTIONS, []),
  invalidator: recordingInvalidator(),
};
import { bootSeededPb, captureTransport, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;
const HOUR = 3_600_000;
const GB = 1024 ** 3;

const bunny: MediaDelivery = {
  name: "bunny",
  urlFor: (a, v) => `https://cdn.example.test/${a.orgId}/${a.id}/${v}`,
  purge: async () => undefined,
  deliveryBytes: async () => null,
};

const sys = () => mintSystemContext({ job: "media-test" });

async function deleteRow(id: string): Promise<void> {
  const pb = await superuser();
  await pb.collection("media_assets").delete(id);
}

describe("runMediaJobs + mediaStatus (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("mediaStatus: app delivery, failures in 24 h, stuck videos, no tenant data", async (ctx) => {
    if (!booted) return ctx.skip();
    const org = booted.seed.A.org;
    const failed = await seedMediaRow(org, {
      kind: "video",
      status: "failed",
      original_ext: "mp4",
    });
    const stuck = await seedMediaRow(org, {
      kind: "video",
      status: "processing",
      original_ext: "mp4",
      duration_s: 10,
      processing_started_at: new Date(Date.now() - 2 * HOUR).toISOString(),
    });
    try {
      const now = new Date();
      const s = await mediaStatus({ now });
      expect(s).toMatchObject({
        cdn: "app",
        cdn_status: "ok",
        fallback_active: false,
        fallback_since: null,
        video_paused: false,
        compress_failures_24h: 1,
        stuck_videos: 1,
      });
      // A failure older than 24 h no longer counts.
      const later = await mediaStatus({
        now: new Date(now.getTime() + 30 * HOUR),
      });
      expect(later.compress_failures_24h).toBe(0);

      const json = JSON.stringify(s);
      expect(json).not.toContain(org);
      expect(json).not.toContain("Org A");
      expect(json).not.toContain("tenants/");
      expect(json).not.toContain("@");
    } finally {
      await deleteRow(failed);
      await deleteRow(stuck);
    }
  });

  it("mediaStatus: Bunny down 73 h -> fallback active, video paused", async (ctx) => {
    if (!booted) return ctx.skip();
    const now = new Date();
    const since = new Date(now.getTime() - 73 * HOUR);
    await writeCdnDownSince(sys(), since);
    await writePlatformMeta(
      sys(),
      "job:media:last_counts",
      JSON.stringify({ overAllowanceAlerted: 2 }),
    );
    try {
      const s = await mediaStatus({ now, delivery: bunny });
      expect(s).toMatchObject({
        cdn: "bunny",
        cdn_status: "down",
        fallback_active: true,
        fallback_since: since.toISOString(),
        video_paused: true,
        over_allowance: 2,
      });
      // The app stand-in ignores a leftover timestamp.
      expect((await mediaStatus({ now })).fallback_active).toBe(false);
    } finally {
      await writeCdnDownSince(sys(), null);
      await writePlatformMeta(sys(), "job:media:last_counts", "");
    }
  });

  it("one run writes the heartbeat; an over-allowance org is alerted once", async (ctx) => {
    if (!booted) return ctx.skip();
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "alerts@example.com");
    const big = await seedMediaRow(booted.seed.A.org, { bytes: 3 * GB });
    try {
      const t1 = captureTransport();
      const r1 = await runMediaJobs({
        transport: t1,
        deps: { tempRoots: [], gc: GC },
      });
      expect(r1.failedSteps).toEqual([]);
      expect(r1.probe).toBe("skipped");
      expect(r1.overAllowanceAlerted).toBe(1);
      expect(r1.gcErrors).toBe(0);
      expect(t1.sent.map((m) => m.type)).toEqual(["media.alert"]);
      expect(t1.sent[0]!.to).toBe("alerts@example.com");
      expect(t1.sent[0]!.subject).toBe(
        "Org A is over its 2 GB media allowance",
      );
      expect(await readPlatformMeta("job:media:last_success")).toBeTruthy();
      const counts = JSON.parse(
        (await readPlatformMeta("job:media:last_counts"))!,
      ) as { overAllowanceAlerted: number };
      expect(counts.overAllowanceAlerted).toBe(1);

      const t2 = captureTransport();
      const r2 = await runMediaJobs({
        transport: t2,
        deps: { tempRoots: [], gc: GC },
      });
      expect(r2.overAllowanceAlerted).toBe(0);
      expect(t2.sent).toHaveLength(0);
    } finally {
      await deleteRow(big);
    }
  });

  it("Bunny faked: a failing probe opens the outage and alerts; a passing one clears it", async (ctx) => {
    if (!booted) return ctx.skip();
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "alerts@example.com");
    const canary = await seedMediaRow(booted.seed.B.org, {
      public_at: new Date().toISOString(),
    });
    const probeDeps = (status: number) => ({
      delivery: bunny,
      fetch: async () => ({ status }),
      store: { stat: async () => ({ size: 1, lastModified: new Date() }) },
      sleep: async () => undefined,
    });
    try {
      const t1 = captureTransport();
      const r1 = await runMediaJobs({
        transport: t1,
        deps: { tempRoots: [], probe: probeDeps(503) },
      });
      expect(r1.probe).toBe("down");
      expect(r1.fallbackActive).toBe(true);
      expect(r1.fallbackStarted).toBe(true);
      expect(await readPlatformMeta(CDN_DOWN_SINCE_KEY)).toBeTruthy();
      expect(t1.sent.map((m) => m.type)).toEqual(["media.alert"]);

      const t2 = captureTransport();
      const r2 = await runMediaJobs({
        transport: t2,
        deps: { tempRoots: [], probe: probeDeps(200) },
      });
      expect(r2.probe).toBe("ok");
      expect(r2.recovered).toBe(true);
      expect(await readPlatformMeta(CDN_DOWN_SINCE_KEY)).toBe("");
      expect(t2.sent).toHaveLength(0);
    } finally {
      await deleteRow(canary);
    }
  });
});
