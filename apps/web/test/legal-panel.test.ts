// Settings › Legal view helpers (09-20; AGR-06, AGR-07; CONTEXT A3-Q3; D82, D216, D311;
// 09-UI-SPEC "Settings › Legal" section 1; D-UI-P9-17, D-UI-P9-19).
import type {
  AgreementDocument,
  AgreementStatus,
  SitePolicyState,
} from "@cds/db";
import { describe, expect, it } from "vitest";
import {
  SETTINGS_TABS,
  settingsTabLabel,
} from "../app/(platform)/hub/settings/tabs";
import {
  agreementRows,
  agreementStrip,
  legalTabCount,
  sitePolicyNotices,
  sitePolicyRows,
} from "../lib/legal-panel";

function status(
  state: AgreementStatus["state"],
  lastSignedAt: string | null = null,
): AgreementStatus {
  return {
    state,
    missing: [],
    consentCurrent: state === "current",
    lastSignedAt,
    lastSignerName: lastSignedAt ? "Ana Rivera" : null,
  };
}

const MEMBER_OUTDATED =
  "Support updated its terms. Your site owner needs to accept them; nothing changes for you or your site meanwhile.";
const REVIEW = { label: "Review and sign", href: "/hub/agreement" };

describe("agreementStrip", () => {
  it("current: success with the last signed date, no action", () => {
    expect(
      agreementStrip(
        status("current", "2026-10-08T19:14:00.000Z"),
        "owner",
        false,
      ),
    ).toEqual({
      tone: "success",
      text: "Your agreement is up to date. Last signed 8 Oct 2026.",
      action: null,
    });
  });

  it("current: the date is in the org time zone when given", () => {
    const s = status("current", "2026-10-09T02:00:00.000Z");
    expect(agreementStrip(s, "owner", false).text).toContain("9 Oct 2026");
    expect(agreementStrip(s, "owner", false, "America/Chicago").text).toContain(
      "8 Oct 2026",
    );
  });

  it("outdated owner: warning with Review and sign", () => {
    expect(agreementStrip(status("outdated"), "owner", false)).toEqual({
      tone: "warning",
      text: "Updated terms are waiting for you.",
      action: REVIEW,
    });
  });

  it("outdated Admin: info MEMBER-OUTDATED, no action", () => {
    expect(agreementStrip(status("outdated"), "admin", false)).toEqual({
      tone: "info",
      text: MEMBER_OUTDATED,
      action: null,
    });
  });

  it("unsigned: owner gets Review and sign, Admin the same text alone", () => {
    const text = "Not signed yet. You sign once, before checkout.";
    expect(agreementStrip(status("unsigned"), "owner", false)).toEqual({
      tone: "info",
      text,
      action: REVIEW,
    });
    expect(agreementStrip(status("unsigned"), "admin", false)).toEqual({
      tone: "info",
      text,
      action: null,
    });
  });

  it("staff impersonating the owner never get the action", () => {
    expect(agreementStrip(status("unsigned"), "owner", true).action).toBeNull();
    expect(agreementStrip(status("outdated"), "owner", true).action).toBeNull();
  });
});

const DOCS: AgreementDocument[] = [
  {
    kind: "agreement",
    id: "bbbbbbbbbb22222",
    title: "Signed agreement",
    versions: [
      { key: "terms-of-service", title: "Terms of Service", version: 2 },
    ],
    signedAt: "2026-11-02T15:05:00.000Z",
    signerName: "Ana Rivera",
    signerEmail: "ana@rivera.test",
    signingKind: "reaccept",
    evidenceSha256: "b".repeat(64),
    downloadUrl: "/hub/agreement/download/bbbbbbbbbb22222",
  },
  {
    kind: "agreement",
    id: "aaaaaaaaaa11111",
    title: "Signed agreement",
    versions: [
      { key: "service-agreement", title: "Service Agreement", version: 1 },
      { key: "terms-of-service", title: "Terms of Service", version: 1 },
    ],
    signedAt: "2026-10-08T19:14:00.000Z",
    signerName: "Ana Rivera",
    signerEmail: "ana@rivera.test",
    signingKind: "signup",
    evidenceSha256: "a".repeat(64),
    downloadUrl: "/hub/agreement/download/aaaaaaaaaa11111",
  },
];

