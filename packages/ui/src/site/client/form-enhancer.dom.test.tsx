// @vitest-environment jsdom
// 07-19 Task 1: the FormEnhancer island (CONT-25, D231; 07-UI-SPEC "Public form"; choice 4).
import {
  EMAIL_ANSWER_COPY,
  FILE_UPLOAD_COPY,
  FORM_ERROR_COPY,
  FORM_PRO_COPY,
  FORM_RATE_COPY,
  requiredCopy,
  type FormField,
} from "@cds/core/forms";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PREMOUNT_FALLBACK_MS,
  PREMOUNT_FALLBACK_SCRIPT,
} from "../items/FormShell";
import { formViewOf } from "../items/form-view";
import { FormEnhancer } from "./FormEnhancer";

// One test below swaps window.location for a stub; the Forms Pro block restores this one.
const REAL_LOCATION = window.location;

function field(
  id: string,
  type: FormField["type"],
  required = true,
): FormField {
  return {
    id,
    type,
    label: id === "email" ? "Email" : "Name",
    placeholder: "",
    help: "",
    required,
    full_width: false,
    options: [],
    content: "",
    value: "",
  };
}

const view = formViewOf({
  form: {
    id: "form1",
    name: "Contact",
    layout: "1",
    fields: [field("name", "name"), field("email", "email")],
    after_submit: { kind: "message", message: "Thanks!", button_text: "Send" },
    newsletter_checkbox: false,
    newsletter_wording: "",
  },
  pageId: "page1",
  status: null,
})!;

let mounted: Mounted[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  for (const m of mounted) m.unmount();
  mounted = [];
  vi.unstubAllGlobals();
});

function setup() {
  const m = mount(
    <FormEnhancer
      view={view}
      itemId="it-1"
      startedAt={1}
      initial={{ kind: "idle" }}
    />,
  );
  mounted.push(m);
  const form = m.container.querySelector("form")!;
  return { m, form };
}

function fill(m: Mounted) {
  typeInto(m.container.querySelector("#f-it-1-name"), "Maria");
  typeInto(m.container.querySelector("#f-it-1-email"), "maria@example.com");
}

function respond(status: number, body: unknown) {
  fetchMock.mockResolvedValue({ status, json: () => Promise.resolve(body) });
}

describe("FormEnhancer", () => {
  it("sets noValidate on mount", () => {
    const { form } = setup();
    expect(form.noValidate).toBe(true);
  });

  it("checks answers client-side and focuses the summary without fetching", async () => {
    const { m, form } = setup();
    submit(form);
    await flush();
    const summary = m.container.querySelector('[role="alert"]');
    expect(summary?.textContent).toContain("2 fields need attention");
    expect(document.activeElement).toBe(summary);
    expect(m.container.textContent).toContain(requiredCopy("Email"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts URL-encoded answers as JSON-accepting and shows Sending…", async () => {
    let resolve: (v: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect((init.body as URLSearchParams).get("email")).toBe(
      "maria@example.com",
    );
    const btn = m.container.querySelector('button[type="submit"]')!;
    expect(btn.textContent).toBe("Sending…");
    expect(btn.getAttribute("aria-busy")).toBe("true");
    submit(form);
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          afterSubmit: { kind: "message", message: "Got it" },
        }),
    });
    await flush();
  });

  it("replaces the form with the focused success panel", async () => {
    respond(200, {
      ok: true,
      afterSubmit: { kind: "message", message: "Got it" },
    });
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    const panel = m.container.querySelector('[role="status"]');
    expect(panel?.textContent).toContain("Got it");
    expect(m.container.querySelector("form")).toBeNull();
    expect(document.activeElement).toBe(panel);
  });

  it("11-31: tells the beacon about a successful send, not a failed one", async () => {
    const seen = vi.fn();
    window.addEventListener("cds:form-submitted", seen);
    respond(422, { ok: false, errors: {} });
    const a = setup();
    fill(a.m);
    submit(a.form);
    await flush();
    expect(seen).not.toHaveBeenCalled();
    respond(200, { ok: true, afterSubmit: { kind: "message" } });
    const b = setup();
    fill(b.m);
    submit(b.form);
    await flush();
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener("cds:form-submitted", seen);
  });

  it("navigates only to same-host paths", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    Object.defineProperty(window, "location", {
      value: { assign },
      configurable: true,
    });
    respond(200, { ok: true, afterSubmit: { kind: "page", href: "/thanks" } });
    const a = setup();
    fill(a.m);
    submit(a.form);
    await flush();
    expect(assign).toHaveBeenCalledWith("/thanks");

    respond(200, {
      ok: true,
      afterSubmit: { kind: "page", href: "//evil.example" },
    });
    const b = setup();
    fill(b.m);
    submit(b.form);
    await flush();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(b.m.container.querySelector('[role="status"]')).not.toBeNull();
  });

  it("shows server field errors on 422", async () => {
    respond(422, {
      ok: false,
      errors: { email: "Enter an email address, like name@example.com." },
    });
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    expect(m.container.textContent).toContain("1 field needs attention");
    expect(m.container.textContent).toContain("like name@example.com");
  });

  it("shows FORM-RATE on 429", async () => {
    respond(429, { ok: false, message: FORM_RATE_COPY });
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    expect(m.container.textContent).toContain(FORM_RATE_COPY);
  });

  it.each([500, 413, 404])("shows FORM-ERROR on %s", async (status) => {
    respond(status, {});
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    expect(m.container.textContent).toContain(FORM_ERROR_COPY);
  });

  it("shows FORM-ERROR on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    const { m, form } = setup();
    fill(m);
    submit(form);
    await flush();
    expect(m.container.textContent).toContain(FORM_ERROR_COPY);
  });

  it("a free form offers no steps and no save-later link", async () => {
    const { m } = setup();
    await flush();
    expect(m.container.querySelector("nav")).toBeNull();
    expect(m.container.textContent).not.toContain(FORM_PRO_COPY.saveLater);
  });
});

