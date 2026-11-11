// @vitest-environment jsdom
// 13-41 Task 1 (STAFF-08, STAFF-09, D96, D119; D-UI-P13-6, -7; 13-UI-SPEC "StaffComposer",
// "CannedPicker", "ShortcutSheet"; T-13-41-01): the Public / Internal radio group, preview before
// a public send, canned insert with placeholders filled (PLACEHOLDER-UNKNOWN otherwise), files
// through onSendWithFiles, and the ticket shortcuts (off while typing, switchable off).
import { P13_COPY, type CannedVars } from "@cds/core/staff";
import { act, useRef } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { SUPPORT_UI_COPY } from "../../hub/support/copy";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { setShortcutsEnabled } from "../shell/ShortcutSheet";
import {
  STAFF_COMPOSER_COPY as C,
  SKIP_PREVIEW_STORAGE_KEY,
  StaffComposer,
  useInboxShortcuts,
  type CannedOption,
  type StaffComposerHandle,
  type StaffComposerProps,
} from "./index";

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
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const TZ = "America/Chicago";
const VARS: CannedVars = {
  first_name: "Maria",
  business: "Rivera Bakery",
  ticket: 1042,
  agent: "Mara",
};
const CANNED: CannedOption[] = [
  {
    id: "c00000000000001",
    title: "Greeting",
    body: "Hi {first_name}, thanks!",
  },
  { id: "c00000000000002", title: "Quote", body: "That costs {price}." },
];

function props(over: Partial<StaffComposerProps> = {}): StaffComposerProps {
  return {
    ticket: {
      number: 1042,
      business: "Rivera Bakery",
      ownerFirstName: "Maria",
      status: "in_progress",
    },
    canned: CANNED,
    vars: VARS,
    timeZone: TZ,
    onSend: vi.fn(async () => ({ ok: true as const, message: "Sent." })),
    onSendWithFiles: vi.fn(async () => ({
      ok: true as const,
      message: "Sent.",
    })),
    ...over,
  };
}

function field(root: ParentNode): HTMLTextAreaElement {
  return root.querySelector("textarea")!;
}

function radio(root: ParentNode, name: string): HTMLButtonElement {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ).find((b) => b.textContent === name)!;
}

