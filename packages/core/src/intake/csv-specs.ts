// Team and Services CSV columns for the P5 engine (D120, UI-SPEC "Team, Services"). Pure. Each
// parse returns owner-facing "what + how" copy; the engine prefixes "Row N: ". Parsed rows still
// go through validateTeamMember / validateService on commit.
import type { CsvColumn, CsvParsed, CsvSpec } from "../csv/types";
import { SERVICE_DURATIONS, type PriceDisplay } from "./validate";

const ok = (value: unknown): CsvParsed => ({ ok: true, value });
const fail = (message: string): CsvParsed => ({ ok: false, message });
const str = (v: unknown) =>
  v === null || v === undefined ? "" : typeof v === "string" ? v : String(v);

function maxText(max: number, label: string) {
  return (raw: string): CsvParsed => {
    const t = raw.trim();
    return t.length > max
      ? fail(`${label} is longer than ${max} characters. Shorten it.`)
      : ok(t);
  };
}

const YES = new Set(["yes", "y", "true", "1"]);
const NO = new Set(["no", "n", "false", "0"]);

function yesNo(label: string, fallback: boolean) {
  return (raw: string): CsvParsed => {
    const t = raw.trim().toLowerCase();
    if (t === "") return ok(fallback);
    if (YES.has(t)) return ok(true);
    if (NO.has(t)) return ok(false);
    return fail(`${label} must be yes or no.`);
  };
}
const yesNoFormat = (v: unknown) => (v === false ? "no" : "yes");

const showOnSite: CsvColumn = {
  key: "is_published",
  label: "Show on site",
  required: false,
  example: "yes",
  parse: yesNo("Show on site", true),
  format: yesNoFormat,
};

export const TEAM_CSV: CsvSpec = {
  collection: "team_members",
  columns: [
    {
      key: "name",
      label: "Name",
      required: true,
      example: "Maria Lopez",
      parse: maxText(80, "Name"),
      format: str,
    },
    {
      key: "role",
      label: "Role",
      required: false,
      example: "Owner",
      parse: maxText(80, "Role"),
      format: str,
    },
    {
      key: "bio",
      label: "Bio",
      required: false,
      example: "Maria has baked sourdough in Austin for twelve years.",
      parse: maxText(600, "Bio"),
      format: str,
    },
    showOnSite,
  ],
  naturalKey: ["name"],
  singular: "team member",
  plural: "team members",
};

const PRICE_TYPES: Readonly<Record<string, PriceDisplay>> = {
  fixed: "fixed",
  "fixed price": "fixed",
  from: "from",
  "starting at": "from",
  free: "free",
  ask: "ask",
  "ask for a price": "ask",
};
const PRICE_LABELS: Readonly<Record<PriceDisplay, string>> = {
  fixed: "Fixed",
  from: "Starting at",
  free: "Free",
  ask: "Ask",
};

function parsePriceType(raw: string): CsvParsed {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (t === "") return ok("fixed");
  const v = Object.hasOwn(PRICE_TYPES, t) ? PRICE_TYPES[t] : undefined;
  return v
    ? ok(v)
    : fail("Price type must be Fixed, Starting at, Free or Ask.");
}

function parsePrice(raw: string): CsvParsed {
  const t = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (t === "") return ok(null);
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(t)) {
    return fail("Price must be a number, like 45 or 45.00.");
  }
  const [whole, frac = ""] = t.split(".");
  return ok(Number(whole) * 100 + Number(frac.padEnd(2, "0")));
}

function formatPrice(v: unknown): string {
  if (typeof v !== "number" || !Number.isInteger(v)) return "";
  return `${Math.floor(v / 100)}.${String(v % 100).padStart(2, "0")}`;
}

function parseDuration(raw: string): CsvParsed {
  const t = raw.trim();
  if (t === "") return ok(null);
  const n = Number(t);
  return (SERVICE_DURATIONS as readonly number[]).includes(n)
    ? ok(n)
    : fail("Duration must be 15, 30, 45, 60, 75, 90 or 120 minutes, or empty.");
}

export const SERVICES_CSV: CsvSpec = {
  collection: "services",
  columns: [
    {
      key: "name",
      label: "Name",
      required: true,
      example: "Haircut",
      parse: maxText(80, "Name"),
      format: str,
    },
    {
      key: "description",
      label: "Description",
      required: false,
      example: "Wash, cut and style.",
      parse: maxText(600, "Description"),
      format: str,
    },
    {
      key: "price_display",
      label: "Price type",
      required: false,
      example: "Starting at",
      parse: parsePriceType,
      format: (v) =>
        typeof v === "string" && Object.hasOwn(PRICE_LABELS, v)
          ? PRICE_LABELS[v as PriceDisplay]
          : "",
    },
    {
      key: "price_cents",
      label: "Price",
      required: false,
      example: "45.00",
      parse: parsePrice,
      format: formatPrice,
    },
    {
      key: "duration_minutes",
      label: "Duration in minutes",
      required: false,
      example: "60",
      parse: parseDuration,
      format: (v) => (typeof v === "number" ? String(v) : ""),
    },
    showOnSite,
  ],
  naturalKey: ["name"],
  singular: "service",
  plural: "services",
};
