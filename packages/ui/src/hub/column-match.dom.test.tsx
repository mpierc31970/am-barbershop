// @vitest-environment jsdom
// 07-16 Task 2: ColumnMatchStep (D120, D-UI-P7-22; 07-UI-SPEC "Contacts CSV import" step 2).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { button, click, mount, type Mounted } from "../test-support/dom";
import {
  ColumnMatchStep,
  assignColumn,
  normalizeMapping,
} from "./ColumnMatchStep";

const TARGETS = [
  { value: "name", label: "Name" },
  { value: "first_name", label: "First name" },
  { value: "last_name", label: "Last name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "tags", label: "Tags" },
  { value: "skip", label: "Don't import" },
];
const COPY = "Match a column to Email. Every contact needs one.";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function render(over: Partial<Parameters<typeof ColumnMatchStep>[0]> = {}): {
  onNext: ReturnType<typeof vi.fn>;
  root: HTMLElement;
} {
  const onNext = vi.fn();
  mounted = mount(
    <ColumnMatchStep
      header={["E-mail Address", "Full", "Notes"]}
      examples={["maria@example.com", "Maria Lopez", "x".repeat(80)]}
      suggested={["email", "name", "skip"]}
      targets={TARGETS}
      skipValue="skip"
      requiredValue="email"
      requiredCopy={COPY}
      onNext={onNext}
      onBack={vi.fn()}
      {...over}
    />,
  );
  return { onNext, root: mounted.container };
}

function selects(root: HTMLElement): HTMLSelectElement[] {
  return Array.from(root.querySelectorAll("select"));
}

function choose(sel: HTMLSelectElement, value: string): void {
  act(() => {
    sel.value = value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("ColumnMatchStep", () => {
  it("presets each column from the suggestion and shows a cut example", () => {
    const { root } = render();
    expect(selects(root).map((s) => s.value)).toEqual([
      "email",
      "name",
      "skip",
    ]);
    expect(root.textContent).toContain("E-mail Address");
    expect(root.textContent).toContain("maria@example.com");
    expect(root.textContent).toContain(`${"x".repeat(39)}…`);
    expect(root.textContent).not.toContain("x".repeat(41));
    expect(selects(root)[0]!.getAttribute("aria-label")).toBe(
      "Goes to, for E-mail Address",
    );
  });

  it("choosing a target another column has moves that column to Don't import", () => {
    const { root } = render();
    choose(selects(root)[2]!, "email");
    expect(selects(root).map((s) => s.value)).toEqual([
      "skip",
      "name",
      "email",
    ]);
  });

  it("with no Email column, MATCH-EMAIL shows and Next is disabled and points at it", () => {
    const { root, onNext } = render();
    choose(selects(root)[0]!, "skip");
    expect(root.textContent).toContain(COPY);
    const next = button(root, "Next: check rows")!;
    expect(next.disabled).toBe(true);
    const alertId = next.getAttribute("aria-describedby")!;
    expect(
      root.querySelector(`#${CSS.escape(alertId)}`)?.textContent,
    ).toContain(COPY);
    click(next);
    expect(onNext).not.toHaveBeenCalled();
  });

  it("Next sends the mapping", () => {
    const { root, onNext } = render();
    choose(selects(root)[2]!, "tags");
    click(button(root, "Next: check rows"));
    expect(onNext).toHaveBeenCalledWith(["email", "name", "tags"]);
  });

  it("a suggestion with repeats or unknown targets is made valid", () => {
    expect(
      normalizeMapping(
        ["a", "b", "c"],
        ["email", "email", "bogus"],
        TARGETS,
        "skip",
      ),
    ).toEqual(["email", "skip", "skip"]);
    expect(assignColumn(["email", "skip"], 1, "skip", "skip")).toEqual([
      "email",
      "skip",
    ]);
  });
});
