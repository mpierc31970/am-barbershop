// @vitest-environment jsdom
// 11-17 Task 2: /hub/today (DASH-02, DASH-19, DASH-20, DASH-30, DASH-31, DASH-33; 11-UI-SPEC
// "Today", role variants; T-11-17-01, T-11-17-02). The real server page over a mocked
// session, @cds/db and getNeedsYou. The page's async sections sit inside Suspense; the test
// resolves async server components in the tree before mounting it in jsdom.
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";
import { ToastRegion } from "@cds/ui/hub";
import { PHONE_ALERTS_COPY } from "@cds/ui/hub/today";

const router = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/today",
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const ROLES = {
  owner: { orgId: "org1", actor: "u1", role: "owner", grants: [] },
  admin: { orgId: "org1", actor: "u2", role: "admin", grants: [] },
  editor: { orgId: "org1", actor: "u4", role: "editor", grants: [] },
  viewer: { orgId: "org1", actor: "u3", role: "viewer", grants: [] },
  staff: { orgId: "org1", actor: "u5", role: "staff", grants: [] },
  impersonating: {
    orgId: "org1",
    actor: "u1",
    role: "admin",
    grants: [],
    impersonator: "s1",
  },
} as const;
type RoleKey = keyof typeof ROLES;

const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const ny = vi.hoisted(() => ({ getNeedsYou: vi.fn() }));
vi.mock("../lib/needs-you", () => ny);

const db = vi.hoisted(() => ({
  readOrgStatus: vi.fn(),
  readMemberPrefs: vi.fn(),
  launchReviewProgress: vi.fn(),
  // 14-34: the card's submitted state.
  launchReviewView: vi.fn(),
  readLedger: vi.fn(),
  statsTimeZone: vi.fn(),
  activeAddons: vi.fn(),
  markSeen: vi.fn(),
  // 11-19: cards, This week, From CDS, work in progress.
  pausedAddons: vi.fn(),
  orgPlanPath: vi.fn(),
  weekNumbers: vi.fn(),
  listSubmissions: vi.fn(),
  listWorkOrders: vi.fn(),
  activeAnnouncement: vi.fn(),
  recentAddonInstalls: vi.fn(),
  updateMemberPrefs: vi.fn(),
  markDismissed: vi.fn(),
  // 11-22: Phone alerts card.
  pushPublicKey: vi.fn(),
  listMyDevices: vi.fn(),
  savePushSubscription: vi.fn(),
  removePushSubscription: vi.fn(),
  validatePushSubscription: vi.fn(),
  // 12-29: the pinned CDS note for From CDS.
  pinnedNoteForFromCds: vi.fn(),
}));
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_SERVER: {},
  activeTodayProviders: () => [],
}));

const { default: TodayPage, metadata } =
  await import("../app/(platform)/hub/today/page");
const { default: TodayLoading } =
  await import("../app/(platform)/hub/today/loading");
const { markSeenAction } = await import("../app/actions/today");
const { stageBlockMode } =
  await import("../app/(platform)/hub/today/today-data");

const REVIEW_ITEMS = [
  "Every page looked over",
  "Changes you asked for",
  "Your key details confirmed",
  "Checked on your phone",
  "Test form received",
  "No open change requests",
].map((label, i) => ({ id: `i${i}`, label, done: false }));

function status(stage: string, over: Record<string, unknown> = {}) {
  return {
    stage,
    launchedAt: stage === "live" ? "2026-10-10 14:00:00.000Z" : null,
    paidAt: "2026-10-01 15:00:00.000Z",
    buildStartedAt: "2026-10-02 15:00:00.000Z",
    buildNote: "",
    buildNoteAt: null,
    analytics: {},
    ...over,
  };
}

function prefs(seen: string[] = []) {
  return {
    todayLayout: { order: [], hidden: [] },
    toursSeen: [],
    alertChannels: {},
    quietHours: { on: true, from: "21:00", until: "07:00" },
    dismissed: [],
    seenFlags: seen,
  };
}

const ITEMS = [
  {
    key: "billing:fix_card",
    kind: "billing.fix_card",
    level: "urgent",
    title: "Your card was declined",
    actionLabel: "Fix your card",
    href: "/hub/settings?tab=billing",
    section: "settings",
    tab: "billing",
    at: "2026-10-11T10:00:00.000Z",
  },
  {
    key: "inbox:m1",
    kind: "inbox.message",
    level: "normal",
    title: "Dana Lee",
    sub: "From the Contact form",
    actionLabel: "Reply",
    href: "/hub/inbox?tab=messages&message=m1",
    section: "inbox",
    at: "2026-10-11T09:00:00.000Z",
  },
];

