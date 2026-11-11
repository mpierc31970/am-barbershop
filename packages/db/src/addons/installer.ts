// The add-on installer (ADDON-04, ADDON-05, ADDON-07, ADDON-09; D21, D27, D183, D264;
// CONTEXT A2-Q1..Q4, A3-Q2..Q3, A5-Q3; RESEARCH Pattern 5, Pitfalls 2 and 8; invariants 3, 9).
//
// Install is declarative and idempotent. Under a separate `addons:<orgId>` lock (the content
// lock is not re-entrant and createPage/saveSection/publishPage take it themselves):
//   1. checks: requires all active, no active conflict (symmetric), path (skipped while the
//      organization has no path) - only when the add-on is not already active
//   2. BillingGate.approve (10-20: the billing-backed gate; D186 charges, install after paid)
//   3. org_addons upsert: none -> create active; disabled -> active (reinstall); active with
//      the same version -> NO write, so a second run is byte-identical
//   4. recipe: the add-on page is seeded once (org_addons.seeded is the ledger). A seeded
//      page the owner later deleted is never recreated (D183). Records seed once per key.
//   5. every entitlement change carries an explicit audit_log row in the same batch
//   6. tags are invalidated only when something changed
// Uninstall disables and retains: it never deletes anything (invariant 9, D27).
// The staff path mints an internal owner-view context with the staff member as
// impersonator, so every content write it causes is audited. That minter is never exported.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  AddonConflict,
  AddonMissingRequirement,
  AddonRequiredBy,
  AddonWrongPath,
  type AddonManifest,
  type AddonRegistry,
  type InstallRecipe,
} from "@cds/core/addons";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { auditBody, type AuditEvent } from "../audit";
import { withSuperuser } from "../client";
import {
  assertPlatformContext,
  mintOrgContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import {
  canonicalJson,
  pageDraftPrint,
  readPageDraft,
} from "../content/draft-print";
import { withOrgLock } from "../content/lock";
import { refreshSiteIndex } from "../content/site-index/build";
import {
  createPage,
  SLUG_MAX,
  SlugReserved,
  SlugTaken,
} from "../content/pages";
import { recordContentFlag } from "../content/flags";
import {
  addonsTag,
  addonTag,
  liveTag,
  pageTag,
  siteTag,
} from "../content/ports";
import { publishPage } from "../content/publish";
import { saveSection } from "../content/sections";
import { pingAndRecord } from "../content/indexing-record";
import { siteUrls, type Op } from "../content/shared";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "../repository";
import { sendAudited } from "./backups";
import { getBillingGate } from "./billing";
import { activeSet, readOrgAddon, seededOf } from "./entitlements";
import { declaredRecordSpec, nextSortOrder, prepareRecord } from "./records";
import type {
  AddonDeps,
  InstallOptions,
  InstallResult,
  InstallSource,
  Seeded,
  UninstallResult,
} from "./types";

const COLLECTION = "org_addons";
/** Seeded page address attempts: slug, slug-2 .. slug-20. */
export const SLUG_ATTEMPTS = 20;
const REASON_MAX = 500;
const RECORDS_KEY_MAX = 100;
const SEED_RECORDS_MAX = 2000;

// ---------------------------------------------------------------------------------------
// Pure pieces (unit-tested)

/** The seeded page address sequence: base, base-2, ..., base-<attempts>. */
export function slugCandidates(
  base: string,
  attempts: number = SLUG_ATTEMPTS,
): string[] {
  const out = [base];
  for (let n = 2; n <= attempts; n++) {
    const suffix = `-${n}`;
    const stem = base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, "");
    out.push(`${stem}${suffix}`);
  }
  return out;
}

/** True when two ledgers hold the same content (key order ignored). */
export function seededEqual(a: Seeded, b: Seeded): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Required add-ons that are not active, in manifest order. */
export function missingRequirements(
  manifest: AddonManifest,
  active: ReadonlySet<string>,
): string[] {
  return manifest.requires.filter((r) => !active.has(r));
}

