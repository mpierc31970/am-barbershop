// The bell's Needs-you keys (11-21; DASH-37; D313). Alerts that mirror a Needs-you item clear
// themselves when their key is no longer in the person's Needs-you list. Two cases would
// clear an alert wrongly, so their keys count as still present:
// - a provider that failed this request (`failed[]`): its items are unknown, never "done";
// - the inbox list hit its 20-item cap: an unread message past the cap is not in the list.
// Server only (layout and /hub/api/alerts). Never throws.
/** The Needs-you result as the layout and the bell API hold it. */
export type BellNeedsYou = {
  items: readonly { key: string }[];
  failed: readonly string[];
};

/**
 * The inbox Needs-you list's cap (@cds/db NEEDS_YOU_INBOX_MAX). Kept as a literal so tests
 * that mock @cds/db still load this module; test/bell-cap.test.ts fails on drift (IN-C04).
 */
export const INBOX_NEEDS_YOU_CAP = 20;

/** Key prefix of each core provider's items. */
const PROVIDER_PREFIX: Readonly<Record<string, string>> = Object.freeze({
  inbox: "inbox:",
  billing: "billing:",
  stripe: "connect:",
  agreement: "agreement:",
  intake: "intake:",
  email: "email:",
  // 12-24: the support provider (still named `cds`) keys its items `support:...`, so a failed
  // support read keeps its bell rows. `cds:document:` / `cds:notice:` rows are plain alerts.
  cds: "support:",
});

/** Every core key namespace (provider prefixes plus the plain `cds:` alerts). */
const CORE_KEY_PREFIXES: readonly string[] = Object.freeze([
  ...Object.values(PROVIDER_PREFIX),
  "cds:",
]);

/**
 * A Set (so `@cds/db` listBell / bellCounts accept it as-is) whose `has` also answers true for
 * keys under a prefix that must not clear this request.
 */
class BellKeySet extends Set<string> {
  readonly keep: readonly string[];
  readonly keepAddons: boolean;

  constructor(
    keys: Iterable<string>,
    keep: readonly string[],
    keepAddons: boolean,
  ) {
    super(keys);
    this.keep = keep;
    this.keepAddons = keepAddons;
  }

  override has(key: string): boolean {
    if (super.has(key)) return true;
    if (typeof key !== "string") return false;
    if (this.keep.some((p) => key.startsWith(p))) return true;
    // "addons" failed: every add-on key (not a core prefix) is kept.
    return (
      this.keepAddons &&
      key.includes(":") &&
      !CORE_KEY_PREFIXES.some((p) => key.startsWith(p))
    );
  }
}

export function bellKeysFrom(needsYou: BellNeedsYou): ReadonlySet<string> {
  const keys = needsYou.items.map((i) => i.key);
  const keep: string[] = [];
  let keepAddons = false;
  for (const f of needsYou.failed) {
    if (f === "addons") keepAddons = true;
    else if (f.startsWith("addon:")) keep.push(`${f.slice("addon:".length)}:`);
    else if (PROVIDER_PREFIX[f]) keep.push(PROVIDER_PREFIX[f]);
  }
  const inbox = keys.filter((k) => k.startsWith("inbox:")).length;
  if (inbox >= INBOX_NEEDS_YOU_CAP) keep.push("inbox:");
  return new BellKeySet(keys, keep, keepAddons);
}