const WEEK = {
  days: {
    now: [
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
      "2026-10-09",
      "2026-10-10",
      "2026-10-11",
    ],
    prev: [],
  },
  visitors: { now: 140, prev: 128 },
  inquiries: { now: 7, prev: 7 },
};

/** Await every async server component in the tree (Suspense children included). */
async function resolveTree(node: ReactNode): Promise<ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveTree));
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  const type = el.type as unknown;
  if (typeof type === "function" && type.constructor.name === "AsyncFunction") {
    const out = await (type as (p: unknown) => Promise<ReactNode>)(el.props);
    return resolveTree(out);
  }
  if (el.props && "children" in el.props) {
    return cloneElement(el, undefined, await resolveTree(el.props.children));
  }
  return el;
}

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function useRole(
  role: RoleKey,
  host: string | null = "rivera.sites.localhost",
) {
  const session = {
    ctx: ROLES[role],
    email: "a@b.co",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: host },
  };
  sess.requireHubSession.mockResolvedValue(session);
  sess.getHubSession.mockResolvedValue(session);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  useRole("owner");
  sess.agreementBlocks.mockResolvedValue(false);
  db.readOrgStatus.mockResolvedValue(status("being_built"));
  db.readMemberPrefs.mockResolvedValue(prefs());
  db.statsTimeZone.mockResolvedValue("America/Chicago");
  db.readLedger.mockResolvedValue({ rowId: "r1", ledger: { status: "done" } });
  db.launchReviewProgress.mockResolvedValue({
    items: REVIEW_ITEMS,
    done: 0,
    total: 6,
    available: false,
  });
  db.launchReviewView.mockResolvedValue({
    submittedAt: null,
    resubmitNeeded: [],
  });
  db.activeAddons.mockResolvedValue([]);
  db.markSeen.mockResolvedValue(prefs(["youre_live"]));
  ny.getNeedsYou.mockResolvedValue({ items: ITEMS, failed: [] });
  db.pausedAddons.mockResolvedValue([]);
  db.orgPlanPath.mockResolvedValue("standard");
  db.weekNumbers.mockResolvedValue(WEEK);
  db.listSubmissions.mockResolvedValue({
    items: [],
    page: 1,
    perPage: 3,
    totalItems: 0,
    totalPages: 0,
  });
  db.listWorkOrders.mockResolvedValue([]);
  db.activeAnnouncement.mockResolvedValue(null);
  db.recentAddonInstalls.mockResolvedValue([]);
  db.pushPublicKey.mockReturnValue(null);
  db.listMyDevices.mockResolvedValue([]);
  db.pinnedNoteForFromCds.mockResolvedValue(null);
});

async function render() {
  const tree = await resolveTree((await TodayPage()) as ReactElement);
  mounted = mount(tree);
  return mounted.container;
}

