// Owner: 15-05 (P15-P1). The closed colour code (UI-SPEC "The closed colour code"). Chips are
// identity, never action. Paths own cobalt / berry (Shop is an outline: not yet dyed); add-ons
// take the ring in number order. Fixed numbers for the three v1.0 add-ons; any other slug gets
// the next number by listing order and the ring colour for that number (deterministic).

export type MkPathChip = "cobalt" | "berry" | "outline";
export type MkAddonChip = "marigold" | "violet" | "teal" | "rose" | "sky";
export type MkChipAssignment = {
  readonly chip: MkAddonChip;
  readonly number: number;
};

export const PATH_CHIPS = {
  standard: "cobalt",
  studio: "berry",
  shop: "outline",
} as const satisfies Record<"standard" | "studio" | "shop", MkPathChip>;

export const ADDON_RING: readonly MkAddonChip[] = [
  "marigold",
  "violet",
  "teal",
  "rose",
  "sky",
] as const;

function ringFor(n: number): MkAddonChip {
  return ADDON_RING[(n - 1) % ADDON_RING.length] as MkAddonChip;
}

/** No. 01-03 in manifest order (UI-SPEC chips). */
const FIXED_ORDER = ["builder-pro", "credentials", "testimonials"] as const;

export const ADDON_CHIPS: Readonly<Record<string, MkChipAssignment>> =
  Object.freeze(
    Object.fromEntries(
      FIXED_ORDER.map((slug, i) => [
        slug,
        { chip: ringFor(i + 1), number: i + 1 },
      ]),
    ),
  );

/**
 * The chip and swatch number of an add-on. Fixed slugs keep theirs; others are numbered after
 * the fixed three in listing order (fixed slugs skipped); a slug not in the listing comes after
 * every listed one.
 */
export function addonChip(
  slug: string,
  listingOrder: readonly string[],
): MkChipAssignment {
  const fixed = ADDON_CHIPS[slug];
  if (fixed) return fixed;
  const others: string[] = [];
  for (const s of listingOrder) {
    if (!(s in ADDON_CHIPS) && !others.includes(s)) others.push(s);
  }
  const idx = others.indexOf(slug);
  const number = FIXED_ORDER.length + 1 + (idx === -1 ? others.length : idx);
  return { chip: ringFor(number), number };
}
