// P8 (08-11): slot report → staff CLI text (UI-SPEC "Staff CLI output", D-UI-P8-27; TMPL-04).
import type { AssemblyReport, SlotReportLine } from "@cds/core/templates";
import { describe, expect, it } from "vitest";
import {
  alreadyAssembledLine,
  dayMonth,
  DRY_RUN_FIRST_LINE,
  polishCount,
  polishLines,
  polishSummaryLine,
  reportRows,
  rerunLines,
  summaryLine,
  wouldAssembleLine,
} from "./report";

const slots: SlotReportLine[] = [
  {
    page: "home",
    slot: "hero",
    source: "fallback",
    note: "No main photo: text-only hero",
  },
  { page: "home", slot: "intro", source: "provided" },
  { page: "home", slot: "services", source: "provided", note: "6 of 12" },
  {
    page: "home",
    slot: "proof",
    source: "omitted",
    note: "No add-on installed",
  },
  { page: "home", slot: "hours-location", source: "provided" },
  { page: "home", slot: "contact", source: "provided" },
  { page: "home", slot: "closing-cta", source: "provided" },
  { page: "about", slot: "about", source: "fallback" },
  { page: "about", slot: "team", source: "provided", note: "4" },
  { page: "about", slot: "gallery", source: "omitted", note: "No photos" },
  {
    page: "about",
    slot: "faq",
    source: "provided",
    note: "2 of 3 need answers (hidden until answered)",
  },
];

const report: AssemblyReport = {
  templateId: "standard-v1",
  templateVersion: 1,
  slots,
  polish: ["Theme: import the impeccable theme (D45)"],
  pages: [
    { key: "home", label: "Home", outcome: "created", path: "/" },
    { key: "about", label: "About", outcome: "created", path: "/about" },
  ],
};

describe("reportRows", () => {
  it("gives page, slot label, result word, note", () => {
    const rows = reportRows(report);
    expect(rows).toHaveLength(11);
    expect(rows[0]).toEqual([
      "Home",
      "Hero",
      "Default used",
      "No main photo: text-only hero",
    ]);
    expect(rows[1]).toEqual(["Home", "Intro", "Filled", ""]);
    expect(rows[2]).toEqual(["Home", "Services", "Filled", "6 of 12"]);
    expect(rows[3]).toEqual([
      "Home",
      "Proof",
      "Left out",
      "No add-on installed",
    ]);
    expect(rows[10]).toEqual([
      "About",
      "Questions and answers",
      "Filled",
      "2 of 3 need answers (hidden until answered)",
    ]);
  });

  it("an unknown page key is shown capitalised", () => {
    const rows = reportRows({
      ...report,
      slots: [{ page: "menu", slot: "x", source: "provided" }],
    });
    expect(rows[0]).toEqual(["Menu", "x", "Filled", ""]);
  });
});

describe("summary and polish", () => {
  it("summaryLine counts pages and slot results", () => {
    expect(summaryLine("Rivera Bakery", report)).toBe(
      "Assembled Rivera Bakery: 2 pages, 11 slots (7 filled, 2 default used, 2 left out).",
    );
  });

  it("summaryLine is singular for one page and one slot", () => {
    expect(
      summaryLine("Ana", {
        ...report,
        slots: [slots[1]!],
        pages: [report.pages[0]!],
      }),
    ).toBe(
      "Assembled Ana: 1 page, 1 slot (1 filled, 0 default used, 0 left out).",
    );
  });

  it("polishCount is fallback slots plus polish items", () => {
    expect(polishCount(report)).toBe(3);
    expect(polishCount({ ...report, slots: [], polish: [] })).toBe(0);
  });

  it("polishLines match the build report email", () => {
    expect(polishLines(report)).toEqual([
      "Hero · Default used · No main photo: text-only hero",
      "About text · Default used",
      "Theme: import the impeccable theme (D45)",
    ]);
  });

  it("polishSummaryLine gives the count and the extra polish items", () => {
    expect(polishSummaryLine(report)).toBe(
      "To polish: 3 · Theme: import the impeccable theme (D45)",
    );
    expect(polishSummaryLine({ ...report, polish: [] })).toBe("To polish: 2");
  });
});

describe("dry run", () => {
  it("first and last lines", () => {
    expect(DRY_RUN_FIRST_LINE).toBe("Dry run: nothing was written.");
    expect(wouldAssembleLine(report)).toBe("Would assemble 2 pages.");
    expect(wouldAssembleLine({ ...report, pages: [report.pages[0]!] })).toBe(
      "Would assemble 1 page.",
    );
  });
});

describe("rerunLines", () => {
  it("edited, deleted, unchanged in UI-SPEC words, then the total", () => {
    const lines = rerunLines({
      ...report,
      pages: [
        { key: "home", label: "Home", outcome: "unchanged", path: "/" },
        { key: "about", label: "About", outcome: "edited", path: "/about" },
      ],
    });
    expect(lines).toEqual([
      "Home   unchanged, rebuilt.",
      "About  edited since it was assembled, left alone.",
      "Re-run done: 1 page rebuilt, 1 left alone.",
    ]);
  });

  it("a deleted page is not recreated", () => {
    const lines = rerunLines({
      ...report,
      pages: [
        { key: "home", label: "Home", outcome: "rebuilt", path: "/" },
        { key: "about", label: "About", outcome: "deleted", path: "/about" },
      ],
    });
    expect(lines).toContain("About  deleted, not recreated.");
    expect(lines).toContain("Home   unchanged, rebuilt.");
    expect(lines.at(-1)).toBe("Re-run done: 1 page rebuilt, 1 left alone.");
  });

  it("plural counts", () => {
    const lines = rerunLines({
      ...report,
      pages: [
        { key: "home", label: "Home", outcome: "rebuilt", path: "/" },
        { key: "about", label: "About", outcome: "rebuilt", path: "/about" },
      ],
    });
    expect(lines.at(-1)).toBe("Re-run done: 2 pages rebuilt, 0 left alone.");
  });
});

describe("dayMonth / alreadyAssembledLine (08-18)", () => {
  it("formats a UTC day and fixed month, empty for bad input", () => {
    expect(dayMonth("2026-10-07T23:30:00.000Z")).toBe("7 Oct");
    expect(dayMonth(new Date("2026-09-03T00:00:00Z"))).toBe("3 Sep");
    expect(dayMonth("nope")).toBe("");
    expect(dayMonth(undefined)).toBe("");
  });

  it("prints the UI-SPEC nothing-to-do line", () => {
    expect(alreadyAssembledLine("2026-10-07T10:00:00Z")).toBe(
      "Already assembled on 7 Oct. Use --rerun to rebuild untouched pages.",
    );
    expect(alreadyAssembledLine(undefined)).toBe(
      "Already assembled. Use --rerun to rebuild untouched pages.",
    );
  });
});
