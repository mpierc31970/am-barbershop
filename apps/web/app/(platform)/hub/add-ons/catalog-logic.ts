// Get add-ons: pure catalog logic (ADDON-05, ADDON-07, ADDON-09; 05-UI-SPEC "Catalog",
// "Detail", "Add and remove", "Copywriting Contract"; D-UI-P5-3). Everything the owner reads
// about an add-on is generated from its manifest here, so a new add-on needs no hub change.
// UI copy never says install, uninstall or entitlement.
import type { OrgRole } from "@cds/core";
import type { AddonManifest, AddonRegistry } from "@cds/core/addons";
import {
  formatCents,
  formatCentsExact,
  formatMonthly,
  formatYearly,
  type CatalogRow,
} from "@cds/core/pricing";

export type WhatItAddsIcon = "FileText" | "LayoutTemplate" | "PanelsTopLeft";

export type AddonRef = { slug: string; name: string };

export type AvailabilityState =
  "can-add" | "added" | "needs" | "conflict" | "not-owner" | "impersonating";

export type Availability = {
  state: AvailabilityState;
  /** Required add-ons (transitively) that are not on the site, in install order. */
  missing: string[];
  /** The active add-on this one can't run alongside. */
  conflictWith: string | null;
};

/** The owner's word for the add-on's items ("testimonials"); the name when it has none. */
export function pluralOf(m: AddonManifest): string {
  const first = Object.values(m.records)[0];
  return first?.plural ?? m.name.toLowerCase();
}

/** "What it adds" lines: the seeded page, the blocks, the hub tab or sidebar item. */
export function whatItAdds(
  m: AddonManifest,
): { icon: WhatItAddsIcon; text: string }[] {
  const lines: { icon: WhatItAddsIcon; text: string }[] = [];
  const page = m.install.page;
  if (page) {
    lines.push({
      icon: "FileText",
      text: `A ${page.title} page at /${page.slug}`,
    });
  }
  for (const s of m.sections) {
    lines.push({
      icon: "LayoutTemplate",
      text: `A ${s.label} block you can place on any page`,
    });
  }
  lines.push({
    icon: "PanelsTopLeft",
    text:
      m.nav.placement === "tab"
        ? `A ${m.nav.label} tab under Website`
        : m.nav.placement === "sidebar"
          ? `A ${m.nav.label} item in the sidebar`
          : // 10-07 choice 1: a manifest-only add-on (Builder Pro) adds no screen.
            `No new screen; it unlocks ${m.nav.unlocks}`,
  });
  return lines;
}

function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "<Category> · Adds a page, a block and a tab" */
export function cardMeta(m: AddonManifest): string {
  const parts: string[] = [];
  if (m.install.page) parts.push("a page");
  if (m.sections.length === 1) parts.push("a block");
  if (m.sections.length > 1) parts.push("blocks");
  if (m.nav.placement === "tab") parts.push("a tab");
  if (m.nav.placement === "sidebar") parts.push("a sidebar item");
  // 10-07 choice 1: nothing to add on screen, so say what it unlocks instead.
  if (parts.length === 0 && m.nav.placement === "none") {
    return `${m.category} · Unlocks ${m.nav.unlocks}`;
  }
  return `${m.category} · Adds ${joinAnd(parts)}`;
}

function refsOf(slugs: readonly string[], registry: AddonRegistry): AddonRef[] {
  const out: AddonRef[] = [];
  for (const slug of slugs) {
    const other = registry.get(slug);
    // Private add-ons are never named to owners (ADDON-09).
    if (!other || other.visibility !== "public") continue;
    out.push({ slug: other.slug, name: other.name });
  }
  return out;
}

/** "Works with" lines. Both empty -> the section is omitted. */
export function worksWith(
  m: AddonManifest,
  registry: AddonRegistry,
): { needs: AddonRef[]; cantUseWith: AddonRef[] } {
  return {
    needs: refsOf(m.requires, registry),
    cantUseWith: refsOf(registry.conflictsOf(m.slug), registry),
  };
}

/** Names for slugs, public or not, for copy about the org's own add-ons. */
export function namesOf(
  slugs: readonly string[],
  registry: AddonRegistry,
): AddonRef[] {
  return slugs.map((slug) => ({
    slug,
    name: registry.get(slug)?.name ?? slug,
  }));
}

/**
 * Every requirement not on the site, transitively, in install order (C-WR-02): a requirement's
 * own requirements come before it, so A needs B needs C gives [C, B]. composeAddonRegistry
 * guarantees `requires` is acyclic; the visited set also keeps a bad registry finite. The
 * add-on itself is never in the list.
 */
