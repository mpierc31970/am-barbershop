// @vitest-environment jsdom
// 13-45 Task 2 (STAFF-13, STAFF-14, CONT-19; D154, D155, D221; 13-UI-SPEC "Health" lines
// 873-905): the Health panels and Site › Media. @cds/db reads are mocked; the real panels,
// row mappers, islands and @cds/ui/staff/health components render.
//   - Media usage as support_agent: listMediaUsage rows, "—" delivery titled for Bunny stats,
//     "Over allowance" for a site past 2 GB, `?over=1` keeps only those;
//   - Premium with no premium add-ons: PREMIUM-EMPTY heading and body;
//   - Platform: "Restore last rehearsed 12 days ago", stand-ins in words, thresholds in words;
//   - Jobs: read-only heartbeat table; Fail-safe: filter, add-on names, deployment line;
//   - Site › Media: the one site's row, no Open site, the takedown line.
import { P13_COPY } from "@cds/core/staff";
import { ToastRegion } from "@cds/ui/hub";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "next/headers",
  async () => (await import("./staff-test-kit")).nextHeadersMock,
);
vi.mock(
  "next/navigation",
  async () => (await import("./staff-test-kit")).nextNavigationMock,
);
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) =>
    createElement("a", rest, children),
}));

const db = vi.hoisted(() => ({
  staffHealthView: vi.fn(),
  listMediaUsage: vi.fn(),
  staffListFailsafeRequests: vi.fn(),
  failsafeStatus: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: PlatformPanel } =
  await import("../app/(platform)/staff/(console)/health/panels/platform");
const { default: PremiumPanel } =
  await import("../app/(platform)/staff/(console)/health/panels/premium");
const { default: JobsPanel } =
  await import("../app/(platform)/staff/(console)/health/panels/jobs");
const { default: MediaPanel } =
  await import("../app/(platform)/staff/(console)/health/panels/media");
const { default: FailsafePanel, parseFailsafeFilter } =
  await import("../app/(platform)/staff/(console)/health/panels/failsafe");
const { default: SiteMediaPanel } =
  await import("../app/(platform)/staff/(console)/sites/[org]/panels/media");
const { thresholdWords, restoreAgo } =
  await import("../app/(platform)/staff/(console)/health/health-data");
const { staffMediaUsageRowView } = await import("../lib/media-usage-view");
const { resetStaffKit } = await import("./staff-test-kit");

type Role = "super_admin" | "support_agent";
const ORG_A = "orgaaaaaaaaaaa1";
const ORG_B = "orgbbbbbbbbbbb2";
const GB = 1024 ** 3;

function session(role: Role) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: false,
    name: "Lee Agent",
    role,
    maskedEmail: "l•••@example.test",
  };
}

async function render(el: Promise<unknown> | unknown): Promise<string> {
  const node = (await el) as ReactElement;
  return renderToStaticMarkup(createElement(ToastRegion, null, node));
}

function healthView(over: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    generatedAt: new Date(now.getTime() - 2 * 60_000).toISOString(),
    overall: "ok",
    alertEmail: "m•••@example.com",
    components: [
      {
        id: "database",
        label: "PocketBase",
        level: "ok",
        reading: "PocketBase 42 ms",
        threshold: "warn > 500 ms · critical > 2 s",
        since: null,
      },
      {
        id: "email",
        label: "Email",
        level: "none",
        reading: "Email: logged (stand-in)",
        threshold: "",
        since: null,
      },
    ],
    backups: [
      {
        id: "db",
        label: "Database offsite backup",
        level: "ok",
        reading: "Last success 3 h ago",
        threshold: "warn > 26 h",
        since: null,
      },
      {
        id: "restore",
        label: "Restore rehearsal",
        level: "ok",
        reading: "Last rehearsed 12 days ago",
        threshold: "warn > 90 days",
        since: null,
      },
    ],
    restore: {
      rehearsedAt: new Date(now.getTime() - 12 * 86_400_000).toISOString(),
      days: 12,
      level: "ok",
    },
    jobs: [
      {
        id: "job-support",
        job: "support:run",
        label: "Support job",
        schedule: "hourly",
        lastSuccess: new Date(now.getTime() - 4 * 60_000).toISOString(),
        level: "ok",
        reading: "Last success 4 min ago",
        warningText: "> 2 h",
        criticalText: "> 4 h",
        since: null,
      },
      {
        id: "job-review",
        job: "review:run",
        label: "Review job",
        schedule: "hourly",
        lastSuccess: null,
        level: "critical",
        reading: "Never succeeded",
        warningText: "> 2 h",
        criticalText: "> 6 h",
        since: new Date(now.getTime() - 60 * 60_000).toISOString(),
      },
    ],
    premium: [],
    failsafe: null,
    checks: [],
    openIncidents: 1,
    ...over,
  };
}

