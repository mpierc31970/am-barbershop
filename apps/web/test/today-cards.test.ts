// 11-19 Task 2: Today cards, From CDS, work in progress and the two actions (DASH-21, DASH-22,
// DASH-23, DASH-33; T-11-19-01, T-11-19-02, T-11-19-03). Loaders over a mocked @cds/db with
// fixture add-on providers passed in as deps; actions over a mocked session.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  listSubmissions: vi.fn(),
  listWorkOrders: vi.fn(),
  activeAddons: vi.fn(),
  activeAnnouncement: vi.fn(),
  recentAddonInstalls: vi.fn(),
  updateMemberPrefs: vi.fn(),
  markDismissed: vi.fn(),
  markSeen: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const sess = vi.hoisted(() => ({
  getHubSession: vi.fn(),
  agreementBlocks: vi.fn(),
}));
vi.mock("../lib/session", () => sess);

const {
  loadTodayCards,
  loadFromCds,
  loadBuildWork,
  cleanCardData,
  tipAllowed,
} = await import("../app/(platform)/hub/today/cards");
const { saveTodayLayoutAction, dismissFromCdsAction } =
  await import("../app/actions/today");

type Ctx = {
  orgId: string;
  actor: string;
  role: string;
  grants: string[];
  impersonator?: string;
};
const owner: Ctx = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const editor: Ctx = { orgId: "org1", actor: "u4", role: "editor", grants: [] };
const viewer: Ctx = { orgId: "org1", actor: "u3", role: "viewer", grants: [] };
const staffMember: Ctx = {
  orgId: "org1",
  actor: "u5",
  role: "staff",
  grants: [],
};
const impersonating: Ctx = { ...owner, role: "admin", impersonator: "s1" };

const NOW = new Date("2026-10-08T15:00:00.000Z"); // Thu 8 Oct, Chicago
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
  inquiries: { now: 7, prev: 4 },
};

function prefs(over: Record<string, unknown> = {}) {
  return {
    todayLayout: { order: [], hidden: [] },
    toursSeen: [],
    alertChannels: {},
    quietHours: { on: true, from: "21:00", until: "07:00" },
    dismissed: [],
    seenFlags: [],
    ...over,
  };
}

const bookingsCard = vi.fn(async () => ({
  title: "Bookings",
  rows: [{ label: "Dana Lee · Cut", value: "10:00", href: "/hub/bookings/1" }],
  link: { label: "Open bookings", href: "/hub/bookings" },
}));

function providers() {
  return [
    {
      slug: "studio-booking",
      cardSpec: { id: "bookings", title: "Bookings" },
      card: bookingsCard,
    },
  ];
}

function deps(over: Record<string, unknown> = {}) {
  return {
    now: NOW,
    providers: async () => providers(),
    path: async () => "standard" as const,
    prefs: Promise.resolve(prefs()),
    timeZone: Promise.resolve("America/Chicago"),
    week: async () => WEEK,
    ...over,
  } as Parameters<typeof loadTodayCards>[1];
}

function message(id: string, created: string, from = "Dana Lee") {
  return {
    id,
    form: "f1",
    formName: "Contact form",
    formDeleted: false,
    from,
    preview: "Hi",
    unread: true,
    spam: false,
    created,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.listSubmissions.mockResolvedValue({
    items: [
      message("m3", "2026-10-07 18:00:00.000Z"),
      message("m2", "2026-10-06 18:00:00.000Z", ""),
      message("m1", "2026-10-01 18:00:00.000Z"), // last week
    ],
    page: 1,
    perPage: 3,
    totalItems: 3,
    totalPages: 1,
  });
  db.activeAddons.mockResolvedValue([]);
  db.activeAnnouncement.mockResolvedValue(null);
  db.recentAddonInstalls.mockResolvedValue([]);
  db.listWorkOrders.mockResolvedValue([]);
  db.updateMemberPrefs.mockImplementation(async (_ctx, patch) =>
    prefs(patch as Record<string, unknown>),
  );
  db.markDismissed.mockResolvedValue(prefs());
  sess.agreementBlocks.mockResolvedValue(false);
  sess.getHubSession.mockResolvedValue({ ctx: owner, email: "a@b.co" });
});

async function cardsFor(ctx: Ctx, over: Record<string, unknown> = {}) {
  const res = await loadTodayCards(ctx as never, deps(over));
  if (!res.ok || !res.data) throw new Error("no cards");
  return res.data;
}

