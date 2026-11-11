// Page builder route (CONT-05..08, CONT-30; D183, D119, D311; 03-UI-SPEC "Page builder";
// T-03-53, T-03-54). Server-loads the page, its draft blocks and the site's pop-up names
// for the signed-in member, then hands them to the client Builder. The org comes only from
// the session cookie; a page id from another site reads as not found (404).
// Selection lives in the URL (?block=<id>, ?add=1) so refresh and back work.
// The org's theme is resolved here with the session context and passed down so the
// Background swatches paint the real colours (THEME-02, D-UI-P4-11; T-04-37).
// P5: the org's active add-ons decide which add-on blocks the picker offers ("From your
// add-ons") and which existing blocks show "Add-on off" (05-UI-SPEC "Builder integration").
// 07-24 (choice 10): the business profile is read once and passed as a plain BuilderBusiness
// (name, phone, formatted address, has-hours, socials, business type only; T-07-24-07) for
// the Map, Hours and Social editors and the Suggested presets. 08-08 moves builderBusiness to
// lib/builder-business.ts and adds the published-services count and the public email.
// 07-28 (CONT-36, D275, choice 9): pop-ups load with includeDeleted (options flagged deleted)
// and every row's refs are checked with deletedRefsAmong, in its own try/catch, so a block
// using a deleted form, pop-up or media file shows "Uses a deleted …" (a failure: no labels).
// 07-30 (CONT-14, CONT-35): the SEO & sharing drawer gets the menu (getNav), the business
// name, the theme's colour roles (contrast check) and a preview of the site share image
// (the chosen library photo, else the generated /_site/share.png), each read in its own
// try/catch so a failure only drops that part. `?seo=1` opens the drawer.
// 07-32 (CONT-28): Page settings gets the protected flag (PageSummary.password_protected), the
// menu state (navHasPage over the same nav read) and the menu size; `?settings=1` opens it.
// 10-41 (BILL-14, BILL-04, D-UI-P10-26): builderPro (getEntitlements, cached) and canBuy
// (purchases:run) go to the builder plan context; the table editor unlocks or locks Pro from them.
// 11-48 (DASH-17, D208): first-use tour `builder` (Add block, blocks, History, Publish).
// 12-17 (COMM-11, D102; choice 2): the page's lock state (activeServiceNotices + core
// lockCovers) and this person's held changes (listHeldDrafts) come from loadEditorLock; the
// builder is keyed by editorLockKey (the held set only, WR-C05): an applied, discarded or
// parked change remounts it from fresh server state; a lock flips it read-only in place.
// A failed read degrades to "not locked".
import { ADDON_REGISTRY } from "@cds/addon-registry";
import { CdsError, can } from "@cds/core";
import {
  unionRefs,
  type NavSettings,
  type SectionRefs,
  navHasPage,
  navTopCount,
} from "@cds/core/content";
import type { ChecklistTheme } from "@cds/core/seo";
import {
  NEUTRAL_DESIGN,
  ROLES,
  evaluatePairs,
  isHexColor,
  projectPublicDesign,
  resolveTheme,
  type RoleMap,
} from "@cds/core/theme";
import {
  activeAddons,
  pausedAddons,
  deletedRefsAmong,
  getNav,
  getPage,
  getSiteSettings,
  listForms,
  listPopups,
  listSections,
  readOrganizationDesign,
  readOwnSiteIcons,
  resolveHubMedia,
  type PageSummary,
  type SectionRow,
} from "@cds/db";
import {
  deletedRefLabel,
  type AddonBlockOption,
  type BuilderBusiness,
} from "@cds/ui/builder";
import { InlineAlert, buttonClasses } from "@cds/ui/hub";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { builderBusiness } from "../../../../../../lib/builder-business";
import { loadEditorLock } from "../../../../../../lib/editor-lock";
import { editorLockKey } from "../../../../../../lib/editor-lock-shared";
import { getEntitlements } from "../../../../../../lib/entitlements";
import { requireHubSession } from "../../../../../../lib/session";
import { SECTION_REGISTRY } from "../../../../../../lib/section-registry";
import { themeOrNeutral } from "../../../../../../lib/theme-read";
import { tourState } from "../../../tour-slot";
import { Builder } from "./Builder";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Edit page" };