/** The first active add-on this one conflicts with (symmetric), if any. */
export function activeConflict(
  registry: AddonRegistry,
  slug: string,
  active: ReadonlySet<string>,
): string | undefined {
  return registry.conflictsOf(slug).find((c) => active.has(c));
}

function nameOf(registry: AddonRegistry, slug: string): string {
  return registry.get(slug)?.name ?? slug;
}

// ---------------------------------------------------------------------------------------
// Internals

type WriteOp = {
  collection: string;
  op: "create" | "update";
  id: string;
  body: Record<string, unknown>;
};

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** The writes plus their audit_log row, in one PB batch (T-05-21). */
async function writeAudited(
  pb: PocketBase,
  ctx: OrgContext,
  ops: WriteOp[],
  event: AuditEvent,
): Promise<void> {
  const batch = pb.createBatch();
  for (const w of ops) {
    const col = batch.collection(w.collection);
    if (w.op === "create") col.create({ ...w.body, id: w.id });
    else col.update(w.id, w.body);
  }
  batch.collection("audit_log").create(auditBody(ctx, event));
  await batch.send();
}

/** The organization's product path, or null while organizations has no path field (P6). */
async function orgPath(pb: PocketBase, orgId: string): Promise<string | null> {
  const org = await pb.collection("organizations").getOne(orgId);
  const path = (org as Record<string, unknown>).path;
  return typeof path === "string" && path !== "" ? path : null;
}

function nowIso(deps: AddonDeps): string {
  return (deps.now ? deps.now() : new Date()).toISOString();
}

function changeTags(orgId: string, slug: string, seeded: Seeded): string[] {
  const tags = [addonsTag(orgId), siteTag(orgId), addonTag(orgId, slug)];
  if (seeded.page) tags.push(pageTag(orgId, seeded.page.id));
  return tags;
}

/**
 * Recipe sections still to save on a page that already holds `existingTypes` (A-WR-01).
 * Each existing block of a recipe type counts once toward that recipe entry, so a resume
 * after a partial run saves only the missing ones, in recipe order.
 */
export function missingRecipeSections<T extends { section_type: string }>(
  recipe: readonly T[],
  existingTypes: readonly string[],
): T[] {
  const left = new Map<string, number>();
  for (const t of existingTypes) left.set(t, (left.get(t) ?? 0) + 1);
  const out: T[] = [];
  for (const s of recipe) {
    const n = left.get(s.section_type) ?? 0;
    if (n > 0) left.set(s.section_type, n - 1);
    else out.push(s);
  }
  return out;
}

// The draft print moved to the shared draft-print module in 08-11; re-exported for importers.
export { pageDraftPrint };

type SeededPage = NonNullable<Seeded["page"]>;

/**
 * Create the add-on page, fill it and publish it (a held publish keeps the draft).
 * The ledger records the page as `pending` before its blocks are saved, and complete after
 * the publish (A-WR-01). Each pending marker carries the draft fingerprint the installer
 * left (R2-WR-02). With `resume` (a pending page from an earlier failed run, passed only on
 * the owner's own install retry) the missing blocks are saved and the page published ONLY
 * when the page is still exactly as the installer left it. A page the owner deleted (D183),
 * edited, reordered, published or added to since is never refilled or published: the
 * ledger is just marked complete and the draft stays the owner's.
 */
