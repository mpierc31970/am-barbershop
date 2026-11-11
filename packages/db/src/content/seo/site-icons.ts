// Site icons and the generated share image (07-30 choices 7, 8; CONT-28, D235 #11; invariant 7;
// T-07-30-02, T-07-30-05, T-07-30-08).
//
// Generated files, not media assets: icon-32.png (transparent), icon-180.png and icon-512.png
// (opaque white padded squares: apple-touch icons must be opaque), share.png (1200x630, the
// logo contained in a 720x378 box on the theme primary) and manifest.json { v, source,
// generated_at }, written LAST to the public store under tenants/<org>/media/site/. They never
// count toward the 2 GB allowance. Without a logo the set is a wordmark: initials (icons) or
// the org name (share) in #FFFFFF or #1B1B19, whichever contrasts more with the primary.
// The org name is XML-escaped before it enters the SVG (T-07-30-02).
//
// `v` = first 12 hex of sha256(logo id + primary + org name + generator version): a call with
// unchanged inputs writes nothing. Regeneration runs on logo upload / remove / restore, staff
// theme apply, Site settings load (a server action the tab calls once mounted, never the
// render: WR-C06) and the SEO action; a visitor request or a hub render never writes. A write
// drops the tenant's cached `v` through deps.invalidator (liveTag) when the caller passes one.
// Failures are logged without ids or keys and never fail the caller.
import { createHash } from "node:crypto";
import {
  NEUTRAL_DESIGN,
  ROLES,
  contrastRatio,
  evaluatePairs,
  isHexColor,
  projectPublicDesign,
  type RoleMap,
} from "@cds/core/theme";
import { Forbidden } from "@cds/core";
import type { RecordModel } from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../../client";
import type { OrgContext } from "../../context";
import { imageQueue } from "../../media/queue";
import { requirePermission } from "../../repository";
import {
  getObjectStore,
  getPublicMediaStore,
  tenantMediaKey,
  tenantSiteAssetKey,
  type ObjectStore,
} from "../../storage";
import { liveTag, type Invalidator } from "../ports";
import { assertSiteContext, type SiteContext } from "../site-context";

export const SITE_ICONS_GENERATOR = 1;

export type SiteIconSource = "logo" | "wordmark";
export type SiteIcons = { v: string; source: SiteIconSource };

export type SiteIconDeps = {
  /** Private store holding the logo (defaults to getObjectStore()). */
  store?: ObjectStore;
  /** Public store receiving the files (defaults to getPublicMediaStore()). */
  publicStore?: ObjectStore;
  /** Regenerate even when `v` is unchanged. */
  force?: boolean;
  now?: () => Date;
  /** WR-C06: told liveTag(org) after a write, so tenant pages pick up the new `v`. */
  invalidator?: Invalidator;
};

export type RegenerateResult =
  { ok: true; written: boolean; icons: SiteIcons } | { ok: false };

const V_RE = /^[0-9a-f]{12}$/;
const WHITE = "#FFFFFF";
const INK = "#1B1B19";
const ICON_FILES = ["icon-32.png", "icon-180.png", "icon-512.png"] as const;

type SharpFn = typeof import("sharp").default;
let sharpLoaded: Promise<SharpFn> | null = null;
function sharpLib(): Promise<SharpFn> {
  sharpLoaded ??= import("sharp").then((m) => {
    m.default.concurrency(1);
    return m.default;
  });
  return sharpLoaded;
}

/** XML text escaping for the wordmark SVG (T-07-30-02). */
export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The theme primary the site renders with (the emitter's all-or-nothing role rule). */
export function themePrimary(design: unknown): string {
  const pub = projectPublicDesign(design);
  const roles = (pub?.roles ?? null) as Record<string, unknown> | null;
  const ok =
    roles !== null &&
    ROLES.every((r) => isHexColor(roles[r])) &&
    evaluatePairs(roles as RoleMap).every((p) => p.pass);
  return (
    ok ? (roles as RoleMap).primary : NEUTRAL_DESIGN.roles.primary
  ).toLowerCase();
}

/** #FFFFFF or #1B1B19, whichever has the higher contrast against `bg`. */
export function wordmarkInk(bg: string): string {
  try {
    return contrastRatio(WHITE, bg) >= contrastRatio(INK, bg) ? WHITE : INK;
  } catch {
    return INK;
  }
}

export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
  const letters = words
    .slice(0, 2)
    .map((w) => [...w.replace(/[^\p{L}\p{N}]/gu, "")][0] ?? "")
    .join("");
  return letters.toUpperCase() || "•";
}

