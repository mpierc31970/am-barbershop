// 13-37 Task 1: catalog actions (STAFF-07, D161, D264; T-13-37-03, T-13-37-04). @cds/db and the
// staff session are mocked; the real matrix (authorizeStaff inside runStaffAction), the real
// input checks and the real error mapping run.
import { InvalidInput } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sess = vi.hoisted(() => ({ getStaffSession: vi.fn() }));
const db = vi.hoisted(() => ({
  CATALOG_AVAILABILITIES: ["available", "coming_soon", "hidden"],
  isSafeAnnouncementHref: (h: string) =>
    h.startsWith("https://") || h.startsWith("/hub/"),
  priceCase: vi.fn(),
  setPrice: vi.fn(),
  setAnnouncement: vi.fn(),
  clearAnnouncement: vi.fn(),
  staffSaveListing: vi.fn(),
  staffMoveListing: vi.fn(),
  staffRemoveScreenshot: vi.fn(),
  publicCatalogView: vi.fn(),
}));
vi.mock("../lib/staff-session", () => sess);
vi.mock("@cds/db", () => db);
vi.mock("@cds/addon-registry/server", () => ({
  ADDON_REGISTRY: {
    list: () => [
      {
        slug: "builder-pro",
        name: "Builder Pro",
        summary: "More blocks.",
        visibility: "public",
        paths: ["standard", "studio"],
      },
    ],
    get: () => undefined,
  },
}));
vi.mock(
  "next/cache",
  async () => (await import("./staff-test-kit")).nextCacheMock,
);

const actions = await import("../app/actions/staff/catalog");
const { resetStaffKit } = await import("./staff-test-kit");

function session(role: "super_admin" | "support_agent", stepUpFresh = false) {
  return {
    ctx: { kind: "platform", actor: "u1", staffRole: role, ip: "203.0.113.21" },
    token: "tok",
    sessionId: "sess00000000001",
    stepUpFresh,
    name: "Lee Admin",
    role,
    maskedEmail: "l•••@example.test",
  };
}

const PRICE = {
  kind: "addon",
  key: "builder-pro",
  path: "standard",
  cents: 1900,
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStaffKit();
  sess.getStaffSession.mockResolvedValue(session("support_agent"));
  db.priceCase.mockResolvedValue({ currentCents: 1500, pathOrgs: 4 });
  db.setPrice.mockImplementation(async (_ctx, input) => ({
    before: null,
    after: {
      itemKind: input.kind,
      itemKey: input.key,
      path: input.path,
      monthlyCents: input.monthlyCents ?? null,
      oneTimeCents: input.oneTimeCents ?? null,
      installments: null,
    },
    synced: 1,
  }));
  db.setAnnouncement.mockResolvedValue({ id: "ann000000000001", ended: [] });
  db.clearAnnouncement.mockResolvedValue({ ended: ["ann000000000001"] });
  db.staffMoveListing.mockResolvedValue([{ slug: "builder-pro" }]);
});

