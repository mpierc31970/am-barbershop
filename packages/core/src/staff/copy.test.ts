import { describe, expect, it } from "vitest";
import { P13_COPY, P13_DIALOGS, fillCopy } from "./copy";
import { STAFF_SECTION_KEYS, STAFF_TAB_IDS } from "./sections-types";

describe("P13_COPY (P13-P16)", () => {
  it("holds the CONTEXT anchors verbatim", () => {
    expect(P13_COPY.INTERNAL_LINE).toBe("Only CDS sees this.");
    expect(P13_COPY.TODAY_EMPTY_H).toBe("Nothing needs you.");
    expect(P13_COPY.SUSPENDED_PAGE_H).toBe(
      "This site is temporarily unavailable.",
    );
    expect(P13_COPY.RATING_Q).toBe("Was this resolved well?");
  });

  it("every dialog has a title, a confirm and a safe button", () => {
    for (const d of Object.values(P13_DIALOGS)) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.confirm.length).toBeGreaterThan(0);
      expect(d.safe.length).toBeGreaterThan(0);
      expect(d.confirm).not.toBe(d.safe);
    }
  });
});

describe("fillCopy", () => {
  it("fills known tokens", () => {
    expect(fillCopy("Resolve {code}?", { code: "I-3" })).toBe("Resolve I-3?");
    expect(fillCopy(P13_DIALOGS.incident_resolve.body, { count: 4 })).toBe(
      "4 linked tickets will move to Resolved.",
    );
  });

  it("leaves unknown tokens untouched", () => {
    expect(fillCopy("Resolve {code} by {when}", { code: "I-3" })).toBe(
      "Resolve I-3 by {when}",
    );
    expect(fillCopy("{toString}", {})).toBe("{toString}");
  });
});

describe("staff sections", () => {
  it("has a tab list for every section key", () => {
    expect(Object.keys(STAFF_TAB_IDS).sort()).toEqual(
      [...STAFF_SECTION_KEYS].sort(),
    );
  });
});
