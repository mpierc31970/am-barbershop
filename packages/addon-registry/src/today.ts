// Add-on Today providers (DASH-21; invariant 4; 11-08). Pure: the caller passes the registry,
// the server modules (ADDON_SERVER, i.e. SERVER_MODULES) and the org's active and paused
// slugs, so platform code reaches add-on `today` exports through the registry only and only
// for add-ons that are active and not paused by a billing lapse (invariant 9).
// Erasable TypeScript only: loaded by @cds/addon-registry/server.
import type { AddonManifest, AddonRegistry } from "@cds/core/addons";
import type { TodayCardSpec } from "@cds/core/today";
import type { AddonServerModule, AddonServerToday } from "./types";

/** The slice of a server module the Today helpers read. */
export type TodayServerModules = Readonly<
  Record<string, Partial<Pick<AddonServerModule, "today">> | undefined>
>;

/** One active add-on's Today contribution; only the providers its manifest declares. */
export type TodayProvider = {
  slug: string;
  /** The manifest's card id and title, for card order and hiding (defaultCardOrder). */
  cardSpec?: TodayCardSpec;
  card?: NonNullable<AddonServerToday["card"]>;
  needsYou?: NonNullable<AddonServerToday["needsYou"]>;
};

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/**
 * Today providers for the org's active add-ons, in registry order. Paused, inactive and unknown
 * slugs give nothing; a provider is returned only when the manifest declares it and the server
 * module exports it.
 */
export function activeTodayProviders(
  registry: Pick<AddonRegistry, "list">,
  serverModules: TodayServerModules,
  activeSlugs: readonly string[],
  pausedSlugs: readonly string[] = [],
): TodayProvider[] {
  const active = new Set(activeSlugs);
  const paused = new Set(pausedSlugs);
  const out: TodayProvider[] = [];
  for (const m of registry.list()) {
    if (!active.has(m.slug) || paused.has(m.slug)) continue;
    if (!hasOwn(serverModules, m.slug)) continue;
    const today = serverModules[m.slug]?.today;
    const p: TodayProvider = { slug: m.slug };
    if (m.today?.card && typeof today?.card === "function") {
      p.cardSpec = { id: m.today.card.id, title: m.today.card.title };
      p.card = today.card;
    }
    if (m.today?.needsYou === true && typeof today?.needsYou === "function") {
      p.needsYou = today.needsYou;
    }
    if (p.card || p.needsYou) out.push(p);
  }
  return out;
}

/**
 * The server-export half of the manifest `today` contract (core cannot import add-on server
 * modules, so compose checks the manifest and this checks the pair). Throws naming the slug.
 */
export function assertTodayExports(
  manifest: Pick<AddonManifest, "slug" | "today">,
  serverModule: Partial<Pick<AddonServerModule, "today">> | undefined,
): void {
  const slug = manifest.slug;
  const today = serverModule?.today;
  const fail = (rule: string): never => {
    throw new Error(`add-on "${slug}": ${rule}`);
  };
  if (manifest.today?.card && typeof today?.card !== "function") {
    fail("manifest declares today.card but the server entry has no today.card");
  }
  if (
    manifest.today?.needsYou === true &&
    typeof today?.needsYou !== "function"
  ) {
    fail(
      "manifest declares today.needsYou but the server entry has no today.needsYou",
    );
  }
  if (today?.card !== undefined && !manifest.today?.card) {
    fail("server today.card is not declared in the manifest (today.card)");
  }
  if (today?.needsYou !== undefined && manifest.today?.needsYou !== true) {
    fail(
      "server today.needsYou is not declared in the manifest (today.needsYou)",
    );
  }
}
