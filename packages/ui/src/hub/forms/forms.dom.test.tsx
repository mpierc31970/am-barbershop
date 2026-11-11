// @vitest-environment jsdom
// 07-18 Task 2: Forms list, template chooser and form editor (CONT-25, D231, D233, D270,
// D119; 07-UI-SPEC Forms; WCAG 2.5.7 reorder without drag).
import {
  BLOCKED_FIELD_COPY,
  HEALTH_TIP_COPY,
  type FormField,
} from "@cds/core/forms";
import type { AnchorHTMLAttributes } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { ToastRegion } from "../Toast";
import { FormEditor, type FormSaveResult } from "./FormEditor";
import { FormsList } from "./FormsList";
import { TemplateChooser } from "./TemplateChooser";
import { newField, type FormDraft, type FormRowView } from "./form-logic";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

function A(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}

function field(root: ParentNode, label: string): HTMLInputElement {
  const el = Array.from(root.querySelectorAll("label")).find(
    (l) => (l.textContent ?? "").trim() === label,
  );
  const id = el?.getAttribute("for");
  const target = id ? document.getElementById(id) : null;
  if (!target) throw new Error(`no field labelled ${label}`);
  return target as HTMLInputElement;
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const rows: FormRowView[] = [
  {
    id: "f1",
    name: "Contact",
    template: "contact",
    fieldCount: 6,
    unread: 4,
    inReview: false,
    deleted: false,
    usage: {
      pages: [
        { id: "p1", title: "Home" },
        { id: "p2", title: "Contact" },
      ],
      inVersions: false,
      inPopups: 0,
    },
  },
  {
    id: "f2",
    name: '<img src=x onerror="alert(1)">',
    template: "blank",
    fieldCount: 0,
    unread: 0,
    inReview: true,
    deleted: false,
    usage: { pages: [], inVersions: false, inPopups: 0 },
  },
];

function list(forms: FormRowView[], canWrite = true) {
  const cb = {
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onHowTo: vi.fn(),
  };
  mounted = mount(
    <FormsList forms={forms} canWrite={canWrite} LinkComponent={A} {...cb} />,
  );
  return { root: mounted.container, ...cb };
}

describe("FormsList", () => {
  it("rows show the meta line, page links and unread; name opens", () => {
    const { root, onOpen } = list(rows);
    const first = root.querySelector('[data-form-row="f1"]')!;
    expect(first.querySelector("[data-form-meta]")!.textContent).toBe(
      "Contact template · 6 fields · On Home, Contact",
    );
    const links = Array.from(first.querySelectorAll("a")).map((a) =>
      a.getAttribute("href"),
    );
    expect(links).toContain("/hub/website/pages/p1");
    expect(links).toContain("/hub/inbox?form=f1");
    expect(first.textContent).toContain("4 unread");
    click(button(first, "Contact"));
    expect(onOpen).toHaveBeenCalledWith("f1");
    expect(root.textContent).toContain("2 forms");
    expect(button(root, "Create form")).not.toBeNull();
    expect(button(root, "How Forms works")).not.toBeNull();
  });

  it("unread hidden at 0, In review badge, hostile name literal", () => {
    const { root } = list(rows);
    const second = root.querySelector('[data-form-row="f2"]')!;
    expect(second.textContent).not.toContain("unread");
    expect(second.textContent).toContain("In review");
    expect(second.textContent).toContain("Not on any page yet");
    expect(root.querySelector("img")).toBeNull();
    expect(second.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("overflow menu: writers get Duplicate and Delete", () => {
    const { root, onDuplicate, onDelete } = list(rows);
    click(button(root, "More for Contact"));
    const menu = root.querySelector('ul[aria-label="More for Contact"]')!;
    expect(
      Array.from(menu.querySelectorAll("li")).map((l) => l.textContent),
    ).toEqual(["Edit", "View messages", "Duplicate form", "Delete form"]);
    expect(menu.querySelector("a")!.getAttribute("href")).toBe(
      "/hub/inbox?form=f1",
    );
    click(button(menu, "Duplicate form"));
    expect(onDuplicate).toHaveBeenCalledWith("f1");
    click(button(root, "More for Contact"));
    click(button(root, "Delete form"));
    expect(onDelete).toHaveBeenCalledWith("f1");
  });

  it("read-only: no Create, no Duplicate or Delete", () => {
    const { root } = list(rows, false);
    expect(button(root, "Create form")).toBeNull();
    click(button(root, "More for Contact"));
    expect(button(root, "Duplicate form")).toBeNull();
    expect(button(root, "Delete form")).toBeNull();
    expect(button(root, "Edit")).not.toBeNull();
  });

  it("empty state with Create form and the helper", () => {
    const { root, onCreate } = list([]);
    expect(root.textContent).toContain("No forms yet");
    expect(root.textContent).toContain(
      "Every message lands in your Inbox and we email you a copy.",
    );
    const creates = Array.from(root.querySelectorAll("button")).filter(
      (b) => b.textContent === "Create form",
    );
    expect(creates).toHaveLength(1);
    click(creates[0]);
    expect(onCreate).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Chooser
// ---------------------------------------------------------------------------

describe("TemplateChooser", () => {
  it("six cards, Contact by default, Create calls onCreate", () => {
    const onCreate = vi.fn();
    mounted = mount(<TemplateChooser onCreate={onCreate} onBack={() => {}} />);
    const root = mounted.container;
    expect(root.textContent).toContain("Start from a template");
    const radios = root.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(radios).toHaveLength(6);
    expect(
      Array.from(radios)
        .filter((r) => r.checked)
        .map((r) => r.value),
    ).toEqual(["contact"]);
    expect(root.textContent).toContain("Name · Email · Phone · Message");
    expect(root.textContent).toContain("No fields yet");
    click(button(root, "Create form"));
    expect(onCreate).toHaveBeenCalledWith("contact");
    act(() => radios[4]!.click());
    click(button(root, "Create form"));
    expect(onCreate).toHaveBeenLastCalledWith("feedback");
  });

  it("pending marks Create busy", () => {
    mounted = mount(
      <TemplateChooser onCreate={() => {}} onBack={() => {}} pending />,
    );
    const busy = mounted.container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function f(label: string, type: FormField["type"] = "short_text"): FormField {
  return { ...newField(type), label };
}

function base(fields: FormField[], over: Partial<FormDraft> = {}): FormDraft {
  return {
    name: "Contact",
    layout: "1",
    fields,
    after_submit: { kind: "message", message: "", page: "", button_text: "" },
    notify_route: "inquiries",
    newsletter_checkbox: false,
    newsletter_wording: "",
    template: "contact",
    inReview: false,
    deleted: false,
    ...over,
  };
}

function editor(
  draft: FormDraft,
  opts: {
    readOnly?: boolean;
    onSave?: (input: unknown) => Promise<FormSaveResult>;
    entitlements?: ReadonlySet<string>;
    canBuy?: boolean;
  } = {},
) {
  const onSave =
    opts.onSave ??
    vi.fn(async (input: unknown) => ({
      ok: true as const,
      data: { saved: { form: input, held: false } },
    }));
  const onExternalFormHelp = vi.fn();
  const onDirtyChange = vi.fn();
  mounted = mount(
    <ToastRegion>
      <FormEditor
        form={{ id: "f1", ...draft }}
        theme={{ hash: "00000000", css: "" }}
        pages={[{ id: "p1", title: "Home" }]}
        routes={null}
        readOnly={opts.readOnly ?? false}
        onSave={onSave as never}
        onDirtyChange={onDirtyChange}
        onExternalFormHelp={onExternalFormHelp}
        LinkComponent={A}
        backHref="/hub/website?tab=forms"
        entitlements={opts.entitlements}
        canBuy={opts.canBuy}
      />
    </ToastRegion>,
  );
  return {
    root: mounted.container,
    onSave,
    onExternalFormHelp,
    onDirtyChange,
  };
}

const rowLabels = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("[data-field-row]")).map(
    (r) => r.querySelector("button[id] span span")?.textContent,
  );

const saveBtn = (root: HTMLElement) => button(root, "Save form")!;

describe("FormEditor: fields", () => {
  it("adds a field from each group; File upload is locked Pro", () => {
    const { root } = editor(base([]));
    expect(root.textContent).toContain("Add your first field.");
    for (const label of ["Email", "Multiple choice", "Date", "Heading"]) {
      click(button(root, "Add field"));
      const menu = root.querySelector('[role="group"]')!.parentElement!;
      click(button(menu, label));
    }
    expect(rowLabels(root)).toEqual([
      "Email",
      "Multiple choice",
      "Date",
      "Heading",
    ]);
    // The new field is selected and its Label input focused.
    expect(document.activeElement).toBe(field(root, "Label"));
    click(button(root, "Add field"));
    const groups = Array.from(root.querySelectorAll('[role="group"]')).map(
      (g) => g.querySelector("p")!.textContent,
    );
    expect(groups).toEqual([
      "Text",
      "Choices",
      "Date and time",
      "Other",
      "File upload",
    ]);
    const file = Array.from(root.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("File upload"),
    )!;
    expect(file.disabled).toBe(true);
    const lock = root.querySelector('[data-feature-lock="builder-pro"]')!;
    expect(lock.textContent).toContain("Part of Builder Pro");
    expect(lock.textContent).toContain(
      "Ask your site owner to add Builder Pro.",
    );
    expect(root.textContent).toContain("Let visitors attach files.");
    expect(root.textContent).not.toContain("Coming with Builder Pro");
  });

  it("an owner without Builder Pro gets the Add Builder Pro link (10-17)", () => {
    const { root } = editor(base([]), { canBuy: true });
    click(button(root, "Add field"));
    const lock = root.querySelector('[data-feature-lock="builder-pro"]')!;
    const link = Array.from(lock.querySelectorAll("a")).find(
      (a) => a.textContent === "Add Builder Pro",
    );
    expect(link?.getAttribute("href")).toBe("/hub/add-ons/builder-pro");
    expect(lock.textContent).not.toContain("Ask your site owner");
  });

  it("with Builder Pro, File upload is enabled and adds a file field (10-17)", () => {
    const { root } = editor(base([]), {
      entitlements: new Set(["builder-pro"]),
    });
    click(button(root, "Add field"));
    expect(root.querySelector("[data-feature-lock]")).toBeNull();
    const file = Array.from(root.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").startsWith("File upload"),
    )!;
    expect(file.disabled).toBe(false);
    click(file);
    expect(rowLabels(root)).toHaveLength(1);
    expect(root.textContent).not.toContain("Part of Builder Pro");
  });

  it("Escape closes the menu and returns focus", () => {
    const { root } = editor(base([]));
    click(button(root, "Add field"));
    const inMenu = button(root, "Email")!;
    inMenu.focus();
    act(() => {
      inMenu.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(root.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(button(root, "Add field"));
  });

  it("reorders with Move up / Move down and keeps focus", () => {
    const { root } = editor(base([f("A"), f("B"), f("C")]));
    expect(button(root, "Move A up")!.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(button(root, "Move C down")!.getAttribute("aria-disabled")).toBe(
      "true",
    );
    const down = button(root, "Move A down")!;
    down.focus();
    click(down);
    expect(rowLabels(root)).toEqual(["B", "A", "C"]);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Move A down",
    );
    expect(root.textContent).toContain("A dropped at position 2 of 3.");
    click(button(root, "Move B up"));
    expect(rowLabels(root)).toEqual(["B", "A", "C"]);
  });

  it("reorders by keyboard drag on the grip and announces it", async () => {
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const row = this.closest("[data-field-row]");
        const all = row
          ? Array.from(row.parentElement!.querySelectorAll("[data-field-row]"))
          : [];
        const i = row ? all.indexOf(row) : 0;
        const top = row ? i * 56 : 0;
        const height = row ? 56 : 0;
        return {
          x: 0,
          y: top,
          top,
          left: 0,
          width: 300,
          height,
          right: 300,
          bottom: top + height,
          toJSON: () => ({}),
        } as DOMRect;
      });
    const { root } = editor(base([f("A"), f("B"), f("C")]));
    const grip = button(root, "Reorder A")!;
    grip.focus();
    const key = (k: string, code = k) =>
      act(() => {
        grip.dispatchEvent(
          new KeyboardEvent("keydown", { key: k, code, bubbles: true }),
        );
      });
    key(" ", "Space");
    await flush(2);
    key("ArrowDown");
    await flush(2);
    key(" ", "Space");
    await flush(3);
    expect(rowLabels(root)).toEqual(["B", "A", "C"]);
    expect(document.body.textContent).toContain(
      "A dropped at position 2 of 3.",
    );
    rect.mockRestore();
  });

  it("a blocked label disables Save and shows BLOCKED-FIELD", () => {
    const { root } = editor(base([f("Name")]));
    click(button(root, /^Name/));
    const label = field(root, "Label");
    typeInto(label, "Card number");
    expect(saveBtn(root).disabled).toBe(true);
    expect(label.getAttribute("aria-invalid")).toBe("true");
    const err = document.getElementById(
      label.getAttribute("aria-describedby")!.split(" ").pop()!,
    );
    expect(err?.textContent).toBe(BLOCKED_FIELD_COPY);
    expect(root.textContent).toContain("Needs attention");
    typeInto(label, "Company");
    expect(saveBtn(root).disabled).toBe(false);
    expect(label.getAttribute("aria-invalid")).toBeNull();
  });

  it("a blocked help text shows BLOCKED-FIELD under it (WR-B02)", () => {
    const { root } = editor(base([f("Name")]));
    click(button(root, /^Name/));
    const help = field(root, "Help text");
    typeInto(help, "Type your card number");
    expect(saveBtn(root).disabled).toBe(true);
    expect(help.getAttribute("aria-invalid")).toBe("true");
    expect(field(root, "Label").getAttribute("aria-invalid")).toBeNull();
    typeInto(help, "Your full name");
    expect(saveBtn(root).disabled).toBe(false);
  });

  it("the health tip shows for medical words and opens the instructions", () => {
    const { root, onExternalFormHelp } = editor(base([f("Medication")]));
    expect(root.textContent).toContain(HEALTH_TIP_COPY);
    click(button(root, "Add an External form button"));
    expect(onExternalFormHelp).toHaveBeenCalled();
  });

  it("Paste a list replaces the options", () => {
    const radio = { ...f("Pick", "radio"), options: ["Old"] };
    const { root } = editor(base([radio]));
    click(button(root, /^Pick/));
    click(button(root, "Paste a list"));
    typeInto(field(root, "Your list"), "Red\n\nGreen\nred\nBlue");
    click(button(root, "Use this list"));
    const opts = Array.from(
      root.querySelectorAll<HTMLInputElement>(
        '[id$="-options-0"], [id*="-options-"]',
      ),
    )
      .filter((i) => i.tagName === "INPUT" && /-options-\d+$/.test(i.id))
      .map((i) => i.value);
    expect(opts).toEqual(["Red", "Green", "Blue"]);
  });

  it("Remove field + Undo restores its index", async () => {
    const { root } = editor(base([f("A"), f("B"), f("C")]));
    click(button(root, /^B/));
    click(button(root, "Remove field"));
    expect(rowLabels(root)).toEqual(["A", "C"]);
    expect(root.textContent).toContain("Field removed.");
    expect(document.activeElement?.textContent).toContain("C");
    click(button(root, "Undo"));
    await flush(1);
    expect(rowLabels(root)).toEqual(["A", "B", "C"]);
  });

  it("Full width appears only with two columns", () => {
    const { root } = editor(base([f("A")]));
    click(button(root, /^A/));
    expect(root.textContent).not.toContain("Full width");
    click(button(root, "Form settings"));
    act(() =>
      root
        .querySelector<HTMLInputElement>('input[type="radio"][value="2"]')!
        .click(),
    );
    click(button(root, /^A/));
    expect(root.textContent).toContain("Full width");
  });
});

describe("FormEditor: save", () => {
  it("an invalid result selects the field and shows the summary", async () => {
    const a = f("A");
    const b = f("B");
    const onSave = vi.fn(async () => ({
      ok: true as const,
      data: {
        invalid: {
          errors: { [b.id]: "Add a label.", name: "Add a name for this form." },
          message: "2 fields need attention",
        },
      },
    }));
    const { root } = editor(base([a, b]), { onSave });
    typeInto(field(root, "Button text"), "Go");
    click(saveBtn(root));
    await flush();
    expect(root.querySelector('[role="alert"]')!.textContent).toContain(
      "2 fields need attention",
    );
    const current = root.querySelector('[aria-current="true"]')!;
    expect(current.textContent).toContain("B");
    expect(document.activeElement).toBe(field(root, "Label"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", name: "Contact" }),
    );
  });

  it("a held save shows In review and the review toast", async () => {
    const onSave = vi.fn(async (input: unknown) => ({
      ok: true as const,
      data: { saved: { form: input, held: true } },
    }));
    const { root } = editor(base([f("A")]), { onSave });
    expect(saveBtn(root).disabled).toBe(true);
    typeInto(field(root, "Button text"), "Go");
    expect(saveBtn(root).disabled).toBe(false);
    click(saveBtn(root));
    await flush();
    expect(root.textContent).toContain("In review");
    expect(root.textContent).toContain(
      "Saved. The form shows on your site once it's reviewed",
    );
    expect(saveBtn(root).disabled).toBe(true);
  });

  it("ok:false shows the save error", async () => {
    const onSave = vi.fn(async () => ({
      ok: false as const,
      code: "save_failed",
      message: "Your changes weren't saved.",
    }));
    const { root } = editor(base([f("A")]), { onSave });
    typeInto(field(root, "Button text"), "Go");
    click(saveBtn(root));
    await flush();
    expect(root.textContent).toContain("Your changes weren't saved.");
  });

  it("read-only: no Save, a disabled fieldset and the read-only line", () => {
    const { root } = editor(base([f("A")]), { readOnly: true });
    expect(button(root, "Save form")).toBeNull();
    expect(button(root, "Add field")).toBeNull();
    expect(
      root.querySelector<HTMLFieldSetElement>(
        '[data-pane="settings"] fieldset',
      )!.disabled,
    ).toBe(true);
    expect(root.textContent).toContain(
      "You can look at forms here. Ask an owner or admin to change them.",
    );
    click(button(root, /^A/));
    expect(button(root, "Remove field")).toBeNull();
  });

  it("dirty is reported for the leave guard", () => {
    const { root, onDirtyChange } = editor(base([f("A")]));
    typeInto(field(root, "Button text"), "Go");
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    click(button(root, "Discard changes"));
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });
});

describe("FormEditor: preview", () => {
  beforeEach(() => {});
  it("renders the draft through FormMarkup, inert, sending off", () => {
    const hidden = { ...f("Secret", "hidden"), value: "x" };
    const { root } = editor(base([f("A"), hidden]));
    const pane = root.querySelector('[data-pane="preview"]')!;
    expect(pane.textContent).toContain("Preview: sending is off");
    const site = pane.querySelector("[data-site]")!;
    expect(site.hasAttribute("inert")).toBe(true);
    expect(site.textContent).toContain("A (optional)");
    expect(site.textContent).not.toContain("Secret");
    const submit = site.querySelector("button")!;
    expect(submit.disabled).toBe(true);
    expect(submit.type).toBe("button");
    expect(submit.textContent).toBe("Send message");
    typeInto(field(root, "Button text"), "Book now");
    expect(site.querySelector("button")!.textContent).toBe("Book now");
    click(button(root, /^A/));
    typeInto(field(root, "Label"), "Your name");
    expect(pane.textContent).toContain("Your name (optional)");
  });

  it("Preview form toggles with aria-pressed", () => {
    const { root } = editor(base([f("A")]));
    const toggle = button(root, "Preview form")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector('[data-pane="preview"]')!.className).toMatch(
      /(^|\s)block(\s|$)/,
    );
  });
});
