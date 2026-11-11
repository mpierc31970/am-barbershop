// Page sections chokepoint (CONT-01, CONT-02, CONT-07, CONT-11; D32, D77, D254; CONTEXT
// A1-Q2/Q3, A2-Q3; invariants 1, 5, 6, 7; T-03-18, T-03-19, T-03-24).
//
// page_sections is writes:"custom". Every write here:
//   - requires content:write; the organization always comes from the context
//   - loads the page with a scoped lookup (foreign = absent = NotFound, Pitfall 7); an
//     existing section must belong to that page and org
//   - validates section_type against the INJECTED registry (DI, RESEARCH Pattern 3;
//     @cds/db never composes it). No registry type = InvalidInput; "custom" never exists
//     (CONT-32).
//   - clamps row_layout to the type's layouts (invariant 6), validates the content deny by
//     default, normalizes a columns block to its layout (CONT-07, D77: surplus columns merge
//     into the last one) and sanitizes every rich-text field (CONT-09, T-03-19)
//   - stores settings as { background_variant } only: other keys would be raw styling
//     (invariant 7, D183)
//   - checks every pop-up, form and media asset the content references belongs to the org
//     (T-03-18, generalized): the ids come from the definition's refsOf
//   - refuses a second H1-owning block (hero) on a page (CONT-35, D280), on save and on
//     undo-delete; hidden heroes count
//   - writes page_slug from the page (never used for lookup) and sets
//     pages.has_unpublished_changes in the same batch
//   - never writes a version: versions are written on publish only (D254)
//   - refuses a block type owned by an add-on that is not active (AddonNotActive, 05-10;
//     ADDON-05, T-05-50), on save AND on undo-delete. The owner lookup is the caller's
//     `addons`, else the one @cds/addon-registry/server registers at load; with neither, a
//     non-core block type is refused outright (fail closed, A-WR-04). Hide, reorder and
//     delete stay available, so a retained block can always be cleared away.
// Reorder is one PB batch (never N client updates). Hide keeps the block in the draft.
import { InvalidInput, NotFound } from "@cds/core";
import {
  assertSectionType,
  assertTablePlan,
  clampLayout,
  CORE_SECTIONS,
  normalizeColumns,
  repairDuplicateItemIds,
  sectionOwnsH1,
  type ColumnsContent,
  type RowLayout,
  type SectionRefs,
  type SectionRegistry,
  type TableBlockContent,
} from "@cds/core/content";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { assertAddonActive } from "../addons/entitlements";
import { auditBody } from "../audit";
import type { OrgContext } from "../context";
import { hasEntitlement } from "../payments/entitlements";
import {
  assertId,
  newRecordId,
  requirePermission,
  tenantRepo,
} from "../repository";
import { getScopedPage, markPageChanged } from "./pages";
import {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  run,
  scopedGet,
  type Op,
} from "./shared";

const COLLECTION = "page_sections";

// Defined in @cds/core/content so client components can type props without @cds/db (10-18).
export type { SectionRow } from "@cds/core/content";
import type { SectionRow } from "@cds/core/content";

/** A deleted section's snapshot, enough for undoDeleteSection to put it back. */
export type DeletedSection = SectionRow;

export type SaveSectionInput = {
  id?: string;
  pageId: string;
  section_type: string;
  row_layout: string;
  content: unknown;
  settings?: unknown;
  /** New sections only: undefined = at the end, null = at the top, id = right after it. */
  afterId?: string | null;
};

function settingsOf(raw: unknown): SectionRow["settings"] {
  const v =
    typeof raw === "object" && raw !== null && !Array.isArray(raw)
      ? own(raw as Record<string, unknown>, "background_variant")
      : undefined;
  return { background_variant: v === "alternate" ? "alternate" : "main" };
}

export function toSectionRow(r: RecordModel): SectionRow {
  return {
    id: r.id,
    page: typeof r.page === "string" ? r.page : "",
    section_type: typeof r.section_type === "string" ? r.section_type : "",
    row_layout: typeof r.row_layout === "string" ? r.row_layout : "full",
    // A columns row whose item ids repeat reads back repaired, so the builder can save it
    // (a save refuses duplicates) instead of failing on every edit (IN-R02).
    content:
      r.section_type === "columns"
        ? repairDuplicateItemIds(r.content ?? {})
        : (r.content ?? {}),
    settings: settingsOf(r.settings),
    sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
    is_published: r.is_published === true,
  };
}