async function seedPage(
  ctx: OrgContext,
  deps: AddonDeps,
  recipe: NonNullable<InstallRecipe["page"]>,
  resume: SeededPage | null,
  record: (page: SeededPage) => Promise<void>,
): Promise<void> {
  let page: { id: string; slug: string } | null = null;
  let existingTypes: string[] = [];
  if (resume) {
    const found = await readPageDraft(ctx, resume.id);
    if (!found || !resume.draft || found.print !== resume.draft) {
      await record({ id: resume.id, slug: resume.slug });
      return;
    }
    const slug = found.page.slug;
    page = { id: found.page.id, slug: typeof slug === "string" ? slug : "" };
    existingTypes = found.types;
  } else {
    for (const slug of slugCandidates(recipe.slug)) {
      try {
        const p = await createPage(
          ctx,
          { title: recipe.title, slug },
          deps.store,
        );
        page = { id: p.id, slug: p.slug };
        break;
      } catch (err) {
        if (err instanceof SlugTaken || err instanceof SlugReserved) continue;
        throw err;
      }
    }
    if (!page) {
      throw new InvalidInput(
        `Every address for the ${recipe.title} page is taken. Rename one of your pages and try again.`,
      );
    }
    // Ledger first: a failure below never leads a retry to create a second page.
    await markPending(ctx, page, record);
  }
  for (const s of missingRecipeSections(recipe.sections, existingTypes)) {
    await saveSection(
      ctx,
      deps.sections,
      {
        pageId: page.id,
        section_type: s.section_type,
        row_layout: "full",
        content: s.content,
      },
      deps.addons,
    );
    // R2-WR-02: the marker always holds the draft as the installer last left it.
    await markPending(ctx, page, record);
  }
  await publishPage(ctx, page.id, deps);
  await record(page);
}

/**
 * Record the page as pending with the fingerprint of its current draft (R2-WR-02). If the
 * fingerprint cannot be read, the page is still recorded (never a second page), just
 * without one, so a later run marks it complete instead of resuming.
 */
async function markPending(
  ctx: OrgContext,
  page: { id: string; slug: string },
  record: (page: SeededPage) => Promise<void>,
): Promise<void> {
  const draft = await readPageDraft(ctx, page.id).then(
    (d) => d?.print,
    () => undefined,
  );
  await record(
    draft
      ? { id: page.id, slug: page.slug, pending: true, draft }
      : { id: page.id, slug: page.slug, pending: true },
  );
}

/**
 * Seed one records key atomically (A-CR-01). Every row is validated and screened first;
 * then the creates, the ledger marker and one audit row go out in ONE PB batch, so the
 * records and the ledger commit together or not at all. A failure part-way leaves nothing
 * behind, and a retry with the same key seeds the set exactly once.
 */
async function seedRecords(
  ctx: OrgContext,
  deps: AddonDeps,
  manifest: AddonManifest,
  rows: readonly Record<string, unknown>[],
  ledger: {
    rowId: string;
    /** The ledger after this key is seeded (the marker holds `count`). */
    next: (count: number) => Seeded;
    event: AuditEvent;
  },
): Promise<Seeded> {
  const collection = manifest.install.records?.collection;
  if (!collection) {
    throw new InvalidInput(`${manifest.name} does not take starter records.`);
  }
  if (rows.length > SEED_RECORDS_MAX) {
    throw new InvalidInput(`Add up to ${SEED_RECORDS_MAX} records at a time.`);
  }
  const { name, spec } = declaredRecordSpec(manifest, collection);
  // Validate and screen every row before any write: a bad row N refuses the whole set.
  const prepared: Awaited<ReturnType<typeof prepareRecord>>[] = [];
  for (const [i, raw] of rows.entries()) {
    try {
      prepared.push(await prepareRecord(ctx, deps, spec, raw));
    } catch (err) {
      if (err instanceof InvalidInput) {
        throw new InvalidInput(`Record ${i + 1}: ${err.message}`);
      }
      throw err;
    }
  }
  const ids = prepared.map(() => newRecordId());
  const next = ledger.next(ids.length);
  await pbRun(async (pb) => {
    const base = (await nextSortOrder(pb, ctx.orgId, name)) - 1;
    const ops: Op[] = prepared.map((p, i) => ({
      collection: name,
      op: "create",
      id: ids[i]!,
      body: {
        ...p.body,
        organization: ctx.orgId,
        sort_order: base + i + 1,
      },
    }));
    ops.push({
      collection: COLLECTION,
      op: "update",
      id: ledger.rowId,
      body: { seeded: next },
    });
    await sendAudited(pb, ctx, ops, {
      ...ledger.event,
      meta: {
        ...ledger.event.meta,
        collection: name,
        count: ids.length,
      },
    });
  });

  // After the commit (the rows exist now): flags, then one invalidation and one ping.
  for (const [i, p] of prepared.entries()) {
    if (p.outcome.verdict === "clean") continue;
    await recordContentFlag(ctx, {
      targetCollection: name,
      targetId: ids[i]!,
      verdict: p.outcome.verdict,
      reasons: p.outcome.reasons,
    });
  }
  deps.invalidator.invalidate([
    addonTag(ctx.orgId, manifest.slug),
    liveTag(ctx.orgId),
  ]);
  // 14-21 (CONT-16): through the central eligibility guard (custom primary host of a live
  // site only) and recorded per org; pingAndRecord never throws.
  try {
    await pingAndRecord(
      ctx.orgId,
      await withSuperuser((pb) => siteUrls(pb, ctx.orgId)),
      deps.pinger ? { pinger: deps.pinger } : {},
    );
  } catch {
    // Best effort; the records are already saved.
  }
  return next;
}

