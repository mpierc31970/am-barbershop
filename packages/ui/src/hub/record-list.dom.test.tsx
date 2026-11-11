// @vitest-environment jsdom
// RecordList (05-06; 05-UI-SPEC "Add-on tabs" item 4, "Credentials tab" grouped list,
// "Accessibility contract"; D-UI-P5-17). Moves go through the row's Move up / Move down
// handle (the WCAG 2.5.7 non-drag path, the same path as keyboard drag); the pure move
// planner and announcements carry the drag rules.
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, click, flush, mount, type Mounted } from "../test-support/dom";
import {
  RecordList,
  groupedOrder,
  planRecordMove,
  recordAnnouncements,
  refusedMoveCopy,
} from "./RecordList";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

type Rec = { id: string; name: string; group?: string };

const people: Rec[] = [
  { id: "a", name: "Maria Lopez" },
  { id: "b", name: "Sam Chen" },
  { id: "c", name: "Ada Park" },
];

function renderList(
  items: Rec[],
  onReorder: (ids: string[]) => Promise<boolean>,
  grouped = false,
  readOnly = false,
) {
  mounted = mount(
    <RecordList
      items={items}
      noun={grouped ? "credential" : "testimonial"}
      label={(r) => (grouped ? r.name : `from ${r.name}`)}
      onReorder={onReorder}
      groupOf={grouped ? (r) => r.group ?? "" : undefined}
      readOnly={readOnly}
      renderRow={(r, h) => (
        <>
          <span data-name="">{r.name}</span>
          <button
            type="button"
            aria-label={`Move ${r.name} up`}
            disabled={!h.canMoveUp}
            onClick={h.moveUp}
          >
            Move up
          </button>
          <button
            type="button"
            aria-label={`Move ${r.name} down`}
            disabled={!h.canMoveDown}
            onClick={h.moveDown}
          >
            Move down
          </button>
        </>
      )}
    />,
  );
  return mounted.container;
}

const order = (el: HTMLElement) =>
  Array.from(el.querySelectorAll("[data-name]")).map((n) => n.textContent);

describe("RecordList flat", () => {
  it("names each drag handle after its record and uses 64px rows", () => {
    const el = renderList(people, async () => true);
    expect(button(el, "Reorder testimonial from Maria Lopez")).not.toBeNull();
    expect(el.querySelector("li > div")?.className).toContain("min-h-16");
    expect(el.querySelector("ol")?.getAttribute("aria-label")).toBe(
      "Your testimonials",
    );
  });

  it("Move down saves the new id order and shows it at once", async () => {
    const onReorder = vi.fn(async () => true);
    const el = renderList(people, onReorder);
    click(button(el, "Move Maria Lopez down"));
    expect(order(el)).toEqual(["Sam Chen", "Maria Lopez", "Ada Park"]);
    await flush();
    expect(onReorder).toHaveBeenCalledWith(["b", "a", "c"]);
  });

  it("a failed save snaps the list back to the original order", async () => {
    const onReorder = vi.fn(async () => false);
    const el = renderList(people, onReorder);
    click(button(el, "Move Ada Park up"));
    expect(order(el)).toEqual(["Maria Lopez", "Ada Park", "Sam Chen"]);
    await flush();
    expect(onReorder).toHaveBeenCalledOnce();
    expect(order(el)).toEqual(["Maria Lopez", "Sam Chen", "Ada Park"]);
  });

  it("Move up is unavailable on the first row, Move down on the last", () => {
    const el = renderList(people, async () => true);
    expect(button(el, "Move Maria Lopez up")!.disabled).toBe(true);
    expect(button(el, "Move Maria Lopez down")!.disabled).toBe(false);
    expect(button(el, "Move Ada Park down")!.disabled).toBe(true);
  });

  it("C-WR-05: read-only has no drag handles and no moves", async () => {
    const onReorder = vi.fn(async () => true);
    const el = renderList(people, onReorder, false, true);
    expect(button(el, /^Reorder /)).toBeNull();
    expect(button(el, "Move Maria Lopez down")!.disabled).toBe(true);
    expect(button(el, "Move Sam Chen up")!.disabled).toBe(true);
    expect(order(el)).toEqual(["Maria Lopez", "Sam Chen", "Ada Park"]);
    await flush();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("keyboard pick-up announces the record by name", async () => {
    const el = renderList(people, async () => true);
    const handle = button(el, "Reorder testimonial from Sam Chen")!;
    act(() => {
      handle.focus();
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Space",
          key: " ",
          bubbles: true,
        }),
      );
    });
    await flush();
    // jsdom has no layout (every rect is 0x0), so dnd-kit immediately reports an "over"
    // after the pick-up; either line names the record, which is the contract here.
    expect(document.body.textContent).toMatch(
      /(Picked up testimonial from Sam Chen\. Position 2 of 3\.|testimonial from Sam Chen moved to position \d of 3\.)/,
    );
    act(() => {
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: "Escape",
          key: "Escape",
          bubbles: true,
        }),
      );
    });
    await flush();
  });
});

