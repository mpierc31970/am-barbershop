// Pop-up validation and show rules (CONT-12, D118, D124; T-03-14, T-03-15).
import { describe, expect, it } from "vitest";
import { InvalidInput } from "../errors";
import {
  popupFrequencyKey,
  popupSummary,
  shouldShowPopup,
  validatePopup,
  type PopupRecord,
} from "./popup-rules";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

const PAGE_A = "abcdefghijklmno";
const PAGE_B = "0123456789abcde";

const RAW = {
  name: "Spring offer",
  content: {
    items: [
      { id: "h", kind: "heading", text: "Spring", level: 2 },
      {
        id: "b",
        kind: "button",
        text: "Shop",
        link: "/shop",
        style: "primary",
        action: "link",
        popup_id: "",
      },
    ],
  },
  trigger: "delay",
  delay_seconds: 5,
  scroll_percent: 50,
  frequency: "once-per-visitor",
  show_on: "all-pages",
  page_ids: [],
  enabled: true,
};

describe("validatePopup", () => {
  it("accepts a valid record and drops unknown keys", () => {
    const out = validatePopup({ ...RAW, id: "x", onclick: "y" });
    expect(Object.keys(out).sort()).toEqual([
      "content",
      "delay_seconds",
      "enabled",
      "frequency",
      "name",
      "page_ids",
      "scroll_percent",
      "show_on",
      "trigger",
    ]);
    expect(out.content.items).toHaveLength(2);
    expect(out.delay_seconds).toBe(5);
  });

  it("rejects two items with the same id (CR-C02)", () => {
    const dup = {
      ...RAW,
      content: {
        items: [
          { id: "i1", kind: "divider" },
          { id: "i1", kind: "divider" },
        ],
      },
    };
    expect(msg(() => validatePopup(dup))).toBe(
      "Two items share the same id. Refresh the page and try again.",
    );
  });

  it("requires a name up to 80 characters", () => {
    expect(msg(() => validatePopup({ ...RAW, name: "  " }))).toBe(
      "Give the pop-up a name.",
    );
    expect(() => validatePopup({ ...RAW, name: "x".repeat(80) })).not.toThrow();
    expect(() => validatePopup({ ...RAW, name: "x".repeat(81) })).toThrow(
      InvalidInput,
    );
  });

  it("bounds the delay to 1-120 seconds", () => {
    expect(() => validatePopup({ ...RAW, delay_seconds: 0 })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, delay_seconds: 121 })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, delay_seconds: 2.5 })).toThrow(
      InvalidInput,
    );
    expect(validatePopup({ ...RAW, delay_seconds: 120 }).delay_seconds).toBe(
      120,
    );
    expect(validatePopup({ ...RAW, delay_seconds: 1 }).delay_seconds).toBe(1);
  });

  it("bounds scroll to 10-100 percent", () => {
    expect(() => validatePopup({ ...RAW, scroll_percent: 5 })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, scroll_percent: 101 })).toThrow(
      InvalidInput,
    );
    expect(validatePopup({ ...RAW, scroll_percent: 100 }).scroll_percent).toBe(
      100,
    );
  });

  it("defaults missing delay and scroll", () => {
    const out = validatePopup({
      ...RAW,
      delay_seconds: undefined,
      scroll_percent: null,
    });
    expect(out.delay_seconds).toBe(5);
    expect(out.scroll_percent).toBe(50);
  });

  it("refuses a pop-up button inside a pop-up", () => {
    expect(() =>
      validatePopup({
        ...RAW,
        content: {
          items: [
            {
              id: "b",
              kind: "button",
              text: "More",
              link: "",
              style: "primary",
              action: "popup",
              popup_id: "other",
            },
          ],
        },
      }),
    ).toThrow(InvalidInput);
  });

  it("rejects an unknown trigger, frequency or show_on", () => {
    expect(msg(() => validatePopup({ ...RAW, trigger: "hover" }))).toBe(
      "Choose when the pop-up appears.",
    );
    expect(() => validatePopup({ ...RAW, trigger: undefined })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, frequency: "daily" })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, show_on: "home" })).toThrow(
      InvalidInput,
    );
  });

  it("validates and deduplicates page ids", () => {
    const out = validatePopup({
      ...RAW,
      show_on: "selected-pages",
      page_ids: [PAGE_A, PAGE_B, PAGE_A],
    });
    expect(out.page_ids).toEqual([PAGE_A, PAGE_B]);
    expect(() =>
      validatePopup({ ...RAW, page_ids: ["../etc/passwd"] }),
    ).toThrow(InvalidInput);
    expect(() => validatePopup({ ...RAW, page_ids: "abc" })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, page_ids: [42] })).toThrow(
      InvalidInput,
    );
  });

  it("needs at least one page for selected-pages", () => {
    expect(
      msg(() =>
        validatePopup({ ...RAW, show_on: "selected-pages", page_ids: [] }),
      ),
    ).toBe("Choose at least one page, or show it on every page.");
  });

  it("forces button-only for the click trigger", () => {
    const out = validatePopup({ ...RAW, trigger: "click" });
    expect(out.show_on).toBe("button-only");
  });

  it("rejects malformed content", () => {
    expect(() => validatePopup({ ...RAW, content: { items: "x" } })).toThrow(
      InvalidInput,
    );
    expect(() => validatePopup({ ...RAW, content: [] })).toThrow(InvalidInput);
    expect(validatePopup({ ...RAW, content: undefined }).content).toEqual({
      items: [],
    });
  });

  it("caps items in the pop-up", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      id: `d${i}`,
      kind: "divider",
    }));
    expect(() => validatePopup({ ...RAW, content: { items } })).toThrow(
      InvalidInput,
    );
  });

  it("treats only true as enabled", () => {
    expect(validatePopup({ ...RAW, enabled: 1 }).enabled).toBe(false);
  });
});