export function iconVersion(input: {
  logoId: string;
  primary: string;
  name: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.logoId}\u0000${input.primary}\u0000${input.name}\u0000${SITE_ICONS_GENERATOR}`,
    )
    .digest("hex")
    .slice(0, 12);
}

function parseManifest(bytes: Uint8Array | null): SiteIcons | null {
  if (!bytes) return null;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (typeof raw !== "object" || raw === null) return null;
    const v = (raw as { v?: unknown }).v;
    const source = (raw as { source?: unknown }).source;
    if (typeof v !== "string" || !V_RE.test(v)) return null;
    if (source !== "logo" && source !== "wordmark") return null;
    return { v, source };
  } catch {
    return null;
  }
}

type Inputs = { name: string; design: unknown; logo: RecordModel | null };

async function readInputs(orgId: string): Promise<Inputs | null> {
  return withSuperuser(async (pb) => {
    let org: RecordModel;
    try {
      org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name,design" });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) return null;
      throw err;
    }
    const logos = await pb.collection("media_assets").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && kind = 'logo' && removed_at = ''",
        { org: orgId },
      ),
      sort: "-created",
      fields: "id,original_ext",
      skipTotal: true,
    });
    return {
      name: typeof org.name === "string" ? org.name.trim().slice(0, 120) : "",
      design: org.design,
      logo: logos.items[0] ?? null,
    };
  });
}

async function logoBytes(
  store: ObjectStore,
  orgId: string,
  logo: RecordModel,
): Promise<Uint8Array | null> {
  const web = await store.get(tenantMediaKey(orgId, logo.id, "web.webp"));
  if (web) return web;
  const ext = String(logo.original_ext ?? "");
  if (ext === "jpg" || ext === "png" || ext === "webp") {
    return store.get(
      tenantMediaKey(orgId, logo.id, `original.${ext}` as "original.jpg"),
    );
  }
  return null;
}

function wordmarkSvg(
  width: number,
  height: number,
  text: string,
  bg: string,
  ink: string,
  fontSize: number,
): Buffer {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="100%" height="100%" fill="${bg}"/>` +
    `<text x="50%" y="50%" fill="${ink}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-weight="bold" font-size="${fontSize}" text-anchor="middle" dominant-baseline="central">${xmlEscape(text)}</text>` +
    `</svg>`;
  return Buffer.from(svg, "utf8");
}

type Rendered = Record<(typeof ICON_FILES)[number] | "share.png", Buffer>;

