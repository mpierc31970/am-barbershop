// @vitest-environment jsdom
// SortableList, IconPicker and the FAQ, icon list and stats editors (07-21 Task 3; CONT-27;
// UI-SPEC rows 362/363/366, line 664 Undo copy, line 686 IconPicker listbox).
import { act, useState, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultFaqBlock,
  defaultIconListBlock,
  defaultStatsContent,
  FAQ_LIMIT_COPY,
  FAQ_QUESTION_COPY,
  ICON_LIST_LIMIT_COPY,
  type FaqBlockContent,
  type IconListBlockContent,
  type StatsContent,
} from "@cds/core/content";
import { ToastRegion } from "../../hub/Toast";
import {
  button,
  click,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { IconPicker, ICON_PICKER_EMPTY } from "../IconPicker";
import { FaqEditor } from "./FaqEditor";
import { IconListEditor } from "./IconListEditor";
import { SortableList } from "./SortableList";
import { STATS_VALUE_COPY, StatsEditor } from "./StatsEditor";
import type { CoreBlockEditorProps } from "./types";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

function harness(
  Editor: ComponentType<CoreBlockEditorProps>,
  initial: object,
  type: string,
) {
  let current: Record<string, unknown> = { ...initial };
  function Host() {
    const [content, setContent] = useState<Record<string, unknown>>(current);
    return (
      <Editor
        type={type}
        content={content}
        errors={{}}
        popups={[]}
        onChange={(name, value) => {
          current = { ...current, [name]: value };
          setContent(current);
        }}
      />
    );
  }
  mounted = mount(
    <ToastRegion>
      <Host />
    </ToastRegion>,
  );
  return { root: mounted.container, content: () => current };
}

const fieldsLabelled = (root: HTMLElement, label: string) =>
  Array.from(root.querySelectorAll("label"))
    .filter((l) => l.textContent?.replace("Optional", "").trim() === label)
    .map((l) => document.getElementById(l.htmlFor) as HTMLInputElement);

const switchLabelled = (root: HTMLElement, label: string) =>
  fieldsLabelled(root, label)[0]!;

/** Let setTimeout(0) focus moves run. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("SortableList", () => {
  type Row = { id: string; name: string };
  function list(initial: Row[]) {
    let current = initial;
    const onRemove = vi.fn();
    function Host() {
      const [items, setItems] = useState<Row[]>(current);
      const set = (next: Row[]) => {
        current = next;
        setItems(next);
      };
      return (
        <SortableList<Row>
          items={items}
          noun="Question"
          label={(_, i) => `Question ${i + 1}`}
          onReorder={set}
          onRemove={(i) => {
            onRemove(i);
            set(current.filter((_, k) => k !== i));
          }}
          onRestore={(item, i) =>
            set([...current.slice(0, i), item, ...current.slice(i)])
          }
          renderItem={(item) => <span>{item.name}</span>}
        />
      );
    }
    mounted = mount(
      <ToastRegion>
        <Host />
      </ToastRegion>,
    );
    return { root: mounted.container, items: () => current, onRemove };
  }

  const rows = [
    { id: "a", name: "Alpha" },
    { id: "b", name: "Beta" },
    { id: "c", name: "Gamma" },
  ];

  it("names Move buttons for the row; ends are soft-disabled", () => {
    const { root } = list(rows);
    expect(
      button(root, "Move Question 1 up")?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      button(root, "Move Question 3 down")?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      button(root, "Move Question 2 up")?.hasAttribute("aria-disabled"),
    ).toBe(false);
  });

  it("Move down reorders and announces", () => {
    const { root, items } = list(rows);
    click(button(root, "Move Question 1 down"));
    expect(items().map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(root.textContent).toContain("Question 1 moved to position 2.");
  });

  it("Delete toasts and Undo restores at the same index", () => {
    const { root, items, onRemove } = list(rows);
    click(button(root, "Delete Question 2"));
    expect(onRemove).toHaveBeenCalledWith(1);
    expect(items().map((r) => r.id)).toEqual(["a", "c"]);
    expect(document.body.textContent).toContain("Question removed.");
    click(button(document.body, "Undo"));
    expect(items().map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("IconPicker", () => {
  function picker(initial: "check" | "phone" = "check") {
    const onChange = vi.fn();
    function Host() {
      const [v, setV] = useState(initial);
      return (
        <IconPicker
          id="ip"
          value={v}
          onChange={(id) => {
            onChange(id);
            setV(id as typeof initial);
          }}
        />
      );
    }
    mounted = mount(<Host />);
    return { root: mounted.container, onChange };
  }

  it("the trigger names the icon and opens a 60-option listbox", async () => {
    const { root } = picker();
    const trigger = button(root, "Icon: Check. Change icon")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    click(trigger);
    await settle();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const box = root.querySelector('[role="listbox"]')!;
    expect(box.getAttribute("aria-label")).toBe("Icons");
    expect(box.querySelectorAll('[role="option"]')).toHaveLength(60);
    const selected = box.querySelectorAll('[aria-selected="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.getAttribute("aria-label")).toBe("Check");
    expect(document.activeElement?.getAttribute("type")).toBe("search");
  });

  it("search filters; no match shows the empty copy", async () => {
    const { root } = picker();
    click(button(root, "Icon: Check. Change icon"));
    await settle();
    const search = root.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    typeInto(search, "pho");
    const opts = root.querySelectorAll('[role="option"]');
    expect(Array.from(opts).map((o) => o.getAttribute("aria-label"))).toEqual([
      "Phone",
    ]);
    typeInto(search, "zzzz");
    expect(root.textContent).toContain(ICON_PICKER_EMPTY);
  });

  it("arrow keys move the active option and Enter selects and closes", async () => {
    const { root, onChange } = picker();
    click(button(root, "Icon: Check. Change icon"));
    await settle();
    const box = root.querySelector<HTMLElement>('[role="listbox"]')!;
    const activeLabel = () =>
      document
        .getElementById(box.getAttribute("aria-activedescendant")!)
        ?.getAttribute("aria-label");
    expect(activeLabel()).toBe("Check");
    const key = (k: string) =>
      act(() => {
        box.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, bubbles: true }),
        );
      });
    key("ArrowRight");
    expect(activeLabel()).toBe("Circle check");
    key("ArrowDown");
    expect(activeLabel()).toBe("Smile");
    key("End");
    expect(activeLabel()).toBe("Gem");
    key("Home");
    key("ArrowRight");
    key("ArrowRight");
    key("Enter");
    await settle();
    expect(onChange).toHaveBeenCalledWith("badge-check");
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Icon: Badge check. Change icon",
    );
  });

  it("Escape closes and returns focus to the trigger", async () => {
    const { root } = picker("phone");
    click(button(root, "Icon: Phone. Change icon"));
    await settle();
    const search = root.querySelector<HTMLInputElement>(
      'input[type="search"]',
    )!;
    act(() => {
      search.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    expect(root.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Icon: Phone. Change icon",
    );
  });
});

describe("FaqEditor", () => {
  it("starts with one empty question; Add question appends and focuses", async () => {
    const { root, content } = harness(FaqEditor, defaultFaqBlock(), "faq");
    expect(fieldsLabelled(root, "Question")).toHaveLength(1);
    click(button(root, "Add question"));
    await settle();
    const qs = fieldsLabelled(root, "Question");
    expect(qs).toHaveLength(2);
    expect(document.activeElement).toBe(qs[1]);
    const items = (content() as unknown as FaqBlockContent).items;
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it("an answer with a blank question shows the core copy", () => {
    const c = defaultFaqBlock();
    c.items[0]!.answer = "<p>We open at nine.</p>";
    const { root } = harness(FaqEditor, c, "faq");
    expect(root.textContent).toContain(FAQ_QUESTION_COPY);
    typeInto(fieldsLabelled(root, "Question")[0], "When do you open?");
    expect(root.textContent).not.toContain(FAQ_QUESTION_COPY);
  });

  it("Add question is disabled at 30 with the max copy", () => {
    const c = defaultFaqBlock();
    c.items = Array.from({ length: 30 }, (_, i) => ({
      id: `q${i}`,
      question: `Q${i}`,
      answer: "",
    }));
    const { root } = harness(FaqEditor, c, "faq");
    expect(button(root, "Add question")?.disabled).toBe(true);
    expect(root.textContent).toContain(FAQ_LIMIT_COPY);
  });

  it("Open the first question writes open_first; Delete shows the Undo toast", () => {
    const { root, content } = harness(FaqEditor, defaultFaqBlock(), "faq");
    click(switchLabelled(root, "Open the first question"));
    expect((content() as unknown as FaqBlockContent).open_first).toBe(true);
    click(button(root, "Delete Question 1"));
    expect((content() as unknown as FaqBlockContent).items).toHaveLength(0);
    expect(document.body.textContent).toContain("Question removed.");
    click(button(document.body, "Undo"));
    expect((content() as unknown as FaqBlockContent).items).toHaveLength(1);
  });
});

describe("IconListEditor", () => {
  it("starts with 3 Check items; icon change writes icon", async () => {
    const { root, content } = harness(
      IconListEditor,
      defaultIconListBlock(),
      "icon-list",
    );
    const triggers = Array.from(root.querySelectorAll("button")).filter((b) =>
      b.getAttribute("aria-label")?.startsWith("Icon: Check"),
    );
    expect(triggers).toHaveLength(3);
    click(triggers[1]);
    await settle();
    const phone = root.querySelector<HTMLElement>('[data-icon="phone"]')!;
    click(phone);
    expect((content() as unknown as IconListBlockContent).items[1]!.icon).toBe(
      "phone",
    );
  });

  it("Title and Text write through; Text has a 200 counter", () => {
    const { root, content } = harness(
      IconListEditor,
      defaultIconListBlock(),
      "icon-list",
    );
    typeInto(fieldsLabelled(root, "Title")[0], "Free parking");
    typeInto(fieldsLabelled(root, "Text")[0], "Right outside.");
    const item = (content() as unknown as IconListBlockContent).items[0]!;
    expect(item.title).toBe("Free parking");
    expect(item.text).toBe("Right outside.");
    expect(root.textContent).toContain("14 / 200");
  });

  it("Add item is disabled at 12 with the core copy", () => {
    const c = defaultIconListBlock();
    c.items = Array.from({ length: 12 }, (_, i) => ({
      id: `i${i}`,
      icon: "check" as const,
      title: `T${i}`,
      text: "",
    }));
    const { root } = harness(IconListEditor, c, "icon-list");
    expect(button(root, "Add item")?.disabled).toBe(true);
    expect(root.textContent).toContain(ICON_LIST_LIMIT_COPY);
  });
});

describe("StatsEditor", () => {
  it("starts with 3 numbers; Add number disabled at 6", () => {
    const { root } = harness(StatsEditor, defaultStatsContent(), "stats");
    expect(fieldsLabelled(root, "Number")).toHaveLength(3);
    click(button(root, "Add number"));
    click(button(root, "Add number"));
    click(button(root, "Add number"));
    expect(fieldsLabelled(root, "Number")).toHaveLength(6);
    expect(button(root, "Add number")?.disabled).toBe(true);
  });

  it("Delete is unavailable at 2 numbers", () => {
    const c = defaultStatsContent();
    c.items = c.items.slice(0, 2);
    const { root, content } = harness(StatsEditor, c, "stats");
    const del = button(root, "Delete Number 1")!;
    expect(del.getAttribute("aria-disabled")).toBe("true");
    click(del);
    expect((content() as unknown as StatsContent).items).toHaveLength(2);
  });

  it("an invalid number shows the copy inline; Before/After keep maxLength", () => {
    const { root, content } = harness(
      StatsEditor,
      defaultStatsContent(),
      "stats",
    );
    const num = fieldsLabelled(root, "Number")[0]!;
    typeInto(num, "12abc");
    expect(root.textContent).toContain(STATS_VALUE_COPY);
    typeInto(num, "1,200");
    expect(root.textContent).not.toContain(STATS_VALUE_COPY);
    expect((content() as unknown as StatsContent).items[0]!.value).toBe(
      "1,200",
    );
    expect(num.inputMode).toBe("decimal");
    expect(fieldsLabelled(root, "Before")[0]!.maxLength).toBe(4);
    expect(fieldsLabelled(root, "After")[0]!.maxLength).toBe(8);
  });

  it("Count up when visible writes count_up", () => {
    const { root, content } = harness(
      StatsEditor,
      defaultStatsContent(),
      "stats",
    );
    const sw = switchLabelled(root, "Count up when visible");
    expect(sw.checked).toBe(true);
    click(sw);
    expect((content() as unknown as StatsContent).count_up).toBe(false);
    expect(root.textContent).toContain(
      "Skipped for visitors who turn off animations.",
    );
  });
});
