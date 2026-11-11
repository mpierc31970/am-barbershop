"use server";
// Get add-ons actions: Add to site, Add both, Remove from site (ADDON-05, ADDON-07,
// ADDON-09; CONTEXT A2-Q2..Q4, A3-Q2; 05-UI-SPEC "Add and remove"; T-05-53..T-05-56).
// Public POST endpoints: every argument is untrusted. The tenant, role and impersonation come
// only from the session cookie via runAction; the chokepoint re-checks owner-only authority
// (addons:run) and the impersonation deny-list, and audits every add, each Add both step and
// every remove. The slug must be an own property of a null-prototype map of the PUBLIC
// catalog: an unknown slug, a private add-on and "__proto__" all get the same not-found
// result (no oracle). Refusals keep the chokepoint's copy and add a typed payload
// ({ missing }, { with }, { dependents }) the way popups' inUse does.
// 13-32 (STAFF-07, T-13-32-01): adds also check the merged catalog view: a hidden listing is
// the same NotFound as an unknown slug; a coming-soon one is InvalidInput
// (comingSoonAddCopy). Remove is never gated by the listing.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import {
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { ADDON_SLUG_RE, type AddonManifest } from "@cds/core/addons";
import { BUSINESS_TIME_ZONE } from "@cds/core/payments";
import { fileError, type ImportMode, type ImportPreview } from "@cds/core/csv";
import {
  activeAddons,
  addonCsvTemplate,
  CARD_DECLINED_COPY,
  CHARGE_PRICE_CHANGED_COPY,
  PAUSED_NO_ADD_COPY,
  UNPRICED_ADDON_COPY,
  addonRepo,
  billingPortalLink,
  exportAddonCsv,
  importAddonRecords,
  installAddon,
  listAddonBackups,
  listPages,
  previewAddonCharge,
  previewAddonImport,
  restoreAddonBackup,
  saveAddonBackup,
  uninstallAddon,
  type AddonBackupSummary,
} from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { addonDeps } from "../../lib/addons";
import {
  CATALOG_UNAVAILABLE_COPY,
  catalogEntryFor,
  getCatalogState,
  getCatalogView,
} from "../../lib/catalog-view";
import { parkIfLocked } from "../../lib/editor-lock";
import type { HubSession } from "../../lib/session";
import {
  IMPERSONATING_COPY,
  NOT_OWNER_COPY,
  addMoneyBlock,
  comingSoonAddCopy,
  missingRequirements,
  namesOf,
  type AddMoney,
  type AddonRef,
} from "../(platform)/hub/add-ons/catalog-logic";
import { addonHref } from "../(platform)/hub/nav";

const COPY = { forbidden: NOT_OWNER_COPY, impersonation: IMPERSONATING_COPY };

export type AddonRefusal = {
  missing?: AddonRef[];
  with?: AddonRef;
  dependents?: AddonRef[];
  /** Add both only: the requirements that went on before a later step failed (C-WR-02). */
  added?: AddonRef[];
};

export type AddonActionResult<T> =
  | ActionResult<T>
  | ({ ok: false; code: string; message: string } & AddonRefusal);

/** Public catalog only, as a null-prototype map (T-05-54, T-05-55). */
function publicManifest(slug: unknown): AddonManifest {
  if (typeof slug !== "string") throw new NotFound();
  const map: Record<string, AddonManifest> = Object.create(null);
  for (const m of ADDON_REGISTRY.publicList()) map[m.slug] = m;
  if (!Object.hasOwn(map, slug)) throw new NotFound();
  return map[slug]!;
}

/**
 * A public add-on the catalog listing lets owners add now (13-32 choice 3): hidden =
 * NotFound (no oracle), coming soon = InvalidInput.
 */
async function addableManifest(slug: unknown): Promise<AddonManifest> {
  const m = publicManifest(slug);
  const { view, degraded } = await getCatalogState();
  // WR-D09: the fallback view marks everything available, so it never gates an add.
  if (degraded) throw new InvalidInput(CATALOG_UNAVAILABLE_COPY);
  const entry = catalogEntryFor(view, m.slug);
  if (!entry) throw new NotFound();
  if (!entry.pickable) throw new InvalidInput(comingSoonAddCopy(m.name));
  return m;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
}