function assertRecordsOptions(opts: InstallOptions): void {
  if (opts.records === undefined) return;
  if (!Array.isArray(opts.records)) {
    throw new InvalidInput("records must be a list");
  }
  const key = opts.recordsKey;
  if (
    typeof key !== "string" ||
    key.trim() === "" ||
    key.length > RECORDS_KEY_MAX
  ) {
    throw new InvalidInput("records need a recordsKey");
  }
}

async function runInstall(
  ctx: OrgContext,
  deps: AddonDeps,
  manifest: AddonManifest,
  source: InstallSource,
  opts: InstallOptions,
  meta: Record<string, unknown>,
): Promise<InstallResult> {
  assertRecordsOptions(opts);
  const orgId = ctx.orgId;
  const slug = manifest.slug;
  return withOrgLock(`addons:${orgId}`, async () => {
    const { row, active, path } = await pbRun(async (pb) => ({
      row: await readOrgAddon(pb, orgId, slug),
      active: await activeSet(pb, orgId),
      path: await orgPath(pb, orgId),
    }));
    const wasActive = row?.status === "active";

    if (!wasActive) {
      const missing = missingRequirements(manifest, active);
      if (missing.length > 0) {
        const names = missing.map((m) => nameOf(deps.addons, m)).join(", ");
        throw new AddonMissingRequirement(
          `${manifest.name} needs ${names}. Add ${names} first.`,
          missing,
        );
      }
      const conflict = activeConflict(deps.addons, slug, active);
      if (conflict !== undefined) {
        const other = nameOf(deps.addons, conflict);
        throw new AddonConflict(
          `${manifest.name} can't run alongside ${other}. Remove ${other} first.`,
          conflict,
        );
      }
      if (
        path !== null &&
        !(manifest.paths as readonly string[]).includes(path)
      ) {
        throw new AddonWrongPath(
          `${manifest.name} isn't offered for this kind of site.`,
        );
      }
      const approval = await (deps.billing ?? getBillingGate()).approve({
        orgId,
        slug,
        actor: ctx.actor,
        source,
        ...(typeof opts.chargeToken === "string"
          ? { token: opts.chargeToken }
          : {}),
      });
      if (!approval.approved) throw new InvalidInput(approval.reason);
    }

    const rowId = row?.id ?? newRecordId();
    const event = (action: string): AuditEvent => ({
      action,
      targetCollection: COLLECTION,
      targetId: rowId,
      meta: { slug, source, version: manifest.version, ...meta },
    });
    let outcome: InstallResult["outcome"] = "unchanged";
    let audited = false;
    let stored: Seeded = row ? seededOf(row.seeded) : {};

    // Any throw after a state change still invalidates (A-WR-01): the add-on may already
    // be active even though a later step failed.
    try {
      if (!row) {
        await pbRun((pb) =>
          writeAudited(
            pb,
            ctx,
            [
              {
                collection: COLLECTION,
                op: "create",
                id: rowId,
                body: {
                  organization: orgId,
                  addon: slug,
                  status: "active",
                  disabled_reason: "",
                  source,
                  installed_version: manifest.version,
                  seeded: {},
                  installed_at: nowIso(deps),
                  disabled_at: "",
                },
              },
            ],
            event("addon.install"),
          ),
        );
        outcome = "installed";
        audited = true;
      } else if (!wasActive) {
        await pbRun((pb) =>
          writeAudited(
            pb,
            ctx,
            [
              {
                collection: COLLECTION,
                op: "update",
                id: rowId,
                body: {
                  status: "active",
                  disabled_reason: "",
                  disabled_at: "",
                  source,
                  installed_version: manifest.version,
                },
              },
            ],
            event("addon.reinstall"),
          ),
        );
        outcome = "reinstalled";
        audited = true;
      } else if (row.installed_version !== manifest.version) {
        await pbRun((pb) =>
          writeAudited(
            pb,
            ctx,
            [
              {
                collection: COLLECTION,
                op: "update",
                id: rowId,
                body: { installed_version: manifest.version },
              },
            ],
            event("addon.install"),
          ),
        );
        audited = true;
      }

      const saveLedger = async (next: Seeded): Promise<void> => {
        if (seededEqual(stored, next)) return;
        const body = { seeded: next };
        await pbRun(async (pb) => {
          if (audited) await pb.collection(COLLECTION).update(rowId, body);
          else {
            await writeAudited(
              pb,
              ctx,
              [{ collection: COLLECTION, op: "update", id: rowId, body }],
              event("addon.install"),
            );
          }
        });
        audited = true;
        stored = next;
      };

      const pageRecipe = manifest.install.page;
      // R2-WR-02: a pending page is resumed only by the owner's own install retry on an
      // add-on that stayed active (the failed run left it so). A staff or assembly run, a
      // records seed, and a remove-then-add-back leave the pending page alone.
      const mayResume =
        source === "hub" && wasActive && opts.records === undefined;
      if (
        pageRecipe &&
        (!stored.page || (stored.page.pending === true && mayResume))
      ) {
        await seedPage(ctx, deps, pageRecipe, stored.page ?? null, (page) =>
          saveLedger({ ...stored, page }),
        );
      }
      const key = opts.recordsKey;
      if (opts.records !== undefined && typeof key === "string") {
        const done = stored.records ?? {};
        if (!Object.prototype.hasOwnProperty.call(done, key)) {
          const at = nowIso(deps);
          const base = stored;
          stored = await seedRecords(ctx, deps, manifest, opts.records, {
            rowId,
            next: (count) => ({
              ...base,
              records: { ...done, [key]: { count, at } },
            }),
            event: event("addon.install.records"),
          });
          audited = true;
        }
      }
    } finally {
      if (audited) {
        await refreshSiteIndex(orgId, deps); // 07-31: rebuild index.json
        deps.invalidator.invalidate(changeTags(orgId, slug, stored));
      }
    }
    const page = stored.page
      ? { id: stored.page.id, slug: stored.page.slug }
      : null;
    return { slug, outcome, page };
  });
}