describe("agreementRows", () => {
  it("keeps newest-first order and builds every label", () => {
    const rows = agreementRows(DOCS, null);
    expect(rows.map((r) => r.id)).toEqual([
      "bbbbbbbbbb22222",
      "aaaaaaaaaa11111",
    ]);
    expect(rows[1]).toEqual({
      id: "aaaaaaaaaa11111",
      dateLabel: "8 Oct 2026",
      timeLabel: "7:14 pm",
      signerName: "Ana Rivera",
      signerEmail: "ana@rivera.test",
      items: ["Service Agreement · version 1", "Terms of Service · version 1"],
      typeLabel: "First signing",
      downloadHref: "/hub/agreement/download/aaaaaaaaaa11111",
      downloadAriaLabel: "Download the agreement signed 8 Oct 2026",
    });
    expect(rows[0]!.typeLabel).toBe("Updated terms");
    expect(rows[0]!.items).toEqual(["Terms of Service · version 2"]);
  });

  it("uses the org time zone when valid, else UTC", () => {
    expect(agreementRows(DOCS, "America/Chicago")[1]!.timeLabel).toBe(
      "2:14 pm",
    );
    expect(agreementRows(DOCS, "Not/AZone")[1]!.timeLabel).toBe("7:14 pm");
  });
});

describe("legalTabCount", () => {
  const none = { templateUpdateWaiting: false, addedSinceReview: [] };
  it("1 when outdated or a site policy update waits, else 0", () => {
    expect(legalTabCount(status("outdated"), null)).toBe(1);
    expect(
      legalTabCount(status("current"), {
        templateUpdateWaiting: true,
        addedSinceReview: [],
      }),
    ).toBe(1);
    expect(
      legalTabCount(status("current"), {
        templateUpdateWaiting: false,
        addedSinceReview: [{ slug: "events", label: "Events" }],
      }),
    ).toBe(1);
    expect(legalTabCount(status("current"), none)).toBe(0);
    expect(legalTabCount(null, null)).toBe(0);
    expect(legalTabCount(status("unsigned"), none)).toBe(0);
  });
});

describe("Settings tabs: Legal", () => {
  it("Legal is the last tab", () => {
    expect(SETTINGS_TABS[SETTINGS_TABS.length - 1]).toEqual({
      id: "legal",
      label: "Legal",
    });
  });

  it("labels carry a per-tab count", () => {
    expect(settingsTabLabel("legal", { legal: 1 })).toBe("Legal · 1");
    expect(settingsTabLabel("legal", {})).toBe("Legal");
    expect(settingsTabLabel("email", { email: 2 })).toBe("Email · 2");
    expect(settingsTabLabel("business", { email: 2, legal: 1 })).toBe(
      "Business info",
    );
  });
});

// 09-23: section 2 "Your site's policy pages" (AGR-08; D217; CONTEXT A5-Q3, A5-Q4).
function siteState(over: Partial<SitePolicyState> = {}): SitePolicyState {
  return {
    published: false,
    ack: null,
    latestTemplateVersion: 1,
    templateUpdateWaiting: false,
    addedSinceReview: [],
    missingInputs: [],
    coveredLabels: [
      "Contact forms",
      "Newsletter sign-ups",
      "Analytics",
      "Testimonials",
    ],
    lastUpdated: null,
    ...over,
  };
}
const ACK = {
  templateVersion: 1,
  ackedAt: "2026-10-08T12:00:00.000Z",
  userName: "Ana Rivera",
};
const WARN_LEGAL =
  "We give no legal advice. These pages are a starting point written from what your site collects. Have your own lawyer approve them before you rely on them.";

