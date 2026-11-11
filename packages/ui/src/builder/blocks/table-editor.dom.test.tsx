// @vitest-environment jsdom
// TableEditor in a real DOM (07-21 Task 2; CONT-26, D120; UI-SPEC row "Table").
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  defaultTableBlock,
  newTableCell,
  PRO_TABLE_LIMIT_COPY,
  TABLE_LIMIT_COPY,
  type TableBlockContent,
} from "@cds/core/content";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { BuilderPlanProvider, type BuilderPlan } from "./business-context";
import { PAUSED_PRO_TABLE_COPY, TableEditor } from "./TableEditor";

beforeAll(() => {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal: () => void;
    close: () => void;
  };
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    };
  }
});

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function harness(initial: TableBlockContent, plan?: BuilderPlan) {
  const calls: [string, unknown][] = [];
  let current: Record<string, unknown> = { ...initial };
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(current);
    return (
      <TableEditor
        type="table"
        content={content}
        errors={{}}
        popups={[]}
        onChange={(name, value) => {
          calls.push([name, value]);
          current = { ...current, [name]: value };
          setContent(current);
        }}
      />
    );
  }
  mounted = mount(
    <ToastRegion>
      {plan ? (
        <BuilderPlanProvider value={plan}>
          <Host />
        </BuilderPlanProvider>
      ) : (
        <Host />
      )}
    </ToastRegion>,
  );
  return {
    calls,
    root: mounted.container,
    content: () => current as unknown as TableBlockContent,
  };
}

const cell = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);

function paste(el: Element | null, text: string) {
  if (!el) throw new Error("paste: element not found");
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: { getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

function sized(rows: number, cols: number): TableBlockContent {
  return {
    ...defaultTableBlock(),
    align: Array.from({ length: cols }, () => "left" as const),
    rows: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => newTableCell(`r${r}c${c}`)),
    ),
  };
}