const creds: Rec[] = [
  { id: "rn", name: "RN License", group: "Licenses" },
  { id: "aana", name: "AANA", group: "Memberships" },
  { id: "cpr", name: "CPR", group: "" },
  { id: "lpn", name: "LPN License", group: "Licenses" },
];

describe("RecordList grouped", () => {
  it("renders group headers with counts, first-seen order, Other last", () => {
    const el = renderList(creds, async () => true, true);
    const headers = Array.from(el.querySelectorAll("[data-group-header]")).map(
      (h) => h.textContent,
    );
    expect(headers).toEqual(["Licenses · 2", "Memberships · 1", "Other · 1"]);
    expect(order(el)).toEqual(["RN License", "LPN License", "AANA", "CPR"]);
    const header = el.querySelector("[data-group-header]")!;
    expect(header.className).toContain("h-10");
    expect(header.className).toContain("bg-hub-surface-2");
  });

  it("Move up / down stop at group edges and moves stay inside the group", async () => {
    const onReorder = vi.fn(async () => true);
    const el = renderList(creds, onReorder, true);
    expect(button(el, "Move LPN License down")!.disabled).toBe(true);
    expect(button(el, "Move AANA up")!.disabled).toBe(true);
    expect(button(el, "Move AANA down")!.disabled).toBe(true);
    click(button(el, "Move LPN License up"));
    await flush();
    expect(onReorder).toHaveBeenCalledWith(["lpn", "rn", "aana", "cpr"]);
  });

  it("refuses a drop onto another group's row and says why", () => {
    const ids = groupedOrder(creds, (r) => r.group ?? "").map((r) => r.id);
    const groupOfId = (id: string) => {
      const g = creds.find((c) => c.id === id)?.group ?? "";
      return g === "" ? "Other" : g;
    };
    expect(planRecordMove(ids, "rn", "aana", groupOfId)).toEqual({
      kind: "refused",
      group: "Memberships",
    });
    expect(planRecordMove(ids, "rn", "lpn", groupOfId)).toEqual({
      kind: "move",
      next: ["lpn", "rn", "aana", "cpr"],
    });
    expect(refusedMoveCopy("RN License", "Memberships")).toBe(
      "Can't move RN License into Memberships. Change its group instead.",
    );

    const a = recordAnnouncements({
      nameOf: (id) => `credential ${creds.find((c) => c.id === id)!.name}`,
      labelOf: (id) => creds.find((c) => c.id === id)!.name,
      positionOf: (id) => ({
        pos: id === "lpn" ? 2 : 1,
        total: groupOfId(id) === "Licenses" ? 2 : 1,
      }),
      groupOfId,
    });
    const active = { id: "rn" } as never;
    expect(a.onDragStart({ active })).toBe(
      "Picked up credential RN License. Position 1 of 2.",
    );
    expect(a.onDragOver({ active, over: { id: "aana" } } as never)).toBe(
      "Can't move RN License into Memberships. Change its group instead.",
    );
    expect(a.onDragEnd({ active, over: { id: "aana" } } as never)).toBe(
      "Can't move RN License into Memberships. Change its group instead.",
    );
    expect(a.onDragEnd({ active, over: { id: "lpn" } } as never)).toBe(
      "credential RN License dropped at position 2 of 2.",
    );
  });
});
