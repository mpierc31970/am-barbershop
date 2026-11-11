// 07-19 Task 1: the server-rendered public form (CONT-25, D231; 07-UI-SPEC "Public form",
// forms a11y line; choices 1 and 2).
import {
  FORM_ERROR_COPY,
  FORM_RATE_COPY,
  formErrorsSummary,
  requiredCopy,
  type FormField,
} from "@cds/core/forms";
import type { FormColumnItem } from "@cds/core/content";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormItem } from "./FormItem";
import type { FormStatusView } from "./form-view";

const NOW = new Date("2026-10-05T12:00:00Z");

function field(
  id: string,
  type: FormField["type"],
  over: Partial<FormField> = {},
): FormField {
  return {
    id,
    type,
    label: id[0]!.toUpperCase() + id.slice(1),
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

const contact = {
  id: "form1",
  name: "Contact",
  layout: "1",
  fields: [
    field("name", "name", { required: true }),
    field("email", "email", { required: true, help: "We reply here." }),
    field("phone", "phone"),
    field("message", "long_text", { required: true }),
  ],
  after_submit: {
    kind: "message",
    message: "Thanks, we got it.",
    button_text: "Send message",
  },
  newsletter_checkbox: false,
  newsletter_wording: "",
};

/** The <input> tag carrying name="<name>". */
function tag(out: string, name: string): string {
  return (
    out.match(
      new RegExp(`<input[^>]*name="${name.replace(".", "\.")}"[^>]*>`, "i"),
    )?.[0] ?? ""
  );
}

function render(
  formOver: Record<string, unknown> = {},
  opts: {
    status?: FormStatusView | null;
    preview?: boolean;
    itemId?: string;
    pageId?: string | null;
  } = {},
): string {
  const item: FormColumnItem = {
    id: opts.itemId ?? "it-1",
    kind: "form",
    form_id: "form1",
  };
  return renderToStaticMarkup(
    <FormItem
      item={item}
      now={NOW}
      forms={{
        form1: {
          form: { ...contact, ...formOver },
          pageId: opts.pageId === undefined ? "page1" : opts.pageId,
          status: opts.status ?? null,
          preview: opts.preview ?? false,
        },
      }}
    />,
  );
}

describe("FormItem", () => {
  it("renders nothing without a form id, entry or a valid entry", () => {
    const item: FormColumnItem = { id: "a", kind: "form", form_id: "" };
    expect(
      renderToStaticMarkup(<FormItem item={item} now={NOW} forms={{}} />),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <FormItem item={{ ...item, form_id: "nope" }} now={NOW} forms={{}} />,
      ),
    ).toBe("");
    expect(
      renderToStaticMarkup(
        <FormItem
          item={{ ...item, form_id: "x" }}
          now={NOW}
          forms={{ x: "junk" }}
        />,
      ),
    ).toBe("");
  });

  it("posts to the tenant endpoint without novalidate", () => {
    const out = render();
    expect(out).toContain('method="post"');
    expect(out).toContain('action="/api/forms/form1"');
    expect(out).not.toMatch(/novalidate/i);
    expect(out).toContain('id="form-it-1"');
  });

  it("carries the start time, page and item as hidden inputs", () => {
    const out = render();
    expect(out).toContain(`name="_started" value="${NOW.getTime()}"`);
    expect(out).toContain('name="_page" value="page1"');
    expect(out).toContain('name="_item" value="it-1"');
    expect(render({}, { pageId: null })).not.toContain('name="_page"');
  });

  it("hides the honeypot from people without display:none", () => {
    const out = render();
    expect(out).toMatch(
      /<div aria-hidden="true"[^>]*><label[^>]*>Leave this empty<\/label>/,
    );
    expect(out).toContain('name="website_url"');
    const hp = tag(out, "website_url");
    expect(hp).toContain('tabindex="-1"');
    expect(hp).toMatch(/autocomplete="off"/i);
    expect(out).not.toContain("display:none");
  });

  it("binds labels, marks optional and required, links help text", () => {
    const out = render();
    expect(out).toContain('for="f-it-1-email"');
    expect(out).toContain('id="f-it-1-email"');
    expect(out).toContain("(optional)");
    expect(out).toMatch(
      /id="f-it-1-name"[^>]*required=""[^>]*aria-required="true"|required=""[^>]*aria-required="true"/,
    );
    expect(out).toContain('aria-describedby="f-it-1-email-help"');
  });

  it("uses the right input types and autocomplete tokens", () => {
    const out = render();
    expect(tag(out, "email")).toContain('type="email"');
    expect(tag(out, "email")).toMatch(/autocomplete="email"/i);
    expect(tag(out, "phone")).toContain('type="tel"');
    expect(tag(out, "phone")).toMatch(/autocomplete="tel"/i);
    expect(tag(out, "name")).toContain('type="text"');
    expect(tag(out, "name")).toMatch(/autocomplete="name"/i);
  });

  it("renders choice groups as fieldsets with legends", () => {
    const out = render({
      fields: [field("pick", "radio", { options: ["One", "Two"] })],
    });
    expect(out).toContain("<fieldset");
    expect(out).toContain("<legend");
  });

  it("shows the newsletter tick only when it is on", () => {
    expect(render()).not.toContain('name="_newsletter"');
    const on = render({
      newsletter_checkbox: true,
      newsletter_wording: "Send me news",
    });
    expect(on).toContain('name="_newsletter"');
    expect(on).toContain("Send me news");
  });

  it("switches to two columns by container width for layout 2", () => {
    expect(render({ layout: "2" })).toContain("@min-[560px]:grid-cols-2");
  });

  it("uses the form's button text", () => {
    expect(render()).toContain("Send message");
  });

  it("shows the success panel for this item only", () => {
    const sent = render({}, { status: { itemId: "it-1", kind: "sent" } });
    expect(sent).toContain('role="status"');
    expect(sent).toContain("Thanks, we got it.");
    expect(sent).not.toContain("<form");
    const other = render({}, { status: { itemId: "it-2", kind: "sent" } });
    expect(other).toContain("<form");
  });

  it("shows field errors as a linked summary and per-field messages", () => {
    const out = render(
      {},
      {
        status: {
          itemId: "it-1",
          kind: "fields",
          fields: { email: "r", name: "r" },
        },
      },
    );
    expect(out).toContain('role="alert"');
    expect(out).toContain(formErrorsSummary(2));
    expect(out).toContain('href="#f-it-1-email"');
    expect(out).toContain(requiredCopy("Email"));
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("f-it-1-email-help f-it-1-email-error");
  });

  it("shows FORM-RATE and FORM-ERROR in the summary", () => {
    expect(render({}, { status: { itemId: "it-1", kind: "rate" } })).toContain(
      FORM_RATE_COPY.replace("'", "&#x27;"),
    );
    expect(render({}, { status: { itemId: "it-1", kind: "error" } })).toContain(
      FORM_ERROR_COPY.replace("'", "&#x27;"),
    );
  });

  it("disables sending in preview", () => {
    const out = render({}, { preview: true });
    expect(out).not.toContain("action=");
    expect(out).toContain("disabled");
    expect(out).toContain("Preview: sending is off");
  });

  it("renders owner text literally", () => {
    const out = render({
      fields: [
        field("x", "short_text", { label: '<img src=x onerror="alert(1)">' }),
      ],
    });
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });

  it("gives two copies of one form distinct ids", () => {
    const a = render({}, { itemId: "a1" });
    const b = render({}, { itemId: "b2" });
    expect(a).toContain('id="f-a1-email"');
    expect(b).toContain('id="f-b2-email"');
    expect(b).not.toContain("f-a1-");
  });
});
