// @vitest-environment jsdom
// 07-18 Task 2: the shared public form markup (choice 2; 07-UI-SPEC "Public form").
import {
  FORM_NEWSLETTER_NAME,
  type FormField,
  type PublicForm,
} from "@cds/core/forms";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mount, type Mounted } from "../../test-support/dom";
import { FormMarkup } from "./FormMarkup";

let mounted: Mounted[] = [];
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
});

function f(
  id: string,
  type: FormField["type"],
  over: Partial<FormField> = {},
): FormField {
  return {
    id,
    type,
    label: id.toUpperCase(),
    placeholder: "",
    help: "",
    required: false,
    full_width: false,
    options: [],
    content: "",
    value: "",
    ...over,
  };
}

function form(fields: FormField[], over: Partial<PublicForm> = {}): PublicForm {
  return {
    id: "f1",
    name: "Contact",
    layout: "1",
    fields,
    after_submit: {
      kind: "message",
      message: "Thanks",
      button_text: "Send it",
    },
    newsletter_checkbox: false,
    newsletter_wording: "",
    ...over,
  };
}

function render(el: ReactElement): HTMLElement {
  const m = mount(el);
  mounted.push(m);
  return m.container;
}

const input = (root: HTMLElement, name: string) =>
  root.querySelector<HTMLInputElement>(`[name="${name}"]`);