/** Why an add-on row is disabled. `billing_lapse` is set only by the billing job (10-15). */
type DisableReason = "uninstalled" | "staff" | "billing_lapse";

async function runUninstall(
  ctx: OrgContext,
  deps: AddonDeps,
  manifest: AddonManifest,
  reason: DisableReason,
  meta: Record<string, unknown>,
  opts: { release?: boolean } = {},
): Promise<UninstallResult> {
  const orgId = ctx.orgId;
  const slug = manifest.slug;
  return withOrgLock(`addons:${orgId}`, async () => {
    const { row, active } = await pbRun(async (pb) => ({
      row: await readOrgAddon(pb, orgId, slug),
      active: await activeSet(pb, orgId),
    }));
    if (
      row &&
      row.status === "disabled" &&
      row.disabled_reason === "billing_lapse" &&
      reason !== "billing_lapse"
    ) {
      // Removed while paused for a lapse (RESEARCH Pitfall 5): the reason is rewritten, so
      // paying again never brings back an add-on the owner (or staff) took off.
      await pbRun((pb) =>
        writeAudited(
          pb,
          ctx,
          [
            {
              collection: COLLECTION,
              op: "update",
              id: row.id,
              body: { disabled_reason: reason },
            },
          ],
          {
            action: "addon.uninstall",
            targetCollection: COLLECTION,
            targetId: row.id,
            meta: {
              slug,
              version: manifest.version,
              from: "billing_lapse",
              ...meta,
            },
          },
        ),
      );
      deps.invalidator.invalidate(
        changeTags(orgId, slug, seededOf(row.seeded)),
      );
      return { slug, outcome: "removed" };
    }
    if (!row || row.status !== "active") return { slug, outcome: "unchanged" };
    // A lapse pauses every paid add-on together, so it never refuses for dependents.
    const dependents =
      reason === "billing_lapse"
        ? []
        : deps.addons.dependentsOf(slug).filter((d) => active.has(d));
    if (dependents.length > 0) {
      const first = nameOf(deps.addons, dependents[0]!);
      throw new AddonRequiredBy(
        `${first} needs ${manifest.name}. Remove ${first} first.`,
        [...dependents],
      );
    }
    if (reason === "uninstalled" && opts.release !== false) {
      // 10-20 choice 3: an owner uninstall drops the subscription item first, with proration
      // credit. A failure throws and the add-on stays on (never off while still billed). A
      // lapse (already unpaid) and a staff uninstall (--no-charge / quote) never call it.
      const gate = deps.billing ?? getBillingGate();
      await gate.release?.({ orgId, slug, actor: ctx.actor });
    }
    await pbRun((pb) =>
      writeAudited(
        pb,
        ctx,
        [
          {
            collection: COLLECTION,
            op: "update",
            id: row.id,
            body: {
              status: "disabled",
              disabled_reason: reason,
              disabled_at: nowIso(deps),
            },
          },
        ],
        {
          action:
            reason === "billing_lapse"
              ? "addon.billing_lapse"
              : "addon.uninstall",
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { slug, version: manifest.version, ...meta },
        },
      ),
    );
    await refreshSiteIndex(orgId, deps); // 07-31: rebuild index.json
    deps.invalidator.invalidate(changeTags(orgId, slug, seededOf(row.seeded)));
    return { slug, outcome: "removed" };
  });
}

