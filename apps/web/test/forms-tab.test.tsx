// @vitest-environment jsdom
// 07-18 Task 3: Website › Forms (CONT-25, D231, D270, D275, D311; 07-UI-SPEC "Forms";
// T-07-18-01, T-07-18-04). The real server tab runs over a mocked session and @cds/db; the
// actions are mocked; the client panel renders in jsdom inside the hub ToastRegion. Also the
// drift tests for the baked how-to steps (D110).
import { Forbidden, NotFound } from "@cds/core";
import { ToastRegion } from "@cds/ui/hub";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  button,
  click,
  flush,
  mount,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const nav = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/hub/website",
  useRouter: () => ({
    push: vi.fn(),
    refresh: nav.refresh,
    replace: nav.replace,
  }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const OWNER = { orgId: "org1", actor: "u1", role: "owner", grants: [] };
const VIEWER = { orgId: "org1", actor: "u3", role: "viewer", grants: [] };
const sess = vi.hoisted(() => ({
  requireHubSession: vi.fn(),
  getHubSession: vi.fn(),
}));
vi.mock("../lib/session", () => sess);
const SECTIONS = vi.hoisted(() => ({ registry: true }));
vi.mock("../lib/content", () => ({
  contentDeps: () => ({ sections: SECTIONS }),
}));

const db = vi.hoisted(() => ({
  listForms: vi.fn(),
  formUsedOn: vi.fn(),
  getForm: vi.fn(),
  listPages: vi.fn(),
  listEmailRoutes: vi.fn(),
  readOrganizationDesign: vi.fn(),
  formUploadUsage: vi.fn(),
}));
vi.mock("@cds/db", () => db);

const actions = vi.hoisted(() => ({
  createFormAction: vi.fn(),
  saveFormAction: vi.fn(),
  duplicateFormAction: vi.fn(),
  deleteFormAction: vi.fn(),
  formUsedOnAction: vi.fn(),
}));
vi.mock("../app/actions/forms", () => actions);

const { FormsTab, FormsTabBody } =
  await import("../app/(platform)/hub/website/FormsTab");
const { FORMS_STEPS, FORMS_HOWTO, EXTERNAL_FORM_STEPS, ITEM_BUTTON_HOWTO } =
  await import("../app/(platform)/hub/website/forms-steps");

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

function row(id: string, name: string, over: Record<string, unknown> = {}) {
  return {
    id,
    name,
    template: "contact",
    fieldCount: 4,
    unread: 0,
    inReview: false,
    deleted: false,
    layout: "1",
    fields: [],
    after_submit: { kind: "message", message: "", page: "", button_text: "" },
    notify_route: "inquiries",
    newsletter_checkbox: false,
    newsletter_wording: "",
    created: "",
    updated: "",
    ...over,
  };
}

const RECORD = row("f1", "Contact", {
  fields: [
    {
      id: "a1",
      type: "name",
      label: "Name",
      placeholder: "",
      help: "",
      required: true,
      full_width: false,
      options: [],
      content: "",
      value: "",
    },
  ],
});

function session(ctx = OWNER) {
  sess.requireHubSession.mockResolvedValue({
    ctx,
    email: "a@b.c",
    org: { id: "org1", name: "Rivera Bakery", primaryHost: null },
  });
}

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
  nav.replace.mockReset();
  nav.refresh.mockReset();
  session();
  db.listForms.mockResolvedValue([
    row("f1", "Contact", { unread: 2 }),
    row("f2", "Quote", { template: "quote-request" }),
  ]);
  db.formUsedOn.mockResolvedValue({
    pages: [{ id: "p1", title: "Home" }],
    inVersions: false,
    inPopups: 0,
  });
  db.getForm.mockResolvedValue(RECORD);
  db.listPages.mockResolvedValue([{ id: "p1", title: "Home", slug: "home" }]);
  db.listEmailRoutes.mockResolvedValue([
    { purpose: "inquiries", address: "hi@rivera.com", status: "confirmed" },
  ]);
  db.readOrganizationDesign.mockResolvedValue(null);
  db.formUploadUsage.mockResolvedValue({
    usedBytes: 0,
    limitBytes: 1024 ** 3,
    level: "ok",
    hasFileFields: false,
  });
});