async function pageSections(
  pb: PocketBase,
  ctx: OrgContext,
  pageId: string,
): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org} && page = {:page}", {
      org: ctx.orgId,
      page: pageId,
    }),
    sort: "sort_order,created,id",
  });
}

/** Where each kind of block reference lives. */
const REF_COLLECTIONS = [
  ["popups", "popups"],
  ["forms", "forms"],
  ["media", "media_assets"],
] as const;

/**
 * Every pop-up, form and media asset a block references must be the org's own (T-03-18,
 * generalized; T-07-04-02): NotFound otherwise. An empty list touches nothing, so a
 * collection is only read once a block references it.
 */
export async function assertRefsOwned(
  pb: PocketBase,
  ctx: OrgContext,
  refs: SectionRefs,
): Promise<void> {
  for (const [key, collection] of REF_COLLECTIONS) {
    const ids: unknown = refs?.[key];
    if (!Array.isArray(ids) || ids.length === 0) continue;
    for (const id of new Set(ids as unknown[])) {
      if (typeof id !== "string" || id === "") continue;
      await scopedGet(pb, ctx, collection, id);
    }
  }
}

/** Every pop-up a button opens must be the org's own (T-03-18): NotFound otherwise. */
export async function assertPopupsOwned(
  pb: PocketBase,
  ctx: OrgContext,
  ids: string[],
): Promise<void> {
  await assertRefsOwned(pb, ctx, { popups: ids, forms: [], media: [] });
}

export const SECOND_HERO_MESSAGE =
  "This page already has a Hero block. A page can have only one.";

/**
 * One H1-owning block (the hero) per page (CONT-35, D280; T-07-04-01). Runs inside the
 * org lock. Hidden rows count: they are still in the draft.
 */
async function assertSingleHero(
  pb: PocketBase,
  ctx: OrgContext,
  registry: SectionRegistry,
  pageId: string,
  sectionType: string,
  selfId?: string,
): Promise<void> {
  if (!sectionOwnsH1(registry, sectionType)) return;
  const rows = await pageSections(pb, ctx, pageId);
  if (
    rows.some((r) => r.id !== selfId && sectionOwnsH1(registry, r.section_type))
  ) {
    throw new InvalidInput(SECOND_HERO_MESSAGE);
  }
}

type Prepared = {
  section_type: string;
  row_layout: RowLayout;
  content: unknown;
  settings: SectionRow["settings"];
};

/** Registry type, clamped layout, validated + normalized + sanitized content, settings. */
async function prepare(
  pb: PocketBase,
  ctx: OrgContext,
  registry: SectionRegistry,
  input: Record<string, unknown>,
): Promise<Prepared> {
  const type = own(input, "section_type");
  if (typeof type !== "string") throw new InvalidInput("Unknown block type.");
  const def = assertSectionType(registry, type);
  const row_layout = clampLayout(def.layouts, own(input, "row_layout"));
  let content = def.validate(own(input, "content"), row_layout);
  if (def.type === "columns") {
    content = normalizeColumns(content as ColumnsContent, row_layout);
  }
  content = def.mapRichText(content, sanitizeRichText);
  await assertRefsOwned(pb, ctx, def.refsOf(content));
  return {
    section_type: def.type,
    row_layout,
    content,
    settings: settingsOf(own(input, "settings")),
  };
}

/**
 * Builder Pro plan check for a table block (BILL-14, D233, invariant 9; T-10-41-01/03).
 * Runs after structural validation. `previous` is the stored content of the same section
 * (null for a new or restored one): a Pro part unchanged from it is kept while lapsed.
 * Other block types pass without an entitlement read.
 */
async function checkTablePlan(
  ctx: OrgContext,
  prepared: Prepared,
  previous: unknown,
): Promise<void> {
  if (prepared.section_type !== "table") return;
  assertTablePlan(prepared.content as TableBlockContent, {
    proEntitled: await hasEntitlement(ctx, "builder-pro"),
    previous:
      previous && typeof previous === "object" && !Array.isArray(previous)
        ? (previous as TableBlockContent)
        : null,
  });
}

