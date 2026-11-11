import { describe, expect, it } from "vitest";
import {
  CORE_CARD_IDS,
  CORE_TIPS,
  defaultCardOrder,
  groupCounts,
  isHubHref,
  isLive,
  pickFromCds,
  sortNeedsYou,
  STAGE_LINE,
  type NeedsYouItem,
} from "./index";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function item(p: Partial<NeedsYouItem> & { key: string }): NeedsYouItem {
  return {
    kind: "test",
    level: "normal",
    title: p.key,
    actionLabel: "Open",
    href: "/hub/inbox",
    section: "inbox",
    at: ago(0),
    ...p,
  };
}

describe("sortNeedsYou", () => {
  it("puts urgent first, then oldest first", () => {
    const a = item({ key: "a", at: ago(1) });
    const b = item({ key: "b", level: "urgent", at: ago(0) });
    const c = item({ key: "c", at: ago(2) });
    expect(sortNeedsYou([a, b, c]).map((i) => i.key)).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by key and never mutates the input", () => {
    const at = ago(1);
    const input = [item({ key: "z", at }), item({ key: "m", at })];
    expect(sortNeedsYou(input).map((i) => i.key)).toEqual(["m", "z"]);
    expect(input.map((i) => i.key)).toEqual(["z", "m"]);
  });
});

describe("groupCounts", () => {
  it("counts by section and by section:tab", () => {
    const counts = groupCounts([
      item({ key: "1", section: "inbox", tab: "all" }),
      item({ key: "2", section: "inbox", tab: "all" }),
      item({ key: "3", section: "settings", tab: "billing" }),
      item({ key: "4", section: "addon:events" }),
    ]);
    expect(counts.bySection).toEqual({
      inbox: 2,
      settings: 1,
      "addon:events": 1,
    });
    expect(counts.byTab).toEqual({ "inbox:all": 2, "settings:billing": 1 });
  });
});

describe("isHubHref", () => {
  it("accepts only relative /hub/ links", () => {
    expect(isHubHref("/hub/inbox?tab=all")).toBe(true);
    expect(isHubHref("/hub")).toBe(true);
    expect(isHubHref("https://evil")).toBe(false);
    expect(isHubHref("//x")).toBe(false);
    expect(isHubHref("/hub//evil.com")).toBe(false);
    expect(isHubHref("/hubx")).toBe(false);
    expect(isHubHref("/hub/\\evil")).toBe(false);
    expect(isHubHref("javascript:alert(1)")).toBe(false);
  });

  it("refuses dot segments that would normalise out of /hub (WR-C03)", () => {
    for (const bad of [
      "/hub/../api/jobs/alerts",
      "/hub/..",
      "/hub/./x",
      "/hub/%2e%2e/sign-out",
      "/hub/%2E%2E/sign-out",
      "/hub/.%2e/x",
      "/hub/%2e./x",
      "/hub/inbox/../../api",
      "/hub/..%2fapi",
      "/hub/%5c..",
    ]) {
      expect(isHubHref(bad), bad).toBe(false);
    }
    expect(isHubHref("/hub/inbox/a..b")).toBe(true);
    expect(isHubHref("/hub/help/v1.2")).toBe(true);
    expect(isHubHref("/hub/inbox?q=../x")).toBe(true);
  });
});

describe("isLive / STAGE_LINE", () => {
  it("is the one pre-launch predicate", () => {
    expect(isLive("live")).toBe(true);
    expect(isLive("being_built")).toBe(false);
    expect(isLive("ready_for_review")).toBe(false);
    expect(isLive("")).toBe(false);
  });

  it("maps stages to status words", () => {
    expect(STAGE_LINE.being_built).toBe("Being built");
    expect(STAGE_LINE.ready_for_build).toBe("Being built");
    expect(STAGE_LINE.ready_for_review).toBe("Ready for your review");
    expect(STAGE_LINE.live).toBe("Live");
  });
});

