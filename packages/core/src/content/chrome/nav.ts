// Site menu rules (CONT-13; D117 / invariant 6, D248, D253; CONTEXT Area 5 row 1; 07-25
// choices 1-4). Owner 07-25; 07-29 snapshots the stored shape.
//
// The menu is site chrome stored in site_settings.nav, never a page section (D117,
// invariant 6). Deny by default: validateNav builds fresh objects from own properties only
// (banner.ts style). A link target is "page:<15-char id>" or an absolute http(s) URL; the
// menu button may also open "popup:<id>". javascript:, data:, mailto:, protocol-relative
// and site paths are refused, so nothing but a page id or a web address reaches an href.
// Children never have children (one dropdown level).
//
// resolveNav turns stored settings into render data from the org's published manifest: a
// deleted, unpublished or hidden add-on page is skipped. A held menu (D248) shows page links
// only, labelled with the published page titles (no URL links, no button).
// Pure and Edge-safe: no node:, no sanitizer, no next/* imports.
import { InvalidInput } from "../../errors";
import { asRecord, isRecord, own, safeId } from "../validate-helpers";

export const NAV_TOP_MAX = 8;
export const NAV_CHILD_MAX = 8;
export const NAV_LABEL_MAX = 40;
export const NAV_CTA_LABEL_MAX = 30;
export const NAV_CTA_DEFAULT = "Book now";
/** The Add page checkbox defaults on while the menu has fewer top-level links than this. */
export const NAV_SUGGEST_BELOW = 6;
const NAV_URL_MAX = 2048;

export const NAV_COPY = Object.freeze({
  empty:
    "Your menu is empty, so visitors only see your logo. Add your main pages.",
  limit:
    "Menus hold up to 8 links. Put some under another link, or remove one.",
  childLimit: "Dropdowns hold up to 8 links.",
  label: "Give this link a name.",
  target: "Choose a page or enter a web address starting with https://.",
  ownPage: "Choose a page from your site.",
  duplicate: "Each menu link needs its own id. Reload and try again.",
  pageGone: "This page was deleted. Remove it from your menu.",
  unpublished: "Shows once the page is published.",
  held: "Your menu is waiting for a quick review. Until then your site shows your page links only.",
  saved: "Menu saved. It's live on your site.",
});

export type NavLink = {
  id: string;
  label: string;
  /** "page:<id>" or an absolute http(s) URL. */
  target: string;
  new_tab: boolean;
};
export type NavItem = NavLink & { children: NavLink[] };
export type NavCta = {
  label: string;
  /** "page:<id>" or "popup:<id>". */
  target: string;
};
export type NavSettings = {
  items: NavItem[];
  cta: NavCta | null;
  held: boolean;
};

export type NavTarget =
  | { kind: "page"; id: string }
  | { kind: "popup"; id: string }
  | { kind: "url"; href: string };

const RECORD_ID = /^[a-z0-9]{15}$/;

/** A canonical absolute http(s) URL, or null. */
function httpHref(s: string): string | null {
  if (!/^https?:\/\//i.test(s)) return null;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.hostname === "") return null;
  return url.href.length > NAV_URL_MAX ? null : url.href;
}

/** Parse a stored target. Never throws; anything unknown is null. */
export function parseNavTarget(t: unknown): NavTarget | null {
  if (typeof t !== "string") return null;
  const s = t.trim();
  if (s.startsWith("page:")) {
    const id = s.slice(5);
    return RECORD_ID.test(id) ? { kind: "page", id } : null;
  }
  if (s.startsWith("popup:")) {
    const id = s.slice(6);
    return RECORD_ID.test(id) ? { kind: "popup", id } : null;
  }
  const href = httpHref(s);
  return href === null ? null : { kind: "url", href };
}

function targetString(t: NavTarget): string {
  return t.kind === "url" ? t.href : `${t.kind}:${t.id}`;
}

function label(raw: Record<string, unknown>, key: string, max: number): string {
  const v = own(raw, key);
  const s = typeof v === "string" ? v.trim() : "";
  if (s.length > max) {
    throw new InvalidInput(`Keep this under ${max} characters.`);
  }
  return s;
}

/** One menu link (no children). Shared with the footer's extra links. */
export function validateNavLink(raw: unknown): NavLink {
  if (!isRecord(raw)) throw new InvalidInput(NAV_COPY.target);
  const l = label(raw, "label", NAV_LABEL_MAX);
  if (l === "") throw new InvalidInput(NAV_COPY.label);
  const t = parseNavTarget(own(raw, "target"));
  if (!t || t.kind === "popup") throw new InvalidInput(NAV_COPY.target);
  return {
    id: safeId(own(raw, "id")),
    label: l,
    target: targetString(t),
    new_tab: t.kind === "url" && own(raw, "new_tab") === true,
  };
}

function list(raw: Record<string, unknown>, key: string): unknown[] {
  const v = own(raw, key);
  return Array.isArray(v) ? v : [];
}

function validateCta(raw: unknown): NavCta | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) throw new InvalidInput(NAV_COPY.target);
  const l = label(raw, "label", NAV_CTA_LABEL_MAX);
  const t = parseNavTarget(own(raw, "target"));
  if (!t || t.kind === "url") throw new InvalidInput(NAV_COPY.target);
  return { label: l === "" ? NAV_CTA_DEFAULT : l, target: targetString(t) };
}

