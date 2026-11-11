// FAQ block (07-07; CONT-27; T-07-07-03, T-07-07-04).
import { describe, expect, it, vi } from "vitest";
import { InvalidInput } from "../../errors";
import { FULL_WIDTH_ONLY } from "../layouts";
import {
  FAQ_MAX_ITEMS,
  defaultFaqBlock,
  faqEntries,
  faqSection,
  validateFaqBlock,
} from "./faq";

function msg(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidInput);
    return (e as Error).message;
  }
  throw new Error("expected a throw");
}

describe("faq content", () => {
  it("default: one empty item, fresh ids, validates", () => {
    const d = defaultFaqBlock();
    expect(d.heading).toBe("Questions and answers");
    expect(d.open_first).toBe(false);
    expect(d.items).toEqual([{ id: d.items[0]!.id, question: "", answer: "" }]);
    expect(defaultFaqBlock().items[0]!.id).not.toBe(d.items[0]!.id);
    expect(validateFaqBlock(d)).toEqual(d);
  });

  it("refuses 31 questions", () => {
    const items = Array.from({ length: FAQ_MAX_ITEMS + 1 }, () => ({
      question: "q",
      answer: "<p>a</p>",
    }));
    expect(msg(() => validateFaqBlock({ items }))).toBe(
      "Keep this to 30 questions or fewer.",
    );
  });

  it("an answer without a question is refused; blank pairs pass", () => {
    expect(
      msg(() =>
        validateFaqBlock({ items: [{ question: " ", answer: "<p>a</p>" }] }),
      ),
    ).toBe("Add the question for this answer.");
    expect(() =>
      validateFaqBlock({ items: [{ question: "", answer: "<p></p>" }] }),
    ).not.toThrow();
  });

  it("duplicate ids are refused; non-object items skipped; keys dropped", () => {
    expect(() =>
      validateFaqBlock({
        items: [
          { id: "a", question: "q" },
          { id: "a", question: "r" },
        ],
      }),
    ).toThrow(InvalidInput);
    const v = validateFaqBlock({
      open_first: true,
      evil: 1,
      items: [5, null, { id: "ok", question: " Q ", answer: "<p>A</p>", x: 1 }],
    });
    expect(v).toEqual({
      heading: "",
      open_first: true,
      items: [{ id: "ok", question: "Q", answer: "<p>A</p>" }],
    });
    expect(validateFaqBlock({ items: "x" }).items).toEqual([]);
  });

  it("faqEntries skips blank questions and empty answers", () => {
    const v = validateFaqBlock({
      items: [
        { id: "a", question: "One", answer: "<p>Yes</p>" },
        { id: "b", question: "Two", answer: "<p><br></p>" },
        { id: "c", question: "", answer: "" },
      ],
    });
    expect(faqEntries(v).map((i) => i.id)).toEqual(["a"]);
    expect(faqEntries(null as never)).toEqual([]);
  });
});

describe("faqSection", () => {
  it("mapRichText runs fn once per answer", () => {
    const v = validateFaqBlock({
      items: [
        { id: "a", question: "One", answer: "<p>1</p>" },
        { id: "b", question: "Two", answer: "<p>2</p>" },
      ],
    });
    const fn = vi.fn((h: string) => h.toUpperCase());
    const out = faqSection.mapRichText(v, fn) as typeof v;
    expect(fn).toHaveBeenCalledTimes(2);
    expect(out.items.map((i) => i.answer)).toEqual(["<P>1</P>", "<P>2</P>"]);
    expect(v.items[0]!.answer).toBe("<p>1</p>");
    for (const bad of [null, undefined, 5, "x", [], { items: [5] }]) {
      expect(() => faqSection.mapRichText(bad, fn)).not.toThrow();
    }
  });

  it("contract", () => {
    expect(faqSection.type).toBe("faq");
    expect(faqSection.label).toBe("FAQ");
    expect(faqSection.layouts).toEqual(FULL_WIDTH_ONLY);
    expect(faqSection.headings).toEqual({ ownsH1: false, blockHeading: "h2" });
    expect(faqSection.refsOf({})).toEqual({ popups: [], forms: [], media: [] });
    const v = validateFaqBlock({
      heading: "H",
      items: [{ id: "a", question: "Q", answer: "<p>A</p>" }],
    });
    expect(faqSection.textsOf(v)).toEqual(["H", "Q", "<p>A</p>"]);
    expect(faqSection.urlsOf(v)).toEqual([]);
    for (const bad of [null, undefined, 5, "x", [], { items: [5] }]) {
      expect(() => faqSection.textsOf(bad)).not.toThrow();
      expect(() => faqSection.urlsOf(bad)).not.toThrow();
    }
  });
});