/** The typed payload of an add-on refusal, with display names; null for anything else. */
function refusalOf(err: unknown): AddonRefusal | null {
  const e = err as {
    code?: unknown;
    missing?: unknown;
    with?: unknown;
    dependents?: unknown;
  } | null;
  if (!e) return null;
  switch (e.code) {
    case "addon_missing_requirement":
      return { missing: namesOf(strs(e.missing), ADDON_REGISTRY) };
    case "addon_conflict": {
      const [other] = namesOf([str(e.with)], ADDON_REGISTRY);
      return other ? { with: other } : {};
    }
    case "addon_required_by":
      return { dependents: namesOf(strs(e.dependents), ADDON_REGISTRY) };
    default:
      return null;
  }
}

/** Run with the add-on copy overrides, then attach a refusal payload when there is one. */
async function run<T>(
  fn: (s: HubSession) => Promise<T>,
): Promise<AddonActionResult<T>> {
  let refusal: AddonRefusal | null = null;
  const res = await runAction(async (s) => {
    try {
      return await fn(s);
    } catch (err) {
      refusal = refusalOf(err);
      throw err;
    }
  }, COPY);
  if (!res.ok && refusal) return { ...res, ...(refusal as AddonRefusal) };
  return res;
}

/**
 * The live URL of the seeded page, the site home when the owner deleted it, or null when
 * the site has no host yet ("View on site").
 */
async function pageUrlFor(
  s: HubSession,
  page: { id: string; slug: string } | null,
): Promise<string | null> {
  const host = s.org.primaryHost;
  if (!host) return null;
  const home = `https://${host}/`;
  if (!page) return home;
  try {
    const pages = await listPages(s.ctx);
    const found = pages.find((p) => p.id === page.id);
    return found ? `${home}${encodeURIComponent(found.slug)}` : home;
  } catch {
    return home;
  }
}

/**
 * The BillingGate's refusals (10-20) arrive as invalid_input with locked copy. Give them
 * their own codes so the dialog can switch state: ERR-CARD with Update card, PAUSED-NO-ADD
 * with Update card and pay and no add button, UNPRICED-ADDON (10-31).
 */
function gateCode<T>(res: AddonActionResult<T>): AddonActionResult<T> {
  if (res.ok || res.code !== "invalid_input") return res;
  if (res.message === CARD_DECLINED_COPY)
    return { ...res, code: "card_declined" };
  if (res.message === PAUSED_NO_ADD_COPY) return { ...res, code: "paused" };
  if (res.message === UNPRICED_ADDON_COPY) return { ...res, code: "unpriced" };
  if (res.message === CHARGE_PRICE_CHANGED_COPY)
    return { ...res, code: "price_changed" };
  return res;
}

/** A confirm token from the Add dialog, shape-checked (the chokepoint verifies it). */
function chargeToken(v: unknown): { chargeToken?: string } {
  return typeof v === "string" && v.length > 0 && v.length <= 1024
    ? { chargeToken: v }
    : {};
}

/** Add both: one token per slug, from a plain object only. */
function tokenFor(tokens: unknown, slug: string): { chargeToken?: string } {
  if (typeof tokens !== "object" || tokens === null || Array.isArray(tokens))
    return {};
  if (!Object.prototype.hasOwnProperty.call(tokens, slug)) return {};
  return chargeToken((tokens as Record<string, unknown>)[slug]);
}

/**
 * Add to site (also Add it back from the remove toast, which now confirms first). The gate
 * computes the real charge at this moment and installs only after the invoice is paid
 * (10-20); the dialog's figures are the preview below (T-10-31-03). A charge needs that
 * preview's token (CR-C01): only the confirmed figure is charged, once ("price_changed"
 * otherwise, and the dialog re-previews).
 */
export async function addAddonAction(
  slug: unknown,
  token?: unknown,
): Promise<
  AddonActionResult<{
    slug: string;
    outcome: string;
    tabHref: string;
    pageUrl: string | null;
  }>
> {
  return gateCode(
    await run(async (s) => {
      const m = await addableManifest(slug);
      const res = await installAddon(
        s.ctx,
        addonDeps(),
        m.slug,
        chargeToken(token),
      );
      return {
        slug: m.slug,
        outcome: res.outcome,
        tabHref: addonHref(m),
        pageUrl: await pageUrlFor(s, res.page),
      };
    }),
  );
}

export type AddPreviewResult =
  | { ok: true; preview: AddMoney; token: string }
  | {
      ok: false;
      reason: "unpriced" | "paused" | "forbidden" | "not_found" | "error";
      message: string;
    };

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long",
  timeZone: BUSINESS_TIME_ZONE,
});

