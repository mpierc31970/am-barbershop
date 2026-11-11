// @vitest-environment jsdom
// Jump to palette (11-15; DASH-28; 11-UI-SPEC "Jump to"; D-UI-P11-6, D-UI-P11-7;
// Pitfall 18: Ctrl/Cmd+K never fires inside the rich-text editor or an open dialog).
import { act, useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mount, typeInto, type Mounted } from "../../test-support/dom";
import {
  JumpToDialog,
  SHELL_COPY,
  filterJumpEntries,
  useJumpShortcut,
  type JumpEntry,
} from "./index";
import { matchedPositions } from "./JumpToDialog";

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
});

const ENTRIES: JumpEntry[] = [
  { group: "Screens", label: "Today", href: "/hub/today" },
  {
    group: "Screens",
    label: "Pages",
    href: "/hub/website/pages",
    path: "Website › Pages",
  },
  {
    group: "Help articles",
    label: "Mobile billing tips",
    href: "/hub/help/mobile-billing",
  },
  {
    group: "Screens",
    label: "Billing",
    href: "/hub/settings/billing",
    keywords: "card invoices payment",
  },
  { group: "Help articles", label: "How Pages works", href: "/hub/help/pages" },
];

function key(el: Element | Document, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

describe("filterJumpEntries", () => {
  it("ranks a prefix match before a word-start match", () => {
    const out = filterJumpEntries(ENTRIES, "bil");
    expect(out.map((e) => e.label)).toEqual(["Billing", "Mobile billing tips"]);
  });

  it("is case-insensitive and matches keywords", () => {
    expect(filterJumpEntries(ENTRIES, "INVOICES").map((e) => e.label)).toEqual([
      "Billing",
    ]);
  });

  it("matches a subsequence last", () => {
    const out = filterJumpEntries(ENTRIES, "tdy");
    expect(out[0]?.label).toBe("Today");
  });

  it("returns at most 20 results", () => {
    const many: JumpEntry[] = Array.from({ length: 40 }, (_, i) => ({
      group: "Screens",
      label: `Page ${i}`,
      href: `/hub/p/${i}`,
    }));
    expect(filterJumpEntries(many, "page")).toHaveLength(20);
  });

  it("an empty query lists only Screens, in index order", () => {
    expect(filterJumpEntries(ENTRIES, "  ").map((e) => e.label)).toEqual([
      "Today",
      "Pages",
      "Billing",
    ]);
  });

  it("no match is empty", () => {
    expect(filterJumpEntries(ENTRIES, "zzzz")).toEqual([]);
  });
});

function Harness({
  onNavigate = () => undefined,
}: {
  onNavigate?: (href: string) => void;
}) {
  const [open, setOpen] = useState(false);
  useJumpShortcut(() => setOpen(true));
  return (
    <>
      <div contentEditable suppressContentEditableWarning data-testid="rte">
        text
      </div>
      <input data-testid="plain" />
      <input data-testid="owns" data-own-shortcuts="" />
      <JumpToDialog
        entries={ENTRIES}
        open={open}
        onOpenChange={setOpen}
        onNavigate={onNavigate}
      />
    </>
  );
}

const isOpen = () => document.querySelector("dialog[open]") !== null;

describe("useJumpShortcut", () => {
  it("Ctrl+K opens", () => {
    mounted = mount(<Harness />);
    key(document.body, "k", { ctrlKey: true });
    expect(isOpen()).toBe(true);
  });

  it("Cmd+K (metaKey) opens", () => {
    mounted = mount(<Harness />);
    key(document.body, "k", { metaKey: true });
    expect(isOpen()).toBe(true);
  });

  it("Ctrl+K inside a plain input opens", () => {
    mounted = mount(<Harness />);
    key(document.querySelector('[data-testid="plain"]')!, "k", {
      ctrlKey: true,
    });
    expect(isOpen()).toBe(true);
  });

  it("Ctrl+K inside a contenteditable does nothing", () => {
    mounted = mount(<Harness />);
    const rte = document.querySelector('[data-testid="rte"]')!;
    const ev = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      rte.dispatchEvent(ev);
    });
    expect(isOpen()).toBe(false);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("Ctrl+K inside an input that owns its shortcuts does nothing", () => {
    mounted = mount(<Harness />);
    key(document.querySelector('[data-testid="owns"]')!, "k", {
      ctrlKey: true,
    });
    expect(isOpen()).toBe(false);
  });

  it("Ctrl+K with another dialog open does nothing", () => {
    mounted = mount(<Harness />);
    const other = document.createElement("dialog");
    other.setAttribute("open", "");
    document.body.appendChild(other);
    key(document.body, "k", { ctrlKey: true });
    const open = Array.from(document.querySelectorAll("dialog[open]"));
    expect(open).toEqual([other]);
  });

  it("plain K does nothing", () => {
    mounted = mount(<Harness />);
    key(document.body, "k");
    expect(isOpen()).toBe(false);
  });
});

describe("JumpToDialog", () => {
  function openPalette(onNavigate = vi.fn()) {
    mounted = mount(<Harness onNavigate={onNavigate} />);
    key(document.body, "k", { ctrlKey: true });
    const input =
      document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    return { input, onNavigate };
  }

  it("the combobox is wired to its listbox and focused", () => {
    const { input } = openPalette();
    const listId = input.getAttribute("aria-controls")!;
    expect(document.getElementById(listId)?.getAttribute("role")).toBe(
      "listbox",
    );
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(input.getAttribute("placeholder")).toBe(SHELL_COPY.jumpPlaceholder);
    expect(document.activeElement).toBe(input);
  });

  it("an empty query shows only the Screens group", () => {
    openPalette();
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain(SHELL_COPY.jumpGroupScreens);
    expect(dialog.textContent).not.toContain(SHELL_COPY.jumpGroupHelp);
    expect(dialog.querySelectorAll('[role="option"]')).toHaveLength(3);
  });

  it("typing groups Screens and Help articles", () => {
    const { input } = openPalette();
    typeInto(input, "pages");
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain(SHELL_COPY.jumpGroupScreens);
    expect(dialog.textContent).toContain(SHELL_COPY.jumpGroupHelp);
    expect(dialog.textContent).toContain("Website › Pages");
  });

  it("ArrowDown moves aria-activedescendant and Enter navigates", () => {
    const { input, onNavigate } = openPalette();
    const first = input.getAttribute("aria-activedescendant");
    expect(document.getElementById(first!)?.textContent).toContain("Today");
    key(input, "ArrowDown");
    const second = input.getAttribute("aria-activedescendant");
    expect(second).not.toBe(first);
    expect(document.getElementById(second!)?.textContent).toContain("Pages");
    expect(
      document.getElementById(second!)?.getAttribute("aria-selected"),
    ).toBe("true");
    key(input, "Enter");
    expect(onNavigate).toHaveBeenCalledWith("/hub/website/pages");
  });

  it("ArrowUp from the top wraps to the last result", () => {
    const { input } = openPalette();
    key(input, "ArrowUp");
    const id = input.getAttribute("aria-activedescendant")!;
    expect(document.getElementById(id)?.textContent).toContain("Billing");
  });

  it("clicking a result navigates", () => {
    const { onNavigate } = openPalette();
    const opt = Array.from(document.querySelectorAll('[role="option"]')).find(
      (o) => o.textContent?.includes("Billing"),
    ) as HTMLElement;
    act(() => opt.click());
    expect(onNavigate).toHaveBeenCalledWith("/hub/settings/billing");
  });

  it("no match shows JUMP-EMPTY with the Help center link", () => {
    const { input, onNavigate } = openPalette();
    typeInto(input, "zzzz");
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain('Nothing matches "zzzz".');
    const link = Array.from(dialog.querySelectorAll("a")).find((a) =>
      a.textContent?.includes(SHELL_COPY.jumpEmptyLink),
    )!;
    expect(link.getAttribute("href")).toBe("/hub/help");
    expect(input.hasAttribute("aria-activedescendant")).toBe(false);
    act(() => link.click());
    expect(onNavigate).toHaveBeenCalledWith("/hub/help");
  });

  it("announces the result count politely", () => {
    const { input } = openPalette();
    typeInto(input, "bil");
    const status = document.querySelector('dialog[open] [role="status"]');
    expect(status?.textContent).toBe("2 results");
  });

  it("Esc closes", () => {
    openPalette();
    const dialog = document.querySelector("dialog[open]")!;
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    expect(isOpen()).toBe(false);
  });

  it("reopening starts with an empty query", () => {
    const { input } = openPalette();
    typeInto(input, "bil");
    const dialog = document.querySelector("dialog[open]")!;
    act(() => {
      dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    key(document.body, "k", { ctrlKey: true });
    const again = document.querySelector<HTMLInputElement>('[role="combobox"]');
    expect(again?.value).toBe("");
  });
});

describe("matchedPositions (IN-D01)", () => {
  const party = String.fromCodePoint(0x1f389);
  it("counts code points, so an emoji does not shift the bold run", () => {
    // [party, " ", E, v, e, n, t, s]
    expect([...matchedPositions(`${party} Events`, "ev")]).toEqual([2, 3]);
    expect([...matchedPositions(`${party} Events`, "ets")]).toEqual([2, 6, 7]);
  });

  it("plain labels: substring first, else subsequence, else nothing", () => {
    expect([...matchedPositions("Inbox", "box")]).toEqual([2, 3, 4]);
    expect([...matchedPositions("Inbox", "ibx")]).toEqual([0, 2, 4]);
    expect(matchedPositions("Inbox", "zz").size).toBe(0);
  });
});
