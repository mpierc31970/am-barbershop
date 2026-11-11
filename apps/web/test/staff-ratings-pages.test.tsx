// @vitest-environment jsdom
// 13-42 Task 2 (STAFF-21, D212, P13-P32; 13-UI-SPEC "Ratings & SLA" lines 597-609): the
// Ratings & SLA tab. @cds/db reads are mocked (the real slaReportLine / slaLateLabel /
// slaMonthOf run); the real panel, island, RatingsReport, SlaCard and the action run.
//   - `?month=` drives both staffRatingsReport and staffSlaReport (junk falls back to now);
//   - per-agent row "1 Thumbs up · 1 Thumbs down · 50%", rating words beside icons;
//   - Followed up calls the action with the number and removes the row;
//   - markRatingFollowedUpAction calls staffMarkRatingFollowedUp (support_reply).
import { ToastRegion } from "@cds/ui/hub";
import {
  RATINGS_REPORT_COPY as C,
  RatingsReport,
  type RatingsReportView,
} from "@cds/ui/staff";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

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

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
vi.mock("../lib/staff-session", async (orig) => ({
  ...(await orig<typeof import("../lib/staff-session")>()),
  getStaffSession: sess.getStaffSession,
}));

const db = vi.hoisted(() => ({
  staffRatingsReport: vi.fn(),
  staffSlaReport: vi.fn(),
  staffMarkRatingFollowedUp: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: RatingsPanel, ratingsMonths } =
  await import("../app/(platform)/staff/(console)/tickets/panels/ratings");
const { markRatingFollowedUpAction } =
  await import("../app/actions/staff/ratings");
const { slaMonthOf } = await import("@cds/db");
const { resetStaffKit } = await import("./staff-test-kit");

type Role = "super_admin" | "support_agent";
const ORG = "orgaaaaaaaaaaa1";

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

function report(over: Partial<RatingsReportView> = {}): RatingsReportView {
  return {
    month: "2026-09",
    label: "September 2026",
    overall: { up: 3, down: 1, rate: 75 },
    byAgent: [
      { agentId: "agentaaaaaaaaa1", name: "Lee", up: 1, down: 1, rate: 50 },
      { agentId: "agentbbbbbbbbb2", name: "Mara", up: 2, down: 0, rate: 100 },
    ],
    comments: [
      {
        number: 1031,
        orgId: ORG,
        business: "Rivera Bakery",
        rating: "down",
        comment: "Still blurry <b>on mobile</b>",
        ratedAt: "2026-09-12T15:00:00.000Z",
        agent: "Lee",
      },
    ],
    toFollowUp: [
      {
        number: 1031,
        orgId: ORG,
        business: "Rivera Bakery",
        agent: "Lee",
        comment: "Still blurry <b>on mobile</b>",
        ratedAt: "2026-09-12T15:00:00.000Z",
      },
      {
        number: 1044,
        orgId: ORG,
        business: "Rivera Bakery",
        agent: "Mara",
        comment: null,
        ratedAt: "2026-09-14T15:00:00.000Z",
      },
    ],
    ...over,
  };
}

function sla(month = "2026-09") {
  return {
    month,
    label: "September 2026",
    firstReplies: 18,
    met: 17,
    missed: 1,
    waiting: 0,
    missedTickets: [
      {
        number: 1031,
        orgId: ORG,
        orgName: "Rivera Bakery",
        lateMs: 3 * 3_600_000,
        answered: true,
      },
    ],
  };
}

async function panel(
  params: Record<string, string>,
  role: Role = "support_agent",
) {
  const el = await RatingsPanel({ session: session(role), params } as never);
  return renderToStaticMarkup(
    createElement(ToastRegion, null, el as ReactElement),
  );
}

let mounted: Mounted | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.staffRatingsReport.mockResolvedValue(report());
  db.staffSlaReport.mockResolvedValue(sla());
  db.staffMarkRatingFollowedUp.mockResolvedValue({
    number: 1031,
    followedAt: "2026-10-16T10:00:00.000Z",
    changed: true,
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

describe("Ratings & SLA panel (13-42 choice 4)", () => {
  it("?month= drives both reads and the SLA card shows the CLI line and the missed links", async () => {
    const current = slaMonthOf(new Date());
    const months = ratingsMonths(current);
    expect(months).toHaveLength(12);
    const asked = months[1]!.value;
    const html = await panel({ tab: "ratings", month: asked });
    expect(db.staffRatingsReport.mock.calls[0]![1]).toMatchObject({
      month: asked,
    });
    expect(db.staffSlaReport.mock.calls[0]![1]).toMatchObject({
      month: asked,
    });
    expect(html).toContain("First replies");
    expect(html).toContain(
      "September 2026 · first replies 18 · met 17 · missed 1 (#1031, 3h late)",
    );
    expect(html).toContain('href="/staff/tickets/1031"');
    expect(html).toContain("#1031 · 3h late");
    expect(html).toContain(`<option value="${asked}" selected="">`);
  });

  it("a junk or out-of-range month falls back to the current business month", async () => {
    const current = slaMonthOf(new Date());
    for (const month of ["2026-13", "abc", "1999-01"]) {
      vi.clearAllMocks();
      db.staffRatingsReport.mockResolvedValue(report());
      db.staffSlaReport.mockResolvedValue(sla());
      await panel({ tab: "ratings", month });
      expect(db.staffRatingsReport.mock.calls[0]![1]).toMatchObject({
        month: current,
      });
      expect(db.staffSlaReport.mock.calls[0]![1]).toMatchObject({
        month: current,
      });
    }
  });

  it("shows the overall line, the per-agent table and words beside the rating icons", async () => {
    const html = await panel({ tab: "ratings" });
    expect(html).toContain("4 rated · 3 thumbs up · 1 thumbs down (75%)");
    expect(html).toContain("Ratings by agent");
    expect(html).toContain(">Lee<");
    expect(html).toContain("50%");
    expect(html).toContain("Thumbs up</th>");
    expect(html).toContain("Thumbs down</th>");
    // The follow-up list is the default view; tenant text stays text.
    expect(html).toContain("Still blurry &lt;b&gt;on mobile&lt;/b&gt;");
    expect(html).toContain("No comment");
    expect(html).toContain("Followed up #1031");
    expect(
      C.agentLine({ agentId: "x", name: "Lee", up: 1, down: 1, rate: 50 }),
    ).toBe("1 Thumbs up · 1 Thumbs down · 50%");
  });

  it("an empty month says so; a failed read shows ERR-LOAD for that section only", async () => {
    db.staffRatingsReport.mockResolvedValue(
      report({
        overall: { up: 0, down: 0, rate: null },
        byAgent: [],
        comments: [],
        toFollowUp: [],
      }),
    );
    db.staffSlaReport.mockRejectedValue(new Error("down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = await panel({ tab: "ratings" });
    expect(html).toContain("No ratings in September yet.");
    expect(html).not.toContain("First replies");
    expect(html).toContain("Try again");
    expect(err).toHaveBeenCalledWith("[staff] sla report failed", "Error");
    err.mockRestore();
  });
});

describe("RatingsReport interactions", () => {
  it("Followed up calls the action with the number and removes the row", async () => {
    const onFollowedUp = vi.fn(async (n: number) => ({
      ok: true as const,
      message: `#${n} marked followed up.`,
    }));
    const notify = vi.fn();
    mounted = mount(
      <RatingsReport
        report={report()}
        canFollowUp
        onFollowedUp={onFollowedUp}
        notify={notify}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain("#1031");
    const sw = root.querySelector<HTMLInputElement>("#followed-1031")!;
    click(sw);
    await flush();
    expect(onFollowedUp).toHaveBeenCalledWith(1031);
    expect(notify).toHaveBeenCalledWith("#1031 marked followed up.");
    expect(root.querySelector("#followed-1031")).toBeNull();
    expect(root.querySelector("#followed-1044")).not.toBeNull();
  });

  it("a refused mark keeps the row and shows the message", async () => {
    const onFollowedUp = vi.fn(async () => ({
      ok: false as const,
      message: "Your role can't do this. Ask a Super Admin.",
    }));
    mounted = mount(
      <RatingsReport
        report={report()}
        canFollowUp
        onFollowedUp={onFollowedUp}
      />,
    );
    click(mounted.container.querySelector("#followed-1031"));
    await flush();
    expect(mounted.container.querySelector("#followed-1031")).not.toBeNull();
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe(
      "Your role can't do this. Ask a Super Admin.",
    );
  });

  it("All comments lists the comments with the rating word", async () => {
    mounted = mount(
      <RatingsReport
        report={report()}
        canFollowUp={false}
        onFollowedUp={vi.fn()}
      />,
    );
    const root = mounted.container;
    expect(root.querySelector("#followed-1031")).toBeNull();
    const tab = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "All comments",
    );
    click(tab);
    expect(root.querySelector("[data-ratings-comments]")).not.toBeNull();
    expect(root.textContent).toContain("Thumbs down");
    expect(root.textContent).toContain("Still blurry <b>on mobile</b>");
  });
});

describe("markRatingFollowedUpAction", () => {
  it("calls staffMarkRatingFollowedUp with the number and returns the line", async () => {
    const res = await markRatingFollowedUpAction("1031");
    expect(res).toEqual({
      ok: true,
      data: {
        number: 1031,
        changed: true,
        message: "#1031 marked followed up.",
      },
    });
    expect(db.staffMarkRatingFollowedUp).toHaveBeenCalledWith(
      session("support_agent").ctx,
      1031,
    );
  });

  it("refuses junk numbers and a missing session without a write", async () => {
    expect(await markRatingFollowedUpAction("abc")).toMatchObject({
      ok: false,
      code: "not_found",
    });
    sess.getStaffSession.mockResolvedValue(null);
    expect(await markRatingFollowedUpAction(1031)).toMatchObject({
      ok: false,
      code: "session_ended",
    });
    expect(db.staffMarkRatingFollowedUp).not.toHaveBeenCalled();
  });
});