describe("loadTodayCards", () => {
  it("Standard: Inquiries first, then the add-on card; Inquiries rows are this week's newest", async () => {
    const d = await cardsFor(owner);
    expect(d.cards.map((c) => c.id)).toEqual(["inquiries", "bookings"]);
    const inq = d.cards[0]!;
    if (inq.state !== "ok") throw new Error("inquiries failed");
    expect(inq.title).toBe("Inquiries");
    expect(inq.data.rows).toEqual([
      {
        label: "Dana Lee · Contact form",
        value: "Wed",
        href: "/hub/inbox?tab=messages&message=m3",
      },
      {
        label: "Someone · Contact form",
        value: "Tue",
        href: "/hub/inbox?tab=messages&message=m2",
      },
    ]);
    expect(inq.footer).toBe("7 messages this week");
    expect(inq.data.link).toEqual({ label: "Open Inbox", href: "/hub/inbox" });
    expect(d.defaultOrder).toEqual(["inquiries", "bookings"]);
  });

  it("Studio: the bookings card leads, and the core card is called Messages", async () => {
    const d = await cardsFor(owner, { path: async () => "studio" });
    expect(d.cards.map((c) => c.id)).toEqual(["bookings", "inquiries"]);
    expect(d.cards[1]!.title).toBe("Messages");
  });

  it("the person's layout reorders and hides; hidden cards are not loaded", async () => {
    const d = await cardsFor(owner, {
      prefs: Promise.resolve(
        prefs({ todayLayout: { order: ["bookings"], hidden: ["inquiries"] } }),
      ),
    });
    expect(d.cards.map((c) => c.id)).toEqual(["bookings"]);
    expect(d.hidden).toEqual(["inquiries"]);
    expect(d.all.map((c) => c.id)).toEqual(["bookings", "inquiries"]);
    expect(db.listSubmissions).not.toHaveBeenCalled();
  });

  it("a provider that throws drops only that card (error line)", async () => {
    bookingsCard.mockRejectedValueOnce(new Error("boom"));
    const d = await cardsFor(owner);
    expect(d.cards.map((c) => [c.id, c.state])).toEqual([
      ["inquiries", "ok"],
      ["bookings", "error"],
    ]);
  });

  it("an Editor without the add-on grant never gets its card (provider not called)", async () => {
    const d = await cardsFor(editor);
    expect(d.cards.map((c) => c.id)).toEqual(["inquiries"]);
    expect(bookingsCard).not.toHaveBeenCalled();
    const granted = await cardsFor({ ...editor, grants: ["studio-booking"] });
    expect(granted.cards.map((c) => c.id)).toEqual(["inquiries", "bookings"]);
  });

  it("a Staff member gets only their add-on card (no Inbox access)", async () => {
    const d = await cardsFor({ ...staffMember, grants: ["studio-booking"] });
    expect(d.cards.map((c) => c.id)).toEqual(["bookings"]);
  });

  it("Viewers get no cards section", async () => {
    expect(await loadTodayCards(viewer as never, deps())).toEqual({
      ok: true,
      data: null,
    });
  });

  it("unreadable add-on state: core card only", async () => {
    const d = await cardsFor(owner, { providers: async () => null });
    expect(d.cards.map((c) => c.id)).toEqual(["inquiries"]);
  });

  it("cleanCardData keeps 4 rows and only hub hrefs", () => {
    const out = cleanCardData(
      {
        title: "X",
        rows: Array.from({ length: 6 }, (_, i) => ({
          label: `r${i}`,
          value: "1",
          href: i === 0 ? "https://evil.example" : "/hub/x",
        })),
        link: { label: "Go", href: "javascript:alert(1)" },
      },
      "Fallback",
    );
    expect(out.rows).toHaveLength(4);
    expect(out.rows[0]!.href).toBeUndefined();
    expect(out.rows[1]!.href).toBe("/hub/x");
    expect(out.link.href).toBe("");
  });
});