/**
 * The Add confirm's money block (10-31; BILL-12, D186, D-UI-P10-14): the server's proration
 * preview for one public add-on, formatted for the dialog. Owner only, never impersonating
 * (T-10-31-02). A malformed or unknown slug is refused before any @cds/db call.
 */
export async function addAddonPreviewAction(
  slug: unknown,
): Promise<AddPreviewResult> {
  if (typeof slug !== "string" || !ADDON_SLUG_RE.test(slug)) {
    return { ok: false, reason: "not_found", message: "" };
  }
  let manifest: AddonManifest;
  try {
    manifest = await addableManifest(slug);
  } catch (err) {
    // A coming-soon listing says so in the dialog; anything else is the silent not_found.
    const message = err instanceof InvalidInput ? err.message : "";
    return { ok: false, reason: "not_found", message };
  }
  const res = await runAction(async (s) => {
    if (s.ctx.role !== "owner") throw new Forbidden();
    if (s.ctx.impersonator) throw new ImpersonationDenied();
    const data = await previewAddonCharge(s.ctx, manifest.slug, {
      registry: ADDON_REGISTRY,
    });
    const money = addMoneyBlock(
      {
        todayCents: data.todayCents,
        setupCents: data.setupCents,
        prorationCents: data.prorationCents,
        thenCents: data.thenCents,
        interval: data.interval,
        cardLine: data.cardLine,
        beforeCheckout: data.beforeCheckout,
        beforeLaunch: data.beforeLaunch,
      },
      MONTH.format(new Date()),
    );
    return { money, token: data.token };
  }, COPY);
  if (res.ok) {
    return { ok: true, preview: res.data.money, token: res.data.token };
  }
  if (res.code === "forbidden" || res.code === "impersonation_denied") {
    return { ok: false, reason: "forbidden", message: res.message };
  }
  if (res.code === "not_found") {
    return { ok: false, reason: "not_found", message: res.message };
  }
  if (res.message === PAUSED_NO_ADD_COPY) {
    return { ok: false, reason: "paused", message: res.message };
  }
  if (res.message === UNPRICED_ADDON_COPY) {
    return { ok: false, reason: "unpriced", message: res.message };
  }
  return { ok: false, reason: "error", message: res.message };
}

/**
 * Add both: every missing requirement first, transitively and in dependency order (A needs B
 * needs C installs C, then B), then the add-on (C-WR-02). Each step is its own audited
 * install, so this is not atomic: a refusal part way names what stopped it, nothing after it
 * runs, and the failure lists the requirements that did go on (`added`) so the owner is told
 * the truth instead of "nothing changed".
 */
export async function addBothAction(
  slug: unknown,
  tokens?: unknown,
): Promise<
  AddonActionResult<{
    added: string[];
    tabHref: string;
    pageUrl: string | null;
  }>
> {
  const added: string[] = [];
  const res = await run(async (s) => {
    const m = await addableManifest(slug);
    const deps = addonDeps();
    const on = await activeAddons(s.ctx);
    const reqs = missingRequirements(m, on, ADDON_REGISTRY);
    // Every requirement must be addable too, checked before anything goes on.
    const view = await getCatalogView();
    for (const req of reqs) {
      const entry = catalogEntryFor(view, req);
      // WR-C04: a public requirement with no listing entry is Hidden, the same NotFound as
      // addableManifest; only a private requirement (never listed) installs without one.
      if (!entry && ADDON_REGISTRY.get(req)?.visibility === "public") {
        throw new NotFound();
      }
      if (entry && !entry.pickable) {
        throw new InvalidInput(comingSoonAddCopy(entry.name));
      }
    }
    for (const req of reqs) {
      await installAddon(s.ctx, deps, req, tokenFor(tokens, req));
      added.push(req);
    }
    const out = await installAddon(
      s.ctx,
      deps,
      m.slug,
      tokenFor(tokens, m.slug),
    );
    added.push(m.slug);
    return {
      added: [...added],
      tabHref: addonHref(m),
      pageUrl: await pageUrlFor(s, out.page),
    };
  });
  if (!res.ok && added.length > 0) {
    return gateCode({ ...res, added: namesOf(added, ADDON_REGISTRY) });
  }
  return gateCode(res);
}