describe("/hub/today", () => {
  it("metadata and the loading skeleton", () => {
    expect(metadata.title).toBe("Today");
    mounted = mount(<TodayLoading />);
    expect(
      mounted.container.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();
    expect(
      mounted.container.querySelectorAll("[data-skeleton-row]").length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("being_built: greeting, status line, tracker and Needs you", async () => {
    const root = await render();
    expect(root.querySelector("h1")!.textContent).toMatch(
      /^Good (morning|afternoon|evening)$/,
    );
    expect(root.textContent).toContain("Being built");
    expect(root.querySelector("[data-build-tracker]")).not.toBeNull();
    expect(root.querySelector("[data-launch-review]")).toBeNull();
    expect(
      root.querySelector('[aria-current="step"]')!.getAttribute("data-step"),
    ).toBe("polishing");
    expect(db.readLedger).toHaveBeenCalledWith(ROLES.owner);
    const rows = root.querySelectorAll("[data-needs-you-item]");
    expect(rows).toHaveLength(2);
    expect(root.textContent).toContain("Fix your card");
    expect(root.textContent).toContain("From the Contact form ·");
  });

  it("ready_for_review: the launch review card (0 of 6, no button) for the Owner", async () => {
    db.readOrgStatus.mockResolvedValue(status("ready_for_review"));
    const root = await render();
    expect(root.textContent).toContain("Ready for your review");
    const card = root.querySelector("[data-launch-review]")!;
    expect(card.textContent).toContain("0 of 6 done");
    expect(card.textContent).toContain(
      "Support will email you when your review is ready to start.",
    );
    expect(card.querySelector("a")).toBeNull();
    expect(root.querySelector("[data-build-tracker]")).toBeNull();
  });

  it("ready_for_review + available: Continue review for the Owner only", async () => {
    db.readOrgStatus.mockResolvedValue(status("ready_for_review"));
    db.launchReviewProgress.mockResolvedValue({
      items: REVIEW_ITEMS,
      done: 0,
      total: 6,
      available: true,
    });
    let root = await render();
    expect(root.textContent).toContain("Continue review");
    mounted!.unmount();
    mounted = null;
    useRole("admin");
    root = await render();
    expect(root.querySelector("[data-launch-review]")).not.toBeNull();
    expect(root.textContent).not.toContain("Continue review");
  });

  it("14-34: a sent review reads SUBMITTED-H with no Continue review", async () => {
    db.readOrgStatus.mockResolvedValue(status("ready_for_review"));
    db.launchReviewProgress.mockResolvedValue({
      items: REVIEW_ITEMS.map((i) => ({ ...i, done: true })),
      done: 6,
      total: 6,
      available: true,
    });
    db.launchReviewView.mockResolvedValue({
      submittedAt: "2026-10-12 15:00:00.000Z",
      resubmitNeeded: [],
    });
    const root = await render();
    const card = root.querySelector("[data-launch-review]")!;
    expect(card.textContent).toContain("Support is giving it a final look.");
    expect(root.textContent).not.toContain("Continue review");
  });

  it("ready_for_review for an Editor: tracker only", async () => {
    useRole("editor");
    db.readOrgStatus.mockResolvedValue(status("ready_for_review"));
    const root = await render();
    expect(root.querySelector("[data-build-tracker]")).not.toBeNull();
    expect(root.querySelector("[data-launch-review]")).toBeNull();
    expect(db.launchReviewProgress).not.toHaveBeenCalled();
  });

  it("live + unseen: You're live; Show my Today saves the flag and shows Today", async () => {
    useRole("owner", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    const root = await render();
    expect(root.querySelector("h1")!.textContent).toBe(
      "You're live at riverabakery.com",
    );
    expect(root.querySelectorAll("[data-live-step]")).toHaveLength(3);
    expect(root.textContent).toContain("See your Site Report");
    // Needs you still renders under it.
    expect(root.querySelector("[data-needs-you]")).not.toBeNull();
    const show = [...root.querySelectorAll("button")].find(
      (b) => b.textContent === "Show my Today",
    );
    click(show);
    await flush();
    expect(root.querySelector("[data-youre-live]")).toBeNull();
    expect(root.textContent).toContain(
      "Your site is live at riverabakery.com.",
    );
    expect(document.activeElement?.tagName).toBe("H1");
    expect(db.markSeen).toHaveBeenCalledWith(ROLES.owner, "youre_live");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("live + seen: the normal Today (no stage block)", async () => {
    useRole("owner", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    db.readMemberPrefs.mockResolvedValue(prefs(["youre_live"]));
    const root = await render();
    expect(root.querySelector("[data-youre-live]")).toBeNull();
    expect(root.textContent).toContain(
      "Your site is live at riverabakery.com.",
    );
    expect(root.textContent).toContain("View site");
    expect(root.querySelector("[data-build-tracker]")).toBeNull();
    expect(root.querySelector("[data-launch-review]")).toBeNull();
    expect(db.readLedger).not.toHaveBeenCalled();
  });

  it("live: impersonating staff never get the one-time screen", async () => {
    useRole("impersonating", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    const root = await render();
    expect(root.querySelector("[data-youre-live]")).toBeNull();
  });

  it("Viewer: tracker, no Needs-you section and no actions", async () => {
    useRole("viewer");
    const root = await render();
    expect(root.querySelector("[data-build-tracker]")).not.toBeNull();
    expect(root.querySelector("[data-needs-you]")).toBeNull();
    expect(root.textContent).not.toContain("Needs you");
    expect(ny.getNeedsYou).not.toHaveBeenCalled();
  });

  it("Staff member (A&M barber seat): their own Today, appointments only, no stage block", async () => {
    useRole("staff");
    const root = await render();
    expect(root.textContent).toContain("Your upcoming appointments");
    expect(root.textContent).not.toContain("Being built");
    expect(root.querySelector("[data-build-tracker]")).toBeNull();
  });

  it("a throwing Needs-you load shows ERR-SECTION, not a crash", async () => {
    ny.getNeedsYou.mockRejectedValue(new Error("boom"));
    const root = await render();
    const err = root.querySelector("[data-section-error]")!;
    expect(err.querySelector("h2")!.textContent).toBe("Needs you");
    expect(err.textContent).toContain(
      "We couldn't load this part. The rest of the page is fine.",
    );
    // The rest renders.
    expect(root.querySelector("[data-build-tracker]")).not.toBeNull();
  });

  it("an empty list whose providers failed is not 'all caught up'", async () => {
    ny.getNeedsYou.mockResolvedValue({ items: [], failed: ["inbox"] });
    let root = await render();
    expect(root.querySelector("[data-section-error]")).not.toBeNull();
    expect(root.textContent).not.toContain("You're all caught up.");
    mounted!.unmount();
    mounted = null;
    ny.getNeedsYou.mockResolvedValue({ items: [], failed: [] });
    root = await render();
    expect(root.textContent).toContain("You're all caught up.");
  });

  it("failed side reads fall back: time zone, assembly, prefs", async () => {
    db.statsTimeZone.mockRejectedValue(new Error("x"));
    db.readLedger.mockRejectedValue(new Error("x"));
    const root = await render();
    expect(root.querySelector("[data-build-tracker]")).not.toBeNull();
    // Live with unreadable prefs: no one-time screen (never nag).
    mounted!.unmount();
    mounted = null;
    useRole("owner", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    db.readMemberPrefs.mockRejectedValue(new Error("x"));
    const root2 = await render();
    expect(root2.querySelector("[data-youre-live]")).toBeNull();
  });
});

describe("/hub/today, second half (11-19)", () => {
  // A&M fork: no From CDS panel on Today.
  it.skip("main column + rail: cards after Needs you; This week and From Support in the rail", async () => {
    const root = await render();
    const main = root.querySelector("[data-today-main]")!;
    const rail = root.querySelector("[data-today-rail]")!;
    expect(main.querySelector("[data-needs-you]")).not.toBeNull();
    expect(main.querySelector('[data-today-card="inquiries"]')).not.toBeNull();
    expect(main.textContent).toContain("No messages this week.");
    // Before launch: the first-numbers note and no numbers.
    expect(rail.querySelector("[data-this-week]")!.textContent).toContain(
      "Your first numbers appear a day after launch.",
    );
    expect(db.weekNumbers).toHaveBeenCalledTimes(1); // the Inquiries footer only
    expect(rail.querySelector("[data-from-cds]")).not.toBeNull();
    expect(root.querySelector("[data-build-work]")).toBeNull();
  });

  it("live: This week numbers and the work-in-progress card", async () => {
    useRole("owner", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    db.readMemberPrefs.mockResolvedValue(prefs(["youre_live"]));
    db.listWorkOrders.mockResolvedValue([
      {
        id: "w1",
        title: "Studio Booking setup",
        status: "deposit_paid",
        sentLabel: "1 Oct",
        totalCents: 1,
        href: "/hub/settings/quotes/w1",
        setup: "setting_up",
        acceptedLabel: "2 Oct",
      },
    ]);
    const root = await render();
    const week = root.querySelector("[data-this-week]")!;
    expect(week.textContent).toContain("Mon 5 – Sun 11 Oct");
    expect(week.textContent).toContain("12 more than last week");
    expect(week.textContent).toContain("Same as last week");
    expect(db.weekNumbers).toHaveBeenCalledTimes(1); // shared with the card footer
    const work = root.querySelector("[data-build-work]")!;
    expect(work.textContent).toContain("Studio Booking setup");
    // Above Needs you in the main column.
    const main = root.querySelector("[data-today-main]")!;
    expect(main.firstElementChild?.hasAttribute("data-build-work")).toBe(true);
  });

  it("Viewer: no cards; This week shows; Staff: no This week", async () => {
    useRole("viewer");
    let root = await render();
    expect(root.querySelector("[data-today-cards]")).toBeNull();
    expect(root.querySelector("[data-this-week]")).not.toBeNull();
    mounted!.unmount();
    mounted = null;
    useRole("staff");
    root = await render();
    expect(root.querySelector("[data-this-week]")).toBeNull();
  });

  it.skip("impersonating staff: From Support has no Dismiss", async () => {
    useRole("impersonating");
    const root = await render();
    expect(root.querySelector("[data-from-cds]")).not.toBeNull();
    expect(root.querySelector('[aria-label="Dismiss this card"]')).toBeNull();
  });

  it.skip("a pinned Support note leads From Support over the announcement; a failed read falls back (12-29)", async () => {
    db.activeAnnouncement.mockResolvedValue({
      id: "a1",
      title: "Planned upgrade",
      body: "Faster pages next week.",
      href: null,
    });
    db.pinnedNoteForFromCds.mockResolvedValue({
      id: "n1",
      title: "Your new booking page is live",
      text: "We moved the booking button to the top.",
      created: "2026-10-11T10:00:00Z",
    });
    const root = await render();
    const card = root.querySelector("[data-from-cds]")!;
    expect(card.getAttribute("data-from-cds")).toBe("note");
    expect(card.textContent).toContain("Your new booking page is live");
    const link = card.querySelector('a[href="/hub/support?tab=messages"]');
    expect(link?.textContent).toBe("Read the note");
    expect(card.querySelector("[data-cds-mark]")).not.toBeNull();
    mounted!.unmount();
    mounted = null;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.pinnedNoteForFromCds.mockRejectedValue(new TypeError("boom"));
    const root2 = await render();
    expect(
      root2.querySelector("[data-from-cds]")!.getAttribute("data-from-cds"),
    ).toBe("announcement");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("boom");
    spy.mockRestore();
  });

  it("a failing This week read shows ERR-SECTION in the rail only", async () => {
    useRole("owner", "riverabakery.com");
    db.readOrgStatus.mockResolvedValue(status("live"));
    db.readMemberPrefs.mockResolvedValue(prefs(["youre_live"]));
    db.weekNumbers.mockRejectedValue(new Error("x"));
    const root = await render();
    const rail = root.querySelector("[data-today-rail]")!;
    expect(rail.querySelector("[data-section-error] h2")!.textContent).toBe(
      "This week",
    );
    expect(root.querySelector('[data-today-card="inquiries"]')).not.toBeNull();
  });
});

describe("/hub/today, Phone alerts card (11-22)", () => {
  async function renderWithToasts() {
    const tree = await resolveTree((await TodayPage()) as ReactElement);
    mounted = mount(<ToastRegion>{tree}</ToastRegion>);
    return mounted.container;
  }

  it("shows in the rail between This week and From Support when push is configured", async () => {
    db.pushPublicKey.mockReturnValue("BPublicKey");
    const root = await renderWithToasts();
    const rail = root.querySelector("[data-today-rail]");
    expect(rail?.querySelector("[data-phone-alerts]")).not.toBeNull();
    expect(rail?.textContent).toContain(PHONE_ALERTS_COPY.heading);
  });

  it("absent without keys, once dismissed, with a device, or for impersonating staff", async () => {
    let root = await renderWithToasts();
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
    mounted?.unmount();

    db.pushPublicKey.mockReturnValue("BPublicKey");
    db.readMemberPrefs.mockResolvedValue(prefs(["phone_alerts"]));
    root = await renderWithToasts();
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
    mounted?.unmount();

    db.readMemberPrefs.mockResolvedValue(prefs());
    db.listMyDevices.mockResolvedValue([
      {
        id: "d1",
        uaFamily: "android",
        createdAt: "",
        lastOkAt: null,
        failCount: 0,
      },
    ]);
    root = await renderWithToasts();
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
    mounted?.unmount();

    db.listMyDevices.mockResolvedValue([]);
    useRole("impersonating");
    root = await renderWithToasts();
    expect(root.querySelector("[data-phone-alerts]")).toBeNull();
  });
});

describe("markSeenAction", () => {
  it("writes the allow-listed flag for the signed-in person", async () => {
    expect(await markSeenAction("youre_live")).toEqual({
      ok: true,
      data: { seen: true },
    });
    expect(db.markSeen).toHaveBeenCalledWith(ROLES.owner, "youre_live");
  });

  it("does not write under impersonation", async () => {
    useRole("impersonating");
    expect(await markSeenAction("youre_live")).toEqual({
      ok: true,
      data: { seen: false },
    });
    expect(db.markSeen).not.toHaveBeenCalled();
  });

  it("refuses unknown flags before @cds/db", async () => {
    for (const bad of ["tour:x", "", 1, null, { flag: "youre_live" }]) {
      const r = await markSeenAction(bad);
      expect(r.ok).toBe(false);
    }
    expect(db.markSeen).not.toHaveBeenCalled();
  });
});

describe("stageBlockMode", () => {
  it("follows the UI-SPEC role table", () => {
    expect(stageBlockMode("owner", false)).toBe("full");
    expect(stageBlockMode("owner", true)).toBe("read-only");
    expect(stageBlockMode("admin", false)).toBe("read-only");
    expect(stageBlockMode("editor", false)).toBe("tracker-only");
    expect(stageBlockMode("viewer", false)).toBe("tracker-only");
    expect(stageBlockMode("staff", false)).toBe("none");
    expect(stageBlockMode("renter", false)).toBe("none");
  });
});
