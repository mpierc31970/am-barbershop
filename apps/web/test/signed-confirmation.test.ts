// Signed confirmation view helpers (09-18; AGR-04; CONTEXT A2-Q4; 09-UI-SPEC "Signed
// confirmation"; T-09-18-05).
import type { AgreementDocument } from "@cds/db";
import { describe, expect, it } from "vitest";
import {
  confirmationActions,
  copyRetain,
  formatSignedSentence,
  localDay,
  policyRows,
} from "../lib/signed-confirmation";

const DOC: AgreementDocument = {
  kind: "agreement",
  id: "abcdefghij12345",
  title: "Signed agreement",
  versions: [
    { key: "service-agreement", title: "Service Agreement", version: 1 },
    { key: "terms-of-service", title: "Terms of Service", version: 2 },
  ],
  signedAt: "2026-10-08T19:14:00.000Z",
  signerName: "Ana Rivera",
  signerEmail: "ana@rivera.test",
  signingKind: "signup",
  evidenceSha256: "a".repeat(64),
  downloadUrl: "/hub/agreement/download/abcdefghij12345",
};

describe("confirmationActions", () => {
  it("defaults to Back to setting up your site", () => {
    expect(confirmationActions(null)).toEqual({
      label: "Back to setting up your site",
      href: "/hub/setup",
    });
  });

  it("checkout next continues to checkout", () => {
    expect(confirmationActions("/hub/checkout")).toEqual({
      label: "Continue to checkout",
      href: "/hub/checkout",
    });
    expect(confirmationActions("/hub/checkout?plan=x").label).toBe(
      "Continue to checkout",
    );
  });

  it("any other hub next continues to your hub at that path", () => {
    expect(confirmationActions("/hub/website")).toEqual({
      label: "Continue to your hub",
      href: "/hub/website",
    });
  });

  it("an unsafe next is the default (no open redirect)", () => {
    for (const bad of [
      "//evil",
      "https://evil.test/hub",
      "/hubx",
      "javascript:alert(1)",
    ]) {
      expect(confirmationActions(bad)).toEqual({
        label: "Back to setting up your site",
        href: "/hub/setup",
      });
    }
  });

  it("a re-accept with no next continues to /hub", () => {
    // IN-C07: a signup signing opened after setup is over goes to the hub, not setup.
    expect(confirmationActions(null, "signup", false)).toEqual({
      label: "Continue to your hub",
      href: "/hub",
    });
    expect(confirmationActions("/hub/checkout", "signup", false).href).toBe(
      "/hub/checkout",
    );
    expect(confirmationActions(null, "signup", true).href).toBe("/hub/setup");
    expect(confirmationActions(null, "reaccept")).toEqual({
      label: "Continue to your hub",
      href: "/hub",
    });
  });
});

describe("formatSignedSentence", () => {
  it("uses the org time zone", () => {
    expect(formatSignedSentence(DOC, "Rivera Bakery", "America/Chicago")).toBe(
      "Signed by Ana Rivera for Rivera Bakery on 8 Oct 2026 at 2:14 pm (America/Chicago). Your copy records each policy's exact wording and version.",
    );
  });

  it("falls back to UTC with no or an unknown zone", () => {
    const utc =
      "Signed by Ana Rivera for Rivera Bakery on 8 Oct 2026 at 7:14 pm (UTC). Your copy records each policy's exact wording and version.";
    expect(formatSignedSentence(DOC, "Rivera Bakery", null)).toBe(utc);
    expect(formatSignedSentence(DOC, "Rivera Bakery", "Not/AZone")).toBe(utc);
  });

  it("crosses the date line in the org zone", () => {
    const late = { ...DOC, signedAt: "2026-10-09T02:05:00.000Z" };
    expect(
      formatSignedSentence(late, "Rivera Bakery", "America/Chicago"),
    ).toContain("on 8 Oct 2026 at 9:05 pm (America/Chicago)");
    expect(formatSignedSentence(late, "Rivera Bakery", "Asia/Tokyo")).toContain(
      "on 9 Oct 2026 at 11:05 am (Asia/Tokyo)",
    );
  });

  it("midnight and noon read as 12", () => {
    const mid = { ...DOC, signedAt: "2026-10-08T00:00:00.000Z" };
    const noon = { ...DOC, signedAt: "2026-10-08T12:00:00.000Z" };
    expect(formatSignedSentence(mid, "X", null)).toContain("at 12:00 am (UTC)");
    expect(formatSignedSentence(noon, "X", null)).toContain(
      "at 12:00 pm (UTC)",
    );
  });
});

describe("policyRows and copyRetain", () => {
  it("one row per signed policy, Version N", () => {
    expect(policyRows(DOC)).toEqual([
      {
        key: "service-agreement",
        term: "Service Agreement",
        value: "Version 1",
      },
      { key: "terms-of-service", term: "Terms of Service", value: "Version 2" },
    ]);
  });

  it("COPY-RETAIN names the signer email", () => {
    expect(copyRetain("ana@rivera.test")).toBe(
      "We've emailed a link to ana@rivera.test. You can download your copy any time from Settings › Legal.",
    );
  });
});

describe("localDay (IN-C06)", () => {
  // 02:30 UTC on 9 Oct is still the evening of 8 Oct in Chicago.
  const LATE = new Date("2026-10-09T02:30:00.000Z");

  it("uses the org's zone, so an evening US signer sees today, not tomorrow", () => {
    expect(localDay(LATE, "America/Chicago")).toBe("2026-10-08");
  });

  it("falls back to UTC when unset or invalid", () => {
    expect(localDay(LATE, null)).toBe("2026-10-09");
    expect(localDay(LATE, "Not/AZone")).toBe("2026-10-09");
  });
});