/** Deny-by-default menu validation. `held` comes only from an own boolean. */
export function validateNav(raw: unknown): NavSettings {
  const r = asRecord(raw);
  const rawItems = list(r, "items");
  if (rawItems.length > NAV_TOP_MAX) throw new InvalidInput(NAV_COPY.limit);
  const seen = new Set<string>();
  const unique = (id: string) => {
    if (seen.has(id)) throw new InvalidInput(NAV_COPY.duplicate);
    seen.add(id);
  };
  const items: NavItem[] = rawItems.map((it) => {
    const link = validateNavLink(it);
    unique(link.id);
    const rawChildren = isRecord(it) ? list(it, "children") : [];
    if (rawChildren.length > NAV_CHILD_MAX) {
      throw new InvalidInput(NAV_COPY.childLimit);
    }
    const children = rawChildren.map((c) => {
      const child = validateNavLink(c);
      unique(child.id);
      return child;
    });
    return { ...link, children };
  });
  return {
    items,
    cta: validateCta(own(r, "cta")),
    held: own(r, "held") === true,
  };
}

export function navTopCount(nav: NavSettings | null | undefined): number {
  return nav ? nav.items.length : 0;
}

/** True when the page is linked at the top level or inside a dropdown. */
export function navHasPage(
  nav: NavSettings | null | undefined,
  pageId: string,
): boolean {
  if (!nav) return false;
  const target = `page:${pageId}`;
  return nav.items.some(
    (i) => i.target === target || i.children.some((c) => c.target === target),
  );
}

export type AppendPageResult =
  | { nav: NavSettings; added: true }
  | { nav: NavSettings; added: false; reason: "exists" | "full" };

/** Append one top-level page link (label = page title cut to 40). Never mutates. */
export function appendPageLink(
  nav: NavSettings | null | undefined,
  page: { pageId: string; title: string; id: string },
): AppendPageResult {
  const base: NavSettings = nav ?? { items: [], cta: null, held: false };
  if (navHasPage(base, page.pageId)) {
    return { nav: base, added: false, reason: "exists" };
  }
  if (base.items.length >= NAV_TOP_MAX) {
    return { nav: base, added: false, reason: "full" };
  }
  const title = page.title.trim().slice(0, NAV_LABEL_MAX).trim();
  const item: NavItem = {
    id: page.id,
    label: title === "" ? "Page" : title,
    target: `page:${page.pageId}`,
    new_tab: false,
    children: [],
  };
  return { nav: { ...base, items: [...base.items, item] }, added: true };
}

/**
 * Remove every menu link to one page (07-32 choice 13): top-level links and dropdown
 * children. A dropdown left with no children becomes a plain link (every stored item has
 * its own target). A removed dropdown parent hands its slot to its first remaining child
 * (the rest stay under it), so no other page drops out and the top-level count never grows.
 * The menu button (CTA) is untouched. Returns the same `nav` object when nothing matched.
 * Never mutates.
 */
export function removePageLinks(
  nav: NavSettings,
  pageId: string,
): { nav: NavSettings; removed: number } {
  const target = `page:${pageId}`;
  let removed = 0;
  const items: NavItem[] = [];
  for (const item of nav.items) {
    const children = item.children.filter((c) => c.target !== target);
    const gone = item.children.length - children.length;
    if (item.target === target) {
      removed += 1 + gone;
      const [first, ...rest] = children;
      if (first) items.push({ ...first, children: rest });
      continue;
    }
    if (gone === 0) {
      items.push(item);
      continue;
    }
    removed += gone;
    items.push({ ...item, children });
  }
  if (removed === 0) return { nav, removed: 0 };
  return { nav: { ...nav, items }, removed };
}