function hubManifest(deps: AddonDeps, slug: unknown): AddonManifest | null {
  const m = deps.addons.get(slug);
  return m && m.visibility === "public" ? m : null;
}

type StaffInput = { orgId: string; slug: string; reason: string };

async function staffPrelude(
  pctx: PlatformContext,
  deps: AddonDeps,
  input: StaffInput,
): Promise<{ ctx: OrgContext; manifest: AddonManifest; reason: string }> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "addon_install");
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("staff install input must be an object");
  }
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason === "" || reason.length > REASON_MAX) {
    throw new InvalidInput(`Give a reason, up to ${REASON_MAX} characters.`);
  }
  const orgId = input.orgId;
  assertId(orgId);
  const manifest = deps.addons.get(input.slug);
  if (!manifest) throw new NotFound();
  await pbRun((pb) =>
    pb.collection("organizations").getOne(orgId, { fields: "id" }),
  );
  // Internal owner view, audited as the staff member (never exported, CONTEXT A2-Q4).
  const ctx = mintOrgContext({
    orgId,
    actor: pctx.actor,
    role: "owner",
    grants: [],
    impersonator: pctx.actor,
    ip: pctx.ip,
  });
  return { ctx, manifest, reason };
}

// ---------------------------------------------------------------------------------------
// Public API

/** Owner hub install ("Add to site"). Private add-ons are NotFound here (no oracle). */
export async function installAddon(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: unknown,
  opts: InstallOptions = {},
): Promise<InstallResult> {
  requirePermission(ctx, "addons", "run");
  const manifest = hubManifest(deps, slug);
  if (!manifest) throw new NotFound();
  return runInstall(ctx, deps, manifest, "hub", opts, {});
}

/**
 * Owner hub uninstall ("Remove"): disables and retains. An unknown slug is NotFound, never a
 * success-shaped no-op (A-WR-08). A private add-on the org has a row for behaves like any
 * add-on in that org's hub (CONTEXT A3-Q3); one it never had is NotFound, exactly like an
 * unknown slug (no oracle).
 */
