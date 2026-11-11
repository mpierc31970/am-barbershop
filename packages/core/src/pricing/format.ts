// Money formatting and quote-selection validation (ONB-06; UI-SPEC Voice; T-06-01).
// "$1,500" (no cents when whole), "$583.33", "$39/mo", "$390/yr".
import { ADDON_SLUG_RE } from "../addons/constants";
import { InvalidInput } from "../errors";
import type { BillingCadence, QuoteSelections } from "./types";

const WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const FRACTION = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatCents(cents: number): string {
  return cents % 100 === 0
    ? WHOLE.format(cents / 100)
    : FRACTION.format(cents / 100);
}

export function formatMonthly(cents: number): string {
  return `${formatCents(cents)}/mo`;
}

export function formatYearly(cents: number): string {
  return `${formatCents(cents)}/yr`;
}

/** Most items a single list may carry (anonymous client input, T-06-01). */
export const MAX_SELECTION_ITEMS = 40;

const BAD_QUOTE =
  "That quote doesn't look right. Refresh the page and try again.";

function slugList(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > MAX_SELECTION_ITEMS) {
    throw new InvalidInput(BAD_QUOTE);
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || !ADDON_SLUG_RE.test(item)) {
      throw new InvalidInput(BAD_QUOTE);
    }
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

/** Validate and normalise client-sent selections. Throws InvalidInput on a bad shape. */
export function normaliseSelections(raw: unknown): QuoteSelections {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new InvalidInput(BAD_QUOTE);
  }
  const r = raw as Record<string, unknown>;
  const cadence = r["cadence"] ?? "monthly";
  if (cadence !== "monthly" && cadence !== "yearly") {
    throw new InvalidInput(BAD_QUOTE);
  }
  return {
    addons: slugList(r["addons"]),
    extras: slugList(r["extras"]),
    carePlan: Boolean(r["carePlan"]),
    cadence: cadence as BillingCadence,
  };
}

const EXACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Always two decimals: "$39.00", "$1,539.00". Billing statements and invoices (10-UI-SPEC). */
export function formatCentsExact(cents: number): string {
  return EXACT.format(cents / 100);
}