/**
 * "Update card and pay" / "Update card" (10-31; BILL-03): the provider's card page for the
 * caller's own customer. Owner only, never impersonating (billing:write); the URL is never
 * rendered into the page.
 */
export async function updateCardAction(): Promise<
  ActionResult<{ url: string }>
> {
  return runAction(async (s) => billingPortalLink(s.ctx));
}

/**
 * Remove from site: disables and keeps everything (invariant 9). Any registered slug goes
 * to the chokepoint: an installed private add-on is removable from its org's hub (CONTEXT
 * A3-Q3), and one the org never had is NotFound there, identical to an unknown slug.
 */
export async function removeAddonAction(
  slug: unknown,
): Promise<AddonActionResult<{ slug: string }>> {
  return run(async (s) => {
    const m = anyManifest(slug);
    await uninstallAddon(s.ctx, addonDeps(), m.slug);
    return { slug: m.slug };
  });
}

// ---------------------------------------------------------------------------------------
// Add-on tab actions (05-12; ADDON-08, ADDON-12..14; T-05-58, T-05-60, T-05-61; Pitfall 12).
// One generic set for every list add-on, bound per (slug, collection) by the Website tab's
// server loader. Every argument is untrusted: the slug must be an own property of a
// null-prototype map of the WHOLE registry (a private add-on's tab is still the owner's; the
// chokepoint enforces active state, grants and roles), the collection an own property of that
// manifest's collections. Both are refused before any @cds/db call. The org comes only from
// the session.

/** Same cap as the importer (MAX_IMPORT_CHARS); checked here before any @cds/db call. */
const MAX_TEXT_CHARS = 2_000_000;
/** At most one PB batch of removals (MAX_ADDON_BATCH). */
const MAX_REMOVAL_IDS = 5000;
/** No list add-on holds more than an import batch; a longer reorder is refused outright. */
const MAX_REORDER_IDS = 5000;
const MODE_COPY = "Choose Update only what changed or Replace all.";
const REORDER_COPY =
  "The list changed while you were reordering. Reload and try again.";
/** Keys never forwarded from a record payload (prototype keys; the org comes from ctx). */
const DROPPED_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "organization",
]);

/** Any registered add-on (private included), as a null-prototype map lookup. */
function anyManifest(slug: unknown): AddonManifest {
  if (typeof slug !== "string") throw new NotFound();
  const map: Record<string, AddonManifest> = Object.create(null);
  for (const m of ADDON_REGISTRY.list()) map[m.slug] = m;
  if (!Object.hasOwn(map, slug)) throw new NotFound();
  return map[slug]!;
}

/** The slug and one collection it declared; anything else is NotFound. */
function target(
  slug: unknown,
  collection: unknown,
): { slug: string; collection: string } {
  const m = anyManifest(slug);
  if (
    typeof collection !== "string" ||
    !Object.hasOwn(m.collections, collection)
  ) {
    throw new NotFound();
  }
  return { slug: m.slug, collection };
}

function recordId(id: unknown): string {
  if (typeof id !== "string" || id === "") throw new NotFound();
  return id;
}

function csvText(text: unknown): string {
  if (typeof text !== "string") {
    throw new InvalidInput(fileError("not_csv").message);
  }
  if (text.length > MAX_TEXT_CHARS) {
    throw new InvalidInput(fileError("too_big").message);
  }
  return text;
}

/** Replace all's confirmed removal ids (A-WR-03, D126): undefined, or a list of ids. */
function removalIds(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (
    !Array.isArray(v) ||
    v.length > MAX_REMOVAL_IDS ||
    !v.every((id) => typeof id === "string" && /^[a-z0-9]{15}$/.test(id))
  ) {
    throw new InvalidInput(
      "The list to remove couldn't be read. Check the file again.",
    );
  }
  return v as string[];
}

function importMode(mode: unknown): ImportMode {
  if (mode !== "update" && mode !== "replace")
    throw new InvalidInput(MODE_COPY);
  return mode;
}

/** Own plain keys of a plain object; prototype keys and organization are dropped. */
function recordInput(input: unknown): Record<string, unknown> {
  if (
    typeof input !== "object" ||
    input === null ||
    Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype &&
      Object.getPrototypeOf(input) !== null)
  ) {
    throw new InvalidInput("That item couldn't be read. Try again.");
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (DROPPED_KEYS.has(key)) continue;
    out[key] = (input as Record<string, unknown>)[key];
  }
  return out;
}