// 10-40 (BILL-14, D233, D234): Forms Pro on the site island.
describe("FormEnhancer · Forms Pro", () => {
  const TOKEN = "A".repeat(43);
  const proFields: FormField[] = [
    { ...field("name", "name"), label: "Name" },
    {
      ...field("svc", "dropdown", false),
      label: "Service",
      options: ["Wedding", "Other"],
    },
    { ...field("venue", "short_text"), label: "Venue" },
    { ...field("photo", "file", false), label: "Your photo" },
  ];
  const pro = {
    rules: [
      {
        target: "venue",
        action: "show",
        when: { field: "svc", op: "is", value: "Wedding" },
      },
    ],
    steps: [
      { id: "s1", title: "About you", fields: ["name", "svc"] },
      { id: "s2", title: "Details", fields: ["venue", "photo"] },
    ],
    save_resume: true,
  };

  function proView(extra: Record<string, unknown> = {}) {
    return formViewOf({
      form: {
        id: "form2",
        name: "Booking",
        layout: "1",
        fields: proFields,
        after_submit: {
          kind: "message",
          message: "Thanks!",
          button_text: "Book it",
        },
        newsletter_checkbox: false,
        newsletter_wording: "",
        pro,
      },
      pageId: "page1",
      status: null,
      ...extra,
    })!;
  }

  function setupPro(extra: Record<string, unknown> = {}) {
    const m = mount(
      <FormEnhancer
        view={proView(extra)}
        itemId="it-2"
        startedAt={1}
        initial={{ kind: "idle" }}
      />,
    );
    mounted.push(m);
    return { m, form: m.container.querySelector("form")! };
  }

  const q = (m: Mounted, sel: string) =>
    m.container.querySelector<HTMLElement>(sel);
  const stepShown = (m: Mounted, id: string) =>
    !q(m, `fieldset[data-step="${id}"]`)!.hasAttribute("hidden");

  function choose(el: Element | null, value: string) {
    const s = el as HTMLSelectElement;
    act(() => {
      s.value = value;
      s.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function pick(m: Mounted, name: string, size: number) {
    const input = q(
      m,
      `input[type="file"][name="${name}"]`,
    ) as HTMLInputElement;
    const file = new File(["%PDF-"], name + ".pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "size", { value: size });
    Object.defineProperty(input, "files", {
      value: [file],
      configurable: true,
    });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: REAL_LOCATION,
      configurable: true,
    });
    window.history.replaceState(null, "", "/");
  });

  it("CR-C02: server HTML is novalidate with data-premount and the 5 s fallback; mount drops both", async () => {
    const html = renderToStaticMarkup(
      <FormEnhancer
        view={proView()}
        itemId="it-2"
        startedAt={1}
        initial={{ kind: "idle" }}
      />,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const ssrForm = host.querySelector("form")!;
    expect(ssrForm.hasAttribute("data-premount")).toBe(true);
    expect(ssrForm.noValidate).toBe(true);
    expect(ssrForm.classList.contains("group/form")).toBe(true);
    const script = ssrForm.nextElementSibling!;
    expect(script.tagName).toBe("SCRIPT");
    expect(script.textContent).toBe(PREMOUNT_FALLBACK_SCRIPT);

    const { m, form } = setupPro();
    await flush();
    expect(form.hasAttribute("data-premount")).toBe(false);
    expect(m.container.querySelector("script")).toBeNull();
  });

  it("CR-C02: the fallback drops data-premount after 5 s when the island never mounted", () => {
    vi.useFakeTimers();
    try {
      const host = document.createElement("div");
      host.innerHTML = '<form data-premount=""></form><script></script>';
      const dead = host.querySelector("form")!;
      const run = new Function("document", PREMOUNT_FALLBACK_SCRIPT);
      run({ currentScript: host.querySelector("script") });
      vi.advanceTimersByTime(PREMOUNT_FALLBACK_MS - 1);
      expect(dead.hasAttribute("data-premount")).toBe(true);
      vi.advanceTimersByTime(1);
      expect(dead.hasAttribute("data-premount")).toBe(false);
      // No form before the script (or no currentScript): nothing throws.
      run({ currentScript: null });
      vi.advanceTimersByTime(PREMOUNT_FALLBACK_MS);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows one step; Next checks only that step; focus moves to the title; Back returns", async () => {
    const { m, form } = setupPro();
    await flush();
    expect(stepShown(m, "s1")).toBe(true);
    expect(stepShown(m, "s2")).toBe(false);
    expect(q(m, "nav")!.textContent).toContain("Step 1 of 2");
    expect(q(m, 'button[type="submit"]')!.textContent).toBe("Next");

    submit(form);
    await flush();
    expect(q(m, '[role="alert"]')!.textContent).toContain(
      "1 field needs attention",
    );
    expect(stepShown(m, "s1")).toBe(true);

    typeInto(q(m, "#f-it-2-name"), "Maria");
    submit(form);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(stepShown(m, "s2")).toBe(true);
    expect(stepShown(m, "s1")).toBe(false);
    expect(document.activeElement).toBe(q(m, "nav h3"));
    expect(q(m, "nav h3")!.textContent).toBe("Details");
    expect(q(m, 'button[type="submit"]')!.textContent).toBe("Book it");

    click(button(m.container, "Back"));
    await flush();
    expect(stepShown(m, "s1")).toBe(true);
    expect(document.activeElement).toBe(q(m, "nav h3"));
  });

  it("WR-C08: a summary link to a field on a hidden step moves to that step and focuses it", async () => {
    respond(422, {
      ok: false,
      errors: { name: "Enter your name.", photo: "Choose a smaller file." },
    });
    const { m, form } = setupPro();
    await flush();
    typeInto(q(m, "#f-it-2-name"), "Maria");
    submit(form); // Next
    await flush();
    submit(form); // Book it -> 422 on both steps
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(stepShown(m, "s1")).toBe(true);
    const links = Array.from(
      m.container.querySelectorAll<HTMLAnchorElement>(
        "[data-cds-form-summary] a",
      ),
    );
    expect(links.map((a) => a.textContent)).toEqual(["Name", "Your photo"]);
    click(links[1]!);
    await flush();
    expect(stepShown(m, "s2")).toBe(true);
    expect(stepShown(m, "s1")).toBe(false);
    expect(document.activeElement).toBe(q(m, "#f-it-2-photo"));
  });

  it("a rule-hidden field is hidden and disabled until its answer matches", async () => {
    const { m } = setupPro();
    await flush();
    const venue = q(m, "#f-it-2-venue") as HTMLInputElement;
    expect(q(m, '[data-field="venue"]')!.hasAttribute("hidden")).toBe(true);
    expect(venue.disabled).toBe(true);
    choose(q(m, "#f-it-2-svc"), "Wedding");
    await flush();
    expect(q(m, '[data-field="venue"]')!.hasAttribute("hidden")).toBe(false);
    expect(venue.disabled).toBe(false);
    choose(q(m, "#f-it-2-svc"), "Other");
    await flush();
    expect(venue.disabled).toBe(true);
  });

  it("a 12 MB pick shows the size error and blocks the send", async () => {
    const { m, form } = setupPro();
    await flush();
    typeInto(q(m, "#f-it-2-name"), "Maria");
    submit(form);
    await flush();
    pick(m, "photo", 12 * 1024 * 1024);
    await flush();
    expect(m.container.textContent).toContain(FILE_UPLOAD_COPY.size);
    submit(form);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(m.container.textContent).toContain(FILE_UPLOAD_COPY.size);

    click(button(m.container, /^Remove /));
    await flush();
    expect(m.container.textContent).not.toContain(FILE_UPLOAD_COPY.size);
  });

  it("sends multipart only when a file is attached", async () => {
    respond(200, { ok: true, afterSubmit: { kind: "message" } });
    const { m, form } = setupPro();
    await flush();
    typeInto(q(m, "#f-it-2-name"), "Maria");
    submit(form);
    await flush();
    pick(m, "photo", 300 * 1024);
    await flush();
    expect(q(m, "[data-file-chosen]")!.textContent).toContain("photo.pdf");
    submit(form);
    await flush();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.body).toBeInstanceOf(FormData);
    expect(q(m, '[role="status"]')!.textContent).toContain("Thanks!");
  });

  it("Save and finish later asks for an email, posts _intent=save and confirms", async () => {
    respond(200, { ok: true });
    const { m } = setupPro();
    await flush();
    typeInto(q(m, "#f-it-2-name"), "Maria");
    click(button(m.container, FORM_PRO_COPY.saveLater));
    await flush();
    const email = m.container.querySelector<HTMLInputElement>(
      'input[type="email"]',
    )!;
    expect(email.name).toBe("");
    click(button(m.container, FORM_PRO_COPY.saveSend));
    await flush();
    expect(m.container.textContent).toContain(EMAIL_ANSWER_COPY);
    expect(fetchMock).not.toHaveBeenCalled();

    typeInto(email, "maria@example.com");
    click(button(m.container, FORM_PRO_COPY.saveSend));
    await flush();
    const [, init] = fetchMock.mock.calls[0]!;
    const body = init.body as URLSearchParams;
    expect(body.get("_intent")).toBe("save");
    expect(body.get("_email")).toBe("maria@example.com");
    expect(body.get("name")).toBe("Maria");
    expect(q(m, '[role="status"]')!.textContent).toContain(FORM_PRO_COPY.saved);
  });

  it("a resume link pre-fills, shows the welcome notice, posts the token back and leaves the URL", async () => {
    window.history.replaceState(null, "", `/about?resume=${TOKEN}#form-form2`);
    const { m } = setupPro({
      values: { name: "Maria", svc: "Wedding", venue: "The barn" },
      resume: { kind: "resumed", token: TOKEN },
    });
    await flush();
    expect(m.container.textContent).toContain(FORM_PRO_COPY.resumed);
    expect((q(m, "#f-it-2-name") as HTMLInputElement).value).toBe("Maria");
    expect((q(m, "#f-it-2-venue") as HTMLInputElement).disabled).toBe(false);
    expect((q(m, 'input[name="_resume"]') as HTMLInputElement).value).toBe(
      TOKEN,
    );
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/about");
    expect(window.location.hash).toBe("#form-form2");
  });

  it("an expired link shows the expired notice over an empty form", async () => {
    const { m } = setupPro({ resume: { kind: "expired" } });
    await flush();
    expect(m.container.textContent).toContain(FORM_PRO_COPY.expired);
    expect(q(m, 'input[name="_resume"]')).toBeNull();
    expect((q(m, "#f-it-2-name") as HTMLInputElement).value).toBe("");
  });
});
