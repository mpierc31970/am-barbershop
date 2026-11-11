// @vitest-environment jsdom
// Staff table primitives (13-07 Task 2; 13-UI-SPEC "StaffTable columns", "Accessibility
// contract", D-UI-P13-2, D-UI-P13-19).
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import {
  AgeCell,
  FilterBar,
  KeyHint,
  PriorityCell,
  QuickFilters,
  SlaCell,
  StaffTable,
  StageChips,
  type StaffColumn,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

interface Ticket {
  number: number;
  site: string;
  subject: string;
}

const ROWS: Ticket[] = [
  { number: 1042, site: "Rivera Bakery", subject: "Menu page broken" },
  { number: 1043, site: "Oak Dental", subject: "Change hours" },
  { number: 1044, site: "Lee Studio", subject: "Billing question" },
];

const COLUMNS: StaffColumn<Ticket>[] = [
  {
    id: "number",
    header: "#",
    cell: (r) => `#${r.number}`,
    priority: 1,
    primary: true,
    sortable: true,
  },
  { id: "site", header: "Site", cell: (r) => r.site, priority: 3 },
  {
    id: "subject",
    header: "Subject",
    cell: (r) => r.subject,
    priority: 1,
    sortable: true,
  },
];

function press(key: string, target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

function primaryLinks(): HTMLAnchorElement[] {
  return Array.from(
    mounted!.container.querySelectorAll<HTMLAnchorElement>(
      "a[data-staff-primary]",
    ),
  );
}

function renderTable(
  extra: Partial<Parameters<typeof StaffTable<Ticket>>[0]> = {},
) {
  mounted = mount(
    <StaffTable<Ticket>
      caption="Tickets, sorted by SLA urgency"
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(r) => String(r.number)}
      rowLabel={(r) => `#${r.number}`}
      primaryHref={(r) => `/staff/tickets/${r.number}`}
      sort={{ column: "number", direction: "desc" }}
      onSortHref={(id, dir) => `/staff/tickets?sort=${id}&dir=${dir}`}
      selectable
      {...extra}
    />,
  );
  return mounted;
}

describe("StaffTable", () => {
  it("renders a real table with a visually hidden caption and th scope=col", () => {
    const { container } = renderTable();
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const caption = table!.querySelector("caption");
    expect(caption?.textContent).toBe("Tickets, sorted by SLA urgency");
    expect(caption?.className).toMatch(/sr-only/);
    const ths = Array.from(table!.querySelectorAll("thead th"));
    expect(ths.length).toBe(4); // checkbox + 3 columns
    for (const th of ths) expect(th.getAttribute("scope")).toBe("col");
  });

  it("puts aria-sort on sortable headers and links them through onSortHref", () => {
    const { container } = renderTable();
    const ths = Array.from(container.querySelectorAll("thead th"));
    const num = ths.find((t) => t.textContent?.includes("#"))!;
    const subject = ths.find((t) => t.textContent?.includes("Subject"))!;
    const site = ths.find((t) => t.textContent?.includes("Site"))!;
    expect(num.getAttribute("aria-sort")).toBe("descending");
    expect(subject.getAttribute("aria-sort")).toBe("none");
    expect(site.hasAttribute("aria-sort")).toBe(false);
    // The active column flips direction; another column starts ascending.
    expect(num.querySelector("a")?.getAttribute("href")).toBe(
      "/staff/tickets?sort=number&dir=asc",
    );
    expect(subject.querySelector("a")?.getAttribute("href")).toBe(
      "/staff/tickets?sort=subject&dir=asc",
    );
  });

  it("drops lower-priority columns at narrower widths and keeps priority 1", () => {
    const { container } = renderTable();
    const siteTh = Array.from(container.querySelectorAll("thead th")).find(
      (t) => t.textContent?.includes("Site"),
    )!;
    expect(siteTh.className).toMatch(/max-lg:hidden/);
    const subjectTh = Array.from(container.querySelectorAll("thead th")).find(
      (t) => t.textContent?.includes("Subject"),
    )!;
    expect(subjectTh.className).not.toMatch(/hidden/);
  });

  it("names row checkboxes 'Select #1042' and reports selected keys", () => {
    const onSelectionChange = vi.fn();
    const { container } = renderTable({ onSelectionChange });
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        "tbody input[type=checkbox]",
      ),
    );
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Select #1042",
      "Select #1043",
      "Select #1044",
    ]);
    act(() => boxes[0]!.click());
    act(() => boxes[2]!.click());
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1042", "1044"]);
  });

  it("select all toggles every row", () => {
    const onSelectionChange = vi.fn();
    const { container } = renderTable({ onSelectionChange });
    const all = container.querySelector<HTMLInputElement>(
      "thead input[type=checkbox]",
    )!;
    act(() => all.click());
    expect(onSelectionChange).toHaveBeenLastCalledWith([
      "1042",
      "1043",
      "1044",
    ]);
    act(() => all.click());
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("j and k move a roving tabindex on the primary link; x toggles selection", () => {
    const onSelectionChange = vi.fn();
    renderTable({ onSelectionChange });
    const links = primaryLinks();
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/staff/tickets/1042",
      "/staff/tickets/1043",
      "/staff/tickets/1044",
    ]);
    // Before any key: the first link is the tab stop.
    expect(links.map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    press("j");
    expect(document.activeElement).toBe(links[0]);
    press("j", document.activeElement!);
    expect(document.activeElement).toBe(links[1]);
    expect(links.map((l) => l.tabIndex)).toEqual([-1, 0, -1]);
    press("k", document.activeElement!);
    expect(document.activeElement).toBe(links[0]);
    press("x", document.activeElement!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(["1042"]);
    press("x", document.activeElement!);
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("announces the row on j/k through a polite live region", () => {
    const { container } = renderTable({
      rowAnnouncement: (r) => `#${r.number}, ${r.site}, At risk, 2 hours left`,
    });
    press("j");
    const live = container.querySelector("[aria-live=polite]");
    expect(live?.textContent).toBe(
      "#1042, Rivera Bakery, At risk, 2 hours left",
    );
  });

  it("ignores single keys when shortcuts are off", () => {
    renderTable({ shortcutsEnabled: false });
    press("j");
    expect(document.activeElement).toBe(document.body);
  });

  it("ignores single keys while focus is in a text field", () => {
    renderTable();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    press("j", input);
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("ignores j/k/x while a modal dialog is open (WR-E03)", () => {
    const onSelectionChange = vi.fn();
    renderTable({ onSelectionChange });
    const dlg = document.createElement("dialog");
    dlg.setAttribute("open", "");
    const box = document.createElement("input");
    box.type = "checkbox";
    dlg.appendChild(box);
    document.body.appendChild(dlg);
    press("j", box);
    press("x", box);
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(primaryLinks().map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    dlg.remove();
  });

  it("ignores single keys inside a contenteditable ancestor", () => {
    renderTable();
    const host = document.createElement("div");
    host.setAttribute("contenteditable", "true");
    const span = document.createElement("span");
    host.appendChild(span);
    document.body.appendChild(host);
    press("j", span);
    expect(primaryLinks().map((l) => l.tabIndex)).toEqual([0, -1, -1]);
    host.remove();
  });

  it("marks the current row with aria-current", () => {
    const { container } = renderTable({ currentKey: "1043" });
    const rows = Array.from(container.querySelectorAll("tbody tr"));
    expect(rows[1]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.hasAttribute("aria-current")).toBe(false);
  });

  it("renders cell content as text, never markup", () => {
    mounted = mount(
      <StaffTable<Ticket>
        caption="Tickets"
        columns={COLUMNS}
        rows={[
          { number: 1, site: "<img src=x onerror=alert(1)>", subject: "s" },
        ]}
        rowKey={(r) => String(r.number)}
        rowLabel={(r) => `#${r.number}`}
        primaryHref={() => "/x"}
      />,
    );
    expect(mounted.container.querySelector("img")).toBeNull();
    expect(mounted.container.textContent).toContain("<img src=x");
  });
});

describe("SlaCell", () => {
  const now = new Date("2026-10-13T15:00:00Z"); // Tue 10:00 America/Chicago

  it("renders a missed state with the sla-missed tone and hours late", () => {
    mounted = mount(
      <SlaCell
        state="missed"
        dueAt="2026-10-13T12:00:00Z"
        repliedAt={null}
        now={now}
      />,
    );
    const badge = mounted.container.querySelector("span");
    expect(badge?.textContent).toBe("Missed · 3h late");
    expect(badge?.className).toMatch(/danger/);
  });

  it("renders at risk with hours left", () => {
    mounted = mount(
      <SlaCell
        state="due_soon"
        dueAt="2026-10-13T17:00:00Z"
        repliedAt={null}
        now={now}
      />,
    );
    expect(mounted.container.textContent).toBe("At risk · 2h");
  });

  it("renders on track as muted 'due in' text", () => {
    mounted = mount(
      <SlaCell
        state="on_track"
        dueAt="2026-10-14T15:00:00Z"
        repliedAt={null}
        now={now}
      />,
    );
    expect(mounted.container.textContent).toMatch(/^due in \d+h$/);
  });

  it("renders met and none", () => {
    mounted = mount(<SlaCell state="met" now={now} />);
    expect(mounted.container.textContent).toBe("Met");
    mounted.unmount();
    mounted = mount(<SlaCell state="none" now={now} />);
    expect(mounted.container.textContent).toBe("—");
  });
});

describe("PriorityCell, AgeCell, KeyHint", () => {
  it("PriorityCell renders the word and tone", () => {
    mounted = mount(<PriorityCell priority="urgent" />);
    expect(mounted.container.textContent).toBe("Urgent");
    expect(
      mounted.container.querySelector("svg")?.getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("AgeCell renders compact tabular ages", () => {
    const now = new Date("2026-10-13T15:00:00Z");
    const cases: [string, string][] = [
      ["2026-10-13T14:40:00Z", "20m"],
      ["2026-10-13T11:00:00Z", "4h"],
      ["2026-10-11T15:00:00Z", "2d"],
      ["2026-09-22T15:00:00Z", "3w"],
    ];
    for (const [from, want] of cases) {
      mounted = mount(<AgeCell from={from} now={now} />);
      const t = mounted.container.querySelector("time");
      expect(t?.textContent).toBe(want);
      expect(t?.getAttribute("dateTime")).toBe(new Date(from).toISOString());
      expect(t?.className).toMatch(/tabular-nums/);
      mounted.unmount();
      mounted = null;
    }
  });

  it("KeyHint renders a kbd", () => {
    mounted = mount(<KeyHint>Ctrl K</KeyHint>);
    expect(mounted.container.querySelector("kbd")?.textContent).toBe("Ctrl K");
  });
});

describe("FilterBar, QuickFilters, StageChips", () => {
  it("renders a GET form whose fields keep current URL values", () => {
    mounted = mount(
      <FilterBar
        action="/staff/tickets"
        hidden={{ tab: "inbox" }}
        search={{ name: "q", label: "Search", value: "menu" }}
        filters={[
          {
            name: "type",
            label: "Type",
            value: "problem",
            options: [
              { value: "problem", label: "Problem" },
              { value: "change", label: "Change" },
            ],
          },
          {
            name: "status",
            label: "Status",
            value: "<script>",
            options: [{ value: "open", label: "Open" }],
          },
        ]}
        resultLine="12 tickets · 2 at risk · 1 missed"
      />,
    );
    const form = mounted.container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("get");
    expect(form.getAttribute("action")).toBe("/staff/tickets");
    const tab = form.querySelector<HTMLInputElement>("input[name=tab]");
    expect(tab?.type).toBe("hidden");
    expect(tab?.value).toBe("inbox");
    expect(form.querySelector<HTMLInputElement>("input[name=q]")?.value).toBe(
      "menu",
    );
    const type = form.querySelector<HTMLSelectElement>("select[name=type]")!;
    expect(type.value).toBe("problem");
    expect(type.options[0]!.textContent).toBe("Any");
    // A value outside the fixed option list falls back to Any (T-13-07-02).
    expect(
      form.querySelector<HTMLSelectElement>("select[name=status]")!.value,
    ).toBe("");
    const clear = Array.from(mounted.container.querySelectorAll("a")).find(
      (a) => a.textContent === "Clear filters",
    );
    expect(clear?.getAttribute("href")).toBe("/staff/tickets?tab=inbox");
    expect(
      mounted.container.querySelector("[aria-live=polite]")?.textContent,
    ).toBe("12 tickets · 2 at risk · 1 missed");
  });

  it("hides Clear filters when nothing is set", () => {
    mounted = mount(
      <FilterBar
        action="/staff/tickets"
        filters={[
          {
            name: "type",
            label: "Type",
            options: [{ value: "problem", label: "Problem" }],
          },
        ]}
      />,
    );
    const clear = Array.from(mounted.container.querySelectorAll("a")).find(
      (a) => a.textContent === "Clear filters",
    );
    expect(clear).toBeUndefined();
  });

  it("QuickFilters renders aria-pressed links", () => {
    mounted = mount(
      <QuickFilters
        label="Quick filters"
        items={[
          { id: "mine", label: "Mine", href: "?quick=mine", pressed: false },
          { id: "all", label: "All open", href: "?quick=all", pressed: true },
        ]}
      />,
    );
    const links = Array.from(mounted.container.querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
    ]);
    expect(links[1]!.className).toMatch(/accent/);
  });

  it("StageChips renders each stage with its count", () => {
    mounted = mount(
      <StageChips
        label="Lead stages"
        stages={[
          { id: "saved", label: "Saved quote", count: 4, href: "?stage=saved" },
          {
            id: "submitted",
            label: "Submitted",
            count: 3,
            href: "?stage=submitted",
            pressed: true,
          },
        ]}
      />,
    );
    const links = Array.from(mounted.container.querySelectorAll("a"));
    expect(links[1]!.textContent).toBe("Submitted 3");
    expect(links[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(links[0]!.getAttribute("aria-pressed")).toBe("false");
  });
});
