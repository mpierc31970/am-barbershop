// @vitest-environment jsdom
// TranslateLink island (07-26; D237, D-UI-P7-29, CONT-34; T-07-26-05): SSR is hidden with
// no Google address; on mount it becomes a plain link; no script, frame or request ever.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, mount, type Mounted } from "../../test-support/dom";
import { TranslateLink } from "./TranslateLink";

let mounted: Mounted | null = null;

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  document.querySelector("main")?.remove();
  vi.restoreAllMocks();
});

describe("TranslateLink SSR", () => {
  it("renders a hidden anchor with no href and no Google address", () => {
    const html = renderToStaticMarkup(<TranslateLink />);
    expect(html).toMatch(/^<a [^>]*hidden=""/);
    expect(html).not.toContain("href=");
    expect(html).toContain("Translate");
    expect(html).toContain(
      '<span class="sr-only"> (opens in a new tab)</span>',
    );
    expect(html).not.toContain("translate.google.com");
    expect(html).not.toMatch(/<script|<iframe/);
  });

  it("preview renders an inert visible span", () => {
    const html = renderToStaticMarkup(<TranslateLink preview />);
    expect(html).toMatch(/^<span /);
    expect(html).not.toContain(" hidden=");
    expect(html).not.toContain("href");
    expect(html).toContain("Translate");
  });
});

describe("TranslateLink on mount", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.history.replaceState({}, "", "/menu?form=x#y");
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const counts = () => ({
    scripts: document.querySelectorAll("script").length,
    frames: document.querySelectorAll("iframe").length,
  });

  it("shows a new-tab link in the visitor's language, query and hash dropped", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("es-MX");
    const before = counts();
    mounted = mount(<TranslateLink />);
    await flush();
    const a = mounted.container.querySelector("a")!;
    expect(a.hidden).toBe(false);
    const page = encodeURIComponent(`${window.location.origin}/menu`);
    expect(a.getAttribute("href")).toBe(
      `https://translate.google.com/translate?sl=auto&tl=es-MX&u=${page}`,
    );
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(counts()).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an empty browser language falls back to en", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("");
    mounted = mount(<TranslateLink />);
    await flush();
    expect(
      mounted.container.querySelector("a")!.getAttribute("href"),
    ).toContain("tl=en&");
  });

  it("stays hidden on a page kind that hides Translate", async () => {
    const main = document.createElement("main");
    main.setAttribute("data-cds-hide-translate", "");
    document.body.appendChild(main);
    mounted = mount(<TranslateLink />);
    await flush();
    const a = mounted.container.querySelector("a")!;
    expect(a.hidden).toBe(true);
    expect(a.hasAttribute("href")).toBe(false);
  });
});
