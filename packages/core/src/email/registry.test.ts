// EMAIL-01, D267: every email is a registered, classed type; add-ons contribute theirs.
import { describe, expect, it } from "vitest";
import { fixtureManifest } from "../addons/__fixtures__/manifests";
import { InvalidInput } from "../errors";
import {
  EMAIL_TYPES,
  composeEmailTypes,
  lookupEmailType,
  suppressionBlocks,
} from "./index";

describe("EMAIL_TYPES (EMAIL-01)", () => {
  it("quote.reminder is marketing and every other core type is transactional", () => {
    for (const [type, spec] of Object.entries(EMAIL_TYPES)) {
      expect(spec.class, type).toBe(
        type === "quote.reminder" ? "marketing" : "transactional",
      );
    }
  });

  it("has the core types (PD-23 adds fit.*, P7 form.submission and media.alert, P8 site.*, P9 agreement.signed, P10 billing.*, org.declined and form.auto_reply, P11 alerts, reports, downloads and invites, P12 support, P13 staff/suspension/report mail)", () => {
    expect(Object.keys(EMAIL_TYPES).sort()).toEqual(
      [
        "billing.receipt",
        "billing.card_failed",
        "billing.lapsed",
        "billing.restored",
        "billing.quote_sent",
        "billing.stripe_setup",
        "billing.staff_alert",
        "org.declined",
        "agreement.signed",
        "auth.code",
        "email.confirm",
        "fit.approved",
        "fit.declined",
        "form.submission",
        "form.auto_reply",
        "form.resume_link",
        "media.alert",
        "quote.reminder",
        "quote.saved",
        "site.assembled",
        "site.assembly_failed",
        "alert.notify",
        "alerts.digest",
        "reports.monthly",
        "data_export.ready",
        "member.invite",
        "support.notify",
        "support.sla_risk",
        "staff.health_alert",
        "support.rating_down",
        "scan.budget_cap",
        "site.suspension_notice",
        "site.suspended",
        "site.suspension_lifted",
        "report.content_notice",
        "report.received",
        "domain.records_copied",
        "domain.nameserver_steps",
        "domain.connected",
        "domain.switch_back",
        "domain.lost_delegation",
        "domain.expiry",
        "review.sent",
        "offboarding.started",
        "offboarding.handed_back",
        "offboarding.handback_overdue",
        "staff.domain_alert",
        "hub.inquiry",
      ].sort(),
    );
  });

  it("agreement.signed is a transactional core type sent by the app (AGR-04)", () => {
    const spec = EMAIL_TYPES["agreement.signed"];
    expect(spec.class).toBe("transactional");
    expect(spec.owner).toBe("core");
    expect("sentBy" in spec).toBe(false);
  });

  it("the P10 billing types are transactional core types sent by the app", () => {
    for (const type of [
      "billing.receipt",
      "billing.card_failed",
      "billing.lapsed",
      "billing.restored",
      "billing.quote_sent",
      "billing.stripe_setup",
      "billing.staff_alert",
      "org.declined",
    ] as const) {
      const spec: { class: string; owner: string; sentBy?: string } =
        EMAIL_TYPES[type];
      expect(spec.class, type).toBe("transactional");
      expect(spec.owner, type).toBe("core");
      expect(spec.sentBy, type).toBeUndefined();
    }
  });

  it("the P11 types are transactional core types sent by the app (11-10)", () => {
    for (const type of [
      "alert.notify",
      "alerts.digest",
      "reports.monthly",
      "data_export.ready",
      "member.invite",
    ] as const) {
      const spec: { class: string; owner: string; sentBy?: string } =
        EMAIL_TYPES[type];
      expect(spec.class, type).toBe("transactional");
      expect(spec.owner, type).toBe("core");
      expect(spec.sentBy, type).toBeUndefined();
    }
  });

  it("auth.code is sent by PocketBase", () => {
    expect(EMAIL_TYPES["auth.code"].sentBy).toBe("pb");
  });

  it("form.submission and media.alert are transactional core types sent by the app", () => {
    for (const type of [
      "form.submission",
      "form.auto_reply",
      "form.resume_link",
      "media.alert",
      "site.assembled",
      "site.assembly_failed",
    ] as const) {
      const spec: { class: string; owner: string; sentBy?: string } =
        EMAIL_TYPES[type];
      expect(spec.class, type).toBe("transactional");
      expect(spec.owner, type).toBe("core");
      expect(spec.sentBy, type).toBeUndefined();
    }
  });
});

describe("composeEmailTypes", () => {
  const withEmails = (
    emails: { type: string; class: "transactional" | "marketing" }[],
  ) =>
    fixtureManifest({
      slug: "fixture-quote",
      emails: emails.map((e) => ({ ...e, description: "Test email." })),
    });

  it("adds manifest email types owned by the add-on", () => {
    const reg = composeEmailTypes([
      withEmails([{ type: "fixture-quote.thanks", class: "transactional" }]),
    ]);
    expect(reg.get("fixture-quote.thanks")).toMatchObject({
      class: "transactional",
      owner: "fixture-quote",
    });
    expect(reg.get("quote.saved")?.class).toBe("transactional");
    expect(reg.list().length).toBe(Object.keys(EMAIL_TYPES).length + 1);
  });

  it("refuses an add-on type that duplicates a core type", () => {
    expect(() =>
      composeEmailTypes([
        withEmails([{ type: "quote.saved", class: "marketing" }]),
      ]),
    ).toThrow(InvalidInput);
  });

  it("refuses an add-on type outside its own slug prefix", () => {
    expect(() =>
      composeEmailTypes([
        withEmails([{ type: "other.thanks", class: "marketing" }]),
      ]),
    ).toThrow(InvalidInput);
  });

  it("get is own-property only", () => {
    const reg = composeEmailTypes([]);
    expect(reg.get("toString")).toBeUndefined();
    expect(reg.get("__proto__")).toBeUndefined();
  });
});

describe("lookupEmailType", () => {
  it("returns a registered spec and throws on an unregistered type", () => {
    const reg = composeEmailTypes([]);
    expect(lookupEmailType(reg, "quote.reminder").class).toBe("marketing");
    expect(() => lookupEmailType(reg, "nope.x")).toThrow(InvalidInput);
    expect(() => lookupEmailType(reg, "nope.x")).toThrow(
      /unregistered email type/,
    );
  });
});

describe("suppressionBlocks", () => {
  it("marketing suppression blocks marketing only; all blocks everything", () => {
    expect(suppressionBlocks("marketing", [{ scope: "marketing" }])).toBe(true);
    expect(suppressionBlocks("transactional", [{ scope: "marketing" }])).toBe(
      false,
    );
    expect(suppressionBlocks("transactional", [{ scope: "all" }])).toBe(true);
    expect(suppressionBlocks("marketing", [{ scope: "all" }])).toBe(true);
    expect(suppressionBlocks("marketing", [])).toBe(false);
  });
});