describe("savePriceAction", () => {
  it("agent → REFUSED-ROLE; setPrice never called", async () => {
    const res = await actions.savePriceAction(PRICE);
    expect(res).toMatchObject({
      ok: false,
      code: "forbidden",
      message: P13_COPY.REFUSED_ROLE,
    });
    expect(db.setPrice).not.toHaveBeenCalled();
  });

  it("super_admin with a stale step-up → step_up_needed; nothing read or saved", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await actions.savePriceAction(PRICE);
    expect(res).toMatchObject({ ok: false, code: "step_up_needed" });
    expect(db.priceCase).not.toHaveBeenCalled();
    expect(db.setPrice).not.toHaveBeenCalled();
  });

  it("fresh super_admin → setPrice gets exactly what prices:set passes (monthly kind)", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.savePriceAction(PRICE);
    expect(res).toEqual({
      ok: true,
      data: { message: "Price saved. New quotes use $19.00/mo." },
    });
    expect(db.setPrice).toHaveBeenCalledTimes(1);
    const [ctx, input] = db.setPrice.mock.calls[0]!;
    expect(ctx).toMatchObject({ kind: "platform", staffRole: "super_admin" });
    expect(input).toEqual({
      kind: "addon",
      key: "builder-pro",
      path: "standard",
      monthlyCents: 1900,
    });
  });

  it("one-time kinds pass oneTimeCents; null = Price coming soon", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    await actions.savePriceAction({
      kind: "build_fee",
      key: "base",
      path: "studio",
      cents: 150000,
    });
    expect(db.setPrice.mock.calls[0]![1]).toEqual({
      kind: "build_fee",
      key: "base",
      path: "studio",
      oneTimeCents: 150000,
    });
    const res = await actions.savePriceAction({
      kind: "plan",
      key: "base",
      path: "standard",
      cents: null,
    });
    expect(db.setPrice.mock.calls[1]![1]).toEqual({
      kind: "plan",
      key: "base",
      path: "standard",
      monthlyCents: null,
    });
    expect(res).toMatchObject({
      ok: true,
      data: { message: "Price saved. New quotes show “Price coming soon”." },
    });
  });

  it("an add-on crossing $0 needs sitesChecked", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.savePriceAction({ ...PRICE, cents: 0 });
    expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.setPrice).not.toHaveBeenCalled();
    const ok = await actions.savePriceAction({
      ...PRICE,
      cents: 0,
      sitesChecked: true,
    });
    expect(ok.ok).toBe(true);
    expect(db.setPrice.mock.calls[0]![1]).toMatchObject({ monthlyCents: 0 });
  });

  it("refuses unknown keys, Studio Booking on Standard and bad cents before signing anything", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    for (const bad of [
      { ...PRICE, key: "no-such-addon" },
      { ...PRICE, key: "studio-booking-solo", path: "standard" },
      { ...PRICE, cents: 19.5 },
      { ...PRICE, cents: -1 },
      { ...PRICE, kind: "nope" },
      { ...PRICE, path: "both" },
    ]) {
      const res = await actions.savePriceAction(bad);
      expect(res).toMatchObject({ ok: false, code: "invalid_input" });
    }
    expect(db.setPrice).not.toHaveBeenCalled();
  });
});

describe("previewPriceAction", () => {
  it("returns the priceCase: old, new, sites affected", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.previewPriceAction(PRICE);
    expect(res).toEqual({
      ok: true,
      data: {
        label: "Builder Pro",
        pathLabel: "Standard",
        monthly: true,
        oldText: "$15.00/mo",
        newText: "$19.00/mo",
        oldCents: 1500,
        newCents: 1900,
        newProviderPrice: true,
        crossesZero: false,
        toFree: false,
        pathOrgs: 4,
      },
    });
    expect(db.priceCase.mock.calls[0]![1]).toEqual({
      kind: "addon",
      key: "builder-pro",
      path: "standard",
    });
  });

  it("flags an add-on going to $0", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.previewPriceAction({ ...PRICE, cents: 0 });
    expect(res).toMatchObject({
      ok: true,
      data: { crossesZero: true, toFree: true, newText: "$0.00/mo" },
    });
  });

  it("agent → REFUSED-ROLE", async () => {
    const res = await actions.previewPriceAction(PRICE);
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(db.priceCase).not.toHaveBeenCalled();
  });
});

describe("listings", () => {
  it("agents may save a listing; input reaches staffSaveListing with registry manifests", async () => {
    db.staffSaveListing.mockResolvedValue({ slug: "builder-pro" });
    const res = await actions.saveListingAction({
      slug: "builder-pro",
      tagline: "Build more.",
      description: "",
      availability: "coming_soon",
      screenshots: [{ id: "shot00000000001", alt: "The editor" }],
    });
    expect(res.ok).toBe(true);
    const [, input, manifests] = db.staffSaveListing.mock.calls[0]!;
    expect(input).toEqual({
      slug: "builder-pro",
      tagline: "Build more.",
      description: "",
      availability: "coming_soon",
      screenshots: [{ id: "shot00000000001", alt: "The editor" }],
    });
    expect(manifests).toEqual([
      {
        slug: "builder-pro",
        name: "Builder Pro",
        summary: "More blocks.",
        visibility: "public",
        path: "both",
        premium: false,
      },
    ]);
  });

  it("refuses a bad availability and a bad slug", async () => {
    expect(
      await actions.saveListingAction({
        slug: "builder-pro",
        tagline: "",
        description: "",
        availability: "gone",
      }),
    ).toMatchObject({ ok: false, field: "availability" });
    expect(await actions.moveListingAction("../x", "up")).toMatchObject({
      ok: false,
    });
    expect(db.staffSaveListing).not.toHaveBeenCalled();
    expect(db.staffMoveListing).not.toHaveBeenCalled();
  });

  it("db InvalidInput copy reaches the console", async () => {
    db.staffRemoveScreenshot.mockRejectedValue(
      new InvalidInput("That screenshot wasn't found."),
    );
    const res = await actions.removeScreenshotAction(
      "builder-pro",
      "shot00000000001",
    );
    expect(res).toMatchObject({
      ok: false,
      code: "invalid_input",
      message: "That screenshot wasn't found.",
    });
  });

  it("move returns the new order", async () => {
    const res = await actions.moveListingAction("builder-pro", "down");
    expect(res).toEqual({ ok: true, data: { order: ["builder-pro"] } });
    expect(db.staffMoveListing.mock.calls[0]!.slice(1, 3)).toEqual([
      "builder-pro",
      "down",
    ]);
  });
});