describe("loadFromCds", () => {
  it("announcement beats everything else", async () => {
    db.activeAnnouncement.mockResolvedValue({
      id: "a1",
      title: "New: phone alerts",
      body: "Turn them on.",
      href: "",
    });
    const res = await loadFromCds(owner as never, deps());
    expect(res.ok && res.data?.card).toMatchObject({
      kind: "announcement",
      id: "announcement:a1",
      text: "Turn them on.",
      link: null,
    });
  });

  it("training for an add-on installed in the last 14 days, with its steps", async () => {
    db.recentAddonInstalls.mockResolvedValue([
      { slug: "testimonials", installedAt: "2026-10-05 10:00:00.000Z" },
    ]);
    const res = await loadFromCds(owner as never, deps());
    if (!res.ok || !res.data) throw new Error("no card");
    expect(res.data.card).toMatchObject({
      kind: "training",
      id: "training:testimonials",
      title: "Getting started with Testimonials",
    });
    expect(res.data.steps.length).toBeGreaterThan(0);
  });

  it("dismissed tips are skipped; a Viewer gets tips only", async () => {
    db.activeAnnouncement.mockResolvedValue({
      id: "a1",
      title: "T",
      body: "B",
      href: "",
    });
    const res = await loadFromCds(viewer as never, deps());
    expect(res.ok && res.data?.card.kind).toBe("tip");
    expect(db.activeAnnouncement).not.toHaveBeenCalled();
  });

  it("a suggested add-on only for the Owner, never for Admins or impersonating staff", async () => {
    const allTips = [
      "tip:reply-fast",
      "tip:fresh-photos",
      "tip:edit-a-page",
      "tip:bio-links",
      "tip:check-hours",
      "tip:weekly-numbers",
      "tip:phone-alerts",
      "tip:invite-help",
    ];
    const d = deps({ prefs: Promise.resolve(prefs({ dismissed: allTips })) });
    const own = await loadFromCds(owner as never, d);
    expect(own.ok && own.data?.card.kind).toBe("addon");
    const imp = await loadFromCds(impersonating as never, d);
    expect(imp.ok && imp.data).toBeNull();
  });

  it("tips never link to a screen the person can't open or that isn't built", () => {
    const tip = (href: string) => ({
      id: "x",
      title: "t",
      line: "l",
      link: { label: "Go", href },
    });
    expect(tipAllowed(tip("/hub/settings"), editor as never)).toBe(false);
    expect(tipAllowed(tip("/hub/settings"), owner as never)).toBe(true);
    expect(tipAllowed(tip("/hub/profile"), owner as never)).toBe(true);
    expect(tipAllowed(tip("/hub/profile"), editor as never)).toBe(true);
    expect(tipAllowed(tip("/hub/settings?tab=people"), owner as never)).toBe(
      true,
    );
    expect(tipAllowed(tip("/hub/settings?tab=people"), editor as never)).toBe(
      false,
    );
    expect(tipAllowed(tip("/hub/inbox"), editor as never)).toBe(true);
  });
});

describe("loadBuildWork", () => {
  it("open work orders only, Owner only", async () => {
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
      {
        id: "w2",
        title: "Done",
        status: "delivered",
        sentLabel: "1 Oct",
        totalCents: 1,
        href: "/hub/settings/quotes/w2",
        setup: null,
        acceptedLabel: "2 Oct",
      },
    ]);
    expect(await loadBuildWork(owner as never)).toEqual([
      {
        id: "w1",
        title: "Studio Booking setup",
        step: "setting_up",
        startedLabel: "2 Oct",
        href: "/hub/settings/quotes/w1",
      },
    ]);
    expect(await loadBuildWork(editor as never)).toEqual([]);
    db.listWorkOrders.mockRejectedValue(new Error("x"));
    expect(await loadBuildWork(owner as never)).toEqual([]);
  });
});

describe("saveTodayLayoutAction", () => {
  it("saves the person's layout", async () => {
    const r = await saveTodayLayoutAction({
      order: ["bookings", "inquiries"],
      hidden: [],
    });
    expect(r).toEqual({
      ok: true,
      data: { order: ["bookings", "inquiries"], hidden: [] },
    });
    expect(db.updateMemberPrefs).toHaveBeenCalledWith(owner, {
      todayLayout: { order: ["bookings", "inquiries"], hidden: [] },
    });
  });

  it("refuses under impersonation without writing", async () => {
    sess.getHubSession.mockResolvedValue({ ctx: impersonating, email: "" });
    const r = await saveTodayLayoutAction({ order: [], hidden: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("viewing as support staff");
    expect(db.updateMemberPrefs).not.toHaveBeenCalled();
  });

  it("refuses bad ids before @cds/db", async () => {
    for (const bad of [
      null,
      "x",
      { order: ["Bad Id"], hidden: [] },
      { order: [], hidden: ["x".repeat(81)] },
      { order: Array.from({ length: 101 }, (_, i) => `c${i}`), hidden: [] },
      { order: [1], hidden: [] },
    ]) {
      expect((await saveTodayLayoutAction(bad)).ok).toBe(false);
    }
    expect(db.updateMemberPrefs).not.toHaveBeenCalled();
  });
});

describe("dismissFromCdsAction", () => {
  it("records the dismissal for the person", async () => {
    expect(await dismissFromCdsAction("tip:reply-fast")).toEqual({
      ok: true,
      data: { dismissed: true },
    });
    expect(db.markDismissed).toHaveBeenCalledWith(owner, "tip:reply-fast");
  });

  it("refuses under impersonation and bad ids", async () => {
    sess.getHubSession.mockResolvedValue({ ctx: impersonating, email: "" });
    expect((await dismissFromCdsAction("tip:reply-fast")).ok).toBe(false);
    expect((await dismissFromCdsAction("<script>")).ok).toBe(false);
    expect(db.markDismissed).not.toHaveBeenCalled();
  });
});
