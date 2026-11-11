// @vitest-environment jsdom
// 14-32: DNS records dialogs and the email setup flow (choice 5; 14-UI-SPEC "AddRecordDialog",
// "RemoveRecordDialog", "Email setup"; T-14-32-01, T-14-32-02). Dialog errors (client-side
// empties, server field refusals, values kept), the safe button autofocused, the 3 steps, the
// pattern errors and the required Replace my current email checkbox gating the primary.
import { EMAIL_PRESETS, P14_COPY } from "@cds/core/dns";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import {
  AddRecordDialog,
  EmailSetupFlow,
  RECORDS_UI_COPY,
  RemoveRecordDialog,
  fullRecordName,
  presetFieldError,
  type EmailSetupPreviewView,
} from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

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

const DOMAIN = "riverabakery.com";
const GOOGLE_VERIFY =
  "google-site-verification=rXOxyZounnZasA8Z7oaD3c14JdjS9aKSWvsR1EbUSIQ";
const DKIM =
  "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAx7Qm2R1fK9pL0sYtW3vB";

describe("fullRecordName", () => {
  it("@ is the domain, a label gains the domain, a full name stays", () => {
    expect(fullRecordName("@", DOMAIN)).toBe(DOMAIN);
    expect(fullRecordName("em123", DOMAIN)).toBe(`em123.${DOMAIN}`);
    expect(fullRecordName(`em123.${DOMAIN}.`, DOMAIN)).toBe(`em123.${DOMAIN}`);
    expect(fullRecordName("  ", DOMAIN)).toBe("");
  });
});

describe("AddRecordDialog", () => {
  function open(action = vi.fn()) {
    const onAdded = vi.fn();
    mounted = mount(
      <AddRecordDialog
        open
        onClose={() => {}}
        domain={DOMAIN}
        action={action}
        onAdded={onAdded}
      />,
    );
    return { action, onAdded, root: mounted.container };
  }

  it("refuses an empty name and value without calling the action", () => {
    const { action, root } = open();
    submit(root.querySelector("form"));
    expect(action).not.toHaveBeenCalled();
    expect(root.textContent).toContain(P14_COPY.REC_NAME_INVALID);
    expect(root.textContent).toContain(P14_COPY.REC_VALUE_EMPTY);
    const name = root.querySelector('input[name="name"]');
    expect(name?.getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the full name, sends TXT by default and toasts REC-ADDED", async () => {
    const action = vi.fn(async () => ({ ok: true as const, data: {} }));
    const { onAdded, root } = open(action);
    expect(root.textContent).toContain("Add a record");
    typeInto(root.querySelector('input[name="name"]'), "em123");
    expect(root.querySelector("[data-full-name]")?.textContent).toBe(
      `Full name: em123.${DOMAIN}`,
    );
    typeInto(root.querySelector('textarea[name="value"]'), '"abc=1"');
    submit(root.querySelector("form"));
    await flush();
    expect(action).toHaveBeenCalledWith({
      type: "TXT",
      name: "em123",
      value: '"abc=1"',
    });
    expect(onAdded).toHaveBeenCalledWith(P14_COPY.REC_ADDED({ type: "TXT" }));
  });

  it("CNAME uses a one-line value field", () => {
    const { root } = open();
    click(root.querySelector('input[type="radio"][value="CNAME"]'));
    expect(root.querySelector('input[name="value"]')).not.toBeNull();
    expect(root.querySelector('textarea[name="value"]')).toBeNull();
  });

  it("a server refusal lands under its field and keeps the values", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      code: "REC-PROTECTED",
      message: P14_COPY.REC_PROTECTED,
      field: "name",
    }));
    const { onAdded, root } = open(action);
    typeInto(root.querySelector('input[name="name"]'), "_dmarc");
    typeInto(root.querySelector('textarea[name="value"]'), "v=DMARC1");
    submit(root.querySelector("form"));
    await flush();
    expect(onAdded).not.toHaveBeenCalled();
    expect(root.textContent).toContain(P14_COPY.REC_PROTECTED);
    expect(
      (root.querySelector('input[name="name"]') as HTMLInputElement).value,
    ).toBe("_dmarc");
    expect(
      (root.querySelector('textarea[name="value"]') as HTMLTextAreaElement)
        .value,
    ).toBe("v=DMARC1");
  });

  it("a save failure shows above the form as an alert", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      code: "save_failed",
      message: "Your changes weren't saved.",
    }));
    const { root } = open(action);
    typeInto(root.querySelector('input[name="name"]'), "@");
    typeInto(root.querySelector('textarea[name="value"]'), "x=1");
    submit(root.querySelector("form"));
    await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      "Your changes weren't saved.",
    );
  });

  it("record text renders as text, never markup (T-14-32-02)", () => {
    const { root } = open();
    typeInto(root.querySelector('input[name="name"]'), "<b>x</b>");
    expect(root.querySelector("[data-full-name] b")).toBeNull();
  });
});

