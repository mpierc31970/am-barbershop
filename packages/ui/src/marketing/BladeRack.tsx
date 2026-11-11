// Owner: 15-10 (P15-P1). BladeRack: the /add-ons grid of upright blades (UI-SPEC "Add-ons" rack,
// "Fixed dimensions"): 4 / 3 / 2 columns at >= 1280 / >= 1024 / >= 640px, row blades below 640px.
// Available blades carry "Add to my site" -> /start?addon=<slug> (A1-Q1, HUB-02 entry) as their own
// focus stop above the stretched name link; coming-soon blades have no link and no Add button, and
// their chip is a 2px outline in its ring colour.
import { Blade, type BladeData } from "./Blade";

export type BladeRackProps = {
  blades: readonly BladeData[];
  /** Blade name heading level: 3 under a section H2 (default), 2 directly under the page H1. */
  headingLevel?: 2 | 3;
  "aria-label"?: string;
  className?: string;
};

/** The rack Add target for one blade: /start?addon=<slug>, or null when it has no Add button. */
export function rackAddHref(blade: BladeData): string | null {
  if (blade.status === "coming_soon" || blade.href === null) return null;
  if (blade.addHref !== undefined) return blade.addHref;
  return `/start?addon=${encodeURIComponent(blade.key)}`;
}

export function BladeRack({
  blades,
  headingLevel = 3,
  "aria-label": ariaLabel,
  className,
}: BladeRackProps) {
  return (
    <ul
      aria-label={ariaLabel}
      className={[
        "m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {blades.map((b) => (
        <li key={b.key} className="min-w-0">
          <Blade
            data={{ ...b, addHref: rackAddHref(b) }}
            orientation="upright"
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