describe("announcement", () => {
  it("agent → REFUSED-ROLE", async () => {
    const res = await actions.setAnnouncementAction({ title: "Hi", days: 7 });
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(await actions.clearAnnouncementAction()).toMatchObject({
      ok: false,
      code: "forbidden",
    });
  });

  it("super stale → step_up_needed", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", false));
    const res = await actions.setAnnouncementAction({ title: "Hi", days: 7 });
    expect(res).toMatchObject({ ok: false, code: "step_up_needed" });
  });

  it("fresh → setAnnouncement with the announce:set shape", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const res = await actions.setAnnouncementAction({
      title: "  New: page packs ",
      body: "Five more pages for $10/mo.",
      href: "/hub/billing",
      paths: ["standard", "standard"],
      days: 14,
    });
    expect(res.ok).toBe(true);
    const [, input, clock] = db.setAnnouncement.mock.calls[0]!;
    expect(input).toMatchObject({
      title: "New: page packs",
      body: "Five more pages for $10/mo.",
      href: "/hub/billing",
      paths: ["standard"],
    });
    const now = clock.now() as Date;
    expect(input.startsAt).toEqual(now);
    expect((input.endsAt as Date).getTime() - now.getTime()).toBe(
      14 * 86_400_000,
    );
  });

  it("refuses a bad link and odd days", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(
      await actions.setAnnouncementAction({
        title: "Hi",
        href: "javascript:alert(1)",
      }),
    ).toMatchObject({ ok: false, field: "href" });
    expect(
      await actions.setAnnouncementAction({ title: "Hi", days: 9 }),
    ).toMatchObject({ ok: false, field: "days" });
    expect(db.setAnnouncement).not.toHaveBeenCalled();
  });

  it("WR-C05: an Undo end date is bounded: no null, not past 30 days, not in the past", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(
      await actions.setAnnouncementAction({ title: "Hi", endsAt: null }),
    ).toMatchObject({ ok: false, field: "days" });
    expect(
      await actions.setAnnouncementAction({
        title: "Hi",
        endsAt: "9999-12-31T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(
      await actions.setAnnouncementAction({
        title: "Hi",
        endsAt: new Date(Date.now() - 60_000).toISOString(),
      }),
    ).toMatchObject({ ok: false, code: "invalid_input" });
    expect(db.setAnnouncement).not.toHaveBeenCalled();
    const end = new Date(Date.now() + 3 * 86_400_000).toISOString();
    expect(
      await actions.setAnnouncementAction({ title: "Hi", endsAt: end }),
    ).toMatchObject({ ok: true });
    expect(
      (db.setAnnouncement.mock.calls[0]![1].endsAt as Date).toISOString(),
    ).toBe(end);
  });

  it("WR-C06: a revalidation error after the write still reports saved", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    const kitMod = await import("./staff-test-kit");
    const spy = vi
      .spyOn(kitMod.nextCacheMock, "revalidatePath")
      .mockImplementation(() => {
        throw new Error("revalidate boom");
      });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await actions.setAnnouncementAction({ title: "Hi", days: 7 }),
      ).toMatchObject({ ok: true });
      expect(await actions.clearAnnouncementAction()).toMatchObject({
        ok: true,
      });
      expect(
        await actions.moveListingAction("fixture-open", "up"),
      ).toBeDefined();
      expect(db.setAnnouncement).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  });

  it("clear ends the announcement", async () => {
    sess.getStaffSession.mockResolvedValue(session("super_admin", true));
    expect(await actions.clearAnnouncementAction()).toEqual({
      ok: true,
      data: { ended: 1 },
    });
  });
});
