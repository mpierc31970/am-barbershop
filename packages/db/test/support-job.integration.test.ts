// 12-31: the hourly support:run job (`runSupportJobs`) on the real PocketBase binary (COMM-08,
// COMM-09, COMM-11, SUPPORT-02). The 7-day auto-close boundary through the whole job, the
// platform_meta lock (busy), a failing step that is recorded while later steps still run and
// no heartbeat is written, a dry run that writes nothing, and the heartbeat + counts keys.
// The clock is real-time relative: messages carry PocketBase's own `created`, so tickets are
// filed and resolved on a backdated clock and the job runs at "now" (12-18 precedent).
import "@cds/addon-registry/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type PocketBase from "pocketbase";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { resetClientForTests, superuser } from "../src/client";
import { captureTransport } from "../src/email/transport";
import { unavailableScanner } from "../src/forms/scanner";
import type { FileScanner } from "../src/forms/scanner-port";
import { runSupportJobs } from "../src/jobs/support";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
} from "../src/platform-meta";
import { resetSupportLimitsForTests } from "../src/rate-limit";
import { LocalDiskStore } from "../src/storage/local-disk";
import { tenantSupportPrefix } from "../src/storage/keys";
import {
  SUPPORT_AUTO_CLOSE_MS,
  fileTicket,
  staffSetTicketStatus,
} from "../src/support";
import { bootPb, type PbInstance } from "./pb-harness";
import { seedSupport, type SupportSeed } from "./support-seed";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let inst: PbInstance | null = null;
let pb: PocketBase;
let s: SupportSeed;
let root: string;
let store: LocalDiskStore;
const savedSupportEmail = process.env.CDS_SUPPORT_EMAIL;

beforeAll(async () => {
  inst = await bootPb();
  if (!inst) return;
  resetClientForTests();
  pb = await superuser();
  s = await seedSupport(pb, { now: new Date(Date.now() - 10 * DAY) });
});

afterAll(async () => {
  await inst?.stop();
});

beforeEach(async () => {
  delete process.env.CDS_SUPPORT_EMAIL;
  resetSupportLimitsForTests();
  root = await mkdtemp(join(tmpdir(), "cds-support-job-"));
  store = new LocalDiskStore(root);
});

afterEach(async () => {
  if (savedSupportEmail === undefined) delete process.env.CDS_SUPPORT_EMAIL;
  else process.env.CDS_SUPPORT_EMAIL = savedSupportEmail;
  await rm(root, { recursive: true, force: true });
});

function clock(at: Date) {
  return { now: () => at };
}

/** A Change ticket (no SLA) filed 9 days before `now`, resolved `agoMs` before `now`. */
async function resolvedTicket(
  subject: string,
  now: Date,
  agoMs: number,
): Promise<number> {
  const n = (
    await fileTicket(
      s.A.ctx.owner,
      { type: "change", subject, body: "Please update the opening hours." },
      { clock: clock(new Date(now.getTime() - 9 * DAY)) },
    )
  ).number;
  await staffSetTicketStatus(
    s.staff.agent,
    { number: n, to: "resolved" },
    {
      clock: clock(new Date(now.getTime() - agoMs)),
      transport: captureTransport(),
    },
  );
  return n;
}

async function statusOf(number: number): Promise<string> {
  const row = await pb
    .collection("support_threads")
    .getFirstListItem(pb.filter("number = {:n}", { n: number }));
  return String(row.status);
}