export async function uninstallAddon(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: unknown,
): Promise<UninstallResult> {
  requirePermission(ctx, "addons", "run");
  const manifest = deps.addons.get(slug);
  if (!manifest) throw new NotFound();
  if (manifest.visibility !== "public") {
    const row = await pbRun((pb) => readOrgAddon(pb, ctx.orgId, manifest.slug));
    if (!row) throw new NotFound();
  }
  return runUninstall(ctx, deps, manifest, "uninstalled", {});
}

/** Staff console / CLI install (super_admin, with a reason). Private add-ons allowed. */
export async function installAddonAsStaff(
  pctx: PlatformContext,
  deps: AddonDeps,
  input: StaffInput & { source?: "staff" | "assembly" } & InstallOptions,
): Promise<InstallResult> {
  const { ctx, manifest, reason } = await staffPrelude(pctx, deps, input);
  const source: InstallSource =
    input.source === "assembly" ? "assembly" : "staff";
  const opts: InstallOptions = {};
  if (input.records !== undefined) opts.records = input.records;
  if (input.recordsKey !== undefined) opts.recordsKey = input.recordsKey;
  return runInstall(ctx, deps, manifest, source, opts, { reason });
}

/**
 * The payment handlers' install (10-12; CONTEXT A2, D186): an add-on the owner paid for at
 * checkout, `source = billing`, no setup fee. Only the billing job's context may call it
 * (minted by payments/accounts.ts billingOrgContext); internal, never exported from index.ts.
 * An add-on already active is a no-op ("unchanged").
 */
export async function installAddonForBilling(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
): Promise<InstallResult> {
  requirePermission(ctx, "addons", "run");
  if (ctx.systemJob !== "billing") {
    throw new InvalidInput("billing installs run as the billing job");
  }
  const manifest = deps.addons.get(slug);
  if (!manifest) throw new NotFound();
  return runInstall(ctx, deps, manifest, "billing", {}, {});
}

function assertBillingJob(ctx: OrgContext): void {
  requirePermission(ctx, "addons", "run");
  if (ctx.systemJob !== "billing") {
    throw new InvalidInput("billing lapse changes run as the billing job");
  }
}

/**
 * Billing lapse (10-15; BILL-03, D27, invariant 9): every listed add-on that is active flips
 * to `disabled` / `billing_lapse`, audited as `addon.billing_lapse`. Nothing is deleted: the
 * add-on's records, pages and ledger stay exactly as they are. Unknown slugs are skipped.
 * Internal (billing job only); returns the slugs this call paused.
 */
export async function lapseAddons(
  ctx: OrgContext,
  deps: AddonDeps,
  slugs: readonly string[],
): Promise<string[]> {
  assertBillingJob(ctx);
  const paused: string[] = [];
  for (const slug of [...new Set(slugs)]) {
    const manifest = deps.addons.get(slug);
    if (!manifest) continue;
    const res = await runUninstall(ctx, deps, manifest, "billing_lapse", {});
    if (res.outcome === "removed") paused.push(slug);
  }
  return paused;
}

/**
 * CR-E03 (D186): add-ons installed before checkout (hub or assembly, free until then) that
 * the owner took off the paid order. Each becomes `disabled` / `uninstalled` (the owner's
 * own choice at checkout; disables and retains, invariant 9), audited `addon.uninstall` with
 * `from: "checkout"`. There is no subscription item to release. Dependents go first; a
 * requirement a paid add-on still needs stays on (logged). Internal (billing job only);
 * returns the slugs turned off.
 */
export async function uninstallUnorderedAddons(
  ctx: OrgContext,
  deps: AddonDeps,
  slugs: readonly string[],
): Promise<string[]> {
  assertBillingJob(ctx);
  const removed: string[] = [];
  let pending = [...new Set(slugs)].filter(
    (s) => deps.addons.get(s) !== undefined,
  );
  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    for (const slug of [...pending]) {
      try {
        const res = await runUninstall(
          ctx,
          deps,
          deps.addons.get(slug)!,
          "uninstalled",
          { from: "checkout" },
          { release: false },
        );
        if (res.outcome === "removed") removed.push(slug);
        pending = pending.filter((s) => s !== slug);
        progress = true;
      } catch (err) {
        if (!(err instanceof AddonRequiredBy)) throw err;
      }
    }
  }
  for (const slug of pending) {
    console.error(
      `[payments] org ${ctx.orgId}: ${slug} stays on (a paid add-on needs it)`,
    );
  }
  return removed;
}