export function missingRequirements(
  manifest: AddonManifest,
  active: Iterable<string>,
  registry: Pick<AddonRegistry, "get">,
): string[] {
  const on = new Set(active);
  const seen = new Set<string>([manifest.slug]);
  const out: string[] = [];
  const visit = (slug: string) => {
    if (seen.has(slug)) return;
    seen.add(slug);
    if (on.has(slug)) return;
    for (const r of registry.get(slug)?.requires ?? []) visit(r);
    out.push(slug);
  };
  for (const r of manifest.requires) visit(r);
  return out;
}

/**
 * What the owner can do with this add-on right now. Authority first (only the owner adds,
 * never while staff view as the owner), then whether it is already on, then conflicts (which
 * "Add both" can't fix), then missing requirements.
 */
export function availability(input: {
  manifest: AddonManifest;
  active: readonly string[];
  role: OrgRole;
  impersonating: boolean;
  registry: AddonRegistry;
}): Availability {
  const { manifest, registry } = input;
  const on = new Set(input.active);
  const missing = missingRequirements(manifest, on, registry);
  const conflictWith =
    registry.conflictsOf(manifest.slug).find((c) => on.has(c)) ?? null;
  const base = { missing, conflictWith };
  if (input.role !== "owner") return { state: "not-owner", ...base };
  if (input.impersonating) return { state: "impersonating", ...base };
  if (on.has(manifest.slug)) return { state: "added", ...base };
  if (conflictWith !== null) return { state: "conflict", ...base };
  if (missing.length > 0) return { state: "needs", ...base };
  return { state: "can-add", ...base };
}

export const CATALOG_INTRO =
  "Add features to your site. Each one adds its own tab here and blocks you can place on any page.";

export const NOT_OWNER_COPY = "Only the site owner can add or remove add-ons.";
export const IMPERSONATING_COPY =
  "Add-ons can't be added while you're viewing as the owner. Use the staff console to add one.";

/** The InlineAlert above the header action for a refusal state, or null. */
export function refusalCopy(
  m: AddonManifest,
  a: Availability,
  registry: AddonRegistry,
): { tone: "info" | "warning"; text: string } | null {
  switch (a.state) {
    case "not-owner":
      return { tone: "info", text: NOT_OWNER_COPY };
    case "impersonating":
      return { tone: "info", text: IMPERSONATING_COPY };
    case "conflict": {
      const other = registry.get(a.conflictWith)?.name ?? a.conflictWith;
      return {
        tone: "warning",
        text: `${m.name} can't run alongside ${other}. Remove ${other} first.`,
      };
    }
    case "needs": {
      const names = joinAnd(namesOf(a.missing, registry).map((r) => r.name));
      return {
        tone: "info",
        text: `${m.name} needs ${names}. Add both to your site? ${names} goes on first.`,
      };
    }
    default:
      return null;
  }
}

/** Add confirm copy; the re-add line only when retained items exist. */
export function addDialogCopy(
  m: AddonManifest,
  retained: number,
): { title: string; body: string; restored: string | null } {
  const page = m.install.page !== undefined;
  const block = m.sections.length > 0;
  let body: string;
  if (page && block) {
    body = `It adds a ${m.name} page and a ${m.name} block you can place on any page.`;
  } else if (block) {
    body = `It adds a ${m.name} block you can place on any page.`;
  } else if (page) {
    body = `It adds a ${m.name} page to your site.`;
  } else {
    body = `It adds ${m.name} to your site.`;
  }
  const plural = pluralOf(m);
  let restored: string | null = null;
  if (retained === 1) {
    restored = `Your 1 ${singularOf(m)} comes back as it was.`;
  } else if (retained > 1) {
    restored = `Your ${retained} ${plural} come back as they were.`;
  }
  return { title: `Add ${m.name} to your site?`, body, restored };
}

function singularOf(m: AddonManifest): string {
  const first = Object.values(m.records)[0];
  return first?.singular ?? m.name.toLowerCase();
}

/** "Add both" copy for a missing requirement. */
export function addBothCopy(
  name: string,
  missing: readonly AddonRef[],
): { title: string; body: string } {
  const names = joinAnd(missing.map((r) => r.name));
  return {
    title: `${name} needs ${names}`,
    body: `Add both to your site? ${names} goes on first, then ${name}.`,
  };
}

