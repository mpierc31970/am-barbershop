"use server";
// Site menu and footer saves from Website › Navigation / Footer, and the add-on page line's
// "Add to navigation" (CONT-13; D248, D249, D253; 07-25 choices 1-3, 13; T-07-25-01..03).
// Public POST endpoints: every argument is untrusted. The tenant comes only from the session
// via runAction. Only allowlisted fields are copied, field by field (nested links too), so
// `organization`, `held` and unknown keys never reach @cds/db. The chokepoint validates deny
// by default, checks every page/pop-up target belongs to the org, screens and invalidates.
// 12-17 (COMM-11, D102): a save refused by a CDS service window (target_locked) parks the
// cleaned input as this person's held draft first (parkIfLocked), so nothing typed is lost.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { NotFound } from "@cds/core";
import {
  navHasPage,
  navRefs,
  navTopCount,
  type FooterSettings,
  type NavSettings,
} from "@cds/core/content";
import {
  addAddonPageToNav,
  getNav,
  saveFooter,
  saveNav,
  type AddToNavResult,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";
import { parkIfLocked } from "../../lib/editor-lock";

type Rec = Record<string, unknown>;

function record(v: unknown): Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Rec)
    : {};
}

function pick(raw: Rec, keys: readonly string[]): Rec {
  const out: Rec = {};
  for (const k of keys) if (Object.hasOwn(raw, k)) out[k] = raw[k];
  return out;
}

const LINK_KEYS = ["id", "label", "target", "new_tab"] as const;
const LIST_MAX = 50;

function links(v: unknown, withChildren: boolean): Rec[] | unknown {
  if (!Array.isArray(v)) return v;
  return v.slice(0, LIST_MAX).map((item) => {
    const r = record(item);
    const out = pick(r, LINK_KEYS);
    if (withChildren && Object.hasOwn(r, "children")) {
      out.children = links(r.children, false);
    }
    return out;
  });
}

export async function saveNavAction(
  input: Pick<NavSettings, "items" | "cta">,
): Promise<ActionResult<{ nav: NavSettings; held: boolean }>> {
  const raw = record(input);
  const clean: Rec = {};
  if (Object.hasOwn(raw, "items")) clean.items = links(raw.items, true);
  if (Object.hasOwn(raw, "cta")) {
    clean.cta =
      raw.cta === null ? null : pick(record(raw.cta), ["label", "target"]);
  }
  return runAction(async (s) => {
    try {
      return await saveNav(s.ctx, contentDeps(), clean);
    } catch (err) {
      await parkIfLocked(s.ctx, err, {
        kind: "site_part",
        part: "nav",
        value: clean,
      });
      throw err;
    }
  });
}

const FOOTER_KEYS = [
  "show_address",
  "show_hours",
  "show_socials",
  "copyright",
] as const;

export async function saveFooterAction(
  input: Omit<FooterSettings, "held">,
): Promise<ActionResult<{ footer: FooterSettings; held: boolean }>> {
  const raw = record(input);
  const clean = pick(raw, FOOTER_KEYS);
  if (Object.hasOwn(raw, "extra_links")) {
    clean.extra_links = links(raw.extra_links, false);
  }
  return runAction(async (s) => {
    try {
      return await saveFooter(s.ctx, contentDeps(), clean);
    } catch (err) {
      await parkIfLocked(s.ctx, err, {
        kind: "site_part",
        part: "footer",
        value: clean,
      });
      throw err;
    }
  });
}

/** Any registered add-on slug (null-prototype lookup); anything else is NotFound. */
function registrySlug(slug: unknown): string {
  if (typeof slug !== "string") throw new NotFound();
  const map: Record<string, true> = Object.create(null);
  for (const m of ADDON_REGISTRY.list()) map[m.slug] = true;
  if (!Object.hasOwn(map, slug)) throw new NotFound();
  return slug;
}

/** Add an add-on's seeded page to the menu. The page is resolved server-side from the slug. */
export async function addAddonPageToNavAction(
  slug: string,
): Promise<ActionResult<AddToNavResult>> {
  return runAction((s) =>
    addAddonPageToNav(s.ctx, contentDeps(), registrySlug(slug)),
  );
}

/** The hub's view of the menu: top-level count and every linked page id. */
export async function navStateAction(): Promise<
  ActionResult<{ topCount: number; pageIds: string[] }>
> {
  return runAction(async (s) => {
    const nav = await getNav(s.ctx);
    const pageIds = nav
      ? navRefs(nav).pages.filter((id) => navHasPage(nav, id))
      : [];
    return { topCount: navTopCount(nav), pageIds };
  });
}
