// @vitest-environment jsdom
// Optimistic item saves in a real DOM (03-REVIEW Part C). The node unit project renders
// static markup only, so these run in jsdom.
import { afterEach, describe, expect, it } from "vitest";
import type { ColumnsContent } from "@cds/core/content";
import { ToastRegion } from "../hub/Toast";
import { ColumnsEditor } from "./ColumnsEditor";
import { ItemListEditor } from "./ItemListEditor";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../test-support/dom";

const content: ColumnsContent = {
  columns: [
    {
      id: "c1",
      items: [{ id: "h1", kind: "heading", text: "Meet Dana", level: 2 }],
    },
    { id: "c2", items: [] },
  ],
};

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function headingInput(root: ParentNode): HTMLInputElement {
  const label = Array.from(root.querySelectorAll("label")).find(
    (l) => l.textContent?.trim() === "Heading",
  );
  const input = label
    ? (document.getElementById(label.htmlFor) as HTMLInputElement | null)
    : null;
  if (!input) throw new Error("Heading input not found");
  return input;
}

describe("CR-C01: a failed item save keeps the owner's edits", () => {
  it("ColumnsEditor keeps the typed text and shows the form's error", async () => {
    mounted = mount(
      <ToastRegion>
        <ColumnsEditor
          layout="50-50"
          content={content}
          popups={[]}
          onChange={() => Promise.reject(new Error("offline"))}
        />
      </ToastRegion>,
    );
    const { container } = mounted;
    click(button(container, /Meet Dana/));
    typeInto(headingInput(container), "Meet Dana and Sam");
    submit(container.querySelector("form"));
    await flush();

    expect(headingInput(container).value).toBe("Meet Dana and Sam");
    expect(container.textContent).toContain("Your changes weren't saved.");
  });

  it("ItemListEditor keeps the typed text and shows the form's error", async () => {
    mounted = mount(
      <ToastRegion>
        <ItemListEditor
          items={content.columns[0]!.items}
          popups={[]}
          allowPopupButton={false}
          onChange={() => Promise.reject(new Error("offline"))}
        />
      </ToastRegion>,
    );
    const { container } = mounted;
    click(button(container, /Meet Dana/));
    typeInto(headingInput(container), "Welcome");
    submit(container.querySelector("form"));
    await flush();

    expect(headingInput(container).value).toBe("Welcome");
    expect(container.textContent).toContain("Your changes weren't saved.");
  });

  it("a successful save closes the form", async () => {
    const saved: ColumnsContent[] = [];
    mounted = mount(
      <ToastRegion>
        <ColumnsEditor
          layout="50-50"
          content={content}
          popups={[]}
          onChange={async (next) => {
            saved.push(next.content);
          }}
        />
      </ToastRegion>,
    );
    const { container } = mounted;
    click(button(container, /Meet Dana/));
    typeInto(headingInput(container), "Welcome");
    submit(container.querySelector("form"));
    await flush();

    expect(container.querySelector("form")).toBeNull();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.columns[0]!.items[0]).toMatchObject({ text: "Welcome" });
  });
});

describe("CR-C02: Undo only after a saved delete", () => {
  function editor(
    onChange: (next: { content: ColumnsContent }) => Promise<void>,
  ) {
    return mount(
      <ToastRegion>
        <ColumnsEditor
          layout="50-50"
          content={content}
          popups={[]}
          onChange={onChange}
        />
      </ToastRegion>,
    );
  }

  it("a failed delete offers no Undo and keeps one copy of the item", async () => {
    const calls: ColumnsContent[] = [];
    mounted = editor((next) => {
      calls.push(next.content);
      return Promise.reject(new Error("offline"));
    });
    const { container } = mounted;
    click(button(container, "Delete Heading item"));
    await flush();

    expect(button(document.body, "Undo")).toBeNull();
    expect(document.body.textContent).toContain("That item wasn't deleted.");
    expect(
      container.querySelectorAll('[aria-label="Delete Heading item"]'),
    ).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("a saved delete offers Undo, which restores the item once", async () => {
    const calls: ColumnsContent[] = [];
    mounted = editor(async (next) => {
      calls.push(next.content);
    });
    const { container } = mounted;
    click(button(container, "Delete Heading item"));
    await flush();
    expect(calls[0]!.columns[0]!.items).toHaveLength(0);

    click(button(document.body, "Undo"));
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.columns[0]!.items.map((i) => i.id)).toEqual(["h1"]);
  });

  it("ItemListEditor: a failed delete offers no Undo", async () => {
    mounted = mount(
      <ToastRegion>
        <ItemListEditor
          items={content.columns[0]!.items}
          popups={[]}
          allowPopupButton={false}
          onChange={() => Promise.reject(new Error("offline"))}
        />
      </ToastRegion>,
    );
    click(button(mounted.container, "Delete Heading item"));
    await flush();
    expect(button(document.body, "Undo")).toBeNull();
    expect(document.body.textContent).toContain("That item wasn't deleted.");
  });
});

describe("WR-C11: Move buttons keep keyboard focus at the ends", () => {
  it("Move up on the second item leaves focus on that (now unavailable) button", async () => {
    const two: ColumnsContent = {
      columns: [
        {
          id: "c1",
          items: [
            { id: "a", kind: "heading", text: "A", level: 2 },
            { id: "b", kind: "heading", text: "B", level: 2 },
          ],
        },
        { id: "c2", items: [] },
      ],
    };
    let clicks = 0;
    mounted = mount(
      <ToastRegion>
        <ColumnsEditor
          layout="50-50"
          content={two}
          popups={[]}
          onChange={async () => {
            clicks += 1;
          }}
        />
      </ToastRegion>,
    );
    const { container } = mounted;
    const up = () =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(
          '[aria-label="Move Heading item up"]',
        ),
      );
    // Item rows are keyed by id, so the pressed button moves with its row to the top.
    const pressed = up()[1]!;
    pressed.focus();
    click(pressed);
    await flush();
    expect(clicks).toBe(1);
    expect(up()[0]).toBe(pressed);
    expect(pressed.getAttribute("aria-disabled")).toBe("true");
    expect(pressed.disabled).toBe(false);
    expect(document.activeElement).toBe(pressed);

    // Pressing it again at the top does nothing.
    click(pressed);
    await flush();
    expect(clicks).toBe(1);
  });
});
