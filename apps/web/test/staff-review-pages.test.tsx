// 13-38 Task 2 (STAFF-23, STAFF-24, STAFF-26; D248, D249, D-UI-P13-10, -25; T-13-38-03): the
// three Review queue panels and the case page. @cds/db is mocked (readStaffSession + the 13-23
// read models); the real staff session, panels and client components run (static render).
import { NotFound } from "@cds/core";
import { ToastRegion } from "@cds/ui/hub";
import { REVIEW_COPY } from "@cds/ui/staff";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { kit, nextSignal, resetStaffKit } from "./staff-test-kit";

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
vi.mock("../lib/section-registry", () => ({ SECTION_REGISTRY: {} }));
vi.mock("../app/actions/staff/review", () => ({
  caseOutcomeAction: vi.fn(),
  flagOutcomeAction: vi.fn(),
  addCaseStepAction: vi.fn(),
  assignCaseAction: vi.fn(),
  markSpotPageAction: vi.fn(),
  logReportAction: vi.fn(),
}));

const db = vi.hoisted(() => ({
  readStaffSession: vi.fn(),
  listReviewQueue: vi.fn(),
  staffGetFlag: vi.fn(),
  repeatInfringerFor: vi.fn(),
  staffGetCase: vi.fn(),
  staffListAuditLog: vi.fn(),
  staffSupportLabels: vi.fn(),
  describeTakedown: vi.fn(),
}));
vi.mock("@cds/db", async (orig) => ({
  ...(await orig<typeof import("@cds/db")>()),
  ...db,
}));

const { default: FlagsPanel } =
  await import("../app/(platform)/staff/(console)/review/panels/flags");
const { default: SpotPanel } =
  await import("../app/(platform)/staff/(console)/review/panels/spot");
const { default: ReportsPanel } =
  await import("../app/(platform)/staff/(console)/review/panels/reports");
const { default: CasePage } =
  await import("../app/(platform)/staff/(console)/review/[case]/page");

type Role = "super_admin" | "support_agent";
const C = REVIEW_COPY;
const ORG = "aaaaaaaaaaaaaaa";
const PAGE = "pageaaaaaaaaaa1";
const FLAG_A = "flagaaaaaaaaaa1";
const FLAG_B = "flagbbbbbbbbbb1";

