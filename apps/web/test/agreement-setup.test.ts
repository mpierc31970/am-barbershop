// 09-19 Task 1: the agreement Setup item, shared by the panel and the sidebar count (AGR-02,
// AGR-07; CONTEXT A2-Q5, A3-Q1; D-UI-P9-4, D-UI-P9-19; RESEARCH Pitfall 15).
import type { AgreementStatus } from "@cds/db";
import { describe, expect, it } from "vitest";
import {
  AGREEMENT_STAGES,
  agreementSetupItem,
  countsAsRequired,
  setupNeededCount,
  showMemberOutdated,
  signedOnDate,
} from "../lib/agreement-setup";

const UNSIGNED: AgreementStatus = {
  state: "unsigned",
  missing: [],
  consentCurrent: false,
  lastSignedAt: null,
  lastSignerName: null,
};
const CURRENT: AgreementStatus = {
  state: "current",
  missing: [],
  consentCurrent: true,
  lastSignedAt: "2026-10-08T15:00:00.000Z",
  lastSignerName: "Ana Rivera",
};
const OUTDATED: AgreementStatus = {
  ...CURRENT,
  state: "outdated",
};

describe("agreementSetupItem", () => {
  it("shows nothing before Send to CDS, while held, or past onboarding", () => {
    for (const stage of ["intake", "fit_review", ""]) {
      expect(agreementSetupItem(stage, UNSIGNED, "owner", false)).toBeNull();
    }
  });

  it("is read from the stage order: ready_for_build onward", () => {
    expect(AGREEMENT_STAGES).toEqual(["ready_for_build", "being_built"]);
  });

  it("no status (read failed) shows nothing", () => {
    expect(
      agreementSetupItem("ready_for_build", null, "owner", false),
    ).toBeNull();
  });

  it("unsigned after Send to CDS: needed; only the Owner, not impersonated, can sign", () => {
    expect(
      agreementSetupItem("ready_for_build", UNSIGNED, "owner", false),
    ).toEqual({ state: "needed", canSign: true, signedOn: null });
    expect(agreementSetupItem("being_built", UNSIGNED, "admin", false)).toEqual(
      { state: "needed", canSign: false, signedOn: null },
    );
    expect(
      agreementSetupItem("being_built", UNSIGNED, "owner", true),
    ).toMatchObject({ state: "needed", canSign: false });
  });

  it("current: signed with the date", () => {
    expect(agreementSetupItem("being_built", CURRENT, "owner", false)).toEqual({
      state: "signed",
      canSign: true,
      signedOn: "8 Oct 2026",
    });
  });

  it("the signed date follows the business time zone", () => {
    const late = { ...CURRENT, lastSignedAt: "2026-10-09T02:00:00.000Z" };
    expect(
      agreementSetupItem("being_built", late, "owner", false, "America/Chicago")
        ?.signedOn,
    ).toBe("8 Oct 2026");
    expect(
      agreementSetupItem("being_built", late, "owner", false)?.signedOn,
    ).toBe("9 Oct 2026");
    expect(signedOnDate(late.lastSignedAt, "Not/AZone")).toBe("9 Oct 2026");
    expect(signedOnDate("nope")).toBeNull();
  });

  it("outdated: the outdated state", () => {
    expect(agreementSetupItem("being_built", OUTDATED, "admin", false)).toEqual(
      { state: "outdated", canSign: false, signedOn: null },
    );
  });
});

describe("countsAsRequired / setupNeededCount (Pitfall 15)", () => {
  it("only needed counts", () => {
    const needed = agreementSetupItem(
      "ready_for_build",
      UNSIGNED,
      "owner",
      false,
    );
    const signed = agreementSetupItem(
      "ready_for_build",
      CURRENT,
      "owner",
      false,
    );
    const outdated = agreementSetupItem(
      "ready_for_build",
      OUTDATED,
      "admin",
      false,
    );
    expect(countsAsRequired(needed)).toBe(true);
    expect(countsAsRequired(signed)).toBe(false);
    expect(countsAsRequired(outdated)).toBe(false);
    expect(countsAsRequired(null)).toBe(false);
  });

  it("the sidebar count is the intake must-haves plus the unsigned agreement", () => {
    const needed = agreementSetupItem(
      "ready_for_build",
      UNSIGNED,
      "owner",
      false,
    );
    expect(setupNeededCount(0, needed)).toBe(1);
    expect(setupNeededCount(2, needed)).toBe(3);
    expect(setupNeededCount(2, null)).toBe(2);
    expect(
      setupNeededCount(
        0,
        agreementSetupItem("intake", UNSIGNED, "owner", false),
      ),
    ).toBe(0);
  });
});

describe("showMemberOutdated (D-UI-P9-19)", () => {
  it("Admins only, and only when outdated", () => {
    expect(showMemberOutdated(OUTDATED, "admin")).toBe(true);
    for (const role of ["owner", "editor", "viewer"]) {
      expect(showMemberOutdated(OUTDATED, role)).toBe(false);
    }
    expect(showMemberOutdated(CURRENT, "admin")).toBe(false);
    expect(showMemberOutdated(UNSIGNED, "admin")).toBe(false);
    expect(showMemberOutdated(null, "admin")).toBe(false);
  });
});
