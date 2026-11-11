// @vitest-environment jsdom
// 07-32: the password gate and the 404 extras (CONT-28, D235 #11/#12; 07-UI-SPEC 526-534;
// D-UI-P7-24, D-UI-P7-31; choice 14). Server markup first (works without JS), then the
// enhancer in jsdom: Show/Hide, wrong answer kept + selected + announced, rate countdown,
// navigation on success.
import { GATE_COPY } from "@cds/core/content";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundExtras } from "./NotFoundExtras";
import { PasswordGate } from "./PasswordGate";
import { PasswordGateEnhancer } from "./client/PasswordGateEnhancer";
import {
  button,
  click,
  flush,
  mount,
  submit,
  typeInto,
  type Mounted,
} from "../test-support/dom";

const ACTION = "/api/gate/abc123def456ghi";

function gateHtml(status?: Parameters<typeof PasswordGate>[0]["status"]) {
  return renderToStaticMarkup(
    <PasswordGate title="Members area" action={ACTION} status={status} />,
  );
}

describe("PasswordGate server markup", () => {
  it("one H1, the body, a labelled password input and a full-width View page", () => {
    const html = gateHtml();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Members area");
    expect(html).toContain(GATE_COPY.body);
    expect(html).toContain(`action="${ACTION}"`);
    expect(html).toContain('method="post"');
    expect(html).toMatch(/<label for="gate-password"[^>]*>Password<\/label>/);
    const input = /<input[^>]*id="gate-password"[^>]*>/.exec(html)![0];
    expect(input).toContain('type="password"');
    expect(input).toContain('autoComplete="current-password"');
    expect(input).toContain('name="password"');
    expect(input).toContain("required");
    expect(input).not.toContain("value=");
    expect(html).toMatch(
      /<button type="submit"[^>]*w-full[^>]*>View page<\/button>/,
    );
    expect(html).not.toContain("data-gate-toggle");
    expect(html).toContain("max-w-[400px]");
    expect(html).toContain("text-[length:var(--site-text-h2)]");
  });

  it("wrong: GATE-WRONG linked to the input", () => {
    const html = gateHtml({ kind: "wrong" });
    expect(html).toContain(GATE_COPY.wrong.replace("'", "&#x27;"));
    const input = /<input[^>]*id="gate-password"[^>]*>/.exec(html)![0];
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="gate-error"');
    expect(html).toContain('id="gate-error" aria-live="polite"');
  });

  it("rate: GATE-RATE, the wait and a disabled View page", () => {
    const html = gateHtml({ kind: "rate", waitMinutes: 14 });
    expect(html).toContain(GATE_COPY.rate);
    expect(html).toContain("Try again in 14 minutes");
    expect(html).toMatch(/<button type="submit" disabled=""/);
  });

  it("renders a hostile title as text", () => {
    const html = renderToStaticMarkup(
      <PasswordGate title={'<img src=x onerror="alert(1)">'} action={ACTION} />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("PasswordGateEnhancer", () => {
  let m: Mounted | null = null;
  const assign = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("location", { ...window.location, assign });
    vi.stubGlobal(
      "requestAnimationFrame",
      (fn: FrameRequestCallback) =>
        setTimeout(() => fn(0), 0) as unknown as number,
    );
  });
  afterEach(() => {
    m?.unmount();
    m = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
    assign.mockReset();
  });

  function respond(status: number, body: unknown) {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  const input = () =>
    m!.container.querySelector<HTMLInputElement>("#gate-password")!;

  it("adds Show/Hide after mount and toggles the input type", () => {
    m = mount(
      <PasswordGateEnhancer action={ACTION} initial={{ kind: "idle" }} />,
    );
    const toggle = button(m.container, "Show");
    expect(toggle).not.toBeNull();
    click(toggle);
    expect(input().type).toBe("text");
    click(button(m.container, "Hide"));
    expect(input().type).toBe("password");
  });

  it("401 keeps and selects the value and announces GATE-WRONG", async () => {
    const f = respond(401, { error: GATE_COPY.wrong });
    m = mount(
      <PasswordGateEnhancer action={ACTION} initial={{ kind: "idle" }} />,
    );
    typeInto(input(), "wrong-one");
    submit(m.container.querySelector("form"));
    await flush();
    expect(f).toHaveBeenCalledWith(
      ACTION,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Accept: "application/json" }),
      }),
    );
    expect(input().value).toBe("wrong-one");
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const live = m.container.querySelector("[aria-live]")!;
    expect(live.textContent).toContain(GATE_COPY.wrong);
    expect(input().selectionStart).toBe(0);
    expect(input().selectionEnd).toBe("wrong-one".length);
  });

  it("429 disables View page and counts down to re-enable it", async () => {
    respond(429, { error: GATE_COPY.rate, retryAfterS: 90 });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    m = mount(
      <PasswordGateEnhancer action={ACTION} initial={{ kind: "idle" }} />,
    );
    typeInto(input(), "again-wrong");
    submit(m.container.querySelector("form"));
    await flush();
    const view = button(m.container, "View page")!;
    expect(view.disabled).toBe(true);
    expect(m.container.textContent).toContain("Try again in 2 minutes");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(m.container.textContent).toContain("Try again in 1 minute");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(button(m.container, "View page")!.disabled).toBe(false);
  });

  it("200 navigates to the same-site location only", async () => {
    respond(200, { ok: true, location: "/members" });
    m = mount(
      <PasswordGateEnhancer action={ACTION} initial={{ kind: "idle" }} />,
    );
    typeInto(input(), "sourdough1");
    submit(m.container.querySelector("form"));
    await flush();
    expect(assign).toHaveBeenCalledWith("/members");
  });

  it.each([
    ["a 500", () => respond(500, { error: GATE_COPY.wrong })],
    [
      "a 200 without a safe location",
      () => respond(200, { ok: true, location: "//evil.example" }),
    ],
    [
      "a failed fetch",
      () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(() => Promise.reject(new TypeError("offline"))),
        ),
    ],
  ])(
    "%s says something went wrong, never wrong password (WR-D06)",
    async (_n, setup) => {
      setup();
      m = mount(
        <PasswordGateEnhancer action={ACTION} initial={{ kind: "idle" }} />,
      );
      typeInto(input(), "right-one");
      submit(m.container.querySelector("form"));
      await flush();
      const live = m.container.querySelector("[aria-live]")!;
      expect(live.textContent).toContain(GATE_COPY.error);
      expect(live.textContent).not.toContain(GATE_COPY.wrong);
      expect(input().hasAttribute("aria-invalid")).toBe(false);
      expect(button(m.container, "View page")!.disabled).toBe(false);
      expect(assign).not.toHaveBeenCalled();
    },
  );
});

describe("NotFoundExtras", () => {
  const links = [
    { label: "Home", href: "/" },
    { label: "Menu", href: "/menu" },
  ];

  it("renders Popular pages and the search form only when search is on", () => {
    const on = renderToStaticMarkup(
      <NotFoundExtras links={links} showSearch />,
    );
    expect(on).toContain("Popular pages");
    expect(on).toContain('role="search"');
    expect(on).toContain('action="/search"');
    expect(on).toContain('href="/menu"');
    const off = renderToStaticMarkup(
      <NotFoundExtras links={links} showSearch={false} />,
    );
    expect(off).toContain("Popular pages");
    expect(off).not.toContain('role="search"');
  });

  it("renders nothing extra with no links and search off", () => {
    expect(
      renderToStaticMarkup(<NotFoundExtras links={[]} showSearch={false} />),
    ).toBe("");
  });
});