function mediaRow(
  orgId: string,
  name: string,
  used: number,
  level: "ok" | "warn" | "full",
) {
  return {
    orgId,
    name,
    usedBytes: used,
    allowanceBytes: 2 * GB,
    ratio: used / (2 * GB),
    level,
    assets: 3,
    byKind: { image: used - GB / 4, video: GB / 4, audio: 0 },
    label: "",
    deliveryBytes: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  db.staffHealthView.mockResolvedValue(healthView());
  db.listMediaUsage.mockResolvedValue([
    mediaRow(ORG_A, "Rivera Bakery", Math.round(2.4 * GB), "full"),
    mediaRow(ORG_B, "Bella's Salon", Math.round(0.6 * GB), "ok"),
  ]);
  db.staffListFailsafeRequests.mockResolvedValue([]);
  db.failsafeStatus.mockResolvedValue({
    active: false,
    pending_requests: 0,
    deployed: false,
    last_pull: null,
  });
});

describe("Health › Media usage (CONT-19 staff half)", () => {
  it("support_agent sees listMediaUsage rows, '—' delivery and the over-allowance badge", async () => {
    const html = await render(
      MediaPanel({
        session: session("support_agent"),
        params: { tab: "media" },
      } as never),
    );
    expect(db.listMediaUsage).toHaveBeenCalledTimes(1);
    expect(db.listMediaUsage.mock.calls[0]![0]).toMatchObject({
      staffRole: "support_agent",
    });
    expect(db.listMediaUsage.mock.calls[0]![1]).toEqual({});
    expect(html).toContain("Rivera Bakery");
    expect(html).toContain("Bella&#x27;s Salon");
    expect(html).toContain("2.4 GB of 2 GB");
    expect(html.match(/Over allowance/g)).toHaveLength(1);
    expect(html).toContain('title="Delivery figures arrive with Bunny stats"');
    expect(html).toContain(`href="/staff/sites/${ORG_A}?tab=media"`);
    expect(html).toContain("2 sites · 3 GB stored · 1 over allowance");
    expect(html).toContain("Only over allowance");
    // Largest first.
    expect(html.indexOf("Rivera Bakery")).toBeLessThan(
      html.indexOf("Bella&#x27;s Salon"),
    );
  });

  it("?over=1 asks for the over rows and keeps only sites past their allowance", async () => {
    db.listMediaUsage.mockResolvedValue([
      mediaRow(ORG_A, "Rivera Bakery", Math.round(2.4 * GB), "full"),
      mediaRow(ORG_B, "Bella's Salon", Math.round(1.7 * GB), "warn"),
    ]);
    const html = await render(
      MediaPanel({
        session: session("super_admin"),
        params: { tab: "media", over: "1" },
      } as never),
    );
    expect(db.listMediaUsage.mock.calls[0]![1]).toEqual({ over: true });
    expect(html).toContain("Rivera Bakery");
    expect(html).not.toContain("Bella");
    expect(html).toContain('checked=""');
  });

  it("no rows says so; a failed read shows ERR-LOAD and logs the class name only", async () => {
    db.listMediaUsage.mockResolvedValue([]);
    const empty = await render(
      MediaPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(empty).toContain("No site stores media yet.");
    db.listMediaUsage.mockRejectedValue(new TypeError("boom secret"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render(
      MediaPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(html).toContain("Try again");
    expect(err).toHaveBeenCalledWith(
      "[staff] media usage read failed",
      "TypeError",
    );
    err.mockRestore();
  });

  it("staffMediaUsageRowView maps the CLI row (sizes per kind, delivery null)", () => {
    const v = staffMediaUsageRowView(mediaRow(ORG_A, "Rivera", GB, "ok"));
    expect(v).toEqual({
      orgId: ORG_A,
      business: "Rivera",
      imageBytes: GB - GB / 4,
      videoBytes: GB / 4,
      audioBytes: 0,
      usedBytes: GB,
      allowanceBytes: 2 * GB,
      deliveryBytes: null,
      level: "ok",
    });
  });
});

describe("Site › Media", () => {
  it("shows the one site's row without Open site, plus the takedown line", async () => {
    db.listMediaUsage.mockResolvedValue([
      mediaRow(ORG_A, "Rivera Bakery", Math.round(2.4 * GB), "full"),
    ]);
    const html = await render(
      SiteMediaPanel({
        session: session("support_agent"),
        params: { tab: "media" },
        orgId: ORG_A,
      } as never),
    );
    expect(db.listMediaUsage.mock.calls[0]![1]).toEqual({ orgId: ORG_A });
    expect(html).toContain("Rivera Bakery");
    expect(html).toContain("Over allowance");
    expect(html).not.toContain("Open site");
    expect(html).toContain("npm run media:takedown");
    expect(html).toContain("docs/how-to/media-staff-tools.md");
  });

  it("a site without media says so", async () => {
    db.listMediaUsage.mockResolvedValue([]);
    const html = await render(
      SiteMediaPanel({
        session: session("super_admin"),
        params: {},
        orgId: ORG_B,
      } as never),
    );
    expect(html).toContain("This site stores no media yet.");
  });
});

describe("Health › Premium", () => {
  it("no premium add-ons renders the PREMIUM-EMPTY heading and body", async () => {
    const html = await render(
      PremiumPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(html).toContain(P13_COPY.PREMIUM_EMPTY_H);
    expect(html).toContain(P13_COPY.PREMIUM_EMPTY_B);
    expect(db.staffHealthView.mock.calls[0]![1].manifests).toBeInstanceOf(
      Array,
    );
  });

  it("premium rows render one row per (site, add-on)", async () => {
    db.staffHealthView.mockResolvedValue(
      healthView({
        premium: [
          {
            orgId: ORG_A,
            business: "Rivera Bakery",
            addon: "fixture-premium",
            checks: 3,
            passing: null,
            errorRate1h: 0.012,
            dbWriteP95Ms: 80,
            failedEmails1h: 0,
            level: "critical",
          },
        ],
      }),
    );
    const html = await render(
      PremiumPanel({ session: session("super_admin"), params: {} } as never),
    );
    expect(html).not.toContain(P13_COPY.PREMIUM_EMPTY_H);
    expect(html).toContain("fixture-premium");
    expect(html).toContain("1.2 %");
    expect(html).toContain("80 ms");
    expect(html).toContain("Critical");
  });
});

describe("Health › Platform", () => {
  it("shows components, stand-ins in words, thresholds in words and the restore line", async () => {
    const html = await render(
      PlatformPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(html).toContain("Restore last rehearsed 12 days ago");
    expect(html).toContain("Runbook: docs/ops/restore-rehearsal.md");
    expect(html).toContain("PocketBase 42 ms");
    expect(html).toContain("Warning above 500 ms · Critical above 2 s");
    expect(html).toContain("Warning after 26 h");
    expect(html).toContain("Email: logged (stand-in)");
    expect(html).toContain(">Stand-in<");
    expect(html).not.toContain(">Critical<");
    expect(html).toContain("Checked 2 min ago · Alerts email m•••@example.com");
    expect(html).toContain("Refresh health");
  });

  it("a failed health read shows ERR-LOAD", async () => {
    db.staffHealthView.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await render(
      PlatformPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(html).toContain("Try again");
    expect(err).toHaveBeenCalledWith("[staff] health read failed", "Error");
    err.mockRestore();
  });

  it("thresholdWords and restoreAgo", () => {
    expect(thresholdWords("warn > 2 h · critical > 4 h")).toBe(
      "Warning after 2 h · Critical after 4 h",
    );
    expect(thresholdWords("warn > 1 %")).toBe("Warning above 1 %");
    expect(thresholdWords("")).toBe("");
    expect(restoreAgo(null)).toBeNull();
    expect(restoreAgo(0)).toBe("today");
    expect(restoreAgo(1)).toBe("1 day ago");
  });
});

describe("Health › Jobs", () => {
  it("lists every heartbeat read-only, critical first, threshold in words", async () => {
    const html = await render(
      JobsPanel({ session: session("support_agent"), params: {} } as never),
    );
    expect(html).toContain("support:run");
    expect(html).toContain("review:run");
    expect(html.indexOf("review:run")).toBeLessThan(
      html.indexOf("support:run"),
    );
    expect(html).toContain("4 min ago");
    expect(html).toContain("Not run yet");
    expect(html).toContain("Warning after 2 h · Critical after 4 h");
    expect(html).toContain("read-only");
    expect(html).not.toMatch(/<button[^>]*>[^<]*Run/);
  });
});

describe("Health › Fail-safe requests", () => {
  it("lists requests for the ?status= filter with registry names and the deployment line", async () => {
    db.staffListFailsafeRequests.mockResolvedValue([
      {
        id: "fsreqaaaaaaaaa1",
        orgId: ORG_A,
        business: "Rivera Bakery",
        addon: "testimonials",
        captureId: "cap1",
        name: "Ana Rivera",
        email: "ana@example.test",
        phone: "",
        preferred: "Sat morning",
        message: "Haircut",
        capturedAt: "2026-10-10T15:00:00.000Z",
        status: "pending",
        convertedAt: null,
        convertedRef: "",
        dismissedAt: null,
      },
    ]);
    const html = await render(
      FailsafePanel({
        session: session("support_agent"),
        params: { tab: "failsafe", status: "all" },
      } as never),
    );
    expect(db.staffListFailsafeRequests.mock.calls[0]![1]).toEqual({
      status: "all",
    });
    expect(html).toContain("Rivera Bakery");
    expect(html).toContain("Sat morning · Ana R.");
    expect(html).toContain(">Testimonials<");
    expect(html).not.toContain(">testimonials<");
    expect(html).toContain("Capture service: not deployed (GO-LIVE)");
    expect(html).toContain("Convert");
    expect(html).toContain("Dismiss");
  });

  it("an unknown status falls back to pending; an empty list says so", async () => {
    expect(parseFailsafeFilter("junk")).toBe("pending");
    expect(parseFailsafeFilter(["all"])).toBe("pending");
    const html = await render(
      FailsafePanel({
        session: session("super_admin"),
        params: { status: "junk" },
      } as never),
    );
    expect(db.staffListFailsafeRequests.mock.calls[0]![1]).toEqual({
      status: "pending",
    });
    expect(html).toContain(
      "No fail-safe requests. They appear here after an outage.",
    );
  });
});
