// @vitest-environment jsdom
// 10-39 Task 2: Forms Pro editor controls (BILL-14, BILL-04, D233; 10-UI-SPEC "Forms Pro",
// D-UI-P10-28..33). Pure draft helpers first, then the editor: rules in the field pane,
// steps in Form settings + the field list, auto-reply / routing / save later, the preview,
// and the locked / paused states. The server re-checks every save; these locks are cosmetic.
import { emptyPro, type FormField } from "@cds/core/forms";
import type { AnchorHTMLAttributes } from "react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { PAUSED_PRO_COPY } from "./ProSettingsPanel";
import {
  addStep,
  cleanPro,
  draftFromRecord,
  draftToInput,
  hasProContent,
  moveFieldInSteps,
  removeStep,
  ruleFor,
  ruleSummary,
  setAutoReply,
  setRouting,
  setRule,
  setSaveResume,
  splitIntoSteps,
  syncSteps,
  type FormDraft,
} from "./form-logic";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

function A(props: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a {...props} />;
}

function fld(
  id: string,
  label: string,
  type: FormField["type"] = "short_text",
  options: string[] = [],
): FormField {
  return {
    id,
    type,
    label,
    placeholder: "",
    help: "",
    required: false,
    full_width: false,
    options,
    content: "",
    value: "",
  };
}

const SERVICE = fld("service", "Service", "dropdown", ["Wedding", "Birthday"]);
const DETAILS = fld("details", "Details", "long_text");
const EMAIL = fld("email", "Email", "email");

function base(fields: FormField[], over: Partial<FormDraft> = {}): FormDraft {
  return {
    name: "Quote",
    layout: "1",
    fields,
    after_submit: { kind: "message", message: "", page: "", button_text: "" },
    notify_route: "inquiries",
    newsletter_checkbox: false,
    newsletter_wording: "",
    template: "blank",
    inReview: false,
    deleted: false,
    ...over,
  };
}

