// Pop-up render and controller contract (CONT-12, D118, D124; CONTEXT A3-Q4;
// 03-UI-SPEC "Pop-up dialog"; T-03-39, T-03-40, T-03-41).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ColumnItem, PopupRecord } from "@cds/core/content";
import { PopupDialog } from "./PopupDialog";
import { PopupHost, openablePopupIds } from "./PopupHost";
import { PopupController } from "./client/PopupController";
import { ColumnItemRenderer } from "./ColumnItemRenderer";
import type { CoreBoundData } from "./types";
import {
  browserStores,
  FINE_POINTER_QUERY,
  isFinePointer,
  markSeen,
  readSeen,
  scrollPercent,
  type StorageLike,
} from "./client/popup-dom";
import { cycleFocus } from "./client/useFocusTrap";
import * as site from "./index";
import * as siteClient from "./client/index";

const CLIENT_DIR = join(import.meta.dirname, "client");
const clientSource = (name: string) =>
  readFileSync(join(CLIENT_DIR, name), "utf8");

function fakeStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("popup-dom: frequency flags (no cookies)", () => {
  it("once-per-session writes sessionStorage cds-popup:<id> only", () => {
    const session = fakeStorage();
    const local = fakeStorage();
    markSeen({ session, local }, "once-per-session", "pop1");
    expect(session.data.get("cds-popup:pop1")).toBeTruthy();
    expect(local.data.size).toBe(0);
    expect(readSeen({ session, local }, "pop1")).toEqual({
      session: true,
      local: false,
    });
  });

  it("once-per-visitor writes localStorage", () => {
    const session = fakeStorage();
    const local = fakeStorage();
    markSeen({ session, local }, "once-per-visitor", "pop1");
    expect(local.data.get("cds-popup:pop1")).toBeTruthy();
    expect(session.data.size).toBe(0);
    expect(readSeen({ session, local }, "pop1")).toEqual({
      session: false,
      local: true,
    });
  });

  it("every-visit writes nothing", () => {
    const session = fakeStorage();
    const local = fakeStorage();
    markSeen({ session, local }, "every-visit", "pop1");
    expect(session.data.size + local.data.size).toBe(0);
    expect(readSeen({ session, local }, "pop2")).toEqual({
      session: false,
      local: false,
    });
  });

  it("storage that throws (privacy mode) is treated as not seen and never throws", () => {
    const stores = { session: throwing, local: throwing };
    expect(() => markSeen(stores, "once-per-visitor", "p")).not.toThrow();
    expect(readSeen(stores, "p")).toEqual({ session: false, local: false });
    expect(readSeen({ session: null, local: null }, "p")).toEqual({
      session: false,
      local: false,
    });
  });

  it("browserStores survives a window whose storage getters throw", () => {
    const win = {} as Window;
    Object.defineProperty(win, "sessionStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
    Object.defineProperty(win, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(browserStores(win)).toEqual({ session: null, local: null });
  });
});

describe("popup-dom: pointer and scroll", () => {
  it("isFinePointer asks (hover: hover) and (pointer: fine)", () => {
    const asked: string[] = [];
    const mm = (q: string) => {
      asked.push(q);
      return { matches: true } as MediaQueryList;
    };
    expect(FINE_POINTER_QUERY).toBe("(hover: hover) and (pointer: fine)");
    expect(isFinePointer(mm)).toBe(true);
    expect(asked).toEqual(["(hover: hover) and (pointer: fine)"]);
    expect(isFinePointer(() => ({ matches: false }) as MediaQueryList)).toBe(
      false,
    );
    expect(isFinePointer(undefined)).toBe(false);
  });

  it("scrollPercent computes 0-100 from scroll metrics", () => {
    const doc = (
      scrollTop: number,
      scrollHeight: number,
      clientHeight = 1000,
    ) =>
      ({
        documentElement: { scrollTop, scrollHeight, clientHeight },
      }) as unknown as Document;
    expect(scrollPercent(doc(0, 3000))).toBe(0);
    expect(scrollPercent(doc(1000, 3000))).toBe(50);
    expect(scrollPercent(doc(2000, 3000))).toBe(100);
    expect(scrollPercent(doc(5000, 3000))).toBe(100);
    // A page that cannot scroll is fully seen.
    expect(scrollPercent(doc(0, 800))).toBe(100);
  });
});

describe("focus trap", () => {
  type El = { id: string; focus: () => void };
  function panel(ids: string[]) {
    let active: El | null = null;
    const els: El[] = ids.map((id) => {
      const el: El = {
        id,
        focus: () => {
          active = el;
        },
      };
      return el;
    });
    return {
      els,
      get active() {
        return active;
      },
      setActive(i: number) {
        active = els[i]!;
      },
      node: {
        querySelectorAll: () => els,
      } as unknown as HTMLElement,
    };
  }

  it("Tab on the last element wraps to the first; Shift+Tab on the first wraps to the last", () => {
    const p = panel(["a", "b", "close"]);
    let prevented = 0;
    const ev = (shiftKey: boolean) => ({
      key: "Tab",
      shiftKey,
      preventDefault: () => void prevented++,
    });
    p.setActive(2);
    cycleFocus(p.node, ev(false), p.active as unknown as Element);
    expect(p.active?.id).toBe("a");
    cycleFocus(p.node, ev(true), p.active as unknown as Element);
    expect(p.active?.id).toBe("close");
    expect(prevented).toBe(2);
  });

  it("leaves Tab in the middle and other keys alone", () => {
    const p = panel(["a", "b", "close"]);
    p.setActive(1);
    let prevented = 0;
    cycleFocus(
      p.node,
      { key: "Tab", shiftKey: false, preventDefault: () => void prevented++ },
      p.active as unknown as Element,
    );
    cycleFocus(
      p.node,
      { key: "Enter", shiftKey: false, preventDefault: () => void prevented++ },
      p.active as unknown as Element,
    );
    expect(prevented).toBe(0);
    expect(p.active?.id).toBe("b");
  });
});

describe("PopupController source contract", () => {
  const controller = clientSource("PopupController.tsx");

  it("never uses cookies in the client islands, except the one consent cookie owner", () => {
    // Recursive, files only: P7 client islands live in client/p7/ (07-02). Pop-ups set no
    // cookies; consent-state.ts alone reads and writes `cds_consent` (07-14, D279).
    const files = readdirSync(CLIENT_DIR, {
      recursive: true,
      encoding: "utf8",
    }).filter(
      // 11-32: tests are not islands (the GA loader test sets the consent cookie itself).
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        !/consent-state\.ts$/.test(f),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(clientSource(f), f).not.toMatch(/\bdoc(?:ument)?\.cookie/);
    }
    expect(clientSource("consent-state.ts")).toContain("cds_consent");
  });

  it("asks shouldShowPopup and listens for [data-cds-popup-open]", () => {
    expect(controller).toContain("shouldShowPopup(");
    expect(controller).toContain("[data-cds-popup-open]");
    expect(controller).toContain("markSeen(");
  });

  it("wires every automatic trigger and cleans up", () => {
    for (const s of [
      "setTimeout",
      "clearTimeout",
      '"scroll"',
      "passive: true",
      '"mouseout"',
      "isFinePointer(",
      "removeEventListener",
    ]) {
      expect(controller, s).toContain(s);
    }
  });

  it("is exported from @cds/ui/site/client with the overlay hooks", () => {
    expect(siteClient.PopupController).toBe(PopupController);
    expect(typeof siteClient.useOverlay).toBe("function");
    expect(typeof siteClient.useFocusTrap).toBe("function");
    expect(typeof siteClient.openOverlay).toBe("function");
  });
});

const NOW = new Date("2026-10-01T12:00:00.000Z");
const PAGE = "pageaaaaaaaaaaa";
const OTHER = "pagebbbbbbbbbbb";

function popup(over: Partial<PopupRecord> = {}): PopupRecord {
  return {
    id: "pop1",
    name: "Spring offer",
    content: { items: [] },
    trigger: "delay",
    delay_seconds: 5,
    scroll_percent: 50,
    frequency: "once-per-visitor",
    show_on: "all-pages",
    page_ids: [],
    enabled: true,
    ...over,
  };
}

const heading: ColumnItem = {
  id: "h1",
  kind: "heading",
  text: "Ten percent off",
  level: 2,
};
const body: ColumnItem = {
  id: "t1",
  kind: "text",
  html: "<p>Sign up<script>x()</script></p>",
};

const renderDialog = (p: PopupRecord) =>
  renderToStaticMarkup(<PopupDialog popup={p} now={NOW} />);

describe("PopupDialog (server markup)", () => {
  it("renders a native dialog keyed by the pop-up id", () => {
    const out = renderDialog(popup({ content: { items: [heading] } }));
    expect(out).toMatch(/^<dialog /);
    expect(out).toContain('id="cds-popup-pop1"');
    expect(out).toContain('data-cds-popup="pop1"');
  });

  it("is labelled by its first heading, which carries that id", () => {
    const out = renderDialog(popup({ content: { items: [body, heading] } }));
    const m = out.match(/aria-labelledby="([^"]+)"/);
    expect(m).not.toBeNull();
    expect(out).toMatch(
      new RegExp(`<h2 id="${m![1]}"[^>]*>Ten percent off</h2>`),
    );
    expect(out).not.toContain('aria-label="Spring offer"');
  });

  it("without a heading falls back to aria-label = the pop-up name", () => {
    const out = renderDialog(popup({ content: { items: [body] } }));
    expect(out).toContain('aria-label="Spring offer"');
    expect(out).not.toContain("aria-labelledby");
  });

  it("has a 44x44 Close button of type button", () => {
    const out = renderDialog(popup());
    expect(out).toMatch(
      /<button type="button" aria-label="Close" data-cds-popup-close=""[^>]*class="[^"]*size-11/,
    );
  });

  it("renders items through the column item renderer, sanitized", () => {
    const out = renderDialog(popup({ content: { items: [heading, body] } }));
    expect(out).toContain('<div class="site-prose"><p>Sign up</p></div>');
    expect(out).not.toContain("<script");
  });

  it("uses the site overlay tokens and a reduced-motion-safe enter", () => {
    const out = renderDialog(popup());
    for (const cls of [
      "bg-site-surface",
      "max-w-[480px]",
      "w-[calc(100%-32px)]",
      "rounded-site-media",
      "shadow-site-overlay",
      "backdrop:bg-[var(--site-backdrop",
      "starting:opacity-0",
      "starting:scale-98",
      "ease-out-expo",
      "motion-reduce:transition-none",
    ]) {
      expect(out, cls).toContain(cls);
    }
    expect(out).toContain("p-8");
  });

  it("scrolls when taller than the viewport, with Close outside the scroll (WR-C05)", () => {
    const out = renderDialog(popup({ content: { items: [heading, body] } }));
    const dialogClass = out.match(/^<dialog [^>]*class="([^"]+)"/)![1]!;
    expect(dialogClass).toContain("max-h-[calc(100dvh-32px)]");
    const panel = out.match(/<dialog [^>]*><div class="([^"]+)"/)![1]!;
    expect(panel).toContain("overflow-y-auto");
    expect(panel).toContain("max-h-[calc(100dvh-32px)]");
    // Close is a direct child of the dialog (after the panel), so it never scrolls away.
    expect(out).toMatch(
      /<\/div><button type="button" aria-label="Close"[^>]*><svg/,
    );
    expect(out).toMatch(/<\/button><\/dialog>$/);
  });

  it("openablePopupIds lists exactly the pop-ups PopupHost renders on a page (WR-C07)", () => {
    const ids = openablePopupIds(
      [
        popup({ id: "on", enabled: true, show_on: "button-only" }),
        popup({ id: "off", enabled: false, show_on: "all-pages" }),
        popup({
          id: "elsewhere",
          enabled: true,
          show_on: "selected-pages",
          page_ids: ["other"],
        }),
        popup({
          id: "here",
          enabled: true,
          show_on: "selected-pages",
          page_ids: ["page1"],
        }),
      ],
      "page1",
    );
    expect([...ids].sort()).toEqual(["here", "on"]);
    expect(site.openablePopupIds).toBe(openablePopupIds);
  });

  it("is exported from @cds/ui/site", () => {
    expect(site.PopupDialog).toBe(PopupDialog);
    expect(site.PopupHost).toBe(PopupHost);
  });
});