describe("TableEditor", () => {
  it("renders the default 3x3 as named inputs", () => {
    const { root } = harness(defaultTableBlock());
    expect(root.querySelectorAll("input[data-cell]")).toHaveLength(9);
    expect(cell(root, "Row 1, Column 1")?.value).toBe("Column 1");
    expect(cell(root, "Row 3, Column 3")).not.toBeNull();
  });

  it("typing updates rows through onChange", () => {
    const { root, calls, content } = harness(defaultTableBlock());
    typeInto(cell(root, "Row 2, Column 2"), "Basic");
    expect(calls.some(([n]) => n === "rows")).toBe(true);
    expect(content().rows[1]![1]!.text).toBe("Basic");
  });

  it("a spreadsheet paste grows the grid, toasts and Undo restores", () => {
    const { root, content } = harness(defaultTableBlock());
    const ev = paste(cell(root, "Row 2, Column 2"), "a\tb\tc\nd\te\tf\n");
    expect(ev.defaultPrevented).toBe(true);
    expect(content().rows[1]![1]!.text).toBe("a");
    expect(content().rows[2]![3]!.text).toBe("f");
    expect(content().rows[0]).toHaveLength(4);
    expect(content().align).toHaveLength(4);
    expect(root.textContent).toContain("Pasted 2 rows and 3 columns.");
    click(button(root, "Undo"));
    expect(content().rows[0]).toHaveLength(3);
    expect(content().rows[1]![1]!.text).toBe("");
  });

  it("a single-cell paste is left to the browser", () => {
    const { root, calls } = harness(defaultTableBlock());
    const ev = paste(cell(root, "Row 2, Column 2"), "hello");
    expect(ev.defaultPrevented).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("an oversize paste shows the limit copy and changes nothing", () => {
    const { root, calls } = harness(defaultTableBlock());
    const wide = Array.from({ length: 12 }, (_, i) => `c${i}`).join("\t");
    paste(cell(root, "Row 2, Column 1"), `${wide}\n${wide}`);
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(TABLE_LIMIT_COPY);
    expect(calls).toHaveLength(0);
  });

  it("Add column is disabled at 10 columns with the limit helper", () => {
    const { root } = harness(sized(2, 10));
    expect(button(root, "Add column")?.disabled).toBe(true);
    expect(button(root, "Add row")?.disabled).toBe(false);
    expect(root.textContent).toContain(TABLE_LIMIT_COPY);
  });

  it("Bold on the focused cell sets bold: true", () => {
    const { root, content } = harness(defaultTableBlock());
    const target = cell(root, "Row 2, Column 3")!;
    act(() => target.focus());
    const bold = button(root, "Bold")!;
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    click(bold);
    expect(content().rows[1]![2]!.bold).toBe(true);
    expect(button(root, "Bold")!.getAttribute("aria-pressed")).toBe("true");
  });

  it("Link applies a safe link and refuses an unsafe one inline", () => {
    const { root, content } = harness(defaultTableBlock());
    act(() => cell(root, "Row 2, Column 1")!.focus());
    click(button(root, "Link"));
    const field = root.querySelector<HTMLInputElement>(
      'input[id$="-link-field"]',
    )!;
    typeInto(field, "javascript:alert(1)");
    click(button(root, "Apply"));
    expect(content().rows[1]![0]!.link).toBe("");
    expect(root.querySelector('[id$="-link-field-error"]')).not.toBeNull();
    typeInto(field, "/contact");
    click(button(root, "Apply"));
    expect(content().rows[1]![0]!.link).toBe("/contact");
  });

  it("row options insert and delete rows", () => {
    const { root, content } = harness(defaultTableBlock());
    click(button(root, "Row 2 options"));
    click(button(root, "Insert below"));
    expect(content().rows).toHaveLength(4);
    click(button(root, "Row 1 options"));
    click(button(root, "Delete row"));
    expect(content().rows).toHaveLength(3);
    expect(content().rows[0]![0]!.text).toBe("");
  });

  it("shows 50 rows until Show all N rows", () => {
    const { root } = harness(sized(184, 2));
    expect(root.querySelectorAll("tbody tr")).toHaveLength(50);
    click(button(root, "Show all 184 rows"));
    expect(root.querySelectorAll("tbody tr")).toHaveLength(184);
  });

  it("Export CSV downloads a .csv file", () => {
    const create = vi.fn(() => "blob:x");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: () => {},
    });
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    const { root } = harness({ ...defaultTableBlock(), heading: "Our prices" });
    click(button(root, "Export CSV"));
    expect(create).toHaveBeenCalledTimes(1);
    expect(clicked).toEqual(["our-prices.csv"]);
  });

  it("options write header_row, striped and mobile", () => {
    const { root, content } = harness(defaultTableBlock());
    const sw = (label: string) =>
      document.getElementById(
        Array.from(root.querySelectorAll("label")).find(
          (l) => l.textContent === label,
        )!.htmlFor,
      ) as HTMLInputElement;
    click(sw("Striped rows"));
    expect(content().striped).toBe(true);
    click(sw("Header row"));
    expect(content().header_row).toBe(false);
    const cards = root.querySelector<HTMLInputElement>(
      'input[type="radio"][value="cards"]',
    )!;
    click(cards);
    expect(content().mobile).toBe("cards");
  });
});

