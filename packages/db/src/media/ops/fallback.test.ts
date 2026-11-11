import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mintSystemContext, type SystemContext } from "../../context";
import type { MediaUsage } from "../cdn/usage";
import {
  alertOverAllowance,
  OVER_ALLOWANCE_KEY,
  sendMediaAlert,
  type AlertStatus,
  type MediaAlertData,
} from "./alerts";
import {
  applyProbe,
  CAP_MARKER,
  START_MARKER,
  type FallbackDeps,
} from "./fallback";
import type { ProbeOutcome } from "./probe";

const HOUR = 3_600_000;
const T0 = new Date("2026-10-01T00:00:00.000Z");
const at = (h: number) => new Date(T0.getTime() + h * HOUR);

function world() {
  const meta = new Map<string, string>();
  let downSince: Date | null = null;
  const sent: MediaAlertData[] = [];
  let nextStatus: AlertStatus = "sent";
  const deps: FallbackDeps = {
    read: async () => downSince,
    write: async (_c, d) => {
      downSince = d;
    },
    readMeta: async (k) => meta.get(k) ?? null,
    writeMeta: async (_c, k, v) => {
      meta.set(k, v);
    },
    alert: async (_c, data) => {
      if (nextStatus === "sent") sent.push(data);
      return { status: nextStatus };
    },
  };
  return {
    meta,
    sent,
    deps,
    get downSince() {
      return downSince;
    },
    set downSince(d: Date | null) {
      downSince = d;
    },
    fail(s: AlertStatus) {
      nextStatus = s;
    },
  };
}

const ctx: SystemContext = mintSystemContext({ job: "media-test" });
const P = (result: ProbeOutcome["result"], canary = true): ProbeOutcome => ({
  result,
  canary,
});

describe("applyProbe (07-27 choice 3, D278)", () => {
  it("ok with no outage writes nothing", async () => {
    const w = world();
    const write = vi.fn();
    const r = await applyProbe(ctx, P("ok"), at(0), { ...w.deps, write });
    expect(write).not.toHaveBeenCalled();
    expect(r).toMatchObject({ downSince: null, recovered: false });
    expect(w.sent).toHaveLength(0);
  });

  it("down: timestamp = now, start alert once, earliest kept", async () => {
    const w = world();
    const r1 = await applyProbe(ctx, P("down"), at(0), w.deps);
    expect(r1.started).toBe(true);
    expect(w.downSince?.toISOString()).toBe(at(0).toISOString());
    expect(w.sent.map((s) => s.event)).toEqual(["cdn-fallback-start"]);
    expect(w.meta.get(START_MARKER)).toBe(at(0).toISOString());

    const r2 = await applyProbe(ctx, P("down"), at(1), w.deps);
    expect(r2.started).toBe(false);
    expect(w.downSince?.toISOString()).toBe(at(0).toISOString());
    expect(w.sent).toHaveLength(1);
  });

  it("down at 72 h sends the cap alert once", async () => {
    const w = world();
    await applyProbe(ctx, P("down"), at(0), w.deps);
    const r = await applyProbe(ctx, P("down"), at(72), w.deps);
    expect(r.capped).toBe(true);
    expect(w.sent.map((s) => s.event)).toEqual([
      "cdn-fallback-start",
      "cdn-fallback-cap",
    ]);
    expect(w.meta.get(CAP_MARKER)).toBe(at(0).toISOString());
    const r2 = await applyProbe(ctx, P("down"), at(73), w.deps);
    expect(r2.capped).toBe(false);
    expect(w.sent).toHaveLength(2);
  });

  it("a failed start send leaves the marker unwritten and the next run retries", async () => {
    const w = world();
    w.fail("failed");
    const r1 = await applyProbe(ctx, P("down"), at(0), w.deps);
    expect(r1.alertFailures).toBe(1);
    expect(w.meta.get(START_MARKER)).toBeUndefined();
    w.fail("sent");
    await applyProbe(ctx, P("down"), at(1), w.deps);
    expect(w.sent.map((s) => s.event)).toEqual(["cdn-fallback-start"]);
    expect(w.meta.get(START_MARKER)).toBe(at(0).toISOString());
  });

  it("a failed cap send is retried next run", async () => {
    const w = world();
    await applyProbe(ctx, P("down"), at(0), w.deps);
    w.fail("skipped");
    const r = await applyProbe(ctx, P("down"), at(72), w.deps);
    expect(r.alertsSkipped).toBe(1);
    expect(w.meta.get(CAP_MARKER)).toBeUndefined();
    w.fail("sent");
    const r2 = await applyProbe(ctx, P("down"), at(73), w.deps);
    expect(r2.capped).toBe(true);
  });

  it("ok during an outage clears timestamp and markers", async () => {
    const w = world();
    await applyProbe(ctx, P("down"), at(0), w.deps);
    await applyProbe(ctx, P("down"), at(72), w.deps);
    const r = await applyProbe(ctx, P("ok"), at(80), w.deps);
    expect(r).toMatchObject({ downSince: null, recovered: true });
    expect(w.downSince).toBeNull();
    expect(w.meta.get(START_MARKER)).toBe("");
    expect(w.meta.get(CAP_MARKER)).toBe("");
  });

  it("skipped clears a leftover timestamp", async () => {
    const w = world();
    w.downSince = at(0);
    const r = await applyProbe(ctx, P("skipped", false), at(5), w.deps);
    expect(w.downSince).toBeNull();
    expect(r.downSince).toBeNull();
  });

  it("no-canary: cleared without a canary row, unchanged with one", async () => {
    const w = world();
    w.downSince = at(0);
    await applyProbe(ctx, P("no-canary", true), at(5), w.deps);
    expect(w.downSince?.toISOString()).toBe(at(0).toISOString());
    await applyProbe(ctx, P("no-canary", false), at(6), w.deps);
    expect(w.downSince).toBeNull();
  });
});