function ctxFor(role: Role) {
  return { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" };
}

function signIn(role: Role) {
  kit.cookies.set("cds_staff", "tok");
  db.readStaffSession.mockResolvedValue({
    ctx: ctxFor(role),
    sessionId: "sess00000000001",
    stepUpFresh: true,
    staffName: "Sam Admin",
    staffEmailMasked: "s•••@example.test",
    createdAt: new Date().toISOString(),
  });
}

function session(role: Role) {
  return {
    ctx: ctxFor(role),
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh: true,
    name: "Sam Admin",
    role,
    maskedEmail: "s•••@example.test",
  } as never;
}

async function html(el: Promise<ReactNode> | ReactNode): Promise<string> {
  return renderToStaticMarkup(
    createElement(ToastRegion, null, (await el) as ReactElement),
  );
}

function flagItem(over: Record<string, unknown> = {}) {
  return {
    kind: "scan_flag",
    ref: FLAG_B,
    orgId: ORG,
    business: "Rivera Bakery",
    target: {
      collection: "pages",
      id: PAGE,
      title: "Page · Menu",
      url: "https://rivera.example/menu",
    },
    verdict: "unsure",
    reasons: ['Text: matched "replica"'],
    pastPromise: false,
    status: "open",
    assignee: null,
    createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    href: `/staff/review/${FLAG_B}`,
    ...over,
  };
}

function reviewCase(over: Record<string, unknown> = {}) {
  return {
    id: "caseaaaaaaaaaa1",
    ref: "R-31",
    seq: 31,
    kind: "dmca",
    orgId: ORG,
    business: "Rivera Bakery",
    targetUrl: "https://rivera.example/gallery",
    targetCollection: "pages",
    targetId: PAGE,
    category: "copyright",
    description: "My photo <script>alert(1)</script> is used.",
    reporterName: "Pat Lens",
    reporterEmail: "pat@example.test",
    dmcaStatement: {
      good_faith: true,
      accuracy: true,
      signature: "Pat Lens",
      signed_at: "2026-10-12T15:00:00.000Z",
    },
    status: "open",
    steps: [{ step: "received", at: "2026-10-12T15:00:00.000Z", by: "" }],
    currentStep: "received",
    dueAt: "2026-10-14T15:00:00.000Z",
    assignee: null,
    outcome: null,
    pages: [],
    repeatInfringer: true,
    created: "2026-10-12T15:00:00.000Z",
    updated: "2026-10-12T15:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  db.repeatInfringerFor.mockResolvedValue(new Set());
  db.staffListAuditLog.mockResolvedValue({
    items: [],
    page: 1,
    perPage: 5,
    totalItems: 0,
    totalPages: 0,
  });
  db.staffSupportLabels.mockResolvedValue({
    orgs: {},
    pages: { [PAGE]: "Gallery" },
  });
});

describe("flags panel", () => {
  it("lists a held item 3 business days old first as 'Held 3 days' (r-held-late) and links fit holds", async () => {
    db.listReviewQueue.mockResolvedValue([
      flagItem({
        kind: "scan_hold",
        ref: FLAG_A,
        verdict: "held",
        heldBusinessDays: 3,
        pastPromise: true,
        target: {
          collection: "pages",
          id: PAGE,
          title: "Page · About us",
          url: null,
        },
        href: `/staff/review/${FLAG_A}`,
      }),
      flagItem(),
      {
        kind: "fit_hold",
        ref: ORG,
        orgId: ORG,
        business: "Fit Co",
        target: { collection: "signup", id: ORG, title: "Signup", url: null },
        reasons: [],
        pastPromise: false,
        status: "held",
        assignee: null,
        createdAt: "",
        readOnly: true,
        href: "/staff/pipeline?tab=fit",
      },
    ]);
    const out = await html(
      FlagsPanel({ session: session("support_agent"), params: {} }),
    );
    expect(db.listReviewQueue).toHaveBeenCalledWith(expect.anything(), {
      tab: "flags",
      status: "open",
    });
    const body = out.slice(out.indexOf("<tbody"));
    const firstRow = body.slice(0, body.indexOf("</tr>"));
    expect(firstRow).toContain("Held 3 days");
    expect(firstRow).toContain("bg-hub-danger-tint");
    expect(firstRow).toContain("Held 3 business days");
    expect(firstRow).toContain(`/staff/review/${FLAG_A}`);
    expect(out).toContain("1 fit hold · in Pipeline");
    expect(out).toContain('href="/staff/pipeline?tab=fit"');
    expect(out).not.toContain("Fit Co");
    expect(out).toContain("Text: matched &quot;replica&quot;");
  });

  it("view=done asks for resolved flags and shows the empty line", async () => {
    db.listReviewQueue.mockResolvedValue([]);
    const out = await html(
      FlagsPanel({
        session: session("support_agent"),
        params: { view: "done" },
      }),
    );
    expect(db.listReviewQueue).toHaveBeenCalledWith(expect.anything(), {
      tab: "flags",
      status: "done",
    });
    expect(out).toContain(C.flagsEmptyDone);
  });
});

describe("spot and reports panels", () => {
  it("spot checks show pages marked / total", async () => {
    db.listReviewQueue.mockResolvedValue([
      {
        ...flagItem({
          kind: "spot_check",
          ref: "R-40",
          href: "/staff/review/R-40",
        }),
        case: reviewCase({
          kind: "spot_check",
          ref: "R-40",
          description: "Weekly spot check: 2 pages to look at.",
          pages: [
            { page_id: PAGE, title: "Home", state: "ok" },
            { page_id: "pagebbbbbbbbbb1", title: "Menu", state: "unchecked" },
          ],
        }),
      },
    ]);
    const out = await html(
      SpotPanel({ session: session("support_agent"), params: {} }),
    );
    expect(out).toContain("R-40");
    expect(out).toContain("1/2");
    expect(out).toContain("Weekly spot check: 2 pages to look at.");
  });

  it("reports list kind, current step, repeat flag and Log a report", async () => {
    db.listReviewQueue.mockResolvedValue([
      {
        ...flagItem({ kind: "dmca", ref: "R-31", href: "/staff/review/R-31" }),
        case: reviewCase(),
      },
    ]);
    db.repeatInfringerFor.mockResolvedValue(new Set([ORG]));
    const out = await html(
      ReportsPanel({ session: session("support_agent"), params: {} }),
    );
    expect(out).toContain("DMCA");
    expect(out).toContain(C.repeat);
    expect(out).toContain("Received");
    expect(out).toContain("Copyright");
    expect(out).toContain(C.logReport);
    expect(out).not.toContain("pat@example.test");
  });
});

describe("case page", () => {
  it("an unknown ref is notFound", async () => {
    signIn("support_agent");
    db.staffGetCase.mockRejectedValue(new NotFound("case not found"));
    expect(
      await nextSignal(() =>
        CasePage({ params: Promise.resolve({ case: "R-999" }) }),
      ),
    ).toBe("NEXT_NOT_FOUND");
    expect(
      await nextSignal(() =>
        CasePage({ params: Promise.resolve({ case: "not-a-case" }) }),
      ),
    ).toBe("NEXT_NOT_FOUND");
  });

  it("shows the target, reporter (staff only), timeline and four secondary outcomes", async () => {
    signIn("super_admin");
    db.staffGetCase.mockResolvedValue(reviewCase());
    const out = await html(
      CasePage({ params: Promise.resolve({ case: "R-31" }) }),
    );
    expect(out).toContain("Case R-31");
    expect(out).toContain("pat@example.test");
    expect(out).toContain("Pat Lens");
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>alert");
    expect(out).toContain(C.stepActions.content_disabled);
    expect(out).toContain(
      `<span>${C.stepActions.content_disabled}</span></button>`,
    );
    expect(out).not.toContain(
      `<span>${C.stepActions.restore_date_set}</span></button>`,
    );
    for (const label of [
      "Clear hold",
      "Ask to fix",
      "Remove content",
      "Suspend…",
    ]) {
      expect(out).toContain(`<span>${label}</span></button>`);
    }
    expect(out).toContain(C.repeat);
    expect(out).toContain(C.rail.closingNote);
    expect(out).toContain("Gallery");
  });

  it("an agent sees Suspend… locked with Super Admin only", async () => {
    signIn("support_agent");
    db.staffGetCase.mockResolvedValue(reviewCase({ repeatInfringer: false }));
    const out = await html(
      CasePage({ params: Promise.resolve({ case: "R-31" }) }),
    );
    expect(out).toMatch(/disabled=""[^>]*><span>Suspend…<\/span><\/button>/);
    expect(out).toContain(C.superOnly);
  });

  it("a flag id opens the held item with its heading (direct read, WR-D05)", async () => {
    signIn("support_agent");
    db.staffGetFlag.mockResolvedValue(
      flagItem({
        kind: "scan_hold",
        ref: FLAG_A,
        heldBusinessDays: 1,
        target: {
          collection: "pages",
          id: PAGE,
          title: "Page · About us",
          url: "https://rivera.example/about",
        },
      }),
    );
    const out = await html(
      CasePage({ params: Promise.resolve({ case: FLAG_A }) }),
    );
    expect(db.staffGetFlag).toHaveBeenCalledWith(expect.anything(), FLAG_A);
    expect(db.listReviewQueue).not.toHaveBeenCalled();
    expect(out).toContain("Held page · About us");
    expect(out).toContain("Held 1 day");
    expect(out).toContain(C.viewLive);
    expect(db.staffGetCase).not.toHaveBeenCalled();
  });
});

describe("spotPageUrl (WR-D03)", () => {
  it("links each page, home at the root; no slug means no link", async () => {
    const { spotPageUrl } =
      await import("../app/(platform)/staff/(console)/review/review-data");
    expect(spotPageUrl("https://rivera.example/", "home")).toBe(
      "https://rivera.example/",
    );
    expect(spotPageUrl("https://rivera.example/", "menu")).toBe(
      "https://rivera.example/menu",
    );
    expect(spotPageUrl("https://rivera.example/", undefined)).toBeNull();
    expect(spotPageUrl("", "menu")).toBeNull();
    expect(spotPageUrl("javascript:alert(1)", "menu")).toBeNull();
    expect(spotPageUrl("https://rivera.example/", "../x")).toBeNull();
  });
});
