// @vitest-environment jsdom
// Pipeline building blocks (13-34; STAFF-01, STAFF-03, STAFF-04; 13-UI-SPEC "Pipeline").
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import {
  FitCasePanel,
  LAUNCH_MOVE_WORDS,
  LaunchChecklist,
  LaunchMoveBadge,
  PIPELINE_COPY,
  SlotReport,
  fitTerms,
  highlightParts,
  sortSlots,
  type FitCaseView,
  type SlotReportRow,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const SLOTS: SlotReportRow[] = [
  {
    page: "Home",
    slot: "hero.title",
    source: "provided",
    filled: true,
    note: "",
  },
  {
    page: "Home",
    slot: "hero.image",
    source: "fallback",
    filled: false,
    note: "used the template photo",
  },
  {
    page: "About",
    slot: "story",
    source: "omitted",
    filled: false,
    note: "",
  },
];

describe("SlotReport", () => {
  it("lists filled and unfilled slots with counts, unfilled first, each unfilled row saying Unfilled", () => {
    mounted = mount(<SlotReport slots={SLOTS} />);
    const c = mounted.container;
    expect(c.textContent).toContain("1 filled · 2 unfilled");
    const rows = [...c.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Unfilled");
    expect(rows[1]!.textContent).toContain("Unfilled");
    expect(rows[2]!.textContent).toContain("Filled");
    expect(rows[2]!.textContent).not.toContain("Unfilled");
    expect(rows[2]!.textContent).toContain("Intake");
    expect(c.textContent).toContain("Default");
    expect(c.textContent).toContain("Empty");
    expect(c.querySelector("caption")?.textContent).toBe(
      PIPELINE_COPY.slots.caption,
    );
    expect(c.textContent).toContain("used the template photo");
  });

  it("says so when there is no report", () => {
    mounted = mount(<SlotReport slots={[]} />);
    expect(mounted.container.textContent).toBe(PIPELINE_COPY.slots.empty);
  });

  it("sortSlots puts unfilled first, then page and slot", () => {
    expect(sortSlots(SLOTS).map((s) => s.slot)).toEqual([
      "story",
      "hero.image",
      "hero.title",
    ]);
  });
});

describe("LaunchChecklist", () => {
  const checklist = {
    items: [
      { id: "pages", label: "Pages look right", done: true },
      { id: "contact", label: "Contact details checked", done: false },
    ],
    done: 1,
    total: 2,
    informational: true,
    note: "(owner review arrives in P14)",
  };

  it("shows the progress as text and the P14 note when informational", () => {
    mounted = mount(<LaunchChecklist checklist={checklist} />);
    const t = mounted.container.textContent ?? "";
    expect(t).toContain("1 of 2");
    expect(t).toContain("(owner review arrives in P14)");
    expect(t).toContain("Pages look right (done)");
    expect(t).toContain("Contact details checked (not done)");
  });

  it("drops the note once the list is real, and compact shows the line only", () => {
    mounted = mount(
      <LaunchChecklist
        compact
        checklist={{ ...checklist, informational: false }}
      />,
    );
    const t = mounted.container.textContent ?? "";
    expect(t).toBe("1 of 2");
  });

  it("14-36: the expanded list adds the owner review and the Domain line", () => {
    mounted = mount(
      <LaunchChecklist
        checklist={{ ...checklist, informational: false, note: "" }}
        move={{ code: "M-7", state: "prepared", domain: "riverabakery.com" }}
        reviewSent
      />,
    );
    const t = mounted.container.textContent ?? "";
    expect(t).toContain("Owner review: Sent");
    expect(t).toContain("Domain: Prepared · riverabakery.com");
    expect(mounted.container.querySelector(".font-mono")?.textContent).toBe(
      "riverabakery.com",
    );
  });

  it("14-36: the compact cell never shows the Domain line", () => {
    mounted = mount(
      <LaunchChecklist
        compact
        checklist={{ ...checklist, informational: false }}
        move={{ code: "M-7", state: "prepared", domain: "riverabakery.com" }}
        reviewSent={false}
      />,
    );
    expect(mounted.container.textContent).toBe("1 of 2");
  });
});

describe("LaunchMoveBadge (14-36)", () => {
  it("words per state, m-* tones, and ink-muted No domain", () => {
    const words = (m: Parameters<typeof LAUNCH_MOVE_WORDS.state>[0]) =>
      LAUNCH_MOVE_WORDS.state(m);
    expect(words({ code: "M-1", state: "prepared" })).toBe("Prepared");
    expect(words({ code: "M-1", state: "waiting_owner" })).toBe(
      "Waiting on nameservers",
    );
    expect(words({ code: "M-1", state: "gate_review" })).toBe(
      "Gate: needs review",
    );
    expect(words({ code: "M-1", state: "failed", failedStep: 8 })).toBe(
      "Failed · step 8",
    );
    expect(words({ code: null, state: "none" })).toBe("No domain");

    mounted = mount(
      <LaunchMoveBadge
        move={{ code: "M-1", state: "failed", failedStep: 8 }}
      />,
    );
    const failed = mounted.container.firstElementChild as HTMLElement;
    expect(failed.className).toContain("text-hub-danger");
    expect(failed.querySelector("svg")).not.toBeNull();
    mounted.unmount();

    mounted = mount(<LaunchMoveBadge move={{ code: null, state: "none" }} />);
    const none = mounted.container.firstElementChild as HTMLElement;
    expect(none.textContent).toBe("No domain");
    expect(none.className).toContain("text-hub-ink-muted");
  });
});

describe("FitCasePanel", () => {
  const hold: FitCaseView = {
    orgId: "aaaaaaaaaaaaaaa",
    name: "Rivera Bakery",
    businessType: "Food",
    description: "Cakes and Firearms classes",
    verdict: "blocked",
    reasons: ["keyword: firearms", "business type: other"],
    fields: [
      { field: "Business name", text: "Rivera Bakery" },
      { field: "Description", text: "Cakes and Firearms classes" },
    ],
    heldSince: "2 business days",
  };

  it("shows the blocked verdict with its reasons and the override label", () => {
    mounted = mount(
      <FitCasePanel
        hold={hold}
        siteHref="/staff/sites/aaaaaaaaaaaaaaa"
        actions={<button type="button">Approve fit</button>}
      />,
    );
    const c = mounted.container;
    expect(c.textContent).toContain("Blocked");
    expect(c.textContent).toContain("keyword: firearms");
    expect(c.textContent).toContain("business type: other");
    expect(c.textContent).toContain(PIPELINE_COPY.fit.blockedLabel);
    expect(c.textContent).toContain("2 business days");
    const marks = [...c.querySelectorAll("mark")].map((m) => m.textContent);
    expect(marks).toEqual(["Firearms"]);
    expect(c.querySelector("a")?.getAttribute("href")).toBe(
      "/staff/sites/aaaaaaaaaaaaaaa",
    );
    expect(c.querySelector("button")?.textContent).toBe("Approve fit");
  });

  it("a review verdict has no override label", () => {
    mounted = mount(
      <FitCasePanel hold={{ ...hold, verdict: "review", reasons: [] }} />,
    );
    expect(mounted.container.textContent).toContain("Needs review");
    expect(mounted.container.textContent).not.toContain(
      PIPELINE_COPY.fit.blockedLabel,
    );
    expect(mounted.container.querySelector("mark")).toBeNull();
  });
});

describe("helpers", () => {
  it("fitTerms reads keyword reasons only", () => {
    expect(
      fitTerms(["keyword: Guns", "business type: x", "keyword: guns"]),
    ).toEqual(["guns"]);
  });

  it("highlightParts is case-insensitive and escapes regex characters", () => {
    expect(highlightParts("a C++ b", ["c++"])).toEqual([
      { text: "a ", match: false },
      { text: "C++", match: true },
      { text: " b", match: false },
    ]);
    expect(highlightParts("plain", [])).toEqual([
      { text: "plain", match: false },
    ]);
  });
});