/** Failure copy when the server gave no specific message (ERR-ADD, ERR-REMOVE). */
export function errAddCopy(name: string): string {
  return `${name} wasn't added, and nothing changed on your site. Try again in a minute.`;
}

/**
 * Add both stopped part way (C-WR-02): the requirements that went on stay on, so the copy
 * says so instead of "nothing changed".
 */
export function errAddPartialCopy(
  name: string,
  added: readonly AddonRef[],
): string {
  const names = joinAnd(added.map((r) => r.name));
  return `${names} ${added.length === 1 ? "was" : "were"} added to your site, but ${name} wasn't. Try again in a minute.`;
}

export function errRemoveCopy(name: string): string {
  return `${name} wasn't removed, and your site hasn't changed. Try again in a minute.`;
}

/** Remove confirm and the Remove section copy. */
export function removeCopy(m: AddonManifest): {
  title: string;
  body: string;
  section: string;
  toast: string;
} {
  const plural = pluralOf(m);
  return {
    title: `Remove ${m.name} from your site?`,
    body: `Its page and blocks stop showing on your site right away. Your ${plural} are kept. Add it back any time and everything returns.`,
    section: `Its page and blocks stop showing on your site. Your ${plural} are kept, so adding it back brings everything back.`,
    toast: `${m.name} was removed. Your ${plural} are kept.`,
  };
}

/** "Newsletter needs Testimonials. Remove Newsletter first." */
export function removeRefusedCopy(
  name: string,
  dependents: readonly AddonRef[],
): string {
  const names = joinAnd(dependents.map((r) => r.name));
  return `${names} ${dependents.length === 1 ? "needs" : "need"} ${name}. Remove ${names} first.`;
}

// ---------------------------------------------------------------------------------------
// P10 prices and paused state (10-31; 10-UI-SPEC "Paused add-ons", "Add-on prices and
// charges"; BILL-03, BILL-18, D27, D264).

/**
 * The card / detail price for an add-on on the org's path, from the one catalog (D264):
 * "$9/mo", "Included" for a $0 row, null when the row is missing or unpriced ("Price coming
 * soon"). Formats only, never sums. An org with no path yet reads the Standard row (10-31
 * choice: the path is chosen at /start, so this only covers old dev orgs).
 */
export function addonPriceLabel(
  rows: readonly CatalogRow[],
  slug: string,
  path: string,
): string | null {
  const cents = addonMonthlyCents(rows, slug, path);
  if (cents === null) return null;
  if (cents === 0) return "Included";
  return formatMonthly(cents);
}

/** The add-on's monthly cents on the org's path; null when missing or unpriced. */
export function addonMonthlyCents(
  rows: readonly CatalogRow[],
  slug: string,
  path: string,
): number | null {
  const p = path === "" ? "standard" : path;
  const row = rows.find(
    (r) => r.itemKind === "addon" && r.itemKey === slug && r.path === p,
  );
  return row?.monthlyCents ?? null;
}

/**
 * The Remove dialog's bill line (UI-SPEC "Add-on prices and charges"): only once checkout
 * is paid and the add-on costs something. The credit itself is the provider's (10-20 note:
 * not previewed), so the line names the item price: the price it is billed at, per its own
 * interval (WR-D04: a yearly owner's bill is yearly).
 */
export function removeBillLine(
  cents: number | null,
  paid: boolean,
  interval: "month" | "year" = "month",
): string | null {
  if (!paid || cents === null || cents <= 0) return null;
  return interval === "year"
    ? `Your yearly bill drops by ${formatCents(cents)}. You get credit for the rest of your year.`
    : `Your monthly bill drops by ${formatCents(cents)}. You get credit for the rest of the month.`;
}

/** Server figures for one add-on (D-UI-P10-14), the browser-safe subset of @cds/db's preview. */
export type AddChargeFigures = {
  todayCents: number;
  setupCents: number;
  prorationCents: number;
  thenCents: number;
  interval: "month" | "year";
  cardLine: string | null;
  beforeCheckout: boolean;
  beforeLaunch: boolean;
};

/** One mini-receipt row: "Today · $3.48" + an optional muted part ("for the rest of October"). */
export type MoneyRow = {
  label: string;
  amount: string;
  detail: string | null;
  strong: boolean;
};

/** The Add confirm's money block, by state (UI-SPEC table; D186, D-UI-P10-14). */
export type AddMoney =
  | { kind: "joins"; note: string }
  | { kind: "included"; note: string }
  | {
      kind: "charge";
      rows: MoneyRow[];
      note: string | null;
      cardLine: string | null;
      todayCents: number;
      /** "Add and pay $28.48". */
      confirmLabel: string;
    };

