import { describe, expect, it } from "vitest";
import { lockCovers, noticeText, windowPhase, windowReaches } from "./windows";
import type { ServiceWindowRule } from "./windows";

const H = 3_600_000;
const now = new Date("2026-10-12T15:00:00Z"); // Mon 10:00 CDT

function w(over: Partial<ServiceWindowRule>): ServiceWindowRule {
  return {
    scope: "organization",
    org_id: "org1",
    addon: "",
    page: "",
    component: "",
    message: "",
    starts_at: new Date(now.getTime() - H).toISOString(),
    ends_at: new Date("2026-10-12T21:00:00Z").toISOString(), // 16:00 CDT
    cleared_at: null,
    ...over,
  };
}

describe("windowPhase", () => {
  it("active, upcoming within 24 h, null beyond, ended", () => {
    expect(windowPhase(w({}), now)).toBe("active");
    const at = (h: number) => new Date(now.getTime() + h * H).toISOString();
    expect(windowPhase(w({ starts_at: at(23), ends_at: at(30) }), now)).toBe(
      "upcoming",
    );
    expect(windowPhase(w({ starts_at: at(25), ends_at: at(30) }), now)).toBe(
      null,
    );
    expect(windowPhase(w({ starts_at: at(-5), ends_at: at(-1) }), now)).toBe(
      "ended",
    );
    expect(windowPhase(w({ cleared_at: at(-0.5) }), now)).toBe("ended");
  });
});

describe("windowReaches", () => {
  const who = { orgId: "org1", activeAddons: ["appointments"] };

  it("platform reaches everyone", () => {
    expect(windowReaches(w({ scope: "platform", org_id: "" }), who)).toBe(true);
  });

  it("add-on reaches only orgs with it active", () => {
    const aw = w({ scope: "addon", org_id: "", addon: "appointments" });
    expect(windowReaches(aw, who)).toBe(true);
    expect(windowReaches(aw, { orgId: "org1", activeAddons: [] })).toBe(false);
  });

  it("organization, page and component reach only their org", () => {
    for (const scope of ["organization", "page", "component"] as const) {
      expect(windowReaches(w({ scope }), who)).toBe(true);
      expect(windowReaches(w({ scope }), { ...who, orgId: "org2" })).toBe(
        false,
      );
    }
  });
});

describe("lockCovers", () => {
  it("platform and organization cover every content target", () => {
    for (const scope of ["platform", "organization"] as const) {
      const lw = w({ scope });
      expect(lockCovers(lw, { kind: "content" })).toBe(true);
      expect(lockCovers(lw, { kind: "page", id: "p1" })).toBe(true);
      expect(lockCovers(lw, { kind: "part", key: "footer" })).toBe(true);
      expect(lockCovers(lw, { kind: "addon", slug: "events" })).toBe(true);
    }
  });

  it("page covers that page only", () => {
    const pw = w({ scope: "page", page: "p1" });
    expect(lockCovers(pw, { kind: "page", id: "p1" })).toBe(true);
    expect(lockCovers(pw, { kind: "page", id: "p2" })).toBe(false);
    expect(lockCovers(pw, { kind: "part", key: "footer" })).toBe(false);
    expect(lockCovers(pw, { kind: "content" })).toBe(false);
  });

  it("add-on covers its slug", () => {
    const aw = w({ scope: "addon", addon: "events" });
    expect(lockCovers(aw, { kind: "addon", slug: "events" })).toBe(true);
    expect(lockCovers(aw, { kind: "addon", slug: "store" })).toBe(false);
    expect(lockCovers(aw, { kind: "page", id: "p1" })).toBe(false);
  });

  it("component covers that part or add-on slug", () => {
    const cw = w({ scope: "component", component: "footer" });
    expect(lockCovers(cw, { kind: "part", key: "footer" })).toBe(true);
    expect(lockCovers(cw, { kind: "part", key: "header" })).toBe(false);
    const ca = w({ scope: "component", component: "events" });
    expect(lockCovers(ca, { kind: "addon", slug: "events" })).toBe(true);
    expect(lockCovers(ca, { kind: "page", id: "events" })).toBe(false);
  });
});

describe("noticeText", () => {
  it("active organization window ending 16:00 today", () => {
    const t = noticeText(w({ message: "Fixing your menu." }), {}, now);
    expect(t).toContain("CDS is working on your site until 4:00 pm");
    expect(t).toBe(
      "CDS is working on your site until 4:00 pm. Fixing your menu.",
    );
  });

  it("names the target in owner words", () => {
    expect(noticeText(w({ scope: "platform" }), {}, now)).toContain(
      "on the CDS platform until",
    );
    expect(
      noticeText(
        w({ scope: "addon", addon: "events" }),
        { addonName: "Events" },
        now,
      ),
    ).toContain("on Events until");
    expect(
      noticeText(
        w({ scope: "page", page: "p1" }),
        { pageTitle: "About us" },
        now,
      ),
    ).toContain("on your About us page until");
    expect(
      noticeText(
        w({ scope: "component", component: "header" }),
        { componentLabel: "Header" },
        now,
      ),
    ).toContain("on your Header until");
  });

  it("never shows a raw slug or key when a label is missing (IN-B06)", () => {
    expect(
      noticeText(w({ scope: "addon", addon: "studio-booking" }), {}, now),
    ).toContain("on an add-on until");
    expect(
      noticeText(w({ scope: "component", component: "menus" }), {}, now),
    ).toContain("on your Menus until");
    expect(
      noticeText(w({ scope: "component", component: "widget-x" }), {}, now),
    ).toContain("on your site until");
  });

  it("ends tomorrow or later in business time", () => {
    expect(
      noticeText(w({ ends_at: "2026-10-13T14:00:00Z" }), {}, now),
    ).toContain("until tomorrow at 9:00 am");
    expect(
      noticeText(w({ ends_at: "2026-10-15T14:00:00Z" }), {}, now),
    ).toContain("until Thu 15 Oct at 9:00 am");
  });

  it("planned work shows the window", () => {
    const t = noticeText(
      w({
        starts_at: "2026-10-13T02:00:00Z", // Mon 21:00 CDT
        ends_at: "2026-10-13T04:00:00Z", // Mon 23:00 CDT
        message: "Short pause.",
      }),
      {},
      now,
    );
    expect(t).toBe(
      "Planned work on your site Mon 12 Oct, 9:00–11:00 pm. Short pause.",
    );
  });

  it("keeps $ patterns and braces in a page title or message literal (WR-B03)", () => {
    expect(
      noticeText(
        w({ scope: "page", page: "p1", message: "Prices drop $' tomorrow." }),
        { pageTitle: "A $& {end} page" },
        now,
      ),
    ).toBe(
      "CDS is working on your A $& {end} page page until 4:00 pm. Prices drop $' tomorrow.",
    );
    expect(
      noticeText(
        w({
          scope: "page",
          page: "p1",
          starts_at: "2026-10-13T02:00:00Z",
          ends_at: "2026-10-13T04:00:00Z",
          message: "$$ {message} $`",
        }),
        { pageTitle: "{when}" },
        now,
      ),
    ).toBe(
      "Planned work on your {when} page Mon 12 Oct, 9:00–11:00 pm. $$ {message} $`",
    );
  });

  it("null when ended or too far ahead", () => {
    expect(
      noticeText(w({ ends_at: "2026-10-12T14:00:00Z" }), {}, now),
    ).toBeNull();
  });
});
