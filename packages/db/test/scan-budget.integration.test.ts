// Web Risk monthly budget against a real PocketBase (13-08 choice 4; P13-P27, D295,
// T-13-08-01). Counter + one-per-month cap alert in platform_meta; mail captured.
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  reserveWebRiskLookups,
  webRiskMonth,
  webRiskMonthLookups,
  webRiskMonthlyCap,
} from "../src/content/scan/budget";
import { readPlatformMeta } from "../src/platform-meta";
import { bootSeededPb, captureTransport, type SeededPb } from "./seeded";

let booted: SeededPb | null = null;

describe("reserveWebRiskLookups (throwaway PocketBase)", () => {
  beforeAll(async () => {
    booted = await bootSeededPb();
  });
  afterAll(async () => {
    await booted?.inst.stop();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("caps at the limit, alerts staff once a month, resets next month", async (ctx) => {
    if (!booted) return ctx.skip();
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "alerts@example.com");
    const now = new Date("2026-03-15T18:00:00Z");
    const month = webRiskMonth(now);
    expect(month).toBe("2026-03");
    const t = captureTransport();

    expect(await reserveWebRiskLookups(2, { now, cap: 3, transport: t })).toBe(
      2,
    );
    expect(t.sent).toHaveLength(0);
    expect(await reserveWebRiskLookups(2, { now, cap: 3, transport: t })).toBe(
      1,
    );
    expect(await reserveWebRiskLookups(1, { now, cap: 3, transport: t })).toBe(
      0,
    );
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]!.to).toBe("alerts@example.com");
    expect(t.sent[0]!.subject).toBe("Link check cap reached for 2026-03");
    expect(await reserveWebRiskLookups(1, { now, cap: 3, transport: t })).toBe(
      0,
    );
    expect(t.sent).toHaveLength(1);

    expect(await readPlatformMeta(`scan:webrisk:${month}`)).toBe("3");
    expect(
      await readPlatformMeta(`scan:webrisk:alerted:${month}`),
    ).toBeTruthy();
    expect(await webRiskMonthLookups(now)).toBe(3);

    // The next month starts at 0 again.
    const next = new Date("2026-04-15T18:00:00Z");
    expect(await webRiskMonthLookups(next)).toBe(0);
    expect(
      await reserveWebRiskLookups(2, { now: next, cap: 3, transport: t }),
    ).toBe(2);
    expect(t.sent).toHaveLength(1);
  });

  it("no staff address: nothing sent, logged, still returns 0", async (ctx) => {
    if (!booted) return ctx.skip();
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "");
    vi.stubEnv("CDS_SUPPORT_EMAIL", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const now = new Date("2026-05-10T12:00:00Z");
    const t = captureTransport();
    expect(await reserveWebRiskLookups(1, { now, cap: 1, transport: t })).toBe(
      1,
    );
    expect(await reserveWebRiskLookups(1, { now, cap: 1, transport: t })).toBe(
      0,
    );
    expect(t.sent).toHaveLength(0);
    expect(JSON.stringify(warn.mock.calls)).toContain("no staff alert address");
    expect(await readPlatformMeta("scan:webrisk:alerted:2026-05")).toBeNull();
  });

  it("parallel reservations never pass the cap", async (ctx) => {
    if (!booted) return ctx.skip();
    vi.stubEnv("CDS_STAFF_ALERT_EMAIL", "alerts@example.com");
    const now = new Date("2026-06-10T12:00:00Z");
    const t = captureTransport();
    const got = await Promise.all(
      Array.from({ length: 6 }, () =>
        reserveWebRiskLookups(2, { now, cap: 5, transport: t }),
      ),
    );
    expect(got.reduce((a, b) => a + b, 0)).toBe(5);
    expect(await webRiskMonthLookups(now)).toBe(5);
    expect(t.sent).toHaveLength(1);
  });

  it("the month is Pacific time; the cap env falls back to 100000", () => {
    // 2026-07-01 03:00 UTC is still June 30 in Los Angeles.
    expect(webRiskMonth(new Date("2026-07-01T03:00:00Z"))).toBe("2026-06");
    vi.stubEnv("CDS_WEBRISK_MONTHLY_CAP", "250");
    expect(webRiskMonthlyCap()).toBe(250);
    vi.stubEnv("CDS_WEBRISK_MONTHLY_CAP", "lots");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(webRiskMonthlyCap()).toBe(100000);
    vi.stubEnv("CDS_WEBRISK_MONTHLY_CAP", "");
    expect(webRiskMonthlyCap()).toBe(100000);
  });
});