function perInterval(cents: number, interval: "month" | "year"): string {
  return interval === "year" ? formatYearly(cents) : formatMonthly(cents);
}

/**
 * Formats the server preview into the dialog's rows. Every figure is the server's: this
 * formats and picks words, never adds anything up. `month` is the current month's name in
 * the business time zone ("October"), computed server-side.
 */
export function addMoneyBlock(f: AddChargeFigures, month: string): AddMoney {
  const then = perInterval(f.thenCents, f.interval);
  if (f.beforeCheckout) {
    return {
      kind: "joins",
      note: `It joins your order: ${then} from checkout, no setup fee.`,
    };
  }
  if (f.todayCents <= 0) {
    return {
      kind: "included",
      note:
        f.thenCents > 0
          ? `It's already on your bill at ${then}, so nothing is charged today.`
          : "It's included in your plan, so nothing is charged.",
    };
  }
  const cardLine = f.cardLine
    ? `Plus sales tax. Charged to ${f.cardLine}.`
    : null;
  const confirmLabel = `Add and pay ${formatCentsExact(f.todayCents)}`;
  if (f.beforeLaunch || f.setupCents <= 0) {
    return {
      kind: "charge",
      rows: [
        {
          label: "Today",
          amount: formatCentsExact(f.todayCents),
          detail: `for the rest of ${month}`,
          strong: true,
        },
        { label: "Then", amount: then, detail: null, strong: false },
      ],
      note: f.beforeLaunch ? "No setup fee before your site launches." : null,
      cardLine,
      todayCents: f.todayCents,
      confirmLabel,
    };
  }
  const bill = f.interval === "year" ? "yearly" : "monthly";
  return {
    kind: "charge",
    rows: [
      {
        label: "Setup",
        amount: formatCentsExact(f.setupCents),
        detail: null,
        strong: false,
      },
      {
        label: `Rest of ${month}`,
        amount: formatCentsExact(f.prorationCents),
        detail: null,
        strong: false,
      },
      {
        label: "Today",
        amount: formatCentsExact(f.todayCents),
        detail: null,
        strong: true,
      },
      {
        label: "Then",
        amount: then,
        detail: `on your ${bill} bill`,
        strong: false,
      },
    ],
    note: null,
    cardLine,
    todayCents: f.todayCents,
    confirmLabel,
  };
}

/** UI-SPEC PAUSED-NO-ADD (the same words as @cds/db PAUSED_NO_ADD_COPY). */
export const PAUSED_NO_ADD =
  "Your add-ons are paused until your overdue bill is paid. Pay it first, then add new ones.";
/** UI-SPEC ERR-CARD (CONTEXT locked) and its second line. */
export const ERR_CARD =
  "Your card was declined. Update it in Settings › Billing.";
export const ERR_CARD_NOTHING_ADDED = "Nothing was added.";
export const PREVIEW_FAILED =
  "We couldn't get your price just now. Close this and try again in a minute.";

/** org_addons rows paused by a billing lapse (disabled, reason billing_lapse; D27). */
export function pausedSlugs(
  rows: readonly { addon: string; status: string; disabled_reason: string }[],
): Set<string> {
  return new Set(
    rows
      .filter(
        (r) => r.status === "disabled" && r.disabled_reason === "billing_lapse",
      )
      .map((r) => r.addon),
  );
}

/** UI-SPEC PAUSED-ADDON. */
export function pausedAddonCopy(name: string, plural: string): string {
  return `${name} is paused because payment stopped. Your ${plural} are kept and come back when you pay.`;
}

/** UI-SPEC UNPRICED-ADDON (the same words as @cds/db UNPRICED_ADDON_COPY). */
export const UNPRICED_ADDON_REASON =
  "We're finalising this price. You'll be able to add it soon.";

export const UPDATE_CARD_AND_PAY = "Update card and pay";

/** 13-32: the neutral badge and the disabled button on a coming-soon listing. */
export const COMING_SOON = "Coming soon";
/** 13-32: the line under the disabled button. */
export const COMING_SOON_REASON =
  "Support is getting this one ready. You'll be able to add it soon.";

/** 13-32 (T-13-32-01): the server refusal for adding a coming-soon add-on. */
export function comingSoonAddCopy(name: string): string {
  return `${name} is coming soon, so it can't be added yet.`;
}

export { joinAnd };