/** Renumber sort_order 1..n for `ordered`, as update ops for the rows that change. */
function renumber(
  ordered: { id: string; sort_order: number }[],
  skip?: string,
): Op[] {
  const ops: Op[] = [];
  ordered.forEach((row, i) => {
    if (row.id === skip) return;
    if (row.sort_order !== i + 1) {
      ops.push({
        collection: COLLECTION,
        op: "update",
        id: row.id,
        body: { sort_order: i + 1 },
      });
    }
  });
  return ops;
}

/** Create (with a chosen id and position) inside the lock. */
async function createAt(
  pb: PocketBase,
  ctx: OrgContext,
  page: RecordModel,
  prepared: Prepared,
  id: string,
  isPublished: boolean,
  position: (rows: RecordModel[]) => number,
): Promise<void> {
  const rows = await pageSections(pb, ctx, page.id);
  const at = Math.min(Math.max(position(rows), 0), rows.length);
  const ordered = rows.map((r) => ({
    id: r.id,
    sort_order: Number(r.sort_order) || 0,
  }));
  ordered.splice(at, 0, { id, sort_order: at + 1 });
  await commit(
    pb,
    ctx,
    [
      {
        collection: COLLECTION,
        op: "create",
        id,
        body: {
          organization: ctx.orgId,
          page: page.id,
          page_slug: page.slug,
          ...prepared,
          sort_order: at + 1,
          is_published: isPublished,
        },
      },
      ...renumber(ordered, id),
      markPageChanged(page.id),
    ],
    {
      action: `${COLLECTION}.create`,
      targetCollection: COLLECTION,
      targetId: id,
      meta: { page: page.id, section_type: prepared.section_type },
    },
  );
}

// ---------------------------------------------------------------------------------------
// Public API

/** A page's sections (the draft), by sort_order. */
export async function listSections(
  ctx: OrgContext,
  pageId: string,
): Promise<SectionRow[]> {
  assertId(pageId);
  await tenantRepo("pages").get(ctx, pageId);
  const res = await tenantRepo(COLLECTION).list(ctx, {
    filter: "page = {:page}",
    params: { page: pageId },
    sort: "sort_order",
    perPage: 500,
  });
  return res.items.map(toSectionRow);
}

/** Which add-on owns a section type (the add-on registry, or a subset of it). */
export type SectionAddonOwners = {
  ownerOf(sectionType: unknown): string | undefined;
  /** For the add-on's display name in the refusal copy; the slug is used without it. */
  get?(slug: unknown): { name: string } | undefined;
};

export function addonOffBlockCopy(name: string): string {
  return `${name} is off, so this block can't be changed. Add ${name} back to edit it.`;
}

let registeredOwners: SectionAddonOwners | undefined;

/**
 * The add-on section owners every save and undo checks by default (A-WR-04). Called once by
 * @cds/addon-registry/server at load; a caller's explicit `addons` still wins.
 */
export function registerSectionAddonOwners(owners: SectionAddonOwners): void {
  if (!owners || typeof owners.ownerOf !== "function") {
    throw new Error("registerSectionAddonOwners needs an ownerOf lookup");
  }
  registeredOwners = owners;
}

/** Test hook: forget the registered owners. */
export function resetSectionAddonOwnersForTest(): void {
  registeredOwners = undefined;
}

const CORE_TYPES: ReadonlySet<string> = new Set(
  CORE_SECTIONS.map((d) => d.type),
);

export const ADDON_REGISTRY_MISSING =
  "saveSection needs the add-on registry for a non-core block type (import @cds/addon-registry/server or pass addons)";

/**
 * AddonNotActive unless every add-on owning one of these types is active. Fails closed: with
 * no owner lookup at all, any non-core type is refused (A-WR-04).
 */
async function assertOwnersActive(
  pb: PocketBase,
  ctx: OrgContext,
  addons: SectionAddonOwners | undefined,
  types: readonly unknown[],
): Promise<void> {
  const owners = addons ?? registeredOwners;
  if (!owners) {
    if (types.some((t) => typeof t !== "string" || !CORE_TYPES.has(t))) {
      throw new Error(ADDON_REGISTRY_MISSING);
    }
    return;
  }
  const slugs = new Set<string>();
  for (const t of types) {
    const slug = owners.ownerOf(t);
    if (slug) slugs.add(slug);
  }
  for (const slug of slugs) {
    const name = owners.get?.(slug)?.name ?? slug;
    await assertAddonActive(
      pb,
      ctx.orgId,
      { slug, name },
      addonOffBlockCopy(name),
    );
  }
}