describe("runSupportJobs (12-31)", () => {
  it("dry run counts the due ticket and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    const n = await resolvedTicket("Dry run close", now, 8 * DAY);
    const before = await readPlatformMeta("job:support:last_counts");

    const res = await runSupportJobs({
      now,
      dryRun: true,
      scanner: unavailableScanner,
      store,
    });
    expect(res.dryRun).toBe(true);
    expect(res.busy).toBe(false);
    expect(res.closed).toBeGreaterThanOrEqual(1);
    expect(res.failedSteps).toEqual([]);
    expect(await statusOf(n)).toBe("resolved");
    expect(await readPlatformMeta("job:support:last_counts")).toBe(before);
    expect(await readPlatformMeta("job:support:last_success")).toBeNull();
    // No lock left behind.
    expect(await readPlatformMeta("lock:support-job")).toBeNull();
  });

  it("closes a ticket Resolved 7 days ago, keeps 6 d 23 h, writes heartbeat and counts", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    // The dry-run case left one due ticket: count it as closed too.
    const old = await resolvedTicket(
      "Resolved 7 days ago",
      now,
      SUPPORT_AUTO_CLOSE_MS + 60_000,
    );
    const young = await resolvedTicket(
      "Resolved 6d23h ago",
      now,
      SUPPORT_AUTO_CLOSE_MS - HOUR,
    );
    const transport = captureTransport();

    const res = await runSupportJobs({
      now,
      transport,
      scanner: unavailableScanner,
      store,
    });
    expect(res.failedSteps).toEqual([]);
    expect(res.busy).toBe(false);
    expect(res.closed).toBe(2);
    expect(await statusOf(old)).toBe("closed");
    expect(await statusOf(young)).toBe("resolved");
    expect(res.rescanned).toBe(0);
    expect(res.slaWarned).toBe(0);

    expect(await readPlatformMeta("job:support:last_success")).toBe(
      now.toISOString(),
    );
    const counts = JSON.parse(
      (await readPlatformMeta("job:support:last_counts")) ?? "{}",
    ) as Record<string, unknown>;
    expect(counts.closed).toBe(2);
    expect(counts.failedSteps).toEqual([]);
    expect(Array.isArray(counts.openWindows)).toBe(true);
    expect(typeof counts.slaMissedOpen).toBe("number");

    // A second run has nothing left to close.
    const again = await runSupportJobs({
      now,
      transport,
      scanner: unavailableScanner,
      store,
    });
    expect(again.closed).toBe(0);
    expect(await readPlatformMeta("lock:support-job")).toBeNull();
  });

  it("a run that finds the lock held returns busy and writes nothing", async (t) => {
    if (!inst) return t.skip();
    const now = new Date();
    const n = await resolvedTicket("Busy close", now, 8 * DAY);
    const heartbeat = await readPlatformMeta("job:support:last_success");
    const token = await acquirePlatformLock("lock:support-job", {
      now,
      staleMs: 30 * 60_000,
    });
    expect(token).not.toBeNull();
    try {
      const res = await runSupportJobs({
        now: new Date(now.getTime() + 1000),
        scanner: unavailableScanner,
        store,
      });
      expect(res.busy).toBe(true);
      expect(res.closed).toBe(0);
      expect(await statusOf(n)).toBe("resolved");
      expect(await readPlatformMeta("job:support:last_success")).toBe(
        heartbeat,
      );
    } finally {
      await releasePlatformLock("lock:support-job", token!);
    }
    // Released: the next run closes it.
    const after = await runSupportJobs({
      now: new Date(now.getTime() + 2000),
      transport: captureTransport(),
      scanner: unavailableScanner,
      store,
    });
    expect(after.busy).toBe(false);
    expect(after.closed).toBe(1);
  });

  it("a step that throws is recorded, later steps still run, no heartbeat", async (t) => {
    if (!inst) return t.skip();
    const now = new Date(Date.now() + 25 * HOUR);
    const heartbeat = await readPlatformMeta("job:support:last_success");
    // A staged upload never sent; at now + 25 h it is past the 24 h limit.
    const staged = `${tenantSupportPrefix(s.A.org)}staging/never-sent.bin`;
    await store.put(staged, "abandoned");
    // The rescan step throws as soon as it asks which scanner it has.
    const broken = {
      get name(): "clamd" {
        throw new Error("scanner exploded");
      },
      scan: () => Promise.resolve("error" as const),
    } as unknown as FileScanner;

    const res = await runSupportJobs({
      now,
      transport: captureTransport(),
      scanner: broken,
      store,
    });
    expect(res.failedSteps).toEqual(["rescan"]);
    expect(res.stagedPruned).toBe(1);
    expect(await store.get(staged)).toBeNull();
    expect(await readPlatformMeta("job:support:last_success")).toBe(heartbeat);
    const counts = JSON.parse(
      (await readPlatformMeta("job:support:last_counts")) ?? "{}",
    ) as { failedSteps?: string[] };
    expect(counts.failedSteps).toEqual(["rescan"]);
  });
});