const PRO = new Set(["builder-pro"]);
const NONE = new Set<string>();

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("form-logic Forms Pro helpers", () => {
  it("setRule keeps one rule per field and ruleFor reads it", () => {
    let d = base([SERVICE, DETAILS]);
    d = setRule(d, "details", {
      action: "show",
      when: { field: "service", op: "is", value: "Wedding" },
    });
    d = setRule(d, "details", {
      action: "hide",
      when: { field: "service", op: "answered", value: "" },
    });
    expect(d.pro!.rules).toHaveLength(1);
    expect(ruleFor(d, "details")!.action).toBe("hide");
    expect(ruleSummary(d.pro!.rules[0]!, d.fields)).toBe(
      "Hides when Service is answered.",
    );
    d = setRule(d, "details", null);
    expect(ruleFor(d, "details")).toBeNull();
  });

  it("splitIntoSteps, addStep, removeStep and syncSteps keep every field in one step", () => {
    let d = splitIntoSteps(base([SERVICE, DETAILS, EMAIL]), true);
    expect(d.pro!.steps).toHaveLength(1);
    expect(d.pro!.steps[0]!.fields).toEqual(["service", "details", "email"]);
    d = addStep(d);
    expect(d.pro!.steps.map((s) => s.title)).toEqual(["Step 1", "Step 2"]);
    // A new field joins the last step.
    d = syncSteps({ ...d, fields: [...d.fields, fld("x", "X")] });
    expect(d.pro!.steps[1]!.fields).toEqual(["x"]);
    // Removing step 2 puts its fields back in step 1.
    d = removeStep(d, d.pro!.steps[1]!.id);
    expect(d.pro!.steps).toHaveLength(1);
    expect(d.pro!.steps[0]!.fields).toEqual([
      "service",
      "details",
      "email",
      "x",
    ]);
    expect(splitIntoSteps(d, false).pro!.steps).toEqual([]);
  });

  it("button moves at a step edge change the step first; drags take the landing step", () => {
    let d = addStep(splitIntoSteps(base([SERVICE, DETAILS, EMAIL]), true));
    // email (index 2, last of step 1) moves down into empty step 2.
    d = moveFieldInSteps(d, 2, 3, "button");
    expect(d.pro!.steps.map((s) => s.fields)).toEqual([
      ["service", "details"],
      ["email"],
    ]);
    // email is first of step 2: Move up joins the end of step 1 (no reorder).
    const up = moveFieldInSteps(d, 2, 1, "button");
    expect(up.pro!.steps.map((s) => s.fields)).toEqual([
      ["service", "details", "email"],
      [],
    ]);
    // Drag service onto email (step 2).
    const dragged = moveFieldInSteps(d, 0, 2, "drag");
    expect(dragged.pro!.steps.map((s) => s.fields)).toEqual([
      ["details"],
      ["email", "service"],
    ]);
    expect(dragged.fields.map((f) => f.id)).toEqual([
      "details",
      "email",
      "service",
    ]);
  });

  it("auto-reply, routing and save later patch the draft; cleanPro drops removed-field refs", () => {
    let d = base([SERVICE, DETAILS, EMAIL]);
    d = setAutoReply(d, {
      enabled: true,
      subject: "Thanks",
      body: "Hi {name}",
    });
    d = setRouting(d, [
      { field: "service", value: "Wedding", route: "default" },
      { field: "gone", value: "x", route: "default" },
    ]);
    d = setSaveResume(d, true);
    d = setRule(d, "details", {
      action: "show",
      when: { field: "service", op: "answered", value: "left over" },
    });
    d = setRule(d, "ghost", {
      action: "show",
      when: { field: "service", op: "is", value: "Wedding" },
    });
    const clean = cleanPro(d);
    expect(clean.routing).toEqual([
      { field: "service", value: "Wedding", route: "default" },
    ]);
    expect(clean.rules).toEqual([
      {
        target: "details",
        action: "show",
        when: { field: "service", op: "answered", value: "" },
      },
    ]);
    expect(clean.auto_reply).toEqual({
      enabled: true,
      subject: "Thanks",
      body: "Hi {name}",
    });
    expect(clean.save_resume).toBe(true);
    expect(hasProContent(clean)).toBe(true);
    expect(hasProContent(emptyPro())).toBe(false);
  });

  it("draftToInput sends pro only while Builder Pro is active; draftFromRecord keeps it", () => {
    const d = setSaveResume(base([EMAIL]), true);
    expect("pro" in draftToInput("f1", d)).toBe(false);
    expect("pro" in draftToInput("f1", d, { proActive: false })).toBe(false);
    expect(draftToInput("f1", d, { proActive: true }).pro!.save_resume).toBe(
      true,
    );
    const back = draftFromRecord({ ...d });
    expect(back.pro).toEqual(d.pro);
    expect("pro" in draftFromRecord({ ...base([EMAIL]) })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function choose(el: Element | null, value: string) {
  if (!el) throw new Error("choose: element not found");
  const select = el as HTMLSelectElement;
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function labelled(root: ParentNode, label: string): HTMLElement {
  const el = Array.from(root.querySelectorAll("label")).find(
    (l) => (l.textContent ?? "").trim() === label,
  );
  const id = el?.getAttribute("for");
  const target = id ? document.getElementById(id) : null;
  if (!target) throw new Error(`no control labelled ${label}`);
  return target;
}

function editor(
  draft: FormDraft,
  opts: {
    entitlements?: ReadonlySet<string>;
    canBuy?: boolean;
    onSave?: (input: unknown) => Promise<FormSaveResult>;
  } = {},
) {
  const onSave =
    opts.onSave ??
    vi.fn(async (input: unknown) => ({
      ok: true as const,
      data: { saved: { form: input, held: false } },
    }));
  mounted = mount(
    <ToastRegion>
      <FormEditor
        form={{ id: "f1", ...draft }}
        theme={{ hash: "00000000", css: "" }}
        pages={[]}
        routes={null}
        readOnly={false}
        onSave={onSave as never}
        onExternalFormHelp={vi.fn()}
        LinkComponent={A}
        backHref="/hub/website?tab=forms"
        entitlements={opts.entitlements}
        canBuy={opts.canBuy}
      />
    </ToastRegion>,
  );
  return { root: mounted.container, onSave };
}

const row = (root: HTMLElement, id: string) =>
  root.querySelector(`[data-field-row="${id}"] button[id]`) as HTMLElement;
const preview = (root: HTMLElement) =>
  root.querySelector('[data-pane="preview"]') as HTMLElement;
const settingsRow = (root: HTMLElement) =>
  Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === "Form settings",
  )!;

describe("FormEditor: Forms Pro entitled", () => {
  it("a rule on details shows it only when service is Wedding (preview + rule icon)", async () => {
    const { root, onSave } = editor(base([SERVICE, DETAILS]), {
      entitlements: PRO,
      canBuy: true,
    });
    click(row(root, "details"));
    choose(labelled(root, "Rule"), "show");
    expect((labelled(root, "Field") as HTMLSelectElement).value).toBe(
      "service",
    );
    expect((labelled(root, "Answer") as HTMLSelectElement).value).toBe(
      "Wedding",
    );
    expect(root.textContent).toContain("Shows when Service is Wedding.");
    expect(
      root.querySelector('[data-field-row="details"] [data-rule-icon]'),
    ).not.toBeNull();

    // Preview: details hidden until the tried answer is Wedding.
    const pv = preview(root);
    expect(pv.querySelector('[data-field="details"]')).toBeNull();
    expect(pv.textContent).toContain("Try an answer");
    choose(labelled(pv, "Service"), "Birthday");
    expect(pv.querySelector('[data-field="details"]')).toBeNull();
    choose(labelled(pv, "Service"), "Wedding");
    expect(pv.querySelector('[data-field="details"]')).not.toBeNull();

    click(button(root, "Save form"));
    await flush();
    const sent = (onSave as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pro: { rules: unknown[] };
    };
    expect(sent.pro.rules).toEqual([
      {
        target: "details",
        action: "show",
        when: { field: "service", op: "is", value: "Wedding" },
      },
    ]);
  });

  it("the first field has no earlier question, so the rule select is disabled with a hint", () => {
    const { root } = editor(base([SERVICE, DETAILS]), { entitlements: PRO });
    click(row(root, "service"));
    expect((labelled(root, "Rule") as HTMLSelectElement).disabled).toBe(true);
    expect(root.textContent).toContain(
      "Add a question above this field first.",
    );
  });

  it("WR-C07: a stale rule on the first field can still be set to Always show and is dropped", async () => {
    // Details was moved above Service, so its rule now points at a field below it.
    const { root, onSave } = editor(
      base([DETAILS, SERVICE], {
        pro: {
          ...emptyPro(),
          rules: [
            {
              target: "details",
              action: "show",
              when: { field: "service", op: "is", value: "Wedding" },
            },
          ],
        },
      }),
      { entitlements: PRO },
    );
    click(row(root, "details"));
    const rule = labelled(root, "Rule") as HTMLSelectElement;
    expect(rule.disabled).toBe(false);
    expect(root.textContent).toContain(
      "Add a question above this field first.",
    );
    choose(rule, "none");
    expect(
      root.querySelector('[data-field-row="details"] [data-rule-icon]'),
    ).toBeNull();
    click(button(root, "Save form"));
    await flush();
    const sent = (onSave as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pro: { rules: unknown[] };
    };
    expect(sent.pro.rules).toEqual([]);
  });

  it("Split into steps adds step headers; moving a field changes its step; preview shows Step 1 of 2", async () => {
    const { root, onSave } = editor(base([SERVICE, DETAILS, EMAIL]), {
      entitlements: PRO,
    });
    click(settingsRow(root));
    click(labelled(root, "Split into steps"));
    click(button(root, "Add step"));
    typeInto(labelled(root, "Step 2 title"), "Contact");
    const headings = Array.from(
      root.querySelectorAll('[data-pane="list"] [role="heading"]'),
    ).map((h) => h.textContent);
    expect(headings).toEqual(["Step 1 · Step 1", "Step 2 · Contact"]);
    expect(root.textContent).toContain("No fields in this step yet.");

    click(button(root, "Move Email down"));
    const groups = Array.from(root.querySelectorAll("[data-step-group]")).map(
      (g) =>
        Array.from(g.querySelectorAll("[data-field-row]")).map((r) =>
          r.getAttribute("data-field-row"),
        ),
    );
    expect(groups).toEqual([["service", "details"], ["email"]]);
    expect(root.textContent).toContain("Email moved to Step 2.");

    const pv = preview(root);
    expect(pv.textContent).toContain("Step 1 of 2");
    expect(pv.querySelector('[data-field="email"]')).toBeNull();
    expect(button(pv, "Next")).not.toBeNull();
    click(button(pv, "Next step"));
    expect(pv.textContent).toContain("Step 2 of 2");
    expect(pv.querySelector('[data-field="email"]')).not.toBeNull();

    click(button(root, "Save form"));
    await flush();
    const sent = (onSave as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pro: { steps: { title: string; fields: string[] }[] };
    };
    expect(sent.pro.steps.map((s) => [s.title, s.fields])).toEqual([
      ["Step 1", ["service", "details"]],
      ["Contact", ["email"]],
    ]);
  });

  it("auto-reply needs an Email field; routing rows and save later reach the save", async () => {
    const noEmail = editor(base([SERVICE]), { entitlements: PRO });
    click(settingsRow(noEmail.root));
    const sw = labelled(
      noEmail.root,
      "Send an automatic reply",
    ) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
    expect(noEmail.root.textContent).toContain(
      "Add an Email field so the auto-reply has somewhere to go.",
    );
    mounted?.unmount();
    mounted = null;

    const { root, onSave } = editor(base([SERVICE, EMAIL]), {
      entitlements: PRO,
    });
    click(settingsRow(root));
    click(labelled(root, "Send an automatic reply"));
    typeInto(labelled(root, "Reply subject"), "Thanks, {name}");
    typeInto(labelled(root, "Reply message"), "We got your request.");
    click(button(root, "Add a routing rule"));
    expect((labelled(root, "Rule 1: field") as HTMLSelectElement).value).toBe(
      "service",
    );
    choose(labelled(root, "Rule 1: answer is"), "Birthday");
    choose(labelled(root, "Rule 1: send to"), "default");
    click(labelled(root, "Let visitors save and finish later"));
    click(button(root, "Save form"));
    await flush();
    const sent = (onSave as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      pro: {
        auto_reply: unknown;
        routing: unknown;
        save_resume: boolean;
      };
    };
    expect(sent.pro.auto_reply).toEqual({
      enabled: true,
      subject: "Thanks, {name}",
      body: "We got your request.",
    });
    expect(sent.pro.routing).toEqual([
      { field: "service", value: "Birthday", route: "default" },
    ]);
    expect(sent.pro.save_resume).toBe(true);
  });

  it("a server PRO_SETTINGS refusal shows in the Builder Pro group", async () => {
    const onSave = vi.fn(async () => ({
      ok: true as const,
      data: {
        invalid: {
          errors: {
            pro: "Part of Builder Pro. Show or hide rules, steps, auto-replies, answer routing and save and finish later come with Builder Pro.",
          },
          message: "1 field needs attention",
        },
      },
    }));
    const { root } = editor(base([EMAIL]), { entitlements: PRO, onSave });
    click(settingsRow(root));
    click(labelled(root, "Let visitors save and finish later"));
    click(button(root, "Save form"));
    await flush();
    expect(root.querySelector("[data-pro-settings]")!.textContent).toContain(
      "Part of Builder Pro. Show or hide rules",
    );
  });
});

describe("FormEditor: Forms Pro locked and paused", () => {
  it("owner without Builder Pro sees one lock panel and a locked Rule select", () => {
    const { root } = editor(base([SERVICE, DETAILS]), {
      entitlements: NONE,
      canBuy: true,
    });
    click(settingsRow(root));
    const group = root.querySelector("[data-pro-settings]") as HTMLElement;
    expect(group.querySelector("[data-feature-lock]")).not.toBeNull();
    expect(group.textContent).toContain("Part of Builder Pro");
    const link = Array.from(group.querySelectorAll("a")).find(
      (a) => a.textContent === "Add Builder Pro",
    );
    expect(link?.getAttribute("href")).toBe("/hub/add-ons/builder-pro");
    // No controls rendered behind the lock (no blurred preview).
    expect(group.querySelector('[role="switch"]')).toBeNull();

    click(row(root, "details"));
    expect((labelled(root, "Rule") as HTMLSelectElement).disabled).toBe(true);
    const rules = root.querySelector("[data-pro-rules]") as HTMLElement;
    expect(rules.textContent).toContain("Add Builder Pro");
    expect(root.querySelector("[role='heading'][aria-level='3']")).toBeNull();
  });

  it("an admin without Builder Pro reads Ask your site owner", () => {
    const { root } = editor(base([SERVICE, DETAILS]), {
      entitlements: NONE,
      canBuy: false,
    });
    click(settingsRow(root));
    expect(root.querySelector("[data-pro-settings]")!.textContent).toContain(
      "Ask your site owner to add Builder Pro.",
    );
    click(row(root, "details"));
    expect(root.querySelector("[data-pro-rules]")!.textContent).toContain(
      "Ask your site owner to add Builder Pro.",
    );
  });

  it("lapsed: PAUSED-PRO, settings read-only, and saving keeps pro unchanged (not sent)", async () => {
    const stored = setRule(
      setSaveResume(splitIntoSteps(base([SERVICE, DETAILS]), true), true),
      "details",
      {
        action: "show",
        when: { field: "service", op: "is", value: "Wedding" },
      },
    );
    const { root, onSave } = editor(stored, {
      entitlements: NONE,
      canBuy: true,
    });
    click(settingsRow(root));
    const group = root.querySelector("[data-pro-settings]") as HTMLElement;
    expect(group.textContent).toContain(PAUSED_PRO_COPY);
    const save = labelled(
      group,
      "Let visitors save and finish later",
    ) as HTMLInputElement;
    expect(save.checked).toBe(true);
    expect(save.disabled).toBe(true);
    expect(
      (labelled(group, "Split into steps") as HTMLInputElement).disabled,
    ).toBe(true);
    expect((labelled(group, "Step 1 title") as HTMLInputElement).disabled).toBe(
      true,
    );
    // Paused rules are not applied in the list or preview.
    expect(root.querySelector("[data-rule-icon]")).toBeNull();
    expect(
      preview(root).querySelector('[data-field="details"]'),
    ).not.toBeNull();

    click(row(root, "details"));
    expect((labelled(root, "Rule") as HTMLSelectElement).disabled).toBe(true);
    expect(root.textContent).toContain(
      "Builder Pro is paused. This rule is kept",
    );

    // A free edit still saves, without the Pro settings.
    typeInto(labelled(root, "Label"), "More details");
    click(button(root, "Save form"));
    await flush();
    const sent = (onSave as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as Record<string, unknown>;
    expect("pro" in sent).toBe(false);
  });
});
