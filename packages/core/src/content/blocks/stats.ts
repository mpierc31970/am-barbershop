// Stats block (owner 07-06; CONT-27; CONTEXT decisions 1, 2 and 5).
//
// 2-6 numbers, each a value + optional prefix/suffix + label. The value is a string, kept
// as typed ("1,200", "4.9"); 07-21's CountUp parses it. Minimum count and "incomplete item"
// rules are editor/renderer rules (UI-SPEC: incomplete items are skipped publicly), not
// validator refusals, so drafts stay saveable. Renderer and editor: 07-21.
// Deny by default: fresh objects, own-property reads, trimmed and capped strings.
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import { newId } from "../columns";
import { nonEmpty } from "../items/walk";
import { FULL_WIDTH_ONLY } from "../layouts";
import type { SectionTypeDefinition } from "../registry";
import { asRecord, isRecord, own, safeId, text } from "../validate-helpers";
import { assertUniqueIds, bool, boundedArray, noRefs } from "./helpers-a";

export type StatsItem = {
  id: string;
  /** Digits as typed ("250", "1,200", "4.9"); "" while a draft. */
  value: string;
  prefix: string;
  suffix: string;
  label: string;
};

export type StatsContent = {
  heading: string;
  count_up: boolean;
  items: StatsItem[];
};

/** minItems is an editor rule (UI-SPEC "2-6 items"), not enforced by the validator. */
export const STATS_LIMITS = Object.freeze({
  minItems: 2,
  maxItems: 6,
  startItems: 3,
  valueMax: 15,
  prefixMax: 4,
  suffixMax: 8,
  labelMax: 80,
} as const);

/** A stat number: digits, optional thousands commas, up to two decimals ("" allowed separately). */
export const STATS_VALUE = /^\d{1,3}(?:,?\d{3})*(?:\.\d{1,2})?$/;

const OVER_COPY = "Stats hold up to 6 numbers.";
const VALUE_COPY = "Use digits for the number, like 250, 1,200 or 4.9.";

function newStat(): StatsItem {
  return { id: newId(), value: "0", prefix: "", suffix: "", label: "" };
}

export function defaultStatsContent(): StatsContent {
  return {
    heading: "",
    count_up: true,
    items: Array.from({ length: STATS_LIMITS.startItems }, newStat),
  };
}

function validateItem(value: unknown): StatsItem {
  const raw = asRecord(value);
  const v = text(raw, "value", STATS_LIMITS.valueMax);
  if (v !== "" && !STATS_VALUE.test(v)) throw new InvalidInput(VALUE_COPY);
  return {
    id: safeId(own(raw, "id")),
    value: v,
    prefix: text(raw, "prefix", STATS_LIMITS.prefixMax),
    suffix: text(raw, "suffix", STATS_LIMITS.suffixMax),
    label: text(raw, "label", STATS_LIMITS.labelMax),
  };
}

export function validateStatsContent(value: unknown): StatsContent {
  const raw = asRecord(value);
  const items = boundedArray(
    raw,
    "items",
    STATS_LIMITS.maxItems,
    OVER_COPY,
  ).map(validateItem);
  assertUniqueIds(items);
  return {
    heading: text(raw, "heading"),
    count_up: bool(raw, "count_up", true),
    items,
  };
}

function itemsOf(content: unknown): StatsItem[] {
  return isRecord(content) && Array.isArray(content.items)
    ? (content.items.filter(isRecord) as StatsItem[])
    : [];
}

export const statsSection: SectionTypeDefinition = {
  type: "stats",
  label: "Stats",
  description: "A few numbers worth knowing",
  layouts: FULL_WIDTH_ONLY,
  defaultContent: () => defaultStatsContent(),
  validate: (raw) => validateStatsContent(raw),
  mapRichText: (content) => ({ ...(content as StatsContent) }),
  textsOf: (content) =>
    nonEmpty([
      isRecord(content) ? (content.heading as string) : "",
      ...itemsOf(content).flatMap((i) => [
        i.prefix,
        i.value,
        i.suffix,
        i.label,
      ]),
    ]),
  urlsOf: () => [],
  headings: { ownsH1: false, blockHeading: "h2" },
  refsOf: () => noRefs(),
};