/**
 * Create or update one section of a page. A block type owned by an add-on that is not
 * active is refused (the chokepoint half of disable-and-retain, ADDON-05). `addons`
 * overrides the registered owner lookup.
 */
export async function saveSection(
  ctx: OrgContext,
  registry: SectionRegistry,
  raw: SaveSectionInput,
  addons?: SectionAddonOwners,
): Promise<SectionRow> {
  requirePermission(ctx, "content", "write");
  if (!registry || typeof registry.get !== "function") {
    throw new Error("saveSection needs the composed section registry");
  }
  const input = asInput(raw, "section input");
  rejectForeignOrg(ctx, input);
  const pageId = own(input, "pageId");
  assertId(pageId);
  const id = own(input, "id");
  if (id !== undefined) assertId(id);
  const afterId = own(input, "afterId");
  if (afterId !== undefined && afterId !== null) assertId(afterId);

  return run(ctx, async (pb) => {
    const page = await getScopedPage(pb, ctx, pageId);
    const prepared = await prepare(pb, ctx, registry, input);
    await assertSingleHero(
      pb,
      ctx,
      registry,
      page.id,
      prepared.section_type,
      typeof id === "string" ? id : undefined,
    );
    if (typeof id === "string") {
      const existing = await scopedGet(pb, ctx, COLLECTION, id);
      if (existing.page !== page.id) throw new NotFound();
      await assertOwnersActive(pb, ctx, addons, [
        prepared.section_type,
        existing.section_type,
      ]);
      await checkTablePlan(
        ctx,
        prepared,
        existing.section_type === "table" ? existing.content : null,
      );
      await commit(
        pb,
        ctx,
        [
          {
            collection: COLLECTION,
            op: "update",
            id,
            body: { ...prepared, page_slug: page.slug },
          },
          markPageChanged(page.id),
        ],
        {
          action: `${COLLECTION}.update`,
          targetCollection: COLLECTION,
          targetId: id,
          meta: { page: page.id, section_type: prepared.section_type },
        },
      );
      return toSectionRow(await scopedGet(pb, ctx, COLLECTION, id));
    }
    await assertOwnersActive(pb, ctx, addons, [prepared.section_type]);
    await checkTablePlan(ctx, prepared, null);
    const newId = newRecordId();
    await createAt(pb, ctx, page, prepared, newId, true, (rows) => {
      if (afterId === undefined) return rows.length;
      if (afterId === null) return 0;
      const i = rows.findIndex((r) => r.id === afterId);
      if (i < 0) throw new NotFound();
      return i + 1;
    });
    return toSectionRow(await scopedGet(pb, ctx, COLLECTION, newId));
  });
}

/** One block of a whole-page replace (replacePageSections). */
export type ReplaceSectionInput = {
  section_type: string;
  row_layout: string;
  content: unknown;
  settings?: unknown;
};

/** Most blocks one whole-page replace takes (well under the PB batch cap). */
export const REPLACE_MAX_BLOCKS = 100;

/**
 * Replace every section of a page, in order, in one batch (internal to @cds/db, used by
 * assembly re-runs (08-15/08-16); not exported from index.ts).
 *
 * Every new block goes through the same `prepare` body as saveSection (registry type,
 * layout clamp, validation, columns normalize, rich-text sanitize, refs owned by the org),
 * the one-hero rule over the new set and the add-on-active check, all BEFORE any row is
 * deleted: an invalid block changes nothing. Then the old rows are deleted and the new ones
 * created under the one content lock, with markPageChanged. No undo entries: the assembly
 * report, not an 8 s toast, is how a re-run is explained.
 */