async function render(sp: Record<string, string | string[] | undefined>) {
  const el = await FormsTabBody({ searchParams: { tab: "forms", ...sp } });
  mounted = mount(<ToastRegion>{el}</ToastRegion>);
  await flush();
  return mounted.container;
}

describe("FormsTab form-upload alerts (10-38)", () => {
  const GB = 1024 ** 3;
  it("80%: a warning with the used amount, only when a form has a file field", async () => {
    db.formUploadUsage.mockResolvedValue({
      usedBytes: Math.round(GB * 0.85),
      limitBytes: GB,
      level: "warn",
      hasFileFields: true,
    });
    const root = await render({});
    const box = root.querySelector('[data-upload-usage="warn"]');
    expect(box?.textContent).toContain(
      "Form uploads have used 870 MB of 1 GB. Delete old messages with files to free space.",
    );
  });

  it("100%: the full alert", async () => {
    db.formUploadUsage.mockResolvedValue({
      usedBytes: GB,
      limitBytes: GB,
      level: "full",
      hasFileFields: true,
    });
    const root = await render({});
    expect(
      root.querySelector('[data-upload-usage="full"]')?.textContent,
    ).toContain(
      "Form uploads are full, so upload fields are hidden until you delete messages with files. Your forms still work.",
    );
  });

  it("no file field, a Viewer, or a failed read: no alert", async () => {
    db.formUploadUsage.mockResolvedValue({
      usedBytes: GB,
      limitBytes: GB,
      level: "full",
      hasFileFields: false,
    });
    expect((await render({})).querySelector("[data-upload-usage]")).toBeNull();
    mounted?.unmount();
    db.formUploadUsage.mockResolvedValue({
      usedBytes: GB,
      limitBytes: GB,
      level: "full",
      hasFileFields: true,
    });
    session(VIEWER);
    expect((await render({})).querySelector("[data-upload-usage]")).toBeNull();
    expect(db.formUploadUsage).toHaveBeenCalledTimes(1);
    mounted?.unmount();
    session();
    db.formUploadUsage.mockRejectedValue(new Error("down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await render({})).querySelector("[data-upload-usage]")).toBeNull();
    spy.mockRestore();
  });
});

describe("FormsTab", () => {
  it("streams behind three skeleton rows", async () => {
    const html = renderToStaticMarkup(await FormsTab({ tab: "forms" }));
    expect(html.match(/data-skeleton-row/g)).toHaveLength(3);
  });

  it("lists live forms with usage per form", async () => {
    const root = await render({});
    expect(db.listForms).toHaveBeenCalledTimes(1);
    expect(db.listForms).toHaveBeenCalledWith(OWNER);
    expect(db.formUsedOn).toHaveBeenCalledWith(OWNER, SECTIONS, "f1");
    expect(db.formUsedOn).toHaveBeenCalledWith(OWNER, SECTIONS, "f2");
    expect(root.querySelector('[data-form-row="f1"]')!.textContent).toContain(
      "Contact template · 4 fields · On Home",
    );
    expect(root.textContent).toContain("2 unread");
    expect(root.textContent).toContain("2 forms");
  });

  it("a usage read that fails drops only that row's usage", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.formUsedOn.mockImplementation(async (_c, _r, id: string) => {
      if (id === "f2") throw new Error("boom");
      return { pages: [], inVersions: false, inPopups: 0 };
    });
    const root = await render({});
    expect(
      root.querySelector('[data-form-row="f2"] [data-form-meta]')!.textContent,
    ).toBe("Quote request template · 4 fields");
    expect(
      root.querySelector('[data-form-row="f1"] [data-form-meta]')!.textContent,
    ).toContain("Not on any page yet");
    spy.mockRestore();
  });

  it("no forms shows EMPTY-FORMS", async () => {
    db.listForms.mockResolvedValue([]);
    const root = await render({});
    expect(root.textContent).toContain("No forms yet");
    expect(root.textContent).toContain(
      "Every message lands in your Inbox and we email you a copy.",
    );
  });

  it("a list read that throws shows ERR-LOAD with Try again", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    db.listForms.mockRejectedValue(new Error("down"));
    const root = await render({});
    expect(root.textContent).toContain("We couldn't load this.");
    expect(
      Array.from(root.querySelectorAll("a")).find(
        (a) => a.textContent === "Try again",
      ),
    ).toBeDefined();
    spy.mockRestore();
  });

  it("&form=new shows the template chooser for writers", async () => {
    const root = await render({ form: "new" });
    expect(root.textContent).toContain("Start from a template");
  });

  it("a Viewer asking for &form=new gets the list", async () => {
    session(VIEWER);
    const root = await render({ form: "new" });
    expect(root.textContent).not.toContain("Start from a template");
    expect(button(root, "Create form")).toBeNull();
  });

  it("&form=<id> opens the editor with pages, routes and the preview", async () => {
    const root = await render({ form: "f1" });
    expect(db.getForm).toHaveBeenCalledWith(OWNER, "f1");
    expect(db.listPages).toHaveBeenCalledWith(OWNER);
    expect(db.listEmailRoutes).toHaveBeenCalledWith(OWNER);
    expect(root.querySelector("[data-form-editor='f1']")).not.toBeNull();
    expect(root.textContent).toContain("Preview: sending is off");
    expect(root.textContent).toContain("Website inquiries · hi@rivera.com");
  });

  it("routes Forbidden still renders the editor with labels only", async () => {
    db.listEmailRoutes.mockRejectedValue(new Forbidden("no"));
    const root = await render({ form: "f1" });
    expect(root.querySelector("[data-form-editor='f1']")).not.toBeNull();
    const route = Array.from(root.querySelectorAll("option")).map(
      (o) => o.textContent,
    );
    expect(route).toContain("Website inquiries");
  });

  it.each([
    ["NotFound", () => db.getForm.mockRejectedValue(new NotFound("x"))],
    [
      "a deleted form",
      () => db.getForm.mockResolvedValue({ ...RECORD, deleted: true }),
    ],
  ])("%s shows the GONE notice over the list", async (_, arrange) => {
    arrange();
    const root = await render({ form: "f1" });
    expect(root.textContent).toContain(
      "This was removed or moved. Reload the page to see the latest.",
    );
    expect(root.querySelector("[data-form-editor]")).toBeNull();
    expect(root.querySelector('[data-form-row="f1"]')).not.toBeNull();
  });

  it("a malformed form param is ignored", async () => {
    await render({ form: "../etc" });
    expect(db.getForm).not.toHaveBeenCalled();
  });

  it("a Viewer sees the editor read-only", async () => {
    session(VIEWER);
    const root = await render({ form: "f1" });
    expect(button(root, "Save form")).toBeNull();
    expect(root.textContent).toContain(
      "You can look at forms here. Ask an owner or admin to change them.",
    );
  });

  it("FormsTab.tsx no longer shows the 07-03 shell", () => {
    const src = readFileSync(
      path.resolve(
        import.meta.dirname,
        "../app/(platform)/hub/website/FormsTab.tsx",
      ),
      "utf8",
    );
    expect(src).not.toContain("SHELL_PANEL_BODY");
  });
});