export async function saveAddonRecordAction(
  slug: unknown,
  collection: unknown,
  input: unknown,
): Promise<ActionResult<{ id: string; held: boolean }>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    const body = recordInput(input);
    try {
      return await addonRepo(s.ctx, addonDeps(), t.slug)
        .collection(t.collection)
        .save(body);
    } catch (err) {
      // 12-17 (COMM-11, D102): a CDS service window locks the add-on; keep the record.
      await parkIfLocked(s.ctx, err, {
        kind: "addon_record",
        slug: t.slug,
        collection: t.collection,
        record: body,
      });
      throw err;
    }
  });
}

export async function setAddonRecordPublishedAction(
  slug: unknown,
  collection: unknown,
  id: unknown,
  on: unknown,
): Promise<ActionResult<{ held: boolean }>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    const rid = recordId(id);
    if (typeof on !== "boolean") {
      throw new InvalidInput("Show on site must be on or off.");
    }
    return addonRepo(s.ctx, addonDeps(), t.slug)
      .collection(t.collection)
      .setPublished(rid, on);
  });
}

export async function reorderAddonRecordsAction(
  slug: unknown,
  collection: unknown,
  ids: unknown,
): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    if (
      !Array.isArray(ids) ||
      ids.length > MAX_REORDER_IDS ||
      !ids.every((id) => typeof id === "string" && id !== "")
    ) {
      throw new InvalidInput(REORDER_COPY);
    }
    await addonRepo(s.ctx, addonDeps(), t.slug)
      .collection(t.collection)
      .reorder(ids as string[]);
    return null;
  });
}

export async function removeAddonRecordAction(
  slug: unknown,
  collection: unknown,
  id: unknown,
): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    const rid = recordId(id);
    await addonRepo(s.ctx, addonDeps(), t.slug)
      .collection(t.collection)
      .remove(rid);
    return null;
  });
}

export async function importPreviewAction(
  slug: unknown,
  collection: unknown,
  text: unknown,
  mode: unknown,
): Promise<ActionResult<ImportPreview>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    const body = csvText(text);
    const m = importMode(mode);
    return previewAddonImport(
      s.ctx,
      addonDeps(),
      t.slug,
      t.collection,
      body,
      m,
    );
  });
}

export async function importCommitAction(
  slug: unknown,
  collection: unknown,
  text: unknown,
  mode: unknown,
  confirmedRemovals?: unknown,
): Promise<
  ActionResult<{
    added: number;
    updated: number;
    removed: number;
    backupId: string;
  }>
> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    const body = csvText(text);
    const m = importMode(mode);
    const removals = removalIds(confirmedRemovals);
    return importAddonRecords(
      s.ctx,
      addonDeps(),
      t.slug,
      t.collection,
      body,
      m,
      removals,
    );
  });
}

export async function exportCsvAction(
  slug: unknown,
  collection: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction(async (s) => {
    const t = target(slug, collection);
    return exportAddonCsv(s.ctx, addonDeps(), t.slug, t.collection);
  });
}

/** The template holds no org data, but still needs a signed-in member. */
export async function templateCsvAction(
  slug: unknown,
  collection: unknown,
): Promise<ActionResult<{ filename: string; csv: string }>> {
  return runAction(async () => {
    const t = target(slug, collection);
    return addonCsvTemplate(addonDeps(), t.slug, t.collection);
  });
}

export async function listBackupsAction(
  slug: unknown,
): Promise<ActionResult<AddonBackupSummary[]>> {
  return runAction(async (s) => {
    const m = anyManifest(slug);
    return listAddonBackups(s.ctx, addonDeps(), m.slug);
  });
}

/** "Save a backup now": always the manual reason (the browser never picks one). */
export async function saveBackupAction(
  slug: unknown,
): Promise<ActionResult<AddonBackupSummary>> {
  return runAction(async (s) => {
    const m = anyManifest(slug);
    return saveAddonBackup(s.ctx, addonDeps(), m.slug, "manual");
  });
}

/** Restore by backup id only; @cds/db resolves it among the org's own backups (T-05-60). */
export async function restoreBackupAction(
  slug: unknown,
  id: unknown,
): Promise<ActionResult<null>> {
  return runAction(async (s) => {
    const m = anyManifest(slug);
    const backupId = recordId(id);
    await restoreAddonBackup(s.ctx, addonDeps(), m.slug, backupId);
    return null;
  });
}
