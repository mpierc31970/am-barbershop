// @vitest-environment jsdom
// CaseTimeline + OutcomeBar (13-38 Task 2; D249, D-UI-P13-10).
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, click, mount, type Mounted } from "../../test-support/dom";
import {
  CaseTimeline,
  caseNextSteps,
  OutcomeBar,
  REVIEW_COPY,
  type CaseTimelineEntry,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const TZ = "America/Chicago";
const C = REVIEW_COPY;

describe("CaseTimeline", () => {
  const entries: CaseTimelineEntry[] = [
    { step: "received", at: "2026-10-12T15:00:00.000Z", byName: "Public form" },
    { step: "content_disabled", at: "2026-10-12T16:30:00.000Z", byName: "You" },
    { step: "tenant_notified", at: "2026-10-13T14:00:00.000Z", byName: "You" },
  ];

  it("renders done steps with times and only the next allowed step buttons", () => {
    const onStep = vi.fn();
    mounted = mount(
      <CaseTimeline
        kind="dmca"
        entries={entries}
        timeZone={TZ}
        onStep={onStep}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Received");
    expect(text).toContain("Mon 12 Oct, 10:00 am · by Public form");
    expect(text).toContain("Tue 13 Oct, 9:00 am · by You");
    const labels = Array.from(mounted.container.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual([
      C.stepActions.counter_notice,
      C.stepActions.upheld,
    ]);
    expect(
      button(mounted.container, C.stepActions.restore_date_set),
    ).toBeNull();
    expect(button(mounted.container, C.stepActions.closed)).toBeNull();
    const current = mounted.container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain(`${C.next}:`);
    expect(current?.textContent).toContain(C.steps.counter_notice);
    click(button(mounted.container, C.stepActions.counter_notice));
    expect(onStep).toHaveBeenCalledWith("counter_notice");
  });

  it("shows the restore date line and hides buttons when read-only", () => {
    mounted = mount(
      <CaseTimeline
        kind="dmca"
        readOnly
        entries={[
          ...entries,
          { step: "counter_notice", at: "2026-10-14T15:00:00.000Z" },
          {
            step: "restore_date_set",
            at: "2026-10-14T16:00:00.000Z",
            restoreDate: "2026-10-30T17:00:00.000Z",
          },
        ]}
        timeZone={TZ}
      />,
    );
    expect(mounted.container.textContent).toContain(
      "Restore after Fri 30 Oct (10 business days)",
    );
    expect(mounted.container.querySelectorAll("button").length).toBe(0);
  });

  it("reports skip the DMCA-only steps", () => {
    mounted = mount(
      <CaseTimeline
        kind="report"
        entries={entries.slice(0, 1)}
        timeZone={TZ}
      />,
    );
    const text = mounted.container.textContent ?? "";
    expect(text).not.toContain(C.steps.counter_notice);
    expect(text).toContain(C.steps.closed);
    expect(caseNextSteps("report", "tenant_notified")).toEqual(["closed"]);
    expect(caseNextSteps("dmca", "restore_date_set")).toEqual([
      "restored",
      "upheld",
    ]);
    expect(caseNextSteps("spot_check", "received")).toEqual([]);
  });
});

describe("OutcomeBar", () => {
  it("renders four secondary buttons and no primary", () => {
    const onOutcome = vi.fn();
    mounted = mount(<OutcomeBar onOutcome={onOutcome} />);
    const buttons = Array.from(mounted.container.querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Clear hold",
      "Ask to fix",
      "Remove content",
      "Suspend…",
    ]);
    for (const b of buttons) {
      expect(b.className).not.toMatch(/bg-hub-accent\b/);
      expect(b.className).not.toMatch(/bg-hub-danger\b/);
    }
    click(button(mounted.container, "Ask to fix"));
    expect(onOutcome).toHaveBeenCalledWith("fix_requested");
  });

  it("locks super-only outcomes with the hint and drops hidden ones", () => {
    mounted = mount(
      <OutcomeBar
        onOutcome={() => {}}
        hidden={["removed"]}
        superOnly={["suspended"]}
      />,
    );
    expect(button(mounted.container, "Remove content")).toBeNull();
    const suspend = button(mounted.container, "Suspend…");
    expect(suspend?.disabled).toBe(true);
    const hint = suspend?.getAttribute("aria-describedby");
    expect(hint && document.getElementById(hint)?.textContent).toBe(
      "Super Admin only",
    );
  });
});
