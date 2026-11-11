// FAQ block (owner 07-07; CONT-27; feeds 07-30's FAQPage JSON-LD; T-07-07-03, T-07-07-04).
//
// Questions are plain text; answers are rich-text html, cleaned at save and publish
// through mapRichText (CONT-09). An answer without a question is refused; a fully blank
// pair is a saveable draft and is skipped publicly (faqEntries). Renderer and editor: 07-21.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no Node built-ins, no html cleaner, no next/* imports.
import { InvalidInput } from "../../errors";
import { newId } from "../columns";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import { isRichTextEmpty } from "../plain-text";
import type { SectionTypeDefinition } from "../registry";
import { assertUniqueItemIds } from "../validate";
import {
  asRecord,
  isRecord,
  own,
  richText,
  safeId,
  text,
} from "../validate-helpers";

export type FaqItem = {
  id: string;
  question: string;
  /** Rich-text html. */
  answer: string;
};

export type FaqBlockContent = {
  heading: string;
  open_first: boolean;
  items: FaqItem[];
};

export const FAQ_HEADING_MAX = 120;
export const FAQ_MAX_ITEMS = 30;
export const FAQ_QUESTION_MAX = 300;
export const FAQ_LIMIT_COPY = "Keep this to 30 questions or fewer.";
export const FAQ_QUESTION_COPY = "Add the question for this answer.";

export function defaultFaqBlock(): FaqBlockContent {
  return {
    heading: "Questions and answers",
    open_first: false,
    items: [{ id: newId(), question: "", answer: "" }],
  };
}

export function validateFaqBlock(value: unknown): FaqBlockContent {
  const raw = asRecord(value);
  const rawItems = own(raw, "items");
  const list: unknown[] = Array.isArray(rawItems) ? rawItems : [];
  if (list.length > FAQ_MAX_ITEMS) throw new InvalidInput(FAQ_LIMIT_COPY);
  const items: FaqItem[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const question = text(entry, "question", FAQ_QUESTION_MAX);
    const answer = richText(entry, "answer");
    if (question === "" && !isRichTextEmpty(answer)) {
      throw new InvalidInput(FAQ_QUESTION_COPY);
    }
    items.push({ id: safeId(own(entry, "id")), question, answer });
  }
  assertUniqueItemIds(items);
  const of = own(raw, "open_first");
  return {
    heading: text(raw, "heading", FAQ_HEADING_MAX),
    open_first: typeof of === "boolean" ? of : false,
    items,
  };
}

function itemsOf(content: unknown): FaqItem[] {
  return isRecord(content) && Array.isArray(content.items)
    ? (content.items.filter(isRecord) as unknown as FaqItem[])
    : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Items with a question and a non-empty answer (renderer + FAQPage JSON-LD). */
export function faqEntries(content: FaqBlockContent): FaqItem[] {
  return itemsOf(content).filter(
    (i) => str(i.question).trim() !== "" && !isRichTextEmpty(str(i.answer)),
  );
}

export const faqSection: SectionTypeDefinition = {
  type: "faq",
  label: "FAQ",
  description: "Questions visitors can open one at a time",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultFaqBlock(),
  validate: (raw) => validateFaqBlock(raw),
  mapRichText: (content, fn) => {
    if (!isRecord(content)) return content;
    return {
      ...content,
      items: itemsOf(content).map((i) => ({ ...i, answer: fn(str(i.answer)) })),
    };
  },
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? str(content.heading) : "",
      ...itemsOf(content).flatMap((i) => [str(i.question), str(i.answer)]),
    ]),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => ({ popups: [], forms: [], media: [] }),
};