/** Every page and pop-up id the menu points at (the db checks the org owns them). */
export function navRefs(nav: NavSettings): {
  pages: string[];
  popups: string[];
} {
  const pages = new Set<string>();
  const popups = new Set<string>();
  const add = (target: string) => {
    const t = parseNavTarget(target);
    if (t?.kind === "page") pages.add(t.id);
    else if (t?.kind === "popup") popups.add(t.id);
  };
  for (const item of nav.items) {
    add(item.target);
    for (const c of item.children) add(c.target);
  }
  if (nav.cta) add(nav.cta.target);
  return { pages: [...pages], popups: [...popups] };
}

// ---------------------------------------------------------------------------------------
// Render data

export type NavPageInfo = { path: string; title: string };

export type NavResolveInput = {
  /** Page id -> its site path and title, from the published manifest. */
  pages: ReadonlyMap<string, NavPageInfo>;
  /** Seeded add-on pages whose add-on is not active. */
  hiddenPageIds?: ReadonlySet<string> | readonly string[];
  /** Overrides nav.held (tests and previews). */
  held?: boolean;
};

export type ResolvedNavLink = {
  id: string;
  label: string;
  href: string;
  newTab: boolean;
};
export type ResolvedNavEntry =
  | ({ kind: "link" } & ResolvedNavLink)
  | { kind: "group"; id: string; label: string; links: ResolvedNavLink[] };
export type ResolvedNavCta =
  { label: string; href: string } | { label: string; popupId: string };
export type ResolvedNav = {
  entries: ResolvedNavEntry[];
  cta: ResolvedNavCta | null;
};

function hiddenSet(h: NavResolveInput["hiddenPageIds"]): ReadonlySet<string> {
  if (!h) return new Set();
  return h instanceof Set ? h : new Set(h as readonly string[]);
}

/** Shared by the menu and the footer's extra links. */
export function resolveNavLink(
  link: NavLink,
  input: NavResolveInput,
  held: boolean,
): ResolvedNavLink | null {
  const t = parseNavTarget(link.target);
  if (!t) return null;
  if (t.kind === "page") {
    if (hiddenSet(input.hiddenPageIds).has(t.id)) return null;
    const page = input.pages.get(t.id);
    if (!page) return null;
    return {
      id: link.id,
      label: held ? page.title : link.label,
      href: page.path,
      newTab: false,
    };
  }
  if (t.kind === "url") {
    if (held) return null;
    return {
      id: link.id,
      label: link.label,
      href: t.href,
      newTab: link.new_tab,
    };
  }
  return null;
}

export const EMPTY_RESOLVED_NAV: ResolvedNav = Object.freeze({
  entries: [],
  cta: null,
}) as ResolvedNav;

/** Stored menu -> render data. Unresolvable links drop; an empty group drops. */
export function resolveNav(
  nav: NavSettings | null | undefined,
  input: NavResolveInput,
): ResolvedNav {
  if (!nav) return { entries: [], cta: null };
  const held = input.held ?? nav.held;
  const entries: ResolvedNavEntry[] = [];
  for (const item of nav.items) {
    const ownLink = resolveNavLink(item, input, held);
    const kids = item.children
      .map((c) => resolveNavLink(c, input, held))
      .filter((c): c is ResolvedNavLink => c !== null);
    if (kids.length === 0) {
      if (ownLink) entries.push({ kind: "link", ...ownLink });
      continue;
    }
    if (held && !ownLink) {
      // A held parent's own label is unreviewed text: list its pages flat instead.
      for (const k of kids) entries.push({ kind: "link", ...k });
      continue;
    }
    entries.push({
      kind: "group",
      id: item.id,
      label: ownLink ? ownLink.label : item.label,
      links: ownLink ? [ownLink, ...kids] : kids,
    });
  }
  let cta: ResolvedNavCta | null = null;
  if (nav.cta && !held) {
    const t = parseNavTarget(nav.cta.target);
    if (t?.kind === "popup") cta = { label: nav.cta.label, popupId: t.id };
    else if (t?.kind === "page" && !hiddenSet(input.hiddenPageIds).has(t.id)) {
      const page = input.pages.get(t.id);
      if (page) cta = { label: nav.cta.label, href: page.path };
    }
  }
  return { entries, cta };
}
