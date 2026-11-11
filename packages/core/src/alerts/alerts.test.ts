import { describe, expect, it } from "vitest";
import type { AuthSubject } from "../permissions";
import {
  CORE_ALERT_TYPES,
  SENSITIVE_BY_DEFAULT,
  alertSubject,
  channelsFor,
  composeAlertTypes,
  eligibleFor,
  sensitivePracticeOn,
  type AlertTypeSpec,
} from "./index";

const spec = (type: string): AlertTypeSpec => {
  const s = CORE_ALERT_TYPES.find((t) => t.type === type);
  if (!s) throw new Error(`missing ${type}`);
  return s;
};

const who = (
  role: AuthSubject["role"],
  grants: string[] = [],
): AuthSubject => ({
  role,
  grants,
});

describe("CORE_ALERT_TYPES", () => {
  it("holds the P11 core types with D313 levels", () => {
    const levels = Object.fromEntries(
      CORE_ALERT_TYPES.map((t) => [t.type, t.level]),
    );
    expect(levels).toEqual({
      "form.message": "normal",
      "billing.card_failed": "urgent",
      "payments.payouts_paused": "urgent",
      "site.stage": "normal",
      "data_export.ready": "normal",
      "contact.new": "summary",
      "cds.notice": "urgent",
      "reports.monthly": "summary",
      "support.reply": "normal",
      "support.status": "normal",
      "cds.message": "normal",
      "cds.note": "normal",
      "cds.document": "normal",
      "cds.idea_built": "normal",
      "site.suspension_notice": "urgent",
      "domain.your_turn": "normal",
      "domain.connected": "normal",
      "domain.switch_back": "urgent",
      "domain.lost_delegation": "urgent",
      "domain.expiry": "urgent",
      "offboarding.started": "normal",
      "offboarding.handed_back": "normal",
    });
  });

  it("P14 domain and leaving alerts reach Owners and Admins only (14-03 choice 3)", () => {
    for (const type of [
      "domain.your_turn",
      "domain.connected",
      "domain.switch_back",
      "domain.lost_delegation",
      "domain.expiry",
      "offboarding.started",
      "offboarding.handed_back",
    ]) {
      const s = spec(type);
      expect(s.section, type).toBe("settings");
      expect(eligibleFor(who("owner"), s), type).toBe(true);
      expect(eligibleFor(who("admin"), s), type).toBe(true);
      expect(eligibleFor(who("editor"), s), type).toBe(false);
      expect(eligibleFor(who("viewer"), s), type).toBe(false);
    }
    expect(spec("offboarding.started").feature).toBe("offboarding");
    expect(spec("domain.expiry").feature).toBe("domain");
  });

  it("every type has a label, example, feature, access and section", () => {
    for (const t of CORE_ALERT_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.example.length).toBeGreaterThan(0);
      expect(t.feature.length).toBeGreaterThan(0);
      expect(["read", "write", "run"]).toContain(t.access);
      expect(t.section.length).toBeGreaterThan(0);
    }
  });

  it("summary types never default to push", () => {
    for (const t of CORE_ALERT_TYPES.filter((x) => x.level === "summary")) {
      expect(t.defaultChannels.push).toBe(false);
    }
  });

  it("data_export.ready defaults to push only (its own email is sent by 11-40)", () => {
    expect(spec("data_export.ready").defaultChannels).toEqual({
      email: false,
      push: true,
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(CORE_ALERT_TYPES)).toBe(true);
  });
});

describe("channelsFor", () => {
  it("uses defaults with no prefs", () => {
    expect(channelsFor(spec("form.message"), undefined)).toEqual({
      bell: true,
      email: true,
      push: true,
    });
  });

  it("applies a person's override", () => {
    expect(
      channelsFor(spec("form.message"), { "form.message": { email: false } }),
    ).toEqual({ bell: true, email: false, push: true });
  });

  it("ignores overrides for other types", () => {
    expect(
      channelsFor(spec("form.message"), { "contact.new": { email: false } }),
    ).toEqual({ bell: true, email: true, push: true });
  });

  it("never pushes a summary type, even when prefs ask for it", () => {
    expect(
      channelsFor(spec("contact.new"), { "contact.new": { push: true } }),
    ).toEqual({ bell: true, email: true, push: false });
  });

  it("the bell cannot be switched off", () => {
    const prefs = { "form.message": { bell: false } } as unknown as Record<
      string,
      { email?: boolean; push?: boolean }
    >;
    expect(channelsFor(spec("form.message"), prefs).bell).toBe(true);
  });

  it("ignores non-boolean override values", () => {
    const prefs = { "form.message": { email: "no" } } as unknown as Record<
      string,
      { email?: boolean; push?: boolean }
    >;
    expect(channelsFor(spec("form.message"), prefs).email).toBe(true);
  });
});