/**
 * Paying again (10-15; RESEARCH Pitfall 5): re-enables ONLY rows disabled for
 * `billing_lapse`. Rows the owner or staff removed (reason `uninstalled` / `staff`) stay off.
 * The row keeps its source, version and ledger, so the add-on returns exactly as it was.
 * A row whose requirement is no longer active, or that now conflicts with an active add-on,
 * stays paused (logged). Internal (billing job only); returns the slugs re-enabled.
 */
export async function restoreLapsedAddons(
  ctx: OrgContext,
  deps: AddonDeps,
): Promise<string[]> {
  assertBillingJob(ctx);
  const orgId = ctx.orgId;
  return withOrgLock(`addons:${orgId}`, async () => {
    const { rows, active } = await pbRun(async (pb) => ({
      rows: await pb.collection(COLLECTION).getFullList({
        filter: pb.filter(
          "organization = {:org} && status = 'disabled' && disabled_reason = 'billing_lapse'",
          { org: orgId },
        ),
        sort: "addon,id",
      }),
      active: await activeSet(pb, orgId),
    }));
    // Restore in requirement order: a row is restorable once its requirements are active
    // (or restored in this run) and it conflicts with nothing active.
    const pending = rows.filter((r) => deps.addons.get(r.addon) !== undefined);
    const restored: string[] = [];
    let progress = true;
    while (progress && pending.length > 0) {
      progress = false;
      for (let i = 0; i < pending.length; i++) {
        const row = pending[i]!;
        const manifest = deps.addons.get(row.addon)!;
        if (missingRequirements(manifest, active).length > 0) continue;
        if (activeConflict(deps.addons, manifest.slug, active) !== undefined) {
          continue;
        }
        await pbRun((pb) =>
          writeAudited(
            pb,
            ctx,
            [
              {
                collection: COLLECTION,
                op: "update",
                id: row.id,
                body: {
                  status: "active",
                  disabled_reason: "",
                  disabled_at: "",
                },
              },
            ],
            {
              action: "addon.billing_restore",
              targetCollection: COLLECTION,
              targetId: row.id,
              meta: { slug: manifest.slug, version: manifest.version },
            },
          ),
        );
        active.add(manifest.slug);
        restored.push(manifest.slug);
        deps.invalidator.invalidate(
          changeTags(orgId, manifest.slug, seededOf(row.seeded)),
        );
        pending.splice(i, 1);
        i -= 1;
        progress = true;
      }
    }
    for (const row of pending) {
      console.error(
        `[payments] org ${orgId}: ${String(row.addon)} stays paused (requirement or conflict)`,
      );
    }
    if (restored.length > 0) await refreshSiteIndex(orgId, deps);
    return restored;
  });
}

/** Staff console / CLI uninstall (super_admin, with a reason): disables and retains. */
export async function uninstallAddonAsStaff(
  pctx: PlatformContext,
  deps: AddonDeps,
  input: StaffInput,
): Promise<UninstallResult> {
  const { ctx, manifest, reason } = await staffPrelude(pctx, deps, input);
  return runUninstall(ctx, deps, manifest, "staff", { reason });
}

/** Records kept for an add-on across its collections ("Your 12 testimonials come back"). */
export async function retainedRecordCounts(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
): Promise<number> {
  requirePermission(ctx, "addons", "read");
  const manifest = deps.addons.get(slug);
  if (!manifest) throw new NotFound();
  const names = Object.keys(manifest.collections);
  if (names.length === 0) return 0;
  return pbRun(async (pb) => {
    let total = 0;
    for (const name of names) {
      const res = await pb.collection(name).getList(1, 1, {
        filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
        fields: "id",
      });
      total += res.totalItems;
    }
    return total;
  });
}