type Props = {
  params: Promise<{ pageId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** 10-32: paused add-ons' blocks say "Paused"; a failure keeps "Add-on off". */
async function pausedOrNone(
  ctx: Parameters<typeof pausedAddons>[0],
): Promise<string[]> {
  try {
    return await pausedAddons(ctx);
  } catch (err) {
    console.error("[hub] pausedAddons failed", err);
    return [];
  }
}

/** Builder Pro on right now (cached server read, 10-17). A failure locks Pro, never breaks the builder. */
async function builderProOn(
  ctx: Parameters<typeof getEntitlements>[0],
): Promise<boolean> {
  try {
    return (await getEntitlements(ctx)).keys.includes("builder-pro");
  } catch (err) {
    console.error("[hub] builder entitlements read failed", err);
    return false;
  }
}

/** The block types of the org's active add-ons, in registry order. */
function addonBlocksFor(active: readonly string[]): AddonBlockOption[] {
  const on = new Set(active);
  return ADDON_REGISTRY.list()
    .filter((m) => on.has(m.slug))
    .flatMap((m) =>
      m.sections.map((d) => ({
        type: d.type,
        label: d.label,
        description: d.description,
        icon: m.nav.icon,
      })),
    );
}

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** The site's forms for the Form item picker; a failure never breaks the builder (07-18). */
async function formOptions(
  ctx: Parameters<typeof listForms>[0],
): Promise<{ id: string; name: string; deleted: boolean }[]> {
  try {
    const rows = await listForms(ctx, { includeDeleted: true });
    return rows.map((f) => ({ id: f.id, name: f.name, deleted: f.deleted }));
  } catch (err) {
    console.error("[hub] builder forms load failed", err);
    return [];
  }
}

/** The theme's colour roles as the site renders them (the emitter's all-or-nothing rule). */
function checklistThemeOf(design: unknown): ChecklistTheme | null {
  try {
    const pub = projectPublicDesign(design);
    const roles = (pub?.roles ?? null) as Record<string, unknown> | null;
    const ok =
      roles !== null &&
      ROLES.every((r) => isHexColor(roles[r])) &&
      evaluatePairs(roles as RoleMap).every((p) => p.pass);
    const r = ok ? (roles as RoleMap) : NEUTRAL_DESIGN.roles;
    return {
      text: r.text,
      textMuted: r["text-muted"],
      surface: r.surface,
      surfaceRaised: r["surface-raised"],
      primary: r.primary,
      onPrimary: r["primary-contrast"],
    };
  } catch {
    return null;
  }
}

/** The site menu for the "in your menu" check; null on failure (07-30). */
async function navOrNull(ctx: Parameters<typeof getNav>[0]): Promise<unknown> {
  try {
    return await getNav(ctx);
  } catch {
    return null;
  }
}

/** The site share image preview: the chosen photo, else the generated image (07-30). */
async function siteSharePreviewOf(
  ctx: Parameters<typeof getSiteSettings>[0],
  primaryHost: string | null,
): Promise<string | null> {
  try {
    const { share_image } = await getSiteSettings(ctx);
    if (share_image) {
      const m = (await resolveHubMedia(ctx, [share_image]))[share_image];
      if (m?.src) return m.src;
    }
    // WR-C06: a render only reads; regeneration runs in the writers.
    const icons = await readOwnSiteIcons(ctx);
    return icons && primaryHost
      ? `https://${primaryHost}/_site/share.png?v=${icons.v}`
      : null;
  } catch {
    return null;
  }
}

/** A row's refs from its block definition; a malformed row references nothing. */
function rowRefs(row: SectionRow): SectionRefs {
  try {
    const def = SECTION_REGISTRY.get(row.section_type);
    if (def) return def.refsOf(row.content);
  } catch {
    // fall through
  }
  return { popups: [], forms: [], media: [] };
}

/** Section id -> "Uses a deleted …" label (07-28 choice 9). A failure: no labels. */
async function deletedRefLabels(
  ctx: Parameters<typeof deletedRefsAmong>[0],
  rows: readonly SectionRow[],
): Promise<Record<string, string>> {
  try {
    const per = rows.map((r) => ({ id: r.id, refs: rowRefs(r) }));
    const deleted = await deletedRefsAmong(
      ctx,
      unionRefs(per.map((p) => p.refs)),
    );
    const out: Record<string, string> = {};
    for (const p of per) {
      const label = deletedRefLabel(p.refs, deleted);
      if (label) out[p.id] = label;
    }
    return out;
  } catch (err) {
    console.error("[hub] deleted refs load failed", err);
    return {};
  }
}

export default async function BuilderPage({ params, searchParams }: Props) {
  const { ctx, org } = await requireHubSession();
  const { pageId } = await params;
  const sp = await searchParams;

  let page: PageSummary;
  try {
    page = await getPage(ctx, pageId);
  } catch (err) {
    if (
      err instanceof CdsError &&
      (err.code === "not_found" || err.code === "invalid_input")
    ) {
      notFound();
    }
    throw err;
  }

  let sections: SectionRow[];
  let popups: { id: string; name: string; deleted: boolean }[];
  let design: unknown;
  let active: string[];
  let forms: { id: string; name: string; deleted: boolean }[];
  let business: BuilderBusiness | null;
  try {
    const [rows, allPopups, stored, on, formRows, biz] = await Promise.all([
      listSections(ctx, page.id),
      listPopups(ctx, { includeDeleted: true }),
      themeOrNeutral(readOrganizationDesign(ctx), "hub"),
      activeAddons(ctx),
      formOptions(ctx),
      builderBusiness(ctx),
    ]);
    forms = formRows;
    business = biz;
    sections = rows;
    active = on;
    design = stored;
    popups = allPopups.map((p) => ({
      id: p.id,
      name: p.name,
      deleted: p.deleted,
    }));
  } catch (err) {
    console.error("[hub] builder load failed", err);
    return (
      <div className="p-8">
        <InlineAlert
          tone="error"
          action={
            <Link
              href={`/hub/website/pages/${encodeURIComponent(page.id)}`}
              className={buttonClasses("secondary", "sm")}
            >
              Try again
            </Link>
          }
        >
          We couldn&apos;t load this. Check your connection and try again.
        </InlineAlert>
      </div>
    );
  }

  const [deletedLabels, nav, siteSharePreview, builderPro, paused, tour, lock] =
    await Promise.all([
      deletedRefLabels(ctx, sections),
      navOrNull(ctx),
      siteSharePreviewOf(ctx, org.primaryHost),
      builderProOn(ctx),
      pausedOrNone(ctx),
      tourState(ctx, "builder"),
      loadEditorLock(
        ctx,
        { kind: "page", id: page.id },
        { activeAddons: active },
      ),
    ]);

  return (
    <Builder
      key={editorLockKey(lock)}
      lock={lock}
      page={page}
      deletedRefLabels={deletedLabels}
      sections={sections}
      popups={popups}
      primaryHost={org.primaryHost}
      initialBlockId={one(sp.block)}
      initialAdding={one(sp.add) === "1"}
      theme={resolveTheme(design)}
      activeAddons={active}
      pausedAddons={paused}
      addonBlocks={addonBlocksFor(active)}
      forms={forms}
      business={business}
      nav={nav}
      businessName={business?.name || org.name}
      siteSharePreview={siteSharePreview}
      pageKind={page.kind}
      checklistTheme={checklistThemeOf(design)}
      initialSeoOpen={one(sp.seo) === "1"}
      inMenu={navHasPage(nav as NavSettings | null, page.id)}
      navTopCount={navTopCount(nav as NavSettings | null)}
      initialSettingsOpen={one(sp.settings) === "1"}
      builderPro={builderPro}
      canBuy={can(ctx, "purchases", "run")}
      canRestore={can(ctx, "content", "write")}
      tour={tour}
    />
  );
}
