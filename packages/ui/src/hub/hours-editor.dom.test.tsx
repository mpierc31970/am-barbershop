// @vitest-environment jsdom
// 06-19 Task 1: HoursEditor (06-UI-SPEC "Hours editor", Accessibility "HoursEditor",
// Copywriting hours rows; ONB-13, D257, D119, D-UI-P6-22, D-UI-P6-23).
import type { WeeklyHours } from "@cds/core/intake";
import { emptyWeeklyHours } from "@cds/core/intake";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPY_WEEKDAYS_TOAST,
  HOURS_EMPTY_HELPER,
  HoursEditor,
  TIME_OPTIONS,
  hoursRowErrors,
  timeLabel,
} from "./HoursEditor";
import { ToastRegion } from "./Toast";
import { button, click, mount, type Mounted } from "../test-support/dom";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const changes = vi.fn();

function Harness({
  initial = null,
  readOnly = false,
}: {
  initial?: WeeklyHours | null;
  readOnly?: boolean;
}) {
  const [v, setV] = useState<WeeklyHours | null>(initial);
  return (
    <ToastRegion>
      <HoursEditor
        value={v}
        timeZone="America/Chicago"
        readOnly={readOnly}
        onChange={(next) => {
          changes(next);
          setV(next);
        }}
      />
    </ToastRegion>
  );
}

function latest(): WeeklyHours {
  return changes.mock.calls.at(-1)![0] as WeeklyHours;
}

function sel(root: HTMLElement, label: string): HTMLSelectElement {
  const el = root.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`,
  );
  if (!el) throw new Error(`no select ${label}`);
  return el;
}

function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function sw(root: HTMLElement, label: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`,
  );
  if (!el) throw new Error(`no switch ${label}`);
  return el;
}

describe("HoursEditor", () => {
  it("seven rows, Monday first, all closed with the empty helper and the time zone", () => {
    changes.mockReset();
    mounted = mount(<Harness />);
    const days = Array.from(
      mounted.container.querySelectorAll("fieldset[data-day] legend"),
    ).map((l) => l.textContent);
    expect(days).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    const text = mounted.container.textContent ?? "";
    expect(text).toContain("Times are in America/Chicago.");
    expect(text).toContain(HOURS_EMPTY_HELPER);
    expect(text).toContain("Closed");
    expect(text).toContain(
      "Open past midnight? Set the day to close at 11:45 pm and tell CDS.",
    );
  });

  it("opening Monday shows one 9:00 am to 5:00 pm range with labelled selects", () => {
    changes.mockReset();
    mounted = mount(<Harness />);
    click(sw(mounted.container, "Open on Monday"));
    expect(latest().mon).toEqual({
      open: true,
      ranges: [{ start: "09:00", end: "17:00" }],
    });
    expect(sel(mounted.container, "Monday opens at").value).toBe("09:00");
    expect(sel(mounted.container, "Monday closes at").value).toBe("17:00");
    const opts = sel(mounted.container, "Monday opens at").options;
    expect(opts).toHaveLength(96);
    expect(opts[36]?.textContent).toBe("9:00 am");
  });

  it("Add hours adds a second range for a split day; its remove button names it", () => {
    changes.mockReset();
    const h = emptyWeeklyHours();
    h.mon = { open: true, ranges: [{ start: "09:00", end: "12:00" }] };
    mounted = mount(<Harness initial={h} />);
    click(button(mounted.container, "Add another time range on Monday"));
    expect(latest().mon.ranges).toEqual([
      { start: "09:00", end: "12:00" },
      { start: "13:00", end: "17:00" },
    ]);
    const remove = button(
      mounted.container,
      "Remove Monday 1:00 pm to 5:00 pm",
    );
    expect(remove).not.toBeNull();
    click(remove);
    expect(latest().mon.ranges).toEqual([{ start: "09:00", end: "12:00" }]);
  });

  it("Copy Monday to weekdays copies to Tuesday-Friday, with Undo", () => {
    changes.mockReset();
    const h = emptyWeeklyHours();
    h.mon = { open: true, ranges: [{ start: "08:00", end: "16:00" }] };
    h.sat = { open: true, ranges: [{ start: "10:00", end: "14:00" }] };
    mounted = mount(<Harness initial={h} />);
    click(button(mounted.container, "Copy Monday to weekdays"));
    const v = latest();
    for (const d of ["tue", "wed", "thu", "fri"] as const) {
      expect(v[d]).toEqual({
        open: true,
        ranges: [{ start: "08:00", end: "16:00" }],
      });
    }
    expect(v.sat.ranges).toEqual([{ start: "10:00", end: "14:00" }]);
    expect(mounted.container.textContent).toContain(COPY_WEEKDAYS_TOAST);
    click(button(mounted.container, "Undo"));
    expect(latest().tue).toEqual({ open: false, ranges: [] });
  });

  it("an end before the start shows the row error in UI-SPEC copy", () => {
    changes.mockReset();
    const h = emptyWeeklyHours();
    h.mon = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
    mounted = mount(<Harness initial={h} />);
    choose(sel(mounted.container, "Monday closes at"), "08:00");
    expect(mounted.container.textContent).toContain(
      "Monday's closing time is before its opening time. Pick a later closing time.",
    );
    expect(
      sel(mounted.container, "Monday closes at").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("overlapping ranges show the overlap copy", () => {
    const h = emptyWeeklyHours();
    h.tue = {
      open: true,
      ranges: [
        { start: "09:00", end: "13:00" },
        { start: "12:00", end: "17:00" },
      ],
    };
    expect(hoursRowErrors(h)).toEqual({
      tue: "Tuesday's times overlap. Adjust one range.",
    });
  });

  it("read-only disables the controls and hides the shortcut", () => {
    const h = emptyWeeklyHours();
    h.mon = { open: true, ranges: [{ start: "09:00", end: "17:00" }] };
    mounted = mount(<Harness initial={h} readOnly />);
    expect(sel(mounted.container, "Monday opens at").disabled).toBe(true);
    expect(sw(mounted.container, "Open on Monday").disabled).toBe(true);
    expect(button(mounted.container, "Copy Monday to weekdays")).toBeNull();
  });

  it("12-hour labels", () => {
    expect(timeLabel("00:00")).toBe("12:00 am");
    expect(timeLabel("12:00")).toBe("12:00 pm");
    expect(timeLabel("23:45")).toBe("11:45 pm");
    expect(TIME_OPTIONS.at(-1)).toEqual({ value: "23:45", label: "11:45 pm" });
  });
});