describe("sitePolicyRows", () => {
  it("unpublished: both pages Not published (draft); privacy lists what it covers", () => {
    expect(sitePolicyRows(siteState())).toEqual([
      {
        page: "privacy",
        label: "Privacy policy",
        badge: { tone: "draft", text: "Not published" },
        covers:
          "Covers: Contact forms · Newsletter sign-ups · Analytics · Testimonials",
      },
      {
        page: "terms",
        label: "Terms",
        badge: { tone: "draft", text: "Not published" },
        covers: null,
      },
    ]);
  });

  it("published -> Published; a waiting template -> Update waiting", () => {
    const pub = sitePolicyRows(siteState({ published: true, ack: ACK }));
    expect(pub.map((r) => r.badge)).toEqual([
      { tone: "published", text: "Published" },
      { tone: "published", text: "Published" },
    ]);
    const waiting = sitePolicyRows(
      siteState({ published: true, ack: ACK, templateUpdateWaiting: true }),
    );
    expect(waiting.map((r) => r.badge.text)).toEqual([
      "Update waiting",
      "Update waiting",
    ]);
    expect(waiting[0]!.badge.tone).toBe("update-waiting");
  });

  it("no covered labels -> no Covers line", () => {
    expect(sitePolicyRows(siteState({ coveredLabels: [] }))[0]!.covers).toBe(
      null,
    );
  });
});

describe("sitePolicyNotices", () => {
  it("always WARN-LEGAL first, titled We are not a law firm", () => {
    for (const role of ["owner", "admin"]) {
      const n = sitePolicyNotices(siteState(), role, false);
      expect(n.alerts[0]).toEqual({
        key: "warn-legal",
        tone: "warning",
        title: "We are not a law firm",
        text: WARN_LEGAL,
        link: null,
      });
    }
  });

  it("missing inputs -> MISSING-LEGAL-INPUTS with the Business info link", () => {
    const n = sitePolicyNotices(
      siteState({ missingInputs: ["legal_name"] }),
      "owner",
      false,
    );
    expect(n.alerts.map((a) => a.key)).toEqual([
      "warn-legal",
      "missing-inputs",
    ]);
    expect(n.alerts[1]).toMatchObject({
      tone: "info",
      text: "Add your legal business name and a privacy contact email first, in Setup › Domain & the rest. Your policy pages use them.",
      link: { label: "Add your legal details", href: "/hub/setup/the-rest" },
    });
  });

  it("template waiting: TEMPLATE-UPDATE for the owner only; no acked line", () => {
    const state = siteState({
      published: true,
      ack: ACK,
      templateUpdateWaiting: true,
    });
    const owner = sitePolicyNotices(state, "owner", false);
    expect(owner.alerts.map((a) => a.key)).toContain("template-update");
    expect(owner.alerts.find((a) => a.key === "template-update")?.text).toBe(
      "Support updated the policy page template. Your site keeps showing the version you approved until you review and publish the update.",
    );
    expect(owner.ackedLine).toBe(null);
    const admin = sitePolicyNotices(state, "admin", false);
    expect(admin.alerts.map((a) => a.key)).not.toContain("template-update");
  });

  it("ADDON-CHANGED per added add-on when published, at the top after the warning", () => {
    const n = sitePolicyNotices(
      siteState({
        published: true,
        ack: ACK,
        addedSinceReview: [
          { slug: "testimonials", label: "Testimonials" },
          { slug: "credentials", label: "Credentials" },
        ],
      }),
      "owner",
      false,
    );
    expect(n.alerts.map((a) => a.text).slice(1)).toEqual([
      "Your privacy policy changed because you added Testimonials. Review it.",
      "Your privacy policy changed because you added Credentials. Review it.",
    ]);
    expect(n.alerts[1]!.tone).toBe("info");
  });

  it("ACKED-LINE when published and nothing waits", () => {
    const n = sitePolicyNotices(
      siteState({ published: true, ack: ACK }),
      "admin",
      false,
    );
    expect(n.ackedLine).toBe(
      "Published by Ana Rivera on 8 Oct 2026 (template version 1).",
    );
    expect(sitePolicyNotices(siteState(), "owner", false).ackedLine).toBe(null);
  });
});