export async function replacePageSections(
  ctx: OrgContext,
  registry: SectionRegistry,
  pageId: string,
  blocks: readonly ReplaceSectionInput[],
  addons?: SectionAddonOwners,
): Promise<SectionRow[]> {
  requirePermission(ctx, "content", "write");
  if (!registry || typeof registry.get !== "function") {
    throw new Error("replacePageSections needs the composed section registry");
  }
  assertId(pageId);
  if (!Array.isArray(blocks)) throw new InvalidInput("blocks must be a list");
  if (blocks.length > REPLACE_MAX_BLOCKS) {
    throw new InvalidInput(
      `A page takes up to ${REPLACE_MAX_BLOCKS} blocks at a time.`,
    );
  }
  const inputs = blocks.map((b) => {
    const input = asInput(b, "section input");
    rejectForeignOrg(ctx, input);
    return input;
  });

  return run(ctx, async (pb) => {
    const page = await getScopedPage(pb, ctx, pageId);
    const prepared: Prepared[] = [];
    for (const input of inputs) {
      prepared.push(await prepare(pb, ctx, registry, input));
    }
    if (
      prepared.filter((p) => sectionOwnsH1(registry, p.section_type)).length > 1
    ) {
      throw new InvalidInput(SECOND_HERO_MESSAGE);
    }
    await assertOwnersActive(
      pb,
      ctx,
      addons,
      prepared.map((p) => p.section_type),
    );
    for (const p of prepared) await checkTablePlan(ctx, p, null);
    const current = await pageSections(pb, ctx, page.id);
    const ops: Op[] = current.map((r) => ({
      collection: COLLECTION,
      op: "delete",
      id: r.id,
    }));
    prepared.forEach((p, i) => {
      ops.push({
        collection: COLLECTION,
        op: "create",
        id: newRecordId(),
        body: {
          organization: ctx.orgId,
          page: page.id,
          page_slug: page.slug,
          ...p,
          sort_order: i + 1,
          is_published: true,
        },
      });
    });
    ops.push(markPageChanged(page.id));
    await commit(pb, ctx, ops, {
      action: `${COLLECTION}.replace`,
      targetCollection: "pages",
      targetId: page.id,
      meta: { removed: current.length, added: prepared.length },
    });
    return (await pageSections(pb, ctx, page.id)).map(toSectionRow);
  });
}

/** Set a page's section order. `orderedIds` must be exactly the page's section ids. */
export async function reorderSections(
  ctx: OrgContext,
  pageId: string,
  orderedIds: string[],
): Promise<void> {
  requirePermission(ctx, "content", "write");
  assertId(pageId);
  if (!Array.isArray(orderedIds)) {
    throw new InvalidInput("the new order must list the page's blocks");
  }
  for (const id of orderedIds) assertId(id);
  await run(ctx, async (pb) => {
    const page = await getScopedPage(pb, ctx, pageId);
    const rows = await pageSections(pb, ctx, page.id);
    const current = new Set(rows.map((r) => r.id));
    const next = new Set(orderedIds);
    if (
      next.size !== orderedIds.length ||
      next.size !== current.size ||
      orderedIds.some((id) => !current.has(id))
    ) {
      throw new InvalidInput("the new order must list the page's blocks");
    }
    const ops: Op[] = orderedIds.map((id, i) => ({
      collection: COLLECTION,
      op: "update",
      id,
      body: { sort_order: i + 1 },
    }));
    // Always one batch, even for a single block.
    const batch = pb.createBatch();
    for (const w of [...ops, markPageChanged(page.id)]) {
      if (w.op === "update")
        batch.collection(w.collection).update(w.id, w.body);
    }
    if (ctx.impersonator) {
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: `${COLLECTION}.reorder`,
          targetCollection: "pages",
          targetId: page.id,
        }),
      );
    }
    await batch.send();
  });
}

/** Hide a block from the published page (it stays in the draft), or show it again. */
export async function setSectionHidden(
  ctx: OrgContext,
  sectionId: string,
  hidden: boolean,
): Promise<void> {
  requirePermission(ctx, "content", "write");
  if (typeof hidden !== "boolean")
    throw new InvalidInput("hidden must be true or false");
  await run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, sectionId);
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "update",
          id: row.id,
          body: { is_published: !hidden },
        },
        markPageChanged(String(row.page)),
      ],
      {
        action: `${COLLECTION}.update`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { hidden },
      },
    );
  });
}