describe("eligibleFor", () => {
  it("billing alerts reach Owners only", () => {
    expect(eligibleFor(who("owner"), spec("billing.card_failed"))).toBe(true);
    expect(eligibleFor(who("admin"), spec("billing.card_failed"))).toBe(false);
    expect(eligibleFor(who("editor"), spec("billing.card_failed"))).toBe(false);
  });

  it("data exports are Owner only", () => {
    expect(eligibleFor(who("owner"), spec("data_export.ready"))).toBe(true);
    expect(eligibleFor(who("admin"), spec("data_export.ready"))).toBe(false);
  });

  it("follows the matrix: contacts:read excludes viewers", () => {
    expect(eligibleFor(who("viewer"), spec("contact.new"))).toBe(false);
    expect(eligibleFor(who("admin"), spec("contact.new"))).toBe(true);
    expect(eligibleFor(who("staff"), spec("form.message"))).toBe(true);
  });

  it("payouts paused: Owner only (11-24: its Needs-you item is the Owner's)", () => {
    expect(eligibleFor(who("owner"), spec("payments.payouts_paused"))).toBe(
      true,
    );
    expect(eligibleFor(who("admin"), spec("payments.payouts_paused"))).toBe(
      false,
    );
    expect(eligibleFor(who("editor"), spec("payments.payouts_paused"))).toBe(
      false,
    );
  });

  it("monthly report reaches everyone who can open Reports (11-24)", () => {
    for (const r of ["owner", "admin", "editor", "viewer"] as const) {
      expect(eligibleFor(who(r), spec("reports.monthly"))).toBe(true);
    }
  });

  it("site stage and CDS notices reach Owner, Admin and Editor", () => {
    expect(eligibleFor(who("editor"), spec("site.stage"))).toBe(true);
    expect(eligibleFor(who("editor"), spec("cds.notice"))).toBe(true);
  });

  it("Viewers get Summary types only (11-24, UI-SPEC Profile)", () => {
    const viewer = CORE_ALERT_TYPES.filter((t) =>
      eligibleFor(who("viewer"), t),
    );
    expect(viewer.map((t) => t.type)).toEqual(["reports.monthly"]);
    expect(viewer.every((t) => t.level === "summary")).toBe(true);
  });

  it("form messages follow D285 form PII: Owner and Admin, not Editor or Viewer", () => {
    expect(eligibleFor(who("admin"), spec("form.message"))).toBe(true);
    expect(eligibleFor(who("editor"), spec("form.message"))).toBe(false);
    expect(eligibleFor(who("viewer"), spec("form.message"))).toBe(false);
  });

  it("add-on types follow grants", () => {
    const booking: AlertTypeSpec = {
      type: "booking.new",
      level: "normal",
      label: "New booking",
      example: "A booking further out",
      feature: "addon:studio-booking",
      access: "read",
      section: "addon:studio-booking",
      defaultChannels: { email: true, push: true },
    };
    expect(eligibleFor(who("staff"), booking)).toBe(false);
    expect(eligibleFor(who("staff", ["studio-booking"]), booking)).toBe(true);
  });
});