describe("FormMarkup", () => {
  it("renders each input type with the right element and autocomplete", () => {
    const root = render(
      <FormMarkup
        form={form([
          f("st", "short_text"),
          f("lt", "long_text"),
          f("em", "email"),
          f("ph", "phone"),
          f("nu", "number"),
          f("nm", "name"),
          f("dt", "date"),
          f("tm", "time"),
          f("dd", "dropdown", { options: ["A", "B"] }),
        ])}
      />,
    );
    expect(input(root, "st")!.type).toBe("text");
    expect(input(root, "lt")!.tagName).toBe("TEXTAREA");
    expect(input(root, "em")!.getAttribute("autocomplete")).toBe("email");
    expect(input(root, "em")!.type).toBe("email");
    expect(input(root, "ph")!.type).toBe("tel");
    expect(input(root, "ph")!.getAttribute("autocomplete")).toBe("tel");
    expect(input(root, "nu")!.getAttribute("inputmode")).toBe("decimal");
    expect(input(root, "nm")!.getAttribute("autocomplete")).toBe("name");
    expect(input(root, "dt")!.type).toBe("date");
    expect(input(root, "tm")!.type).toBe("time");
    const sel = root.querySelector<HTMLSelectElement>('select[name="dd"]')!;
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["", "A", "B"]);
  });

  it("optional suffix, required attributes and help by aria-describedby", () => {
    const root = render(
      <FormMarkup
        form={form([
          f("a", "short_text", {
            label: "Name",
            required: true,
            help: "Full name",
          }),
          f("b", "short_text", { label: "Company" }),
        ])}
      />,
    );
    const a = input(root, "a")!;
    expect(a.required).toBe(true);
    expect(a.getAttribute("aria-required")).toBe("true");
    const help = document.getElementById(a.getAttribute("aria-describedby")!);
    expect(help?.textContent).toBe("Full name");
    const labels = Array.from(root.querySelectorAll("label")).map(
      (l) => l.textContent,
    );
    expect(labels).toContain("Name");
    expect(labels).toContain("Company (optional)");
  });

  it("groups are fieldsets with legends; payload names follow the contract", () => {
    const root = render(
      <FormMarkup
        form={form([
          f("r", "radio", { label: "Pick", options: ["X", "Y"] }),
          f("c", "checkboxes", { label: "Many", options: ["P", "Q"] }),
          f("y", "yes_no", { label: "OK?" }),
          f("ad", "address", { label: "Address" }),
          f("ag", "agreement", { content: "I agree." }),
          f("hd", "heading", { content: "Section" }),
          f("pa", "paragraph", { content: "Words" }),
        ])}
      />,
    );
    const legends = Array.from(root.querySelectorAll("fieldset > legend")).map(
      (l) => l.textContent,
    );
    expect(legends).toEqual([
      "Pick (optional)",
      "Many (optional)",
      "OK? (optional)",
      "Address (optional)",
    ]);
    expect(root.querySelectorAll('input[type="radio"][name="r"]')).toHaveLength(
      2,
    );
    expect(
      root.querySelectorAll('input[type="checkbox"][name="c"]'),
    ).toHaveLength(2);
    expect(
      Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="y"]'),
      ).map((i) => i.value),
    ).toEqual(["yes", "no"]);
    for (const [part, ac] of [
      ["line1", "address-line1"],
      ["line2", "address-line2"],
      ["city", "address-level2"],
      ["region", "address-level1"],
      ["postal_code", "postal-code"],
    ]) {
      expect(input(root, `ad.${part}`)!.getAttribute("autocomplete")).toBe(ac);
    }
    const ag = input(root, "ag")!;
    expect(ag.type).toBe("checkbox");
    expect(ag.closest("label")!.textContent).toContain("I agree.");
    expect(root.querySelector("h3")!.textContent).toBe("Section");
    expect(
      Array.from(root.querySelectorAll("p")).some(
        (p) => p.textContent === "Words",
      ),
    ).toBe(true);
  });

  it("two columns via a container query; full width spans both", () => {
    const root = render(
      <FormMarkup
        form={form(
          [f("a", "short_text"), f("b", "long_text", { full_width: true })],
          {
            layout: "2",
          },
        )}
      />,
    );
    expect(root.querySelector(".\\@container")).not.toBeNull();
    expect(root.innerHTML).toContain("@min-[560px]:grid-cols-2");
    expect(root.querySelector('[data-field="b"]')!.className).toContain(
      "@min-[560px]:col-span-2",
    );
    expect(root.querySelector('[data-field="a"]')!.className).not.toContain(
      "col-span-2",
    );
  });

  it("newsletter checkbox and submit; preview disables the submit", () => {
    const live = render(
      <FormMarkup
        form={form([], {
          newsletter_checkbox: true,
          newsletter_wording: "News?",
        })}
      />,
    );
    const nl = input(live, FORM_NEWSLETTER_NAME)!;
    expect(nl.closest("label")!.textContent).toBe("News?");
    const send = live.querySelector("button")!;
    expect(send.type).toBe("submit");
    expect(send.disabled).toBe(false);
    expect(send.textContent).toBe("Send it");
    const prev = render(<FormMarkup form={form([])} preview />);
    const b = prev.querySelector("button")!;
    expect(b.type).toBe("button");
    expect(b.disabled).toBe(true);
  });

  it("errors render icon + text with aria-invalid; values pre-fill", () => {
    const root = render(
      <FormMarkup
        form={form([
          f("em", "email"),
          f("c", "checkboxes", { options: ["P", "Q"] }),
        ])}
        errors={{ em: "Enter an email address, like name@example.com." }}
        values={{ em: "bad@", c: ["Q"] }}
      />,
    );
    const em = input(root, "em")!;
    expect(em.getAttribute("aria-invalid")).toBe("true");
    expect(em.value).toBe("bad@");
    const err = document.getElementById(
      em.getAttribute("aria-describedby")!.split(" ").pop()!,
    )!;
    expect(err.textContent).toBe(
      "Enter an email address, like name@example.com.",
    );
    expect(err.querySelector("svg")).not.toBeNull();
    const boxes = root.querySelectorAll<HTMLInputElement>('input[name="c"]');
    expect(boxes[0]!.checked).toBe(false);
    expect(boxes[1]!.checked).toBe(true);
  });

  it("a hostile label renders literally", () => {
    const root = render(
      <FormMarkup
        form={form([
          f("x", "short_text", { label: '<img src=x onerror="alert(1)">' }),
        ])}
      />,
    );
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it("two forms on one page get distinct ids", () => {
    const root = render(
      <div>
        <FormMarkup form={form([f("a", "short_text")])} />
        <FormMarkup form={form([f("a", "short_text")], { id: "f2" })} />
      </div>,
    );
    const ids = Array.from(root.querySelectorAll("input")).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(["form-f1-a", "form-f2-a"]);
  });
});