describe("defaultCardOrder", () => {
  const avail = [
    { id: "inquiries", order: 0 },
    { id: "bookings", order: 10 },
  ];

  it("leads with the path card", () => {
    expect(CORE_CARD_IDS).toEqual(["inquiries"]);
    expect(defaultCardOrder("studio", avail).visible).toEqual([
      "bookings",
      "inquiries",
    ]);
    expect(defaultCardOrder("standard", avail).visible).toEqual([
      "inquiries",
      "bookings",
    ]);
  });

  it("falls back to manifest order", () => {
    const r = defaultCardOrder("shop", [
      { id: "b", order: 20 },
      { id: "a", order: 5 },
      { id: "orders", order: 30 },
      { id: "inquiries", order: 0 },
    ]);
    expect(r.visible).toEqual(["orders", "inquiries", "a", "b"]);
  });

  it("applies hidden and order prefs, ignoring unknown ids", () => {
    const hidden = defaultCardOrder("studio", avail, {
      order: [],
      hidden: ["inquiries"],
    });
    expect(hidden).toEqual({ visible: ["bookings"], hidden: ["inquiries"] });

    const ordered = defaultCardOrder("studio", avail, {
      order: ["ghost", "inquiries", "bookings"],
      hidden: ["ghost"],
    });
    expect(ordered).toEqual({ visible: ["inquiries", "bookings"], hidden: [] });
  });

  it("puts cards missing from saved order after the saved ones", () => {
    const r = defaultCardOrder(
      "standard",
      [...avail, { id: "orders", order: 5 }],
      { order: ["bookings"], hidden: [] },
    );
    expect(r.visible).toEqual(["bookings", "inquiries", "orders"]);
  });
});

describe("pickFromCds", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const announcement = { id: "a1", title: "New", text: "Hello", link: null };
  const training = [
    {
      slug: "events",
      name: "Events",
      line: "Run events.",
      installedAt: "2026-10-05T00:00:00Z",
    },
  ];
  const suggestedAddon = {
    slug: "newsletter",
    name: "Newsletter",
    summary: "Send news.",
  };

  it("prefers the announcement", () => {
    const r = pickFromCds({
      announcement,
      recentAddonTraining: training,
      tips: CORE_TIPS,
      suggestedAddon,
      dismissed: [],
      now,
    });
    expect(r?.kind).toBe("announcement");
    expect(r?.id).toBe("announcement:a1");
  });

  it("skips dismissed ids to the next priority", () => {
    const r = pickFromCds({
      announcement,
      recentAddonTraining: training,
      tips: CORE_TIPS,
      suggestedAddon,
      dismissed: ["announcement:a1"],
      now,
    });
    expect(r?.kind).toBe("training");
    expect(r?.id).toBe("training:events");
  });

  it("ignores training older than 14 days", () => {
    const old = [{ ...training[0]!, installedAt: "2026-09-20T00:00:00Z" }];
    const r = pickFromCds({
      announcement: null,
      recentAddonTraining: old,
      tips: CORE_TIPS,
      suggestedAddon,
      dismissed: [],
      now,
    });
    expect(r?.kind).toBe("tip");
  });

  it("rotates tips by week, deterministically", () => {
    const a = pickFromCds({
      announcement: null,
      recentAddonTraining: [],
      tips: CORE_TIPS,
      suggestedAddon: null,
      dismissed: [],
      now,
    });
    const b = pickFromCds({
      announcement: null,
      recentAddonTraining: [],
      tips: CORE_TIPS,
      suggestedAddon: null,
      dismissed: [],
      now: new Date("2026-10-12T12:00:00Z"),
    });
    const again = pickFromCds({
      announcement: null,
      recentAddonTraining: [],
      tips: CORE_TIPS,
      suggestedAddon: null,
      dismissed: [],
      now,
    });
    expect(a?.id).toBe(again?.id);
    expect(a?.id).not.toBe(b?.id);
  });

  it("falls to the suggested add-on when every tip is dismissed", () => {
    const r = pickFromCds({
      announcement: null,
      recentAddonTraining: [],
      tips: CORE_TIPS,
      suggestedAddon,
      dismissed: CORE_TIPS.map((t) => `tip:${t.id}`),
      now,
    });
    expect(r).toMatchObject({
      kind: "addon",
      id: "addon:newsletter",
      href: "/hub/add-ons/newsletter",
    });
  });

  it("returns null when nothing is left", () => {
    expect(
      pickFromCds({
        announcement: null,
        recentAddonTraining: [],
        tips: [],
        suggestedAddon: null,
        dismissed: [],
        now,
      }),
    ).toBeNull();
  });

  it("core tips are plain and link inside the hub", () => {
    expect(CORE_TIPS.length).toBeGreaterThanOrEqual(6);
    for (const t of CORE_TIPS) expect(isHubHref(t.link.href)).toBe(true);
    expect(new Set(CORE_TIPS.map((t) => t.id)).size).toBe(CORE_TIPS.length);
  });
});
