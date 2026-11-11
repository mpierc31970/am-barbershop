// @vitest-environment jsdom
// 11-50: post-redirect toasts. Switch → "You're now in {site}.", invite join → "Welcome to
// {org}.", shown once from `?flash=<kind>`, then the param is stripped. Unknown kinds are
// ignored and never echoed; the name comes from the shell, not the URL.
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mount, type Mounted } from "../../../packages/ui/src/test-support/dom";
import { flashCopy, withFlash, withoutFlash } from "../lib/flash";

const nav = vi.hoisted(() => ({
  search: new URLSearchParams(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/hub/today",
  useSearchParams: () => nav.search,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: nav.replace }),
}));

const { HubFlash } = await import("../app/(platform)/hub/HubFlash");
const { ToastRegion } = await import("@cds/ui/hub");

let mounted: Mounted | null = null;
beforeEach(() => nav.replace.mockClear());
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.body.innerHTML = "";
});

function render(search: string, name = "Rivera Bakery"): string {
  nav.search = new URLSearchParams(search);
  mounted = mount(
    createElement(
      ToastRegion,
      null,
      createElement(HubFlash, { businessName: name }),
    ),
  );
  return document.body.textContent ?? "";
}

describe("flash helpers", () => {
  it("builds and strips the param, keeping other params", () => {
    expect(withFlash("/hub/today", "switched")).toBe(
      "/hub/today?flash=switched",
    );
    expect(withFlash("/hub/today?x=1", "joined")).toBe(
      "/hub/today?x=1&flash=joined",
    );
    expect(
      withoutFlash("/hub/today", new URLSearchParams("a=1&flash=joined&b=2")),
    ).toBe("/hub/today?a=1&b=2");
  });

  it("knows two kinds only and needs a name", () => {
    expect(flashCopy("switched", "Lopez Spa")).toBe("You're now in Lopez Spa.");
    expect(flashCopy("joined", "Rivera Bakery")).toBe(
      "Welcome to Rivera Bakery.",
    );
    expect(flashCopy("<b>hi</b>", "Rivera Bakery")).toBeNull();
    expect(flashCopy("joined", "  ")).toBeNull();
  });
});

describe("HubFlash", () => {
  it("shows the switch toast once and strips the param", () => {
    const text = render("flash=switched&tab=x");
    expect(text).toContain("You're now in Rivera Bakery.");
    expect(nav.replace).toHaveBeenCalledWith("/hub/today?tab=x", {
      scroll: false,
    });
  });

  it("shows the welcome toast after joining", () => {
    expect(render("flash=joined")).toContain("Welcome to Rivera Bakery.");
  });

  it("ignores an unknown kind (never echoed) but still strips it", () => {
    const text = render("flash=Gotcha");
    expect(text).not.toContain("Gotcha");
    expect(nav.replace).toHaveBeenCalledWith("/hub/today", { scroll: false });
  });

  it("does nothing without the param", () => {
    expect(render("")).toBe("");
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