async function renderFromLogo(
  bytes: Uint8Array,
  primary: string,
): Promise<Rendered> {
  const sharp = await sharpLib();
  const src = Buffer.from(bytes);
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const white = { r: 255, g: 255, b: 255, alpha: 1 };
  const opaque = async (side: number) => {
    const pad = Math.round(side * 0.1);
    const inner = side - pad * 2;
    return sharp(src)
      .resize(inner, inner, { fit: "contain", background: white })
      .flatten({ background: WHITE })
      .extend({
        top: pad,
        bottom: pad,
        left: pad,
        right: pad,
        background: white,
      })
      .png()
      .toBuffer();
  };
  const logoBox = await sharp(src)
    .resize(720, 378, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  return {
    "icon-32.png": await sharp(src)
      .resize(32, 32, { fit: "contain", background: clear })
      .png()
      .toBuffer(),
    "icon-180.png": await opaque(180),
    "icon-512.png": await opaque(512),
    "share.png": await sharp({
      create: { width: 1200, height: 630, channels: 4, background: primary },
    })
      .composite([{ input: logoBox, gravity: "center" }])
      .png()
      .toBuffer(),
  };
}

async function renderWordmark(
  name: string,
  primary: string,
): Promise<Rendered> {
  const sharp = await sharpLib();
  const ink = wordmarkInk(primary);
  const initials = initialsOf(name);
  const icon = (side: number) =>
    sharp(
      wordmarkSvg(
        side,
        side,
        initials,
        primary,
        ink,
        Math.round(side * (initials.length > 1 ? 0.42 : 0.55)),
      ),
    )
      .png()
      .toBuffer();
  const label = name || initials;
  const shareSize = Math.max(
    40,
    Math.min(96, Math.floor(1800 / Math.max(label.length, 1))),
  );
  return {
    "icon-32.png": await icon(32),
    "icon-180.png": await icon(180),
    "icon-512.png": await icon(512),
    "share.png": await sharp(
      wordmarkSvg(1200, 630, label, primary, ink, shareSize),
    )
      .png()
      .toBuffer(),
  };
}

/**
 * Internal (by path only, never in the barrel): regenerate one org's icon set when its inputs
 * changed (or `force`). Never throws; `{ ok: false }` after a logged failure.
 */
export async function regenerateSiteIcons(
  orgId: string,
  deps: SiteIconDeps = {},
): Promise<RegenerateResult> {
  try {
    const inputs = await readInputs(orgId);
    if (!inputs) return { ok: false };
    const primary = themePrimary(inputs.design);
    const logoId = inputs.logo?.id ?? "";
    const v = iconVersion({ logoId, primary, name: inputs.name });
    const publicStore = deps.publicStore ?? getPublicMediaStore();
    const manifestKey = tenantSiteAssetKey(orgId, "manifest.json");
    const current = parseManifest(await publicStore.get(manifestKey));
    if (current && current.v === v && !deps.force) {
      return { ok: true, written: false, icons: current };
    }
    return await imageQueue.run(async () => {
      let source: SiteIconSource = "wordmark";
      let files: Rendered | null = null;
      if (inputs.logo) {
        const bytes = await logoBytes(
          deps.store ?? getObjectStore(),
          orgId,
          inputs.logo,
        );
        if (bytes) {
          files = await renderFromLogo(bytes, primary);
          source = "logo";
        }
      }
      files ??= await renderWordmark(inputs.name, primary);
      for (const name of [...ICON_FILES, "share.png"] as const) {
        await publicStore.put(
          tenantSiteAssetKey(orgId, name),
          files[name],
          "image/png",
        );
      }
      const at = (deps.now ?? (() => new Date()))();
      await publicStore.put(
        manifestKey,
        JSON.stringify({ v, source, generated_at: at.toISOString() }),
        "application/json",
      );
      try {
        deps.invalidator?.invalidate([liveTag(orgId)]);
      } catch {
        // The tenant's cached icon set expires on its own (60 s).
      }
      return { ok: true as const, written: true, icons: { v, source } };
    });
  } catch {
    console.error("[seo] site icons failed");
    return { ok: false };
  }
}

function canRefresh(ctx: OrgContext): void {
  try {
    requirePermission(ctx, "content", "write");
  } catch (err) {
    if (!(err instanceof Forbidden)) throw err;
    requirePermission(ctx, "business", "write");
  }
}

/** Regenerate the caller's own icon set when its inputs changed (content or business write). */
export async function refreshSiteIcons(
  ctx: OrgContext,
  deps: Omit<SiteIconDeps, "force"> = {},
): Promise<SiteIcons | null> {
  canRefresh(ctx);
  const r = await regenerateSiteIcons(ctx.orgId, deps);
  return r.ok ? r.icons : null;
}

/** WR-C06: the caller's own icon set, read only (hub renders never write). */
export async function readOwnSiteIcons(
  ctx: OrgContext,
  deps: { publicStore?: ObjectStore } = {},
): Promise<SiteIcons | null> {
  const store = deps.publicStore ?? getPublicMediaStore();
  return parseManifest(
    await store.get(tenantSiteAssetKey(ctx.orgId, "manifest.json")),
  );
}

/** The site's generated icon set ({ v, source }), or null when none is generated yet. */
export async function readSiteIcons(
  site: SiteContext,
  deps: { publicStore?: ObjectStore } = {},
): Promise<SiteIcons | null> {
  assertSiteContext(site);
  const store = deps.publicStore ?? getPublicMediaStore();
  return parseManifest(
    await store.get(tenantSiteAssetKey(site.orgId, "manifest.json")),
  );
}

/** The four servable files (never the manifest). */
export const SITE_ICON_FILES = Object.freeze([
  "icon-32.png",
  "icon-180.png",
  "icon-512.png",
  "share.png",
] as const);
export type SiteIconFile = (typeof SITE_ICON_FILES)[number];

export function isSiteIconFile(name: unknown): name is SiteIconFile {
  return (
    typeof name === "string" &&
    (SITE_ICON_FILES as readonly string[]).includes(name)
  );
}

/**
 * 11-22: one generated PNG of the caller's own org, for the installable hub's manifest icons
 * (served on the platform origin by /hub/icon/<file>). Key built from ctx.orgId only.
 */
export async function readOwnSiteIconFile(
  ctx: OrgContext,
  name: string,
  deps: { publicStore?: ObjectStore } = {},
): Promise<Uint8Array | null> {
  if (!isSiteIconFile(name)) return null;
  const store = deps.publicStore ?? getPublicMediaStore();
  return store.get(tenantSiteAssetKey(ctx.orgId, name));
}

/** One generated PNG of the site's own org (key built from site.orgId), or null. */
export async function readSiteIconFile(
  site: SiteContext,
  name: string,
  deps: { publicStore?: ObjectStore } = {},
): Promise<Uint8Array | null> {
  assertSiteContext(site);
  if (!isSiteIconFile(name)) return null;
  const store = deps.publicStore ?? getPublicMediaStore();
  return store.get(tenantSiteAssetKey(site.orgId, name));
}