function usage(
  level: MediaUsage["level"],
  usedBytes = 3 * 1024 ** 3,
): MediaUsage {
  return {
    usedBytes,
    allowanceBytes: 2 * 1024 ** 3,
    ratio: usedBytes / (2 * 1024 ** 3),
    level,
    assets: 3,
    byKind: { image: usedBytes, video: 0, audio: 0 },
    label: "x",
  };
}

describe("sendMediaAlert (07-27 choice 5)", () => {
  beforeEach(() => {
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "");
    vi.stubEnv("CDS_SUPPORT_EMAIL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const data: MediaAlertData = {
    event: "cdn-fallback-start",
    at: T0,
    orgName: null,
    detail: "d",
    link: null,
  };

  it("no address -> skipped, no send", async () => {
    const send = vi.fn();
    expect(await sendMediaAlert(ctx, data, { send })).toEqual({
      status: "skipped",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("the alert address wins over the support address", async () => {
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "alerts@example.test");
    vi.stubEnv("CDS_SUPPORT_EMAIL", "support@example.test");
    const send = vi.fn(async () => ({ status: "sent" as const }));
    expect(await sendMediaAlert(ctx, data, { send })).toEqual({
      status: "sent",
    });
    expect((send.mock.calls[0] as unknown[])[2]).toBe("alerts@example.test");
  });

  it("falls back to the support address; a throw is failed", async () => {
    vi.stubEnv("CDS_SUPPORT_EMAIL", "support@example.test");
    const send = vi.fn(async () => {
      throw new Error("smtp");
    });
    expect(await sendMediaAlert(ctx, data, { send })).toEqual({
      status: "failed",
    });
    expect((send.mock.calls[0] as unknown[])[2]).toBe("support@example.test");
  });
});

describe("alertOverAllowance (07-27 choice 4)", () => {
  const A = "aaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbb";
  const C = "ccccccccccccccc";

  function setup() {
    const meta = new Map<string, string>();
    const sent: MediaAlertData[] = [];
    let map = new Map<string, MediaUsage>([
      [A, usage("full")],
      [B, usage("full")],
      [C, usage("warn", 1.7 * 1024 ** 3)],
    ]);
    const deps = {
      usage: async () => map,
      orgNames: async (ids: readonly string[]) =>
        new Map(ids.map((id) => [id, `Org ${id[0]}`])),
      read: async (k: string) => meta.get(k) ?? null,
      write: async (_c: SystemContext, k: string, v: string) => {
        meta.set(k, v);
      },
      send: async (_c: SystemContext, d: MediaAlertData) => {
        sent.push(d);
        return { status: "sent" as const };
      },
    };
    return {
      meta,
      sent,
      deps,
      setUsage(m: Map<string, MediaUsage>) {
        map = m;
      },
    };
  }

  it("alerts each full org once, drops orgs back under, re-alerts a new crossing", async () => {
    const s = setup();
    const r1 = await alertOverAllowance(ctx, T0, s.deps);
    expect(r1.alerted).toBe(2);
    expect(s.sent.map((d) => d.orgName).sort()).toEqual(["Org a", "Org b"]);
    expect(s.sent[0]!.event).toBe("over-allowance");
    expect(s.sent[0]!.detail).toBe("Using 3 GB of its 2 GB of media.");

    const r2 = await alertOverAllowance(ctx, T0, s.deps);
    expect(r2.alerted).toBe(0);
    expect(s.sent).toHaveLength(2);

    s.setUsage(
      new Map([
        [A, usage("warn", 1.7 * 1024 ** 3)],
        [B, usage("full")],
      ]),
    );
    await alertOverAllowance(ctx, T0, s.deps);
    expect(s.meta.get(OVER_ALLOWANCE_KEY)).toBe(B);
    expect(s.sent).toHaveLength(2);

    s.setUsage(
      new Map([
        [A, usage("full")],
        [B, usage("full")],
      ]),
    );
    const r4 = await alertOverAllowance(ctx, T0, s.deps);
    expect(r4.alerted).toBe(1);
    expect(s.sent.at(-1)!.orgName).toBe("Org a");
  });

  it("a failed send keeps the org off the list for a retry", async () => {
    const s = setup();
    const r = await alertOverAllowance(ctx, T0, {
      ...s.deps,
      send: async () => ({ status: "failed" as const }),
    });
    expect(r).toEqual({ alerted: 0, skipped: 0, failed: 2 });
    expect(s.meta.get(OVER_ALLOWANCE_KEY)).toBeUndefined();
  });
});