describe("composeAlertTypes", () => {
  const booking: AlertTypeSpec = {
    type: "booking.new",
    level: "normal",
    label: "New booking",
    example: "A booking further out",
    feature: "addon:studio-booking",
    access: "read",
    section: "addon:studio-booking",
    defaultChannels: { email: true, push: true },
  };

  it("returns core types with no manifests", () => {
    expect(composeAlertTypes([]).map((t) => t.type)).toEqual(
      CORE_ALERT_TYPES.map((t) => t.type),
    );
  });

  it("adds manifest alerts after the core types", () => {
    const all = composeAlertTypes([
      { slug: "studio-booking", alerts: [booking] },
      { slug: "newsletter" },
    ]);
    expect(all).toHaveLength(CORE_ALERT_TYPES.length + 1);
    expect(all.at(-1)?.type).toBe("booking.new");
  });

  it("throws on a duplicate type", () => {
    expect(() =>
      composeAlertTypes([
        { slug: "x", alerts: [{ ...booking, type: "form.message" }] },
      ]),
    ).toThrow(/form\.message/);
    expect(() =>
      composeAlertTypes([
        { slug: "a", alerts: [booking] },
        { slug: "b", alerts: [booking] },
      ]),
    ).toThrow(/booking\.new/);
  });

  it("forces summary add-on types to never push", () => {
    const all = composeAlertTypes([
      {
        slug: "store",
        alerts: [
          {
            ...booking,
            type: "store.low_stock",
            level: "summary",
            defaultChannels: { email: true, push: true },
          },
        ],
      },
    ]);
    expect(all.at(-1)?.defaultChannels.push).toBe(false);
  });
});

describe("sensitive-practice mode (D305)", () => {
  it("lists the health and counseling business types", () => {
    expect([...SENSITIVE_BY_DEFAULT].sort()).toEqual(
      ["counselor", "med-spa", "therapist", "wellness-clinic"].sort(),
    );
  });

  it("empty value falls back to the business type default", () => {
    expect(sensitivePracticeOn("", "therapist")).toBe(true);
    expect(sensitivePracticeOn("", "bakery")).toBe(false);
    expect(sensitivePracticeOn("", "")).toBe(false);
  });

  it("an explicit value wins", () => {
    expect(sensitivePracticeOn("off", "therapist")).toBe(false);
    expect(sensitivePracticeOn("on", "bakery")).toBe(true);
  });

  it("alertSubject uses the safe title only when sensitive", () => {
    const s = spec("form.message");
    const alert = {
      title: "New message from Dana Rivera",
      safe_title: "New form message",
    };
    expect(alertSubject(s, alert, false)).toBe("New message from Dana Rivera");
    expect(alertSubject(s, alert, true)).toBe("New form message");
  });

  it("alertSubject falls back to the type label when the safe title is empty", () => {
    const s = spec("form.message");
    expect(
      alertSubject(s, { title: "Dana Rivera", safe_title: "" }, true),
    ).toBe(s.label);
  });
});

describe("P12 support alert types (COMM-10)", () => {
  const P12 = [
    "support.reply",
    "support.status",
    "cds.message",
    "cds.note",
    "cds.document",
    "cds.idea_built",
  ];

  it.each(P12)(
    "%s is a normal support-feature type opening Support",
    (type) => {
      const s = spec(type);
      expect(s.level).toBe("normal");
      expect(s.feature).toBe("support");
      expect(s.access).toBe("read");
      expect(s.section).toBe("support");
      expect(s.defaultChannels).toEqual({ email: true, push: true });
    },
  );

  it.each(P12)("%s reaches owner, admin and editor but not viewer", (type) => {
    const s = spec(type);
    expect(eligibleFor(who("owner"), s)).toBe(true);
    expect(eligibleFor(who("admin"), s)).toBe(true);
    expect(eligibleFor(who("editor"), s)).toBe(true);
    expect(eligibleFor(who("viewer"), s)).toBe(false);
    expect(eligibleFor(who("staff"), s)).toBe(false);
  });
});

describe("P13 suspension notice alert (13-02; P13-P17)", () => {
  it("is urgent, opens Settings and reaches Owners and Admins only", () => {
    const s = spec("site.suspension_notice");
    expect(s.level).toBe("urgent");
    expect(s.section).toBe("settings");
    expect(s.feature).toBe("settings");
    expect(s.defaultChannels).toEqual({ email: true, push: true });
    expect(eligibleFor(who("owner"), s)).toBe(true);
    expect(eligibleFor(who("admin"), s)).toBe(true);
    expect(eligibleFor(who("editor"), s)).toBe(false);
  });

  it("staff mail types are never tenant alert rows", () => {
    const types = CORE_ALERT_TYPES.map((t) => t.type);
    expect(types).not.toContain("support.rating_down");
    expect(types).not.toContain("staff.health_alert");
  });
});
