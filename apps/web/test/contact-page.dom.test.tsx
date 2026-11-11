// @vitest-environment jsdom
// 15-19 Task 2: /contact page and form (HUB-07, HUB-03; A3-Q2, D-UI-P15-19, D-UI-P15-20;
// UI-SPEC "Contact"). Shared marketing mocks first (P15-P27); the action module and the
// Turnstile widget are mocked.
import { mockMarketingData, PUBLIC_VIEW } from "./helpers/marketing-mocks";
import { MK_COPY } from "@cds/core/marketing";
import type { CatalogEntry } from "@cds/db";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../../../packages/ui/src/test-support/dom";

const action = vi.hoisted(() => ({ submitContactAction: vi.fn() }));
vi.mock("../app/actions/contact", () => action);
vi.mock("../app/(platform)/start/_components/Turnstile", async () => {
  const { useEffect } = await import("react");
  return {
    Turnstile: ({ onToken }: { onToken: (t: string) => void }) => {
      useEffect(() => onToken("test-token"), [onToken]);
      return null;
    },
  };
});
vi.mock("next/link", () => ({
  default: ({ children, ...rest }: { children: ReactNode; href: string }) => (
    <a {...rest}>{children}</a>
  ),
}));

const pageModule = await import("../app/(platform)/(marketing)/contact/page");
const ContactPage = pageModule.default;
const { CONTACT_FIELD_IDS } = await import("../lib/contact-form");

const C = MK_COPY.CONTACT;
const PRIVATE: CatalogEntry = {
  ...PUBLIC_VIEW[0]!,
  slug: "secret-addon",
  name: "Secret Add-on",
  private: true,
};

let mounted: Mounted | null = null;
beforeEach(() => {
  action.submitContactAction.mockReset();
  mockMarketingData({ view: [...PUBLIC_VIEW, PRIVATE] });
});
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.unstubAllEnvs();
});

type SP = Record<string, string>;

async function mountPage(sp: SP = {}) {
  const ui = await ContactPage({ searchParams: Promise.resolve(sp) });
  mounted = mount(ui);
  return mounted.container;
}

function byId<T extends HTMLElement = HTMLInputElement>(
  root: ParentNode,
  id: string,
): T | null {
  return root.querySelector<T>(`#${id}`);
}

function radio(root: ParentNode, value: string): HTMLInputElement {
  const el = root.querySelector<HTMLInputElement>(
    `input[type="radio"][name="topic"][value="${value}"]`,
  );
  if (!el) throw new Error(`no radio ${value}`);
  return el;
}

const labelFor = (root: ParentNode, id: string) =>
  root.querySelector(`label[for="${id}"]`)?.textContent;

