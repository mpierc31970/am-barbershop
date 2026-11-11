// 09-17 Task 1: the signing screen's pure view model (AGR-07, CONTEXT A2-Q1, A3-Q1, D216,
// D287; 09-UI-SPEC "Signing screen", "Re-accept", Copywriting Contract).
import type { ConsentVersion, PolicyKey, PolicyVersion } from "@cds/core/legal";
import type { AgreementStatus } from "@cds/db";
import { describe, expect, it } from "vitest";
import { buildSigningView } from "../lib/signing-view";

const SHA = (c: string) => c.repeat(64);

function policy(
  key: PolicyKey,
  title: string,
  version = 1,
  extra: Partial<PolicyVersion> = {},
): PolicyVersion {
  return {
    key,
    version,
    title,
    summary: [`${title} one`, `${title} two`, `${title} three`],
    changes: null,
    effectiveAt: "2026-10-08",
    draft: true,
    bodyMd: `# ${title}`,
    bodyHtml: `<h1>${title}</h1>`,
    sha256: SHA(String(version)),
    ...extra,
  };
}

// Deliberately not in D216 order: the view sorts.
const ACTIVE_V1: PolicyVersion[] = [
  policy("acceptable-use", "Acceptable Use Policy"),
  policy("dpa", "Data Processing Agreement"),
  policy("service-agreement", "Service Agreement"),
  policy("subscription-terms", "Subscription terms"),
  policy("terms-of-service", "Terms of Service"),
];
const TOS_V2 = policy("terms-of-service", "Terms of Service", 2, {
  effectiveAt: "2027-01-01",
  changes: "Clarifies how we notify you of outages.",
  sha256: SHA("b"),
});
const ACTIVE_TOS2 = ACTIVE_V1.map((p) =>
  p.key === "terms-of-service" ? TOS_V2 : p,
);

const CONSENT: ConsentVersion = {
  key: "esign-consent",
  version: 1,
  title: "Electronic signature consent",
  label: "I agree to sign electronically…",
  effectiveAt: "2026-10-08",
  draft: true,
  bodyMd: "consent",
  bodyHtml: "<p>consent</p>",
  sha256: SHA("c"),
};

const UNSIGNED: AgreementStatus = {
  state: "unsigned",
  missing: ACTIVE_V1.map((p) => ({
    key: p.key,
    version: p.version,
    title: p.title,
    changes: null,
    previousVersion: null,
    previousSignedAt: null,
  })),
  consentCurrent: false,
  lastSignedAt: null,
  lastSignerName: null,
};
const CURRENT: AgreementStatus = {
  state: "current",
  missing: [],
  consentCurrent: true,
  lastSignedAt: "2026-10-08 10:00:00.000Z",
  lastSignerName: "Ana Rivera",
};
const OUTDATED: AgreementStatus = {
  state: "outdated",
  missing: [
    {
      key: "terms-of-service",
      version: 2,
      title: "Terms of Service",
      changes: "Clarifies how we notify you of outages.",
      previousVersion: 1,
      previousSignedAt: "2026-10-08 10:00:00.000Z",
    },
  ],
  consentCurrent: true,
  lastSignedAt: "2026-10-08 10:00:00.000Z",
  lastSignerName: "Ana Rivera",
};

const BASE = {
  consent: CONSENT,
  role: "owner",
  impersonating: false,
  ownerName: "Ana Rivera",
  onBehalfOf: "Rivera Bakery LLC",
  today: "2026-10-08",
};

describe("buildSigningView: sign mode", () => {
  it("owner, unsigned: a form with five cards in D216 order", () => {
    const v = buildSigningView({
      ...BASE,
      status: UNSIGNED,
      active: ACTIVE_V1,
      mode: "sign",
    });
    expect(v.kind).toBe("form");
    expect(v.title).toBe("Review and sign your agreement");
    expect(v.intro).toMatch(/^Five short policies cover/);
    expect(v.cards.map((c) => c.key)).toEqual([
      "service-agreement",
      "acceptable-use",
      "terms-of-service",
      "subscription-terms",
      "dpa",
    ]);
    const first = v.cards[0]!;
    expect(first.metaLine).toBe("Version 1 · Effective 8 Oct 2026");
    expect(first.fullTextHref).toBe("/legal/service-agreement/v1");
    expect(first.summary).toHaveLength(3);
    expect(first.bodyHtml).toBe("<h1>Service Agreement</h1>");
    expect(first.sha256).toBe(SHA("1"));
    expect(first.whatChanged).toBeUndefined();
    expect(v.stillCurrent).toBeNull();
    expect(v.consent).toEqual({
      version: 1,
      sha256: SHA("c"),
      metaLine: "Electronic signature consent · Version 1",
      bodyHtml: "<p>consent</p>",
    });
    expect(v.alert).toBeNull();
    expect(v.showDraft).toBe(true);
  });

  it("showDraft is false when nothing shown is a draft", () => {
    const v = buildSigningView({
      ...BASE,
      consent: { ...CONSENT, draft: false },
      status: UNSIGNED,
      active: ACTIVE_V1.map((p) => ({ ...p, draft: false })),
      mode: "sign",
    });
    expect(v.showDraft).toBe(false);
  });

  it("owner, current: kind current with the up-to-date alert", () => {
    const v = buildSigningView({
      ...BASE,
      status: CURRENT,
      active: ACTIVE_V1,
      mode: "sign",
    });
    expect(v.kind).toBe("current");
    expect(v.cards).toEqual([]);
    expect(v.alert).toEqual({
      tone: "success",
      text: "Your agreement is up to date.",
    });
  });

  it("an outdated org opening sign mode gets the changed set (what the server accepts)", () => {
    const v = buildSigningView({
      ...BASE,
      status: OUTDATED,
      active: ACTIVE_TOS2,
      mode: "sign",
    });
    expect(v.kind).toBe("form");
    expect(v.cards.map((c) => c.key)).toEqual(["terms-of-service"]);
  });
});

