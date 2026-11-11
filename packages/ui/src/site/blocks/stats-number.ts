// Stats number parsing and formatting (07-21; CONT-27, D-UI-P7-27).
//
// The count-up animates from 0 to a stat's typed value ("250", "1,200", "4.9") and must
// print exactly that value on its last frame. Formatting is hand-rolled (toFixed + manual
// grouping), never Intl, so every runtime prints the same characters (like formatCount).
// Pure and Edge-safe.
import { STATS_VALUE } from "@cds/core/content";

export interface StatsNumberParts {
  /** The numeric value ("1,200" -> 1200). */
  target: number;
  /** Decimal places as typed ("4.9" -> 1). */
  decimals: number;
  /** True when the typed value used thousands commas. */
  grouped: boolean;
}

/** Parse a typed stat value; null when it is blank or not a stat number. */
export function statsNumberParts(value: string): StatsNumberParts | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (v === "" || !STATS_VALUE.test(v)) return null;
  const dot = v.indexOf(".");
  const decimals = dot === -1 ? 0 : v.length - dot - 1;
  const target = Number(v.replace(/,/g, ""));
  if (!Number.isFinite(target)) return null;
  return { target, decimals, grouped: v.includes(",") };
}

/** Format n with the typed value's decimals and grouping ("1,234.5"). */
export function formatStatsNumber(
  n: number,
  parts: Pick<StatsNumberParts, "decimals" | "grouped">,
): string {
  const safe = Number.isFinite(n) && n > 0 ? n : 0;
  const fixed = safe.toFixed(parts.decimals);
  if (!parts.grouped) return fixed;
  const [int, frac] = fixed.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}