// ---------------------------------------------------------------------------------------
// Undo ledger (WR-A06). undoDeleteSection re-creates a block with its old id, and that id
// arrives as caller data. Only ids this org deleted, recently, from this page may come back:
// anything else would let the caller pick record ids and would turn PB's uniqueness error
// into a cross-tenant existence oracle (Pitfall 7). In memory: the Undo toast lives 8 s,
// and a restarted server simply refuses the undo (NotFound), like any unknown id.

/** How long a deleted block can be undone (well past the 8 s Undo toast). */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;
/** Per-org cap, so a delete loop cannot grow the ledger without bound. */
const UNDO_MAX_PER_ORG = 200;

const undoLedger = new Map<string, Map<string, { page: string; at: number }>>();

function rememberDeleted(orgId: string, id: string, page: string): void {
  const now = Date.now();
  let org = undoLedger.get(orgId);
  if (!org) {
    org = new Map();
    undoLedger.set(orgId, org);
  }
  for (const [k, v] of org) if (now - v.at > UNDO_WINDOW_MS) org.delete(k);
  org.delete(id);
  org.set(id, { page, at: now });
  while (org.size > UNDO_MAX_PER_ORG) {
    const oldest = org.keys().next().value;
    if (oldest === undefined) break;
    org.delete(oldest);
  }
}

/** True when this org deleted `id` from `page` within the undo window. */
function wasDeletedHere(orgId: string, id: string, page: string): boolean {
  const hit = undoLedger.get(orgId)?.get(id);
  return (
    hit !== undefined &&
    hit.page === page &&
    Date.now() - hit.at <= UNDO_WINDOW_MS
  );
}

function forgetDeleted(orgId: string, id: string): void {
  undoLedger.get(orgId)?.delete(id);
}

/** Delete a block; returns the snapshot undoDeleteSection needs. */
export async function deleteSection(
  ctx: OrgContext,
  sectionId: string,
): Promise<DeletedSection> {
  requirePermission(ctx, "content", "write");
  return run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, sectionId);
    const snapshot = toSectionRow(row);
    await commit(
      pb,
      ctx,
      [
        { collection: COLLECTION, op: "delete", id: row.id },
        markPageChanged(String(row.page)),
      ],
      {
        action: `${COLLECTION}.delete`,
        targetCollection: COLLECTION,
        targetId: row.id,
        meta: { page: row.page },
      },
    );
    rememberDeleted(ctx.orgId, row.id, String(row.page));
    return snapshot;
  });
}

/**
 * Undo a delete: re-create the block with the same id at the same position. The snapshot
 * is caller data, so it goes through the full save pipeline again, and its id must be one
 * this org deleted from this page within the undo window (WR-A06); anything else is
 * NotFound, exactly like an absent id.
 */
export async function undoDeleteSection(
  ctx: OrgContext,
  registry: SectionRegistry,
  deleted: DeletedSection,
  addons?: SectionAddonOwners,
): Promise<SectionRow> {
  requirePermission(ctx, "content", "write");
  if (!registry || typeof registry.get !== "function") {
    throw new Error("undoDeleteSection needs the composed section registry");
  }
  const input = asInput(deleted, "deleted section");
  rejectForeignOrg(ctx, input);
  const id = own(input, "id");
  assertId(id);
  const pageId = own(input, "page");
  assertId(pageId);
  const sortRaw = own(input, "sort_order");
  const sort =
    typeof sortRaw === "number" && Number.isFinite(sortRaw) ? sortRaw : 0;
  const isPublished = own(input, "is_published") !== false;
  return run(ctx, async (pb) => {
    const page = await getScopedPage(pb, ctx, pageId);
    if (!wasDeletedHere(ctx.orgId, id, page.id)) throw new NotFound();
    const prepared = await prepare(pb, ctx, registry, input);
    await assertSingleHero(
      pb,
      ctx,
      registry,
      page.id,
      prepared.section_type,
      id,
    );
    // An add-on block only comes back while its add-on is on (A-WR-04, ADDON-05).
    await assertOwnersActive(pb, ctx, addons, [prepared.section_type]);
    await checkTablePlan(ctx, prepared, null);
    await createAt(
      pb,
      ctx,
      page,
      prepared,
      id,
      isPublished,
      (rows) => rows.filter((r) => (Number(r.sort_order) || 0) < sort).length,
    );
    forgetDeleted(ctx.orgId, id);
    return toSectionRow(await scopedGet(pb, ctx, COLLECTION, id));
  });
}