describe("FormsPanel actions", () => {
  it("Create → createFormAction → editor URL + toast", async () => {
    actions.createFormAction.mockResolvedValue({
      ok: true,
      data: { id: "f9", name: "Contact" },
    });
    const root = await render({ form: "new" });
    const creates = Array.from(root.querySelectorAll("button")).filter(
      (b) => b.textContent === "Create form",
    );
    click(creates[creates.length - 1]);
    await flush();
    expect(actions.createFormAction).toHaveBeenCalledWith({
      template: "contact",
    });
    expect(nav.replace).toHaveBeenCalledWith("/hub/website?tab=forms&form=f9", {
      scroll: false,
    });
    expect(nav.refresh).toHaveBeenCalled();
    expect(root.textContent).toContain("Form created.");
  });

  it("Duplicate → toast and open the copy", async () => {
    actions.duplicateFormAction.mockResolvedValue({
      ok: true,
      data: { id: "f3", name: "Copy of Contact" },
    });
    const root = await render({});
    click(button(root, "More for Contact"));
    click(button(root, "Duplicate form"));
    await flush();
    expect(actions.duplicateFormAction).toHaveBeenCalledWith("f1");
    expect(root.textContent).toContain("Form duplicated.");
    expect(nav.replace).toHaveBeenCalledWith("/hub/website?tab=forms&form=f3", {
      scroll: false,
    });
  });

  it.each([
    [
      "used",
      { pages: [{ id: "p1", title: "Home" }], inVersions: false, inPopups: 0 },
      "It leaves your forms list. Pages that show it keep working until you change them. Its messages stay in your Inbox.",
    ],
    [
      "unused",
      { pages: [], inVersions: false, inPopups: 0 },
      "It's deleted for good. Its messages stay in your Inbox.",
    ],
  ])(
    "Delete (%s) asks with the right copy, then deletes",
    async (_, used, copy) => {
      actions.formUsedOnAction.mockResolvedValue({ ok: true, data: used });
      actions.deleteFormAction.mockResolvedValue({ ok: true, data: null });
      const root = await render({});
      click(button(root, "More for Contact"));
      click(button(root, "Delete form"));
      await flush();
      expect(actions.formUsedOnAction).toHaveBeenCalledWith("f1");
      const dialog = document.querySelector("dialog[open]")!;
      expect(dialog.textContent).toContain("Delete the Contact form?");
      expect(dialog.textContent).toContain(copy);
      const keep = button(dialog, "Keep form")!;
      expect(
        keep.hasAttribute("autofocus") || document.activeElement === keep,
      ).toBe(true);
      click(button(dialog, "Delete form"));
      await flush();
      expect(actions.deleteFormAction).toHaveBeenCalledWith("f1");
      expect(root.textContent).toContain("Form deleted.");
      expect(nav.replace).toHaveBeenCalledWith("/hub/website?tab=forms", {
        scroll: false,
      });
    },
  );

  it("View messages and unread link to the Inbox", async () => {
    const root = await render({});
    const unread = Array.from(root.querySelectorAll("a")).find(
      (a) => a.textContent === "2 unread",
    );
    expect(unread?.getAttribute("href")).toBe("/hub/inbox?form=f1");
  });

  it("the how-to button opens How Forms works", async () => {
    const root = await render({});
    click(button(root, "How Forms works"));
    await flush(1);
    expect(document.body.textContent).toContain(FORMS_STEPS[0]!.expected);
  });

  it("the health tip opens Add an External form button", async () => {
    db.getForm.mockResolvedValue({
      ...RECORD,
      fields: [
        {
          ...(RECORD.fields[0] as Record<string, unknown>),
          label: "Medication",
        },
      ],
    });
    const root = await render({ form: "f1" });
    click(button(root, "Add an External form button"));
    await flush(1);
    expect(document.body.textContent).toContain(
      "Add a Button item that links to your HIPAA intake form",
    );
  });

  it("save goes through saveFormAction and refreshes", async () => {
    actions.saveFormAction.mockImplementation(async (input: unknown) => ({
      ok: true,
      data: { saved: { form: input, held: false } },
    }));
    const root = await render({ form: "f1" });
    const text = root.querySelector<HTMLInputElement>(
      'input[placeholder="Send message"]',
    )!;
    const proto = Object.getPrototypeOf(text) as object;
    const { act } = await import("react");
    act(() => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(text, "Go");
      text.dispatchEvent(new Event("input", { bubbles: true }));
    });
    click(button(root, "Save form"));
    await flush();
    expect(actions.saveFormAction).toHaveBeenCalledWith(
      expect.objectContaining({ id: "f1", name: "Contact" }),
    );
    expect(nav.refresh).toHaveBeenCalled();
    expect(root.textContent).toContain("Form saved. It's live on your site.");
  });
});

describe("baked how-to steps (drift)", () => {
  async function parse(rel: string) {
    const gen =
      (await import("../../../packages/addon-registry/scripts/gen.mjs")) as {
        parseUseSteps: (md: string) => unknown[];
      };
    const md = readFileSync(
      path.resolve(import.meta.dirname, "../../..", rel),
      "utf8",
    );
    return gen.parseUseSteps(md);
  }

  it("FORMS_STEPS match docs/how-to/forms.md", async () => {
    expect(await parse(FORMS_HOWTO)).toEqual(
      FORMS_STEPS.map((s) => ({ ...s })),
    );
  });

  it("EXTERNAL_FORM_STEPS are the intro then docs/how-to/item-button.md", async () => {
    const [intro, ...rest] = EXTERNAL_FORM_STEPS;
    expect(intro!.action).toBe(
      "Add a Button item that links to your HIPAA intake form (IntakeQ, Jane, SimplePractice).",
    );
    expect(await parse(ITEM_BUTTON_HOWTO)).toEqual(rest.map((s) => ({ ...s })));
  });
});