function children(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    out.push(n);
    walk((n.props as { children?: ReactNode }).children);
  };
  walk(node);
  return out;
}

describe("PopupHost", () => {
  const three = [
    popup({ id: "btn", trigger: "click", show_on: "button-only" }),
    popup({ id: "all", show_on: "all-pages" }),
    popup({ id: "sel", show_on: "selected-pages", page_ids: [OTHER] }),
  ];

  it("renders dialogs only for eligible pop-ups on this page", () => {
    const out = renderToStaticMarkup(
      <PopupHost popups={three} pageId={PAGE} now={NOW} />,
    );
    expect(out).toContain('data-cds-popup="btn"');
    expect(out).toContain('data-cds-popup="all"');
    expect(out).not.toContain('data-cds-popup="sel"');
  });

  it("renders a selected-pages pop-up on one of its pages", () => {
    const out = renderToStaticMarkup(
      <PopupHost
        popups={[
          popup({ id: "sel", show_on: "selected-pages", page_ids: [PAGE] }),
        ]}
        pageId={PAGE}
        now={NOW}
      />,
    );
    expect(out).toContain('data-cds-popup="sel"');
  });

  it("mounts one controller whose config holds ids and trigger settings only", () => {
    const tree = PopupHost({
      popups: [
        popup({
          id: "btn",
          trigger: "click",
          show_on: "button-only",
          content: { items: [heading, body] },
        }),
        ...three.slice(1),
      ],
      pageId: PAGE,
      now: NOW,
    });
    const controllers = children(tree).filter(
      (el) => el.type === PopupController,
    );
    expect(controllers).toHaveLength(1);
    const props = controllers[0]!.props as {
      config: Record<string, unknown>[];
      pageId: string;
    };
    expect(props.pageId).toBe(PAGE);
    expect(props.config.map((c) => c.id)).toEqual(["btn", "all"]);
    const json = JSON.stringify(props.config);
    expect(json).not.toContain("content");
    expect(json).not.toContain("Spring offer");
    expect(json).not.toContain("Ten percent off");
    expect(Object.keys(props.config[0]!).sort()).toEqual(
      [
        "delay_seconds",
        "enabled",
        "frequency",
        "id",
        "page_ids",
        "scroll_percent",
        "show_on",
        "trigger",
      ].sort(),
    );
  });

  it("renders nothing for disabled pop-ups", () => {
    const out = renderToStaticMarkup(
      <PopupHost
        popups={[popup({ id: "off", enabled: false })]}
        pageId={PAGE}
        now={NOW}
      />,
    );
    expect(out).toBe("");
  });

  it("passes the page's media and forms to pop-up items (07-14, CONT-21)", () => {
    const coreData: CoreBoundData = {
      media: {
        img1: {
          id: "img1",
          kind: "image",
          src: "/_media/o1/image/img1/w960.webp",
          alt: "Spring table",
        },
      },
      forms: { f1: { id: "f1" } },
    };
    const image = {
      id: "i1",
      kind: "image",
      asset: "img1",
      url: "",
      alt: "",
    } as unknown as ColumnItem;
    const withImage = popup({ id: "all", content: { items: [image] } });
    const out = renderToStaticMarkup(
      <PopupHost
        popups={[withImage]}
        pageId={PAGE}
        now={NOW}
        coreData={coreData}
      />,
    );
    expect(out).toContain('src="/_media/o1/image/img1/w960.webp"');
    expect(out).toContain('alt="Spring table"');
    const items = children(
      PopupDialog({ popup: withImage, now: NOW, coreData }),
    ).filter((el) => el.type === ColumnItemRenderer);
    expect(items).toHaveLength(1);
    const props = items[0]!.props as Pick<CoreBoundData, "media" | "forms">;
    expect(props.media).toBe(coreData.media);
    expect(props.forms).toBe(coreData.forms);
    // The controller config stays plain (no media).
    const tree = PopupHost({
      popups: [withImage],
      pageId: PAGE,
      now: NOW,
      coreData,
    });
    const ctrl = children(tree).find((el) => el.type === PopupController)!;
    expect(JSON.stringify(ctrl.props)).not.toContain("_media");
  });

  it("renders nothing at all when no pop-up is eligible", () => {
    expect(PopupHost({ popups: [], pageId: PAGE, now: NOW })).toBeNull();
  });
});
