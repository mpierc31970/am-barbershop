// Builder component markup (03-08; CONT-05, CONT-06, CONT-07, CONT-10, CONT-12;
// 03-UI-SPEC "ColumnsEditor", "ColumnItemForm fields", "Accessibility contract").
// Server-rendered markup in the node unit project (no jsdom), like the hub primitive tests.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ALL_LAYOUTS,
  canFlip,
  newColumnItem,
  type ColumnItem,
  type ColumnsContent,
  type RowLayout,
} from "@cds/core/content";
import { ToastRegion } from "../hub/Toast";
import { ColumnItemForm } from "./ColumnItemForm";
import { ColumnsEditor } from "./ColumnsEditor";
import { ItemListEditor } from "./ItemListEditor";
import * as builder from "./index";

const noop = async () => {};

const twoColumns: ColumnsContent = {
  columns: [
    {
      id: "c1",
      items: [{ id: "h1", kind: "heading", text: "Meet Dana", level: 2 }],
    },
    { id: "c2", items: [] },
  ],
};

function editor(layout: RowLayout, content: ColumnsContent = twoColumns) {
  return renderToStaticMarkup(
    <ToastRegion>
      <ColumnsEditor
        layout={layout}
        content={content}
        popups={[]}
        onChange={noop}
      />
    </ToastRegion>,
  );
}

function form(
  item: ColumnItem,
  opts: {
    allowPopupButton?: boolean;
    popups?: { id: string; name: string; deleted?: boolean }[];
  } = {},
) {
  return renderToStaticMarkup(
    <ColumnItemForm
      item={item}
      popups={opts.popups ?? []}
      allowPopupButton={opts.allowPopupButton ?? true}
      onSave={noop}
      onCancel={() => {}}
      timeZone="America/Chicago"
    />,
  );
}

describe("ColumnsEditor", () => {
  it("offers all 12 layouts as a radiogroup with the current one checked", () => {
    const html = editor("50-50");
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(ALL_LAYOUTS.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it.each(ALL_LAYOUTS)(
    "Flip widths only on asymmetric two-column (%s)",
    (l) => {
      const html = editor(l);
      expect(html.includes("Flip widths")).toBe(canFlip(l));
    },
  );

  it("names every column control's target", () => {
    const html = editor("25-75");
    for (const label of [
      "Reorder Column 1",
      "Move Column 1 right",
      "Move Column 2 left",
      "Move Column 2 up",
    ]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("summarises items and shows the empty column state", () => {
    const html = editor("50-50");
    expect(html).toContain("Heading · &quot;Meet Dana&quot;");
    expect(html).toContain("Empty column");
    expect(html).toContain('aria-label="Add item to Column 2"');
    expect(html).toContain('aria-label="Delete Heading item"');
  });

  it("draws the layout's columns even when stored columns disagree (no item lost)", () => {
    const three: ColumnsContent = {
      columns: [
        { id: "a", items: [] },
        { id: "b", items: [] },
        { id: "c", items: [{ id: "x", kind: "divider" }] },
      ],
    };
    const html = editor("50-50", three);
    expect(html.match(/<section/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Delete Divider item"');
  });

  it("a single-column layout has no column reorder controls", () => {
    const html = editor("full", { columns: [{ id: "c1", items: [] }] });
    expect(html).not.toContain("Reorder Column 1");
  });
});

describe("ColumnItemForm", () => {
  it("heading offers both levels", () => {
    const html = form(newColumnItem("heading"));
    expect(html).toContain("Section heading (H2)");
    expect(html).toContain("Sub-heading (H3)");
    expect(html).toContain("Save item");
  });

  it("button offers a pop-up action only when allowed", () => {
    expect(form(newColumnItem("button"))).toContain("Open a pop-up");
    expect(
      form(newColumnItem("button"), { allowPopupButton: false }),
    ).not.toContain("Open a pop-up");
    expect(form(newColumnItem("button"))).toContain("Go to a link");
  });

  it("a chosen soft-deleted pop-up is labelled (deleted) with DELETED-REF and Choose another (07-28)", () => {
    const item = {
      ...newColumnItem("button"),
      action: "popup",
      popup_id: "pdeleted0000001",
    } as ColumnItem;
    const popups = [
      { id: "plive0000000001", name: "Spring offer" },
      { id: "pdeleted0000001", name: "Old offer", deleted: true },
      { id: "pdeleted0000002", name: "Other old", deleted: true },
    ];
    const html = form(item, { popups });
    expect(html).toContain("Old offer (deleted)");
    // A deleted pop-up nobody chose is not offered.
    expect(html).not.toContain("Other old");
    expect(html).toContain(
      "This pop-up was deleted. It still opens here so nothing breaks; choose another pop-up or change this button.",
    );
    expect(html).toContain("Choose another");
    const live = form({ ...item, popup_id: "plive0000000001" } as ColumnItem, {
      popups,
    });
    expect(live).not.toContain("(deleted)");
    expect(live).not.toContain("Choose another");
  });

  it("pop-up action without pop-ups links to create one", () => {
    const item = { ...newColumnItem("button"), action: "popup" } as ColumnItem;
    const html = form(item);
    expect(html).toContain("Create a pop-up first");
    expect(html).toContain('href="/hub/website?tab=popups"');
  });

  it("pop-up action with pop-ups shows a select of them", () => {
    const item = { ...newColumnItem("button"), action: "popup" } as ColumnItem;
    const html = form(item, { popups: [{ id: "p1", name: "Spring offer" }] });
    expect(html).toContain("<select");
    expect(html).toContain("Spring offer");
  });

  it("countdown shows the time zone and a required zero message", () => {
    const html = form({
      id: "c",
      kind: "countdown",
      target_at: "2026-10-12T14:00:00.000Z",
      zero_message: "Open",
    });
    expect(html).toContain("Your time zone: America/Chicago");
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('value="2026-10-12T09:00"');
    expect(html).toContain("Message when it reaches zero");
  });

  it("image asks for alt text with the UI-SPEC helper", () => {
    // 07-17: the field is now "Description" under the library Photo field.
    const html = form(newColumnItem("image"));
    expect(html).toContain(
      "Describe the photo for people who can&#x27;t see it.",
    );
    expect(html).toContain("Choose a photo");
    expect(html).toContain("Paste a link instead");
  });

  it("spacer offers three sizes; divider has no fields", () => {
    const spacer = form(newColumnItem("spacer"));
    for (const s of ["Small", "Medium", "Large"]) expect(spacer).toContain(s);
    expect(form(newColumnItem("divider"))).not.toContain("<input");
  });
});

describe("ItemListEditor and barrel", () => {
  it("renders an empty list with Add item", () => {
    const html = renderToStaticMarkup(
      <ToastRegion>
        <ItemListEditor
          items={[]}
          popups={[]}
          allowPopupButton={false}
          onChange={noop}
        />
      </ToastRegion>,
    );
    expect(html).toContain("Empty column");
    expect(html).toContain("Add item");
  });

  it("exports the builder surface", () => {
    for (const name of [
      "RichTextEditor",
      "ColumnItemForm",
      "ItemListEditor",
      "ColumnsEditor",
      "applyLayoutChange",
      "itemSummary",
      "localInputToUtcIso",
    ]) {
      expect(builder).toHaveProperty(name);
    }
  });
});