function key(target: EventTarget, k: string, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function Harness(p: StaffComposerProps & { onBack?: () => void }) {
  const ref = useRef<StaffComposerHandle>(null);
  useInboxShortcuts({
    onReply: () => ref.current?.focus("public"),
    onNote: () => ref.current?.focus("internal"),
    onCanned: () => ref.current?.openCanned(),
    onBack: p.onBack,
  });
  return <StaffComposer {...p} handleRef={ref} />;
}

describe("StaffComposer modes", () => {
  it("defaults to Public in a radio group named Reply type", () => {
    mounted = mount(<StaffComposer {...props()} />);
    const group = mounted.container.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute("aria-label")).toBe("Reply type");
    expect(radio(group, C.modePublic).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(mounted.container.textContent).toContain("Reply to Maria");
    expect(mounted.container.textContent).toContain(
      "Rivera Bakery sees this in the hub and by email.",
    );
  });

  it("Internal note announces, shows the hatch and stays after saving a note", async () => {
    const p = props({
      onSend: vi.fn(async () => ({
        ok: true as const,
        message: "Saved as an internal note. The owner never sees it.",
      })),
    });
    const onSent = vi.fn();
    mounted = mount(<StaffComposer {...p} onSent={onSent} />);
    const c = mounted.container;
    click(radio(c, C.modeInternal));
    expect(c.querySelector("[data-composer-announce]")!.textContent).toBe(
      "Internal note. Only CDS sees this.",
    );
    const box = c.querySelector<HTMLElement>("[data-composer-box]")!;
    expect(box.className).toContain("border-dashed");
    expect(box.getAttribute("style")).toContain("--hub-internal-hatch");
    expect(c.textContent).toContain(P13_COPY.INTERNAL_LINE);
    typeInto(field(c), "Checked the DNS.");
    click(button(c, C.save));
    await flush();
    // Notes never preview: one call straight away.
    expect(p.onSend).toHaveBeenCalledTimes(1);
    expect(p.onSend).toHaveBeenCalledWith({
      number: 1042,
      body: "Checked the DNS.",
      internal: true,
    });
    expect(onSent).toHaveBeenCalledWith(
      "Saved as an internal note. The owner never sees it.",
    );
    expect(field(c).value).toBe("");
    expect(radio(c, C.modeInternal).getAttribute("aria-checked")).toBe("true");
  });
});

describe("StaffComposer send", () => {
  it("first Send reply previews as the owner sees it; the second sends once", async () => {
    const p = props();
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    typeInto(field(c), "All fixed, {first_name}.");
    const select = c.querySelector("select")!;
    act(() => {
      select.value = "waiting_on_you";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    click(button(c, C.send));
    expect(p.onSend).not.toHaveBeenCalled();
    const preview = c.querySelector("[data-composer-preview]")!;
    expect(preview.textContent).toContain("Maria will see");
    expect(preview.textContent).toContain("All fixed, Maria.");
    expect(preview.querySelector('[data-author-kind="staff"]')).not.toBeNull();
    expect(preview.textContent).toContain("Status changes to Waiting on you");
    click(button(c, C.send));
    await flush();
    expect(p.onSend).toHaveBeenCalledTimes(1);
    expect(p.onSend).toHaveBeenCalledWith({
      number: 1042,
      body: "All fixed, Maria.",
      internal: false,
      status: "waiting_on_you",
    });
  });

  it("Edit reply closes the preview; Skip preview next time is remembered", async () => {
    const p = props();
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    typeInto(field(c), "Hello");
    click(button(c, C.send));
    click(button(c, C.edit));
    expect(c.querySelector("[data-composer-preview]")).toBeNull();
    click(button(c, C.send));
    const sw = c.querySelector<HTMLInputElement>(
      '[role="switch"], input[type="checkbox"]',
    )!;
    click(sw);
    expect(localStorage.getItem(SKIP_PREVIEW_STORAGE_KEY)).toBe("on");
    mounted.unmount();
    mounted = mount(<StaffComposer {...p} />);
    await flush();
    typeInto(field(mounted.container), "Again");
    click(button(mounted.container, C.send));
    await flush();
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("Ctrl Enter previews then sends; empty → MSG-REQUIRED", async () => {
    const p = props();
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    key(field(c), "Enter", { ctrlKey: true });
    expect(c.textContent).toContain(SUPPORT_UI_COPY.MSG_REQUIRED);
    typeInto(field(c), "Done");
    key(field(c), "Enter", { ctrlKey: true });
    expect(c.querySelector("[data-composer-preview]")).not.toBeNull();
    key(field(c), "Enter", { ctrlKey: true });
    await flush();
    expect(p.onSend).toHaveBeenCalledTimes(1);
  });

  it("a failed send keeps the text and shows ERR-SEND", async () => {
    const p = props({
      onSend: vi.fn(async () => ({ ok: false as const })),
      previewDefault: false,
    });
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    typeInto(field(c), "Keep me");
    click(button(c, C.send));
    await flush();
    expect(c.textContent).toContain(P13_COPY.ERR_SEND);
    expect(field(c).value).toBe("Keep me");
  });

  it("an unknown {word} is sent as typed with a hint; known ones are filled (WR-E09)", async () => {
    const p = props({ previewDefault: false });
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    typeInto(field(c), "Hi {first_name}, your page shows {title}");
    expect(c.querySelector("[data-placeholder-kept]")!.textContent).toBe(
      C.unknownKept("{title}"),
    );
    click(button(c, C.send));
    await flush();
    expect(p.onSend).toHaveBeenCalledTimes(1);
    expect(
      (p.onSend as unknown as { mock: { calls: [{ body: string }][] } }).mock
        .calls[0]![0].body,
    ).toBe("Hi Maria, your page shows {title}");
  });

  it("Then set falls back when a refresh moves the ticket off the picked status (WR-E10)", async () => {
    const p = props({ previewDefault: false });
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    const select = c.querySelector("select")!;
    act(() => {
      select.value = "resolved";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() =>
      mounted!.root.render(
        <StaffComposer {...p} ticket={{ ...p.ticket, status: "resolved" }} />,
      ),
    );
    expect(c.querySelector("select")!.value).toBe("");
    typeInto(field(c), "Following up.");
    click(button(c, C.send));
    await flush();
    expect(p.onSend).toHaveBeenCalledWith({
      number: 1042,
      body: "Following up.",
      internal: false,
    });
  });

  it("attached files go through onSendWithFiles as multipart", async () => {
    const p = props({ previewDefault: false });
    mounted = mount(<StaffComposer {...p} />);
    const c = mounted.container;
    typeInto(field(c), "See attached");
    const input = c.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["%PDF-1.4"], "quote.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(c.textContent).toContain("quote.pdf");
    click(button(c, C.send));
    await flush();
    expect(p.onSend).not.toHaveBeenCalled();
    const form = (p.onSendWithFiles as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as FormData;
    expect(form.get("body")).toBe("See attached");
    expect(form.get("internal")).toBe("0");
    expect((form.getAll("file")[0] as File).name).toBe("quote.pdf");
  });

  it("an Open ticket defaults Then set to In progress for a public reply", () => {
    mounted = mount(
      <StaffComposer
        {...props({
          ticket: {
            number: 7,
            business: "B",
            ownerFirstName: "",
            status: "open",
          },
        })}
      />,
    );
    expect(mounted.container.querySelector("select")!.value).toBe(
      "in_progress",
    );
    expect(mounted.container.textContent).toContain("Reply to the owner");
  });
});

describe("Canned picker", () => {
  it("inserts with placeholders filled and the text stays editable", async () => {
    mounted = mount(<StaffComposer {...props()} />);
    const c = mounted.container;
    click(button(c, C.canned));
    const dialog = c.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("Greeting");
    // The preview shows the filled text before insert.
    expect(
      dialog.querySelector("[data-placeholder-preview]")!.textContent,
    ).toContain("Hi Maria, thanks!");
    const search = dialog.querySelector<HTMLInputElement>("input")!;
    key(search, "Enter");
    await flush();
    expect(field(c).value).toBe("Hi Maria, thanks!");
    expect(c.querySelector("dialog[open]")).toBeNull();
    typeInto(field(c), "Hi Maria, thanks! More text.");
    expect(field(c).value).toBe("Hi Maria, thanks! More text.");
  });

  it("a template with {price} shows PLACEHOLDER-UNKNOWN and inserts nothing", () => {
    mounted = mount(<StaffComposer {...props()} />);
    const c = mounted.container;
    click(button(c, C.canned));
    const dialog = c.querySelector("dialog[open]")!;
    const search = dialog.querySelector<HTMLInputElement>("input")!;
    typeInto(search, "quote");
    key(search, "Enter");
    expect(
      dialog.querySelector("[data-placeholder-unknown]")!.textContent,
    ).toContain("{price} isn't a placeholder.");
    expect(field(c).value).toBe("");
  });

  it("an empty list says so and links to Add one", () => {
    mounted = mount(<StaffComposer {...props({ canned: [] })} />);
    click(button(mounted.container, C.canned));
    const dialog = mounted.container.querySelector("dialog[open]")!;
    expect(dialog.textContent).toContain("No canned replies yet.");
    expect(dialog.querySelector('a[href*="tab=canned"]')).not.toBeNull();
  });
});

describe("useInboxShortcuts", () => {
  it("r focuses Public, n focuses Internal, / opens the picker", async () => {
    mounted = mount(<Harness {...props()} />);
    const c = mounted.container;
    click(radio(c, C.modeInternal));
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    key(document.body, "r");
    await flush();
    expect(radio(c, C.modePublic).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(field(c));
    act(() => field(c).blur());
    key(document.body, "n");
    await flush();
    expect(radio(c, C.modeInternal).getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(field(c));
    act(() => field(c).blur());
    key(document.body, "/");
    expect(c.querySelector("dialog[open]")).not.toBeNull();
  });

  it("keys are ignored while typing in the textarea", async () => {
    mounted = mount(<Harness {...props()} />);
    const c = mounted.container;
    act(() => field(c).focus());
    key(field(c), "n");
    key(field(c), "/");
    await flush();
    expect(radio(c, C.modePublic).getAttribute("aria-checked")).toBe("true");
    expect(c.querySelector("dialog[open]")).toBeNull();
  });

  it("Esc goes back; the console switch turns single keys off", () => {
    const onBack = vi.fn();
    mounted = mount(<Harness {...props()} onBack={onBack} />);
    key(document.body, "Escape");
    expect(onBack).toHaveBeenCalledTimes(1);
    act(() => setShortcutsEnabled(false));
    key(document.body, "Escape");
    key(document.body, "/");
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(mounted.container.querySelector("dialog[open]")).toBeNull();
    act(() => setShortcutsEnabled(true));
  });
});
