// The curated font catalog (CONTEXT A2-Q4, D-UI-P4-5; UI-SPEC "Font catalog"). A theme names
// a catalog family; anything else fails import with the nearest suggestion. Themes choose
// families only: weights (400, 600) and line heights stay fixed in CSS (D-UI-P4-3).
// Every family-name string lives here in packages/core, never in a directory the impeccable
// detector scans (RESEARCH Pitfall 10). Pure and Edge-safe.

export type FontClass = "serif" | "sans";
export type FontRole = "heading" | "body";

export type FontEntry = {
  /** What a theme writes. */
  name: string;
  /** The @font-face family, or null for a system stack (no download). */
  cssFamily: string | null;
  /** The OFL variable package that ships the woff2, or null for a system stack. */
  pkg: string | null;
  class: FontClass;
  /** Display faces are heading-only. */
  display: boolean;
  roles: readonly FontRole[];
  italic: boolean;
};

/** The P3 system sans stack (apps/web/app/globals.css --hub-font). */
export const SANS_FALLBACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const SERIF_FALLBACK = 'ui-serif, Georgia, "Times New Roman", serif';

const HEADING: readonly FontRole[] = ["heading"];
const BOTH: readonly FontRole[] = ["heading", "body"];

// prettier-ignore
export const FONT_CATALOG: readonly FontEntry[] = [
  { name: "Fraunces", cssFamily: "Fraunces Variable",
    pkg: "@fontsource-variable/fraunces", class: "serif", display: true, roles: HEADING, italic: false },
  { name: "Newsreader", cssFamily: "Newsreader Variable",
    pkg: "@fontsource-variable/newsreader", class: "serif", display: false, roles: BOTH, italic: true },
  { name: "Source Serif 4", cssFamily: "Source Serif 4 Variable",
    pkg: "@fontsource-variable/source-serif-4", class: "serif", display: false, roles: BOTH, italic: true },
  { name: "Literata", cssFamily: "Literata Variable",
    pkg: "@fontsource-variable/literata", class: "serif", display: false, roles: BOTH, italic: true },
  { name: "Bricolage Grotesque", cssFamily: "Bricolage Grotesque Variable",
    pkg: "@fontsource-variable/bricolage-grotesque", class: "sans", display: true, roles: HEADING, italic: false },
  { name: "Archivo", cssFamily: "Archivo Variable",
    pkg: "@fontsource-variable/archivo", class: "sans", display: false, roles: BOTH, italic: true },
  { name: "Public Sans", cssFamily: "Public Sans Variable",
    pkg: "@fontsource-variable/public-sans", class: "sans", display: false, roles: BOTH, italic: true },
  { name: "Figtree", cssFamily: "Figtree Variable",
    pkg: "@fontsource-variable/figtree", class: "sans", display: false, roles: BOTH, italic: true },
  { name: "Work Sans", cssFamily: "Work Sans Variable",
    pkg: "@fontsource-variable/work-sans", class: "sans", display: false, roles: BOTH, italic: true },
  { name: "Instrument Sans", cssFamily: "Instrument Sans Variable",
    pkg: "@fontsource-variable/instrument-sans", class: "sans", display: false, roles: BOTH, italic: true },
  { name: "System Sans", cssFamily: null, pkg: null, class: "sans", display: false, roles: BOTH, italic: true },
  { name: "System Serif", cssFamily: null, pkg: null, class: "serif", display: false, roles: BOTH, italic: true },
];

/** Body faces suggested when a display face is written as the body font (UI-SPEC pairings). */
const BODY_PAIRINGS: Readonly<Record<string, readonly [string, string]>> = {
  Fraunces: ["Source Serif 4", "Newsreader"],
  "Bricolage Grotesque": ["Figtree", "Instrument Sans"],
};

/** Case-insensitive exact match on the catalog name. */
export function findFont(name: string): FontEntry | null {
  if (typeof name !== "string") return null;
  const key = name.trim().toLowerCase();
  if (key === "") return null;
  return FONT_CATALOG.find((f) => f.name.toLowerCase() === key) ?? null;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/** The closest catalog family allowed in `role`; ties go to catalog order. */
export function nearestFont(name: string, role: FontRole): FontEntry {
  const key = String(name).trim().toLowerCase().slice(0, 100);
  let best: FontEntry | null = null;
  let bestDist = Infinity;
  for (const f of FONT_CATALOG) {
    if (!f.roles.includes(role)) continue;
    const d = levenshtein(key, f.name.toLowerCase());
    if (d < bestDist) {
      best = f;
      bestDist = d;
    }
  }
  // The catalog always holds body-capable families, so best is never null.
  return best as FontEntry;
}

/** Two same-class body faces to suggest in place of a display face. */
export function bodySuggestions(name: string): string[] {
  const f = findFont(name);
  if (f === null) return [];
  const paired = BODY_PAIRINGS[f.name];
  if (paired) return [...paired];
  return FONT_CATALOG.filter(
    (e) =>
      e.class === f.class &&
      e.roles.includes("body") &&
      e.pkg !== null &&
      e.name !== f.name,
  )
    .slice(0, 2)
    .map((e) => e.name);
}

/** The CSS font-family value for a catalog family, or null when it is not in the catalog. */
export function fontStack(name: string): string | null {
  const f = findFont(name);
  if (f === null) return null;
  const fallback = f.class === "serif" ? SERIF_FALLBACK : SANS_FALLBACK;
  return f.cssFamily === null ? fallback : `"${f.cssFamily}", ${fallback}`;
}