describe("RemoveRecordDialog", () => {
  const record = {
    type: "TXT",
    name: "@",
    value: "google-site-verification=abc",
  };

  it("names the record, autofocuses Keep record and removes on confirm", async () => {
    const action = vi.fn(async () => ({ ok: true as const, data: null }));
    const onRemoved = vi.fn();
    const onClose = vi.fn();
    mounted = mount(
      <RemoveRecordDialog
        open
        onClose={onClose}
        domain={DOMAIN}
        record={record}
        action={action}
        onRemoved={onRemoved}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(P14_COPY.REC_REMOVE_H({ type: "TXT" }));
    expect(root.textContent).toContain(
      P14_COPY.REC_REMOVE_B({ domain: DOMAIN }),
    );
    expect(root.textContent).toContain("google-site-verification=abc");
    const keep = button(root, P14_COPY.BTN_KEEP_RECORD);
    expect(keep?.hasAttribute("data-safe")).toBe(true);
    expect(document.activeElement === keep || keep?.autofocus).toBe(true);
    click(button(root, P14_COPY.BTN_REMOVE_RECORD));
    await flush();
    expect(action).toHaveBeenCalledTimes(1);
    expect(onRemoved).toHaveBeenCalledWith("TXT record removed.");
    expect(onClose).toHaveBeenCalled();
  });

  it("a refusal stays in the dialog", async () => {
    const action = vi.fn(async () => ({
      ok: false as const,
      code: "REC-PROTECTED",
      message: P14_COPY.REC_PROTECTED,
    }));
    const onClose = vi.fn();
    mounted = mount(
      <RemoveRecordDialog
        open
        onClose={onClose}
        domain={DOMAIN}
        record={record}
        action={action}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_REMOVE_RECORD));
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      mounted.container.querySelector('[role="alert"]')?.textContent,
    ).toContain(P14_COPY.REC_PROTECTED);
  });
});

describe("presetFieldError", () => {
  it("empty, wrong prefix (EMAIL-VALUE-FORMAT) and a good value", () => {
    expect(presetFieldError("google", "verification", "")).toBe(
      P14_COPY.REC_VALUE_EMPTY,
    );
    expect(presetFieldError("google", "verification", "MS=ms12345678")).toBe(
      P14_COPY.EMAIL_VALUE_FORMAT({
        service: "Google Workspace",
        prefix: "google-site-verification=",
      }),
    );
    expect(presetFieldError("google", "verification", GOOGLE_VERIFY)).toBe(
      null,
    );
    expect(presetFieldError("google", "dkim", "nope")).toContain("v=DKIM1");
  });
});