describe("buildSigningView: re-accept mode", () => {
  it("owner, outdated: only the changed card with what changed and the still-current list", () => {
    const v = buildSigningView({
      ...BASE,
      status: OUTDATED,
      active: ACTIVE_TOS2,
      mode: "reaccept",
    });
    expect(v.kind).toBe("form");
    expect(v.title).toBe("We've updated our terms");
    expect(v.intro).toBe(
      "We changed 1 of the policies you signed. Here's what changed. Sign again to keep using your hub. Your site stays live the whole time.",
    );
    expect(v.cards).toHaveLength(1);
    const card = v.cards[0]!;
    expect(card.key).toBe("terms-of-service");
    expect(card.version).toBe(2);
    expect(card.sha256).toBe(SHA("b"));
    expect(card.whatChanged).toBe("Clarifies how we notify you of outages.");
    expect(card.metaLine).toBe(
      "Version 2 · Effective 1 Jan 2027 · You signed version 1 on 8 Oct 2026",
    );
    expect(card.fullTextHref).toBe("/legal/terms-of-service/v2");
    expect(v.stillCurrent).toBe(
      "Still current, no need to sign again: Service Agreement v1 · Acceptable Use Policy v1 · Subscription terms v1 · Data Processing Agreement v1.",
    );
  });

  it("consent-only change: every active policy, a consent intro, no still-current list", () => {
    const v = buildSigningView({
      ...BASE,
      status: { ...OUTDATED, missing: [], consentCurrent: false },
      active: ACTIVE_V1,
      mode: "reaccept",
    });
    expect(v.kind).toBe("form");
    expect(v.cards).toHaveLength(5);
    expect(v.stillCurrent).toBeNull();
    expect(v.intro).toMatch(/electronic signature consent/);
  });

  it("current: redirect", () => {
    const v = buildSigningView({
      ...BASE,
      status: CURRENT,
      active: ACTIVE_V1,
      mode: "reaccept",
    });
    expect(v.kind).toBe("redirect");
  });

  it("unsigned org in re-accept mode falls back to the full sign form", () => {
    const v = buildSigningView({
      ...BASE,
      status: UNSIGNED,
      active: ACTIVE_V1,
      mode: "reaccept",
    });
    expect(v.kind).toBe("form");
    expect(v.cards).toHaveLength(5);
    expect(v.title).toBe("Review and sign your agreement");
  });
});

describe("buildSigningView: who sees what (D287)", () => {
  it("Admin: read-only with NOT-OWNER-SIGN naming the owner", () => {
    const v = buildSigningView({
      ...BASE,
      role: "admin",
      status: UNSIGNED,
      active: ACTIVE_V1,
      mode: "sign",
    });
    expect(v.kind).toBe("readonly");
    expect(v.cards).toHaveLength(5);
    expect(v.alert).toEqual({
      tone: "info",
      text: "Only the site owner can sign this agreement. Ana Rivera will see it when they next sign in.",
    });
  });

  it("Admin with no owner name: falls back to The site owner", () => {
    const v = buildSigningView({
      ...BASE,
      ownerName: "  ",
      role: "admin",
      status: UNSIGNED,
      active: ACTIVE_V1,
      mode: "sign",
    });
    expect(v.alert?.text).toBe(
      "Only the site owner can sign this agreement. The site owner will see it when they next sign in.",
    );
  });

  it("impersonating staff (as owner): read-only with IMPERSONATING-SIGN", () => {
    const v = buildSigningView({
      ...BASE,
      impersonating: true,
      status: OUTDATED,
      active: ACTIVE_TOS2,
      mode: "reaccept",
    });
    expect(v.kind).toBe("readonly");
    expect(v.alert).toEqual({
      tone: "info",
      text: "You're viewing as CDS staff, so signing is turned off. Only the owner can sign.",
    });
  });
});