describe("popupFrequencyKey", () => {
  it("namespaces the storage key", () => {
    expect(popupFrequencyKey("abc")).toBe("cds-popup:abc");
  });
});

const POPUP: PopupRecord = {
  id: "p1",
  ...validatePopup(RAW),
};

type Input = Parameters<typeof shouldShowPopup>[0];
function input(over: Partial<Input> = {}, p: Partial<PopupRecord> = {}): Input {
  return {
    popup: { ...POPUP, frequency: "every-visit", ...p },
    pageId: PAGE_A,
    event: "auto",
    seen: { session: false, local: false },
    autoAlreadyShown: false,
    finePointer: true,
    ...over,
  };
}

describe("shouldShowPopup", () => {
  it("never shows a disabled pop-up", () => {
    expect(shouldShowPopup(input({}, { enabled: false }))).toBe(false);
    expect(shouldShowPopup(input({ event: "click" }, { enabled: false }))).toBe(
      false,
    );
  });

  it("always opens on click, whatever show_on and frequency say", () => {
    expect(
      shouldShowPopup(
        input(
          {
            event: "click",
            seen: { session: true, local: true },
            autoAlreadyShown: true,
            pageId: PAGE_B,
          },
          {
            frequency: "once-per-visitor",
            show_on: "selected-pages",
            page_ids: [PAGE_A],
          },
        ),
      ),
    ).toBe(true);
  });

  it("does not auto-open a click-trigger pop-up", () => {
    expect(
      shouldShowPopup(input({}, { trigger: "click", show_on: "all-pages" })),
    ).toBe(false);
  });

  it("does not auto-open a button-only pop-up", () => {
    expect(shouldShowPopup(input({}, { show_on: "button-only" }))).toBe(false);
  });

  it("skips exit intent without a fine pointer", () => {
    expect(
      shouldShowPopup(
        input({ finePointer: false }, { trigger: "exit-intent" }),
      ),
    ).toBe(false);
    expect(shouldShowPopup(input({}, { trigger: "exit-intent" }))).toBe(true);
  });

  it("opens only one automatic pop-up per view", () => {
    expect(shouldShowPopup(input({ autoAlreadyShown: true }))).toBe(false);
  });

  it("honours once per session", () => {
    const p = { frequency: "once-per-session" as const };
    expect(
      shouldShowPopup(input({ seen: { session: true, local: false } }, p)),
    ).toBe(false);
    expect(
      shouldShowPopup(input({ seen: { session: false, local: true } }, p)),
    ).toBe(true);
  });

  it("honours once per visitor", () => {
    const p = { frequency: "once-per-visitor" as const };
    expect(
      shouldShowPopup(input({ seen: { session: false, local: true } }, p)),
    ).toBe(false);
    expect(shouldShowPopup(input({}, p))).toBe(true);
  });

  it("shows every visit regardless of seen flags", () => {
    expect(
      shouldShowPopup(input({ seen: { session: true, local: true } })),
    ).toBe(true);
  });

  it("targets selected pages only", () => {
    const p = {
      show_on: "selected-pages" as const,
      page_ids: [PAGE_A],
    };
    expect(shouldShowPopup(input({ pageId: PAGE_B }, p))).toBe(false);
    expect(shouldShowPopup(input({ pageId: PAGE_A }, p))).toBe(true);
  });
});

describe("popupSummary", () => {
  it("matches the UI-SPEC example", () => {
    expect(popupSummary(POPUP)).toBe(
      "After 5 seconds · Once per visitor · Every page",
    );
  });

  it("describes each trigger", () => {
    expect(popupSummary({ ...POPUP, delay_seconds: 1 })).toBe(
      "After 1 second · Once per visitor · Every page",
    );
    expect(
      popupSummary({
        ...POPUP,
        trigger: "scroll",
        frequency: "every-visit",
        show_on: "selected-pages",
        page_ids: [PAGE_A, PAGE_B],
      }),
    ).toBe("At 50% scrolled · Every visit · 2 pages");
    expect(
      popupSummary({
        ...POPUP,
        trigger: "exit-intent",
        frequency: "once-per-session",
        show_on: "selected-pages",
        page_ids: [PAGE_A],
      }),
    ).toBe("When leaving · Once per session · 1 page");
    expect(popupSummary({ ...POPUP, trigger: "page-load" })).toBe(
      "When the page opens · Once per visitor · Every page",
    );
    expect(
      popupSummary({ ...POPUP, trigger: "click", show_on: "button-only" }),
    ).toBe("Opens from a button");
  });
});