// 10-40 (BILL-14, D233, D234): Forms Pro markup. Without the island every step shows.
describe("FormMarkup · Forms Pro", () => {
  const fields = [
    f("name", "name", { label: "Name", required: true }),
    f("svc", "dropdown", { label: "Service", options: ["Wedding", "Other"] }),
    f("date", "date", { label: "Date" }),
    f("photo", "file", { label: "Your photo" }),
  ];
  const pro = {
    rules: [
      {
        target: "date",
        action: "show" as const,
        when: { field: "svc", op: "is" as const, value: "Wedding" },
      },
    ],
    steps: [
      { id: "s1", title: "About you", fields: ["name", "svc"] },
      { id: "s2", title: "Details", fields: ["date", "photo"] },
    ],
    save_resume: true,
  };

  it("a free form renders the same markup with or without `pro: null`", () => {
    const plain = render(<FormMarkup form={form(fields.slice(0, 3))} />);
    const nulled = render(
      <FormMarkup form={form(fields.slice(0, 3), { pro: null })} />,
    );
    expect(nulled.innerHTML).toBe(plain.innerHTML);
    expect(plain.querySelector("[data-step]")).toBeNull();
    expect(plain.querySelector("nav")).toBeNull();
  });

  it("without JS every step shows as a fieldset with an h3 title, one submit", () => {
    const root = render(<FormMarkup form={form(fields, { pro })} />);
    const sets = Array.from(root.querySelectorAll("fieldset[data-step]"));
    expect(sets).toHaveLength(2);
    expect(sets.every((s) => !s.hasAttribute("hidden"))).toBe(true);
    expect(
      sets.map((s) => s.querySelector("legend > h3")?.textContent),
    ).toEqual(["About you", "Details"]);
    expect(root.querySelector("nav")).toBeNull();
    // Rules are not applied server-side: every field shows and is enabled.
    expect(input(root, "date")!.disabled).toBe(false);
    // One submit; the pre-mount Next stand-in (CR-C02) is display:none without scripting.
    const submits = root.querySelectorAll('button[type="submit"]');
    expect(submits).toHaveLength(1);
    expect(submits[0]!.textContent).toBe("Send it");
    const standIn = root.querySelector('button[type="button"]')!;
    expect(standIn.parentElement!.className).toMatch(/^hidden /);
  });

  it("10-44 CLS: the pre-mount markup carries scripting-only hints matching the island layout", () => {
    const JS_HIDE =
      "[@media(scripting:enabled)]:group-data-[premount]/form:hidden";
    const root = render(<FormMarkup form={form(fields, { pro })} />);
    const [s1, s2] = Array.from(root.querySelectorAll("fieldset[data-step]"));
    // Step 2 is hidden only where scripts run; no `hidden` attribute (no-JS shows it).
    expect(s1!.className).not.toContain(JS_HIDE);
    expect(s2!.className).toContain(JS_HIDE);
    expect(s2!.hasAttribute("hidden")).toBe(false);
    expect(s1!.querySelector("legend")!.className).toContain(
      "[@media(scripting:enabled)]:group-data-[premount]/form:sr-only",
    );
    // The progress stand-in is aria-hidden and display:none unless scripting is enabled.
    const standIn = root.querySelector('[aria-hidden="true"]')!;
    expect(standIn.className).toContain(
      "hidden [@media(scripting:enabled)]:group-data-[premount]/form:flex",
    );
    expect(standIn.textContent).toContain("Step 1 of 2");
    // The rule-hidden field (date shows only for Wedding) is hinted, not disabled.
    const date = root.querySelector('[data-field="date"]')!;
    expect(date.className).toContain(JS_HIDE);
    expect(input(root, "date")!.disabled).toBe(false);
    // The save link's space is kept (invisible, aria-hidden).
    expect(root.textContent).toContain("Save and finish later");
  });

  it("CR-C02: every pre-mount hint is scoped to the form's data-premount, never bare scripting", () => {
    const root = render(<FormMarkup form={form(fields, { pro })} />);
    const classes = Array.from(root.querySelectorAll("[class]")).flatMap((el) =>
      el.className.split(/\s+/),
    );
    const hints = classes.filter((c) => c.includes("scripting:enabled"));
    expect(hints.length).toBeGreaterThan(0);
    for (const c of hints) {
      expect(c).toMatch(
        /^\[@media\(scripting:enabled\)\]:group-data-\[premount\]\/form:/,
      );
    }
  });

  it("CR-C02: before mount the visible button is a Next stand-in that posts nothing", () => {
    const root = render(<FormMarkup form={form(fields, { pro })} />);
    const buttons = Array.from(root.querySelectorAll("button"));
    expect(buttons.map((b) => [b.type, b.textContent])).toEqual([
      ["submit", "Send it"],
      ["button", "Next"],
    ]);
    // The real submit hides only while pre-mount with scripting; the stand-in shows only then.
    expect(buttons[0]!.parentElement!.className).toBe(
      "[@media(scripting:enabled)]:group-data-[premount]/form:hidden",
    );
    expect(buttons[1]!.parentElement!.className).toBe(
      "hidden [@media(scripting:enabled)]:group-data-[premount]/form:block",
    );
    // Once enhanced, the island's own buttons only.
    const enhanced = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{ stepId: "s1", liveSteps: ["s1", "s2"], hidden: new Set() }}
      />,
    );
    expect(
      Array.from(enhanced.querySelectorAll("button")).map((b) => b.type),
    ).toEqual(["submit"]);
  });

  it("10-44 CLS: no hints once enhanced, in preview, or on a free form", () => {
    const hint = "scripting:enabled";
    const enhanced = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{ stepId: "s1", liveSteps: ["s1", "s2"], hidden: new Set() }}
      />,
    );
    expect(enhanced.innerHTML).not.toContain(hint);
    const preview = render(<FormMarkup form={form(fields, { pro })} preview />);
    expect(preview.innerHTML).not.toContain(hint);
    const free = render(<FormMarkup form={form(fields)} />);
    expect(free.innerHTML).not.toContain(hint);
  });

  it("enhanced: only the current step, progress nav, Back and Next", () => {
    const root = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{ stepId: "s2", liveSteps: ["s1", "s2"], hidden: new Set() }}
      />,
    );
    const [s1, s2] = Array.from(root.querySelectorAll("fieldset[data-step]"));
    expect(s1!.hasAttribute("hidden")).toBe(true);
    expect(s2!.hasAttribute("hidden")).toBe(false);
    const nav = root.querySelector('nav[aria-label="Form progress"]')!;
    expect(nav.textContent).toContain("Step 2 of 2");
    expect(nav.querySelector("h3")!.textContent).toBe("Details");
    expect(nav.querySelector('[aria-current="step"]')!.textContent).toBe(
      "Details",
    );
    expect(root.querySelector('[aria-live="polite"]')!.textContent).toBe(
      "Step 2 of 2: Details",
    );
    const labels = Array.from(root.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Back", "Send it"]);

    const first = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{ stepId: "s1", liveSteps: ["s1", "s2"], hidden: new Set() }}
      />,
    );
    expect(
      Array.from(first.querySelectorAll("button")).map((b) => b.textContent),
    ).toEqual(["Next"]);
  });

  it("enhanced: a rule-hidden field is hidden and disabled", () => {
    const root = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{ hidden: new Set(["date"]) }}
      />,
    );
    expect(
      root.querySelector('[data-field="date"]')!.hasAttribute("hidden"),
    ).toBe(true);
    expect(input(root, "date")!.disabled).toBe(true);
    expect(input(root, "name")!.disabled).toBe(false);
  });

  it("a file field: accept list, helper, never required; chosen file with Remove", () => {
    const removed: string[] = [];
    const root = render(
      <FormMarkup
        form={form(fields, { pro })}
        enhanced={{
          files: { photo: { name: "id.pdf", size: 340 * 1024 } },
          onRemoveFile: (id) => removed.push(id),
        }}
      />,
    );
    const file = input(root, "photo")!;
    expect(file.type).toBe("file");
    expect(file.getAttribute("accept")).toBe(
      ".pdf,.jpg,.jpeg,.png,.heic,.heif,.doc,.docx",
    );
    expect(file.required).toBe(false);
    const described = file
      .getAttribute("aria-describedby")!
      .split(" ")
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain("PDF, JPG, PNG, HEIC or Word, up to 10 MB");
    expect(root.querySelector("[data-file-chosen]")!.textContent).toContain(
      "id.pdf (340 KB)",
    );
    const remove = root.querySelector<HTMLButtonElement>(
      '[data-file-chosen] button[type="button"]',
    )!;
    remove.click();
    expect(removed).toEqual(["photo"]);
  });
});