describe("/contact page", () => {
  it("is force-dynamic, titled, noindex outside production", async () => {
    expect(pageModule.dynamic).toBe("force-dynamic");
    expect("revalidate" in pageModule).toBe(false);
    const meta = await pageModule.generateMetadata();
    expect(meta.title).toBe(MK_COPY.SEO.CONTACT_TITLE);
    expect(meta.description).toBe(C.LEAD);
    expect(meta.robots).toEqual({ index: false, follow: false });
  });

  it("server markup: POST form, phone always shown with the no-JS label, aside links", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const html = renderToStaticMarkup(
      await ContactPage({ searchParams: Promise.resolve({}) }),
    );
    const form = /<form\s[^>]*>/.exec(html)?.[0] ?? "";
    expect(form).toMatch(/\saction="/);
    expect(form).not.toMatch(/method="get"/i);
    expect(html).toContain(`id="${CONTACT_FIELD_IDS.phone}"`);
    expect(html).toContain("Phone (only if you&#x27;d like a call)");
    expect(html).toContain(`href="mailto:${C.EMAIL}"`);
    expect(html).toContain('href="/report"');
    expect(html).toContain('href="/sign-in"');
    expect((html.match(/<h1[\s>]/g) ?? []).length).toBe(1);
  });

  it("without a call topic the island hides the phone; choosing the call shows it", async () => {
    const root = await mountPage();
    expect(byId(root, CONTACT_FIELD_IDS.phone)).toBeNull();
    expect(
      root.querySelectorAll('input[type="radio"][name="topic"]'),
    ).toHaveLength(3);
    click(radio(root, "call"));
    expect(byId(root, CONTACT_FIELD_IDS.phone)).not.toBeNull();
    expect(labelFor(root, CONTACT_FIELD_IDS.phone)).toBe(C.PHONE);
  });

  it("?topic=call checks the call radio and shows the phone", async () => {
    const root = await mountPage({ topic: "call" });
    expect(radio(root, "call").checked).toBe(true);
    expect(byId(root, CONTACT_FIELD_IDS.phone)?.type).toBe("tel");
  });

  it("?about=builder-pro prefills the message and the hidden about", async () => {
    const root = await mountPage({ topic: "question", about: "builder-pro" });
    expect(radio(root, "question").checked).toBe(true);
    expect(
      byId<HTMLTextAreaElement>(root, CONTACT_FIELD_IDS.message)?.value,
    ).toBe("I'd like to know more about Builder Pro.");
    expect(
      root.querySelector<HTMLInputElement>('input[type="hidden"][name="about"]')
        ?.value,
    ).toBe("builder-pro");
  });

  it("?about=shop and ?about=independent-pro use the fixed keys", async () => {
    let root = await mountPage({ about: "shop" });
    expect(
      byId<HTMLTextAreaElement>(root, CONTACT_FIELD_IDS.message)?.value,
    ).toBe("I'd like to know more about Shop.");
    mounted?.unmount();
    root = await mountPage({ about: "independent-pro" });
    expect(
      byId<HTMLTextAreaElement>(root, CONTACT_FIELD_IDS.message)?.value,
    ).toBe("I'd like to know more about Independent pros.");
  });

  it("a private or unknown ?about= and an unknown ?topic= are ignored", async () => {
    for (const sp of [
      { about: "secret-addon", topic: "spam" } as SP,
      { about: "nope" },
      { about: "<script>" },
    ]) {
      const root = await mountPage(sp);
      expect(
        byId<HTMLTextAreaElement>(root, CONTACT_FIELD_IDS.message)?.value,
      ).toBe("");
      expect(
        root.querySelector<HTMLInputElement>(
          'input[type="hidden"][name="about"]',
        )?.value,
      ).toBe("");
      expect(
        root.querySelectorAll('input[type="radio"][name="topic"]:checked'),
      ).toHaveLength(0);
      mounted?.unmount();
      mounted = null;
    }
  });

  it("a failed submit focuses the error summary, links each field and keeps the text", async () => {
    action.submitContactAction.mockResolvedValue({
      status: "idle",
      error: null,
      fieldErrors: { email: C.ERR_EMAIL, topic: C.ERR_TOPIC },
      values: {},
    });
    const root = await mountPage();
    typeInto(byId(root, CONTACT_FIELD_IDS.name), "Ana Reyes");
    typeInto(byId(root, CONTACT_FIELD_IDS.message), "Typed words stay here.");
    submit(root.querySelector("form"));
    await flush();
    const summary = root.querySelector('[role="alert"]');
    expect(summary).not.toBeNull();
    expect(document.activeElement).toBe(summary);
    expect(summary?.textContent).toContain(C.ERROR_SUMMARY);
    const links = Array.from(summary!.querySelectorAll("a")).map((a) => [
      a.getAttribute("href"),
      a.textContent,
    ]);
    expect(links).toEqual([
      [`#${CONTACT_FIELD_IDS.email}`, C.ERR_EMAIL],
      [`#${CONTACT_FIELD_IDS.topic}`, C.ERR_TOPIC],
    ]);
    expect(
      byId(root, CONTACT_FIELD_IDS.email)?.getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      byId<HTMLTextAreaElement>(root, CONTACT_FIELD_IDS.message)?.value,
    ).toBe("Typed words stay here.");
    const fd = action.submitContactAction.mock.calls[0]![1] as FormData;
    expect(fd.get("name")).toBe("Ana Reyes");
    expect(fd.get("cf-turnstile-response")).toBe("test-token");
    expect(fd.has("phone")).toBe(false);
  });

  it("a request error (rate limit) is shown and focused", async () => {
    action.submitContactAction.mockResolvedValue({
      status: "idle",
      error: C.ERR_RATE,
      fieldErrors: {},
      values: {},
    });
    const root = await mountPage();
    submit(root.querySelector("form"));
    await flush();
    const alert = root.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(C.ERR_RATE);
    expect(document.activeElement).toBe(alert);
  });

  it("success replaces the form and focuses the heading", async () => {
    action.submitContactAction.mockResolvedValue({
      status: "sent",
      email: "ana@example.com",
      isCall: true,
    });
    const root = await mountPage({ topic: "call" });
    submit(root.querySelector("form"));
    await flush();
    expect(root.querySelector("form")).toBeNull();
    const h2 = root.querySelector("h2");
    expect(h2?.textContent).toBe(C.SENT_H2);
    expect(document.activeElement).toBe(h2);
    expect(root.textContent).toContain(
      "We'll email ana@example.com to set up a time.",
    );
    expect(root.querySelector('a[href="/"]')?.textContent).toBe(C.BACK_HOME);
  });
});
