// @vitest-environment jsdom
// SendingDomainStatus (14-25 choice 6; 14-UI-SPEC "Sending from your domain"): the four states,
// the "@domain" adornment, one primary button, SEND-LOCAL-INVALID without a request.
import { P14_COPY } from "@cds/core/dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../test-support/dom";
import { SENDING_UI_COPY, SendingDomainStatus } from "./index";

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

const DOMAIN = "riverabakery.com";
const REPLY = "maria@gmail.com";

describe("SendingDomainStatus", () => {
  it("none: the connect sentence and a link to Settings › Domain", () => {
    mounted = mount(
      <SendingDomainStatus
        state="none"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      "Once your domain is connected, emails can come from hello@riverabakery.com.",
    );
    const a = root.querySelector("a")!;
    expect(a.textContent).toBe(SENDING_UI_COPY.connectLink);
    expect(a.getAttribute("href")).toBe("/hub/settings?tab=domain");
    expect(root.querySelector("input")).toBeNull();
  });

  it("pending: SEND-PENDING and no field", () => {
    mounted = mount(
      <SendingDomainStatus
        state="pending"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
      />,
    );
    expect(mounted.container.textContent).toBe(
      P14_COPY.SEND_PENDING({ domain: DOMAIN }),
    );
    expect(mounted.container.querySelector("input")).toBeNull();
  });

  it("failed: a warning alert with SEND-FAILED", () => {
    mounted = mount(
      <SendingDomainStatus
        state="failed"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
      />,
    );
    expect(mounted.container.textContent).toContain(
      P14_COPY.SEND_FAILED({ domain: DOMAIN }),
    );
    expect(mounted.container.querySelector("input")).toBeNull();
  });

  it("verified: SEND-ON, the Send from field with the @domain adornment, helper and one primary button", () => {
    mounted = mount(
      <SendingDomainStatus
        state="verified"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
        save={() => Promise.resolve({ ok: true, data: { localPart: "x" } })}
      />,
    );
    const root = mounted.container;
    expect(root.textContent).toContain(
      P14_COPY.SEND_ON({ address: "hello@riverabakery.com" }),
    );
    expect(root.querySelector("strong")!.textContent).toBe(
      "hello@riverabakery.com",
    );
    const input = root.querySelector("input")!;
    const label = root.querySelector(`label[for="${input.id}"]`)!;
    expect(label.textContent).toBe("Send from");
    expect(input.value).toBe("hello");
    expect(root.querySelector("[data-adornment]")!.textContent).toBe(
      "@riverabakery.com",
    );
    expect(root.textContent).toContain("Replies still go to maria@gmail.com.");
    expect(input.getAttribute("aria-describedby")).toBe(`${input.id}-helper`);
    const buttons = root.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe(P14_COPY.BTN_SAVE_SENDING);
  });

  it("verified without save is read-only", () => {
    mounted = mount(
      <SendingDomainStatus
        state="verified"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
      />,
    );
    expect(mounted.container.querySelector("input")).toBeNull();
    expect(mounted.container.querySelector("button")).toBeNull();
  });

  it("an invalid local part shows SEND-LOCAL-INVALID and never calls save", async () => {
    const save = vi.fn();
    mounted = mount(
      <SendingDomainStatus
        state="verified"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
        save={save}
      />,
    );
    const input = mounted.container.querySelector("input")!;
    typeInto(input, "a..b");
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(save).not.toHaveBeenCalled();
    expect(mounted.container.textContent).toContain(
      P14_COPY.SEND_LOCAL_INVALID,
    );
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("a valid save calls save lowercased and reports the toast words", async () => {
    const save = vi.fn(() =>
      Promise.resolve({ ok: true as const, data: { localPart: "bookings" } }),
    );
    const onSaved = vi.fn();
    mounted = mount(
      <SendingDomainStatus
        state="verified"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
        save={save}
        onSaved={onSaved}
      />,
    );
    typeInto(mounted.container.querySelector("input"), " Bookings ");
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(save).toHaveBeenCalledWith("bookings");
    expect(onSaved).toHaveBeenCalledWith(
      "Emails now send from bookings@riverabakery.com.",
      "bookings",
    );
    expect(mounted.container.querySelector("strong")!.textContent).toBe(
      "bookings@riverabakery.com",
    );
  });

  it("a server field error shows under the field", async () => {
    mounted = mount(
      <SendingDomainStatus
        state="verified"
        domain={DOMAIN}
        localPart="hello"
        replyTo={REPLY}
        save={() =>
          Promise.resolve({
            ok: false,
            code: "invalid",
            message: P14_COPY.SEND_LOCAL_INVALID,
            field: "localPart",
          })
        }
      />,
    );
    typeInto(mounted.container.querySelector("input"), "sales");
    submit(mounted.container.querySelector("form"));
    await flush();
    expect(mounted.container.textContent).toContain(
      P14_COPY.SEND_LOCAL_INVALID,
    );
  });
});