describe("EmailSetupFlow", () => {
  const groups: EmailSetupPreviewView["groups"] = [
    {
      key: "email",
      records: [
        {
          key: "mx",
          type: "MX",
          name: "@",
          value: "smtp.google.com",
          priority: 1,
          change: "replace",
        },
      ],
    },
  ];

  function render(
    preview: EmailSetupPreviewView,
    over: Partial<Parameters<typeof EmailSetupFlow>[0]> = {},
  ) {
    const previewAction = vi.fn(async () => ({
      ok: true as const,
      data: preview,
    }));
    const applyAction = vi.fn(async () => ({ ok: true as const, data: {} }));
    const askAction = vi.fn(async () => ({
      ok: true as const,
      data: { number: 1042 },
    }));
    mounted = mount(
      <EmailSetupFlow
        domain={DOMAIN}
        currentPreset="zoho"
        previewAction={previewAction}
        applyAction={applyAction}
        askAction={askAction}
        recordsHref="/hub/settings?tab=domain&view=records"
        {...over}
      />,
    );
    return { previewAction, applyAction, askAction, root: mounted.container };
  }

  async function toStep3(root: HTMLElement) {
    click(root.querySelector('input[type="radio"][value="google"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    typeInto(root.querySelector('input[name="verification"]'), GOOGLE_VERIFY);
    typeInto(root.querySelector('textarea[name="dkim"]'), DKIM);
    click(button(root, P14_COPY.BTN_NEXT));
    await flush();
  }

  it("step 1 lists the six presets + Another provider; the current one is marked", () => {
    const { root } = render({
      groups,
      spfInclude: null,
      replacesProvider: null,
    });
    expect(root.textContent).toContain("Step 1 of 3");
    expect(root.textContent).toContain("Who provides your email?");
    const radios = root.querySelectorAll('input[type="radio"]');
    expect(radios).toHaveLength(7);
    const zoho = root.querySelector('input[value="zoho"]')?.closest("label");
    expect(zoho?.textContent).toContain(RECORDS_UI_COPY.currentEmail);
    const google = root
      .querySelector('input[value="google"]')
      ?.closest("label");
    expect(google?.textContent).not.toContain(RECORDS_UI_COPY.currentEmail);
  });

  it("Another provider swaps Next for Ask CDS to set it up (prefilled ticket)", async () => {
    const { root, askAction } = render({
      groups,
      spfInclude: null,
      replacesProvider: null,
    });
    click(root.querySelector('input[type="radio"][value="other"]'));
    expect(button(root, P14_COPY.BTN_NEXT)).toBeNull();
    expect(root.textContent).toContain(RECORDS_UI_COPY.otherBody);
    click(button(root, P14_COPY.BTN_ASK_CDS_SET_UP));
    await flush();
    expect(askAction).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("#1042");
  });

  it("step 2 shows only the preset's fields and refuses a bad value before previewing", async () => {
    const { root, previewAction } = render({
      groups,
      spfInclude: null,
      replacesProvider: null,
    });
    click(root.querySelector('input[type="radio"][value="google"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    expect(root.textContent).toContain("Step 2 of 3");
    expect(root.textContent).toContain(
      "Paste your values from Google Workspace",
    );
    expect(root.querySelectorAll("input[name], textarea[name]")).toHaveLength(
      EMAIL_PRESETS.google.fields.length,
    );
    typeInto(root.querySelector('input[name="verification"]'), "MS=ms1234567");
    typeInto(root.querySelector('textarea[name="dkim"]'), DKIM);
    click(button(root, P14_COPY.BTN_NEXT));
    await flush();
    expect(previewAction).not.toHaveBeenCalled();
    expect(root.textContent).toContain(
      "That doesn't look like a Google Workspace verification value. It starts with google-site-verification=.",
    );
  });

  it("step 3 without another provider: no checkbox, Add email records enabled", async () => {
    const { root, applyAction, previewAction } = render({
      groups,
      spfInclude: "_spf.google.com",
      replacesProvider: null,
    });
    await toStep3(root);
    expect(previewAction).toHaveBeenCalledWith({
      preset: "google",
      values: { verification: GOOGLE_VERIFY, dkim: DKIM },
    });
    expect(root.textContent).toContain("Step 3 of 3");
    expect(root.querySelector("[data-spf-line]")?.textContent).toBe(
      "Your one SPF record gains include:_spf.google.com",
    );
    expect(root.querySelector('input[type="checkbox"]')).toBeNull();
    const add = button(root, P14_COPY.BTN_ADD_EMAIL_RECORDS);
    expect(add?.disabled).toBe(false);
    click(add);
    await flush();
    expect(applyAction).toHaveBeenCalledWith({
      preset: "google",
      values: { verification: GOOGLE_VERIFY, dkim: DKIM },
      replaceConfirmed: false,
    });
    expect(root.textContent).toContain(
      P14_COPY.EMAIL_DONE_H({ provider: "Google Workspace" }),
    );
    expect(root.textContent).toContain(
      P14_COPY.EMAIL_DONE_B({ console: "Google Admin" }),
    );
    expect(root.textContent).toContain(P14_COPY.BTN_BACK_TO_RECORDS);
  });

  it("REPLACE-WARN: the required checkbox gates Add email records", async () => {
    const { root, applyAction } = render({
      groups,
      spfInclude: null,
      replacesProvider: "Zoho Mail",
    });
    await toStep3(root);
    expect(root.textContent).toContain(
      P14_COPY.REPLACE_WARN({ current: "Zoho Mail", next: "Google Workspace" }),
    );
    const add = button(root, P14_COPY.BTN_ADD_EMAIL_RECORDS);
    expect(add?.disabled).toBe(true);
    const warnId = add?.getAttribute("aria-describedby");
    expect(warnId && root.querySelector(`[id="${warnId}"]`)).toBeTruthy();
    const box = root.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(box.required).toBe(true);
    expect(box.closest("label")?.textContent).toBe(P14_COPY.BTN_REPLACE_EMAIL);
    click(box);
    const add2 = button(root, P14_COPY.BTN_ADD_EMAIL_RECORDS);
    expect(add2?.disabled).toBe(false);
    click(add2);
    await flush();
    expect(applyAction).toHaveBeenCalledWith(
      expect.objectContaining({ replaceConfirmed: true }),
    );
  });

  it("a write failure shows EMAIL-WRITE-FAILED and stays on step 3", async () => {
    const applyAction = vi.fn(async () => ({
      ok: false as const,
      code: "EMAIL-WRITE-FAILED",
      message: P14_COPY.EMAIL_WRITE_FAILED,
    }));
    const { root } = render(
      { groups, spfInclude: null, replacesProvider: null },
      { applyAction },
    );
    await toStep3(root);
    click(button(root, P14_COPY.BTN_ADD_EMAIL_RECORDS));
    await flush();
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      P14_COPY.EMAIL_WRITE_FAILED,
    );
    expect(root.textContent).toContain("Step 3 of 3");
  });
});

describe("WR-E01: a thrown server action shows ERR_GENERIC", () => {
  it("AddRecordDialog keeps the values and shows the generic error", async () => {
    const action = vi.fn(async () => {
      throw new Error("Failed to find Server Action");
    });
    mounted = mount(
      <AddRecordDialog
        open
        onClose={() => {}}
        domain={DOMAIN}
        action={action}
      />,
    );
    const root = mounted.container;
    typeInto(root.querySelector('input[name="name"]'), "em123");
    typeInto(root.querySelector('textarea[name="value"]'), "abc=1");
    submit(root.querySelector("form"));
    await flush();
    expect(action).toHaveBeenCalledOnce();
    expect(root.textContent).toContain(P14_COPY.ERR_GENERIC);
    expect(
      (root.querySelector('input[name="name"]') as HTMLInputElement).value,
    ).toBe("em123");
  });

  it("RemoveRecordDialog shows the generic error", async () => {
    const action = vi.fn(async () => {
      throw new Error("network");
    });
    mounted = mount(
      <RemoveRecordDialog
        open
        onClose={() => {}}
        domain={DOMAIN}
        record={{ type: "TXT", name: "em123", value: "abc=1" }}
        action={action}
      />,
    );
    click(button(mounted.container, P14_COPY.BTN_REMOVE_RECORD));
    await flush();
    expect(action).toHaveBeenCalledOnce();
    expect(mounted.container.textContent).toContain(P14_COPY.ERR_GENERIC);
  });

  it("EmailSetupFlow preview throw stays on step 2 with the generic error", async () => {
    const previewAction = vi.fn(async () => {
      throw new Error("network");
    });
    mounted = mount(
      <EmailSetupFlow
        domain={DOMAIN}
        previewAction={previewAction}
        applyAction={vi.fn()}
        askAction={vi.fn()}
        recordsHref="/hub/settings?tab=domain&view=records"
      />,
    );
    const root = mounted.container;
    click(root.querySelector('input[type="radio"][value="google"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    typeInto(root.querySelector('input[name="verification"]'), GOOGLE_VERIFY);
    typeInto(root.querySelector('textarea[name="dkim"]'), DKIM);
    click(button(root, P14_COPY.BTN_NEXT));
    await flush();
    expect(previewAction).toHaveBeenCalledOnce();
    expect(root.textContent).toContain("Step 2 of 3");
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(
      P14_COPY.ERR_GENERIC,
    );
  });
});

describe("WR-E07: changing the provider clears the old values and errors", () => {
  it("Google's value and error don't follow the owner to Microsoft 365", async () => {
    const previewAction = vi.fn();
    mounted = mount(
      <EmailSetupFlow
        domain={DOMAIN}
        previewAction={previewAction}
        applyAction={vi.fn()}
        askAction={vi.fn()}
        recordsHref="/hub/settings?tab=domain&view=records"
      />,
    );
    const root = mounted.container;
    click(root.querySelector('input[type="radio"][value="google"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    typeInto(root.querySelector('input[name="verification"]'), "MS=ms1234567");
    click(button(root, P14_COPY.BTN_NEXT));
    await flush();
    expect(root.textContent).toContain("Google Workspace verification value");
    click(button(root, P14_COPY.BTN_BACK));
    click(root.querySelector('input[type="radio"][value="microsoft"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    const field = root.querySelector(
      'input[name="verification"]',
    ) as HTMLInputElement | null;
    expect(field?.value ?? "").toBe("");
    expect(root.textContent).not.toContain("Google Workspace");
    expect(previewAction).not.toHaveBeenCalled();
  });
});

describe("WR-E08: after Add email records succeeds, focus goes to the done heading", () => {
  it("the done heading has focus, not <body>", async () => {
    mounted = mount(
      <EmailSetupFlow
        domain={DOMAIN}
        previewAction={vi.fn(async () => ({
          ok: true as const,
          data: { groups: [], spfInclude: null, replacesProvider: null },
        }))}
        applyAction={vi.fn(async () => ({ ok: true as const, data: {} }))}
        askAction={vi.fn()}
        recordsHref="/hub/settings?tab=domain&view=records"
      />,
    );
    const root = mounted.container;
    click(root.querySelector('input[type="radio"][value="google"]'));
    click(button(root, P14_COPY.BTN_NEXT));
    typeInto(root.querySelector('input[name="verification"]'), GOOGLE_VERIFY);
    typeInto(root.querySelector('textarea[name="dkim"]'), DKIM);
    click(button(root, P14_COPY.BTN_NEXT));
    await flush();
    click(button(root, P14_COPY.BTN_ADD_EMAIL_RECORDS));
    await flush();
    expect(root.querySelector('[data-email-setup="done"]')).not.toBeNull();
    const h = root.querySelector("h2");
    expect(document.activeElement).toBe(h);
    expect(h?.textContent).toBe(
      P14_COPY.EMAIL_DONE_H({ provider: EMAIL_PRESETS.google.name }),
    );
  });
});