/** Pick a select option the way React's onChange sees it. */
function change(el: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const PRO_OWNER: BuilderPlan = { builderPro: true, canBuy: true };
const FREE_OWNER: BuilderPlan = { builderPro: false, canBuy: true };
const FREE_EDITOR: BuilderPlan = { builderPro: false, canBuy: false };

const sw = (root: HTMLElement, label: string) =>
  Array.from(
    root.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
  ).find((el) => el.labels?.[0]?.textContent === label);

describe("TableEditor with Builder Pro (10-41)", () => {
  it("the Builder Pro switches set pro.*", () => {
    const { root, content } = harness(defaultTableBlock(), PRO_OWNER);
    expect(root.querySelector("[data-feature-lock]")).toBeNull();
    click(sw(root, "Let visitors sort by column"));
    expect(content().pro?.sortable).toBe(true);
    click(sw(root, "Show 25 rows per page"));
    expect(content().pro?.paged).toBe(true);
    expect(content().pro?.sortable).toBe(true);
  });

  it("Add column goes past 10 and stops at 20 with the Pro copy", () => {
    const { root, content } = harness(sized(2, 10), PRO_OWNER);
    expect(button(root, "Add column")?.disabled).toBe(false);
    click(button(root, "Add column"));
    expect(content().rows[0]).toHaveLength(11);
    mounted?.unmount();
    const twenty = harness(sized(2, 20), PRO_OWNER);
    expect(button(twenty.root, "Add column")?.disabled).toBe(true);
    expect(twenty.root.textContent).toContain(PRO_TABLE_LIMIT_COPY);
  });

  it("the cell toolbar sets an icon on the focused cell", () => {
    const { root, content } = harness(defaultTableBlock(), PRO_OWNER);
    act(() => cell(root, "Row 2, Column 2")!.focus());
    const select = root.querySelector<HTMLSelectElement>(
      'select[aria-label="Icon for this cell"]',
    )!;
    expect(select.disabled).toBe(false);
    change(select, "yes");
    expect(content().rows[1]![1]!.icon).toBe("yes");
  });

  it("the row menu makes a section heading; the column menu sets width and highlight", () => {
    const { root, content } = harness(defaultTableBlock(), PRO_OWNER);
    click(button(root, "Row 2 options"));
    click(button(root, "Make section heading"));
    expect(content().pro?.section_rows).toEqual([1]);
    click(button(root, "Column 3 options"));
    click(button(root, "Highlight this column"));
    expect(content().pro?.highlight).toEqual({ column: 2, label: "" });
    click(button(root, "Column 1 options"));
    const width = Array.from(root.querySelectorAll("label"))
      .find((l) => l.textContent?.startsWith("Column width"))!
      .querySelector("select")!;
    change(width, "wide");
    expect(content().pro?.widths).toEqual(["wide", "auto", "auto"]);
  });
});

describe("TableEditor without Builder Pro (10-41)", () => {
  it("owner: lock panel with Add Builder Pro, disabled Icon select, P7 limits", () => {
    const { root } = harness(sized(2, 10), FREE_OWNER);
    const lock = root.querySelector('section[data-feature-lock="builder-pro"]');
    expect(lock?.textContent).toContain("Part of Builder Pro");
    expect(lock?.querySelector("a")?.textContent).toBe("Add Builder Pro");
    expect(sw(root, "Let visitors sort by column")).toBeUndefined();
    expect(
      root.querySelector<HTMLSelectElement>(
        'select[aria-label="Icon for this cell"]',
      )?.disabled,
    ).toBe(true);
    expect(button(root, "Add column")?.disabled).toBe(true);
    expect(root.textContent).toContain(TABLE_LIMIT_COPY);
    click(button(root, "Row 1 options"));
    expect(button(root, "Make section heading")).toBeNull();
  });

  it("editor: asks the site owner, no buy link", () => {
    const { root } = harness(defaultTableBlock(), FREE_EDITOR);
    expect(root.textContent).toContain(
      "Ask your site owner to add Builder Pro.",
    );
    expect(
      Array.from(root.querySelectorAll("a")).some(
        (a) => a.textContent === "Add Builder Pro",
      ),
    ).toBe(false);
  });

  it("lapsed table: paused copy and its Pro settings read-only", () => {
    const lapsed = {
      ...defaultTableBlock(),
      pro: {
        sticky: false,
        sortable: true,
        searchable: false,
        paged: false,
        highlight: null,
        widths: [],
        section_rows: [],
      },
    } as TableBlockContent;
    const { root, calls } = harness(lapsed, FREE_OWNER);
    expect(root.textContent).toContain(PAUSED_PRO_TABLE_COPY);
    const sort = sw(root, "Let visitors sort by column")!;
    expect(sort.checked).toBe(true);
    expect(sort.disabled).toBe(true);
    // Text edits still go through and keep pro untouched.
    typeInto(cell(root, "Row 2, Column 1"), "x");
    expect(calls.some(([n]) => n === "pro")).toBe(false);
  });
});
