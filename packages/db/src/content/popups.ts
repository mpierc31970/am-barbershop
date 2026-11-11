// Pop-ups chokepoint (CONT-11, CONT-31; D118, D124, D248, D253, D270; CONTEXT A3-Q4;
// invariant 1, TEN-03; T-03-15, T-03-18, T-03-19).
//
// popups is writes:"custom". Every write here:
//   - requires content:write; organization never from input; lookups scoped (NotFound)
//   - validates deny by default (validatePopup: no pop-up buttons inside a pop-up, bounded
//     delay/scroll) and sanitizes every rich-text item
//   - checks each show_on page id belongs to the org: foreign = absent = NotFound (T-03-15)
//   - screens the text and URLs (held keeps it off, D248 never blocks), invalidates the
//     org's live tag and pings once (D253, D270)
//   - checks every form and media asset its items reference belongs to the org
//     (T-03-18, generalized; 07-08)
// Deleting a pop-up follows D275 (soft-delete.ts): soft when anything references it, else
// hard; a soft-deleted pop-up is served button-only (07-28).
import { InvalidInput, NotFound } from "@cds/core";
import {
  htmlToPlainText,
  itemRefs,
  itemTexts,
  itemUrls,
  repairDuplicateItemIds,
  validatePopup,
  type ColumnItem,
  type PopupRecord,
  unionRefs,
} from "@cds/core/content";
import { sanitizeRichText } from "@cds/core/content/sanitize";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import {
  assertId,
  mapError,
  newRecordId,
  requirePermission,
} from "../repository";
import { liveTag, type ContentDeps } from "./ports";
import { findRefHolders } from "./references";
import { assertRefsOwned } from "./sections";
import { afterLiveSave, screen, type ScanOutcome } from "./screen";
import {
  chromePopupIds,
  isReferenced,
  softOrHard,
  type DeleteOutcome,
} from "./soft-delete";
import {
  asInput,
  commit,
  own,
  rejectForeignOrg,
  run,
  scopedGet,
} from "./shared";

const COLLECTION = "popups";

/** A pop-up as the hub reads it: `deleted` = soft-deleted (D275, 07-28). */
export type PopupWithState = PopupRecord & { deleted: boolean };

/** Where a pop-up is used (07-28 choice 6); the delete dialog picks its body from it. */
export type PopupUsage = {
  pages: { id: string; title: string }[];
  inVersions: boolean;
  inMenu: boolean;
  used: boolean;
};

function toPopup(r: RecordModel): PopupRecord {
  const v = validatePopupLoose(r);
  return { id: r.id, ...v };
}

function withState(r: RecordModel): PopupWithState {
  const d = (r as Record<string, unknown>).deleted_at;
  return { ...toPopup(r), deleted: typeof d === "string" && d !== "" };
}

/**
 * Stored rows are re-validated on read; a malformed row reads back disabled and empty.
 * Repeated item ids are repaired first rather than treated as malformed, so the next save
 * does not wipe the pop-up's items (IN-R02).
 */
function validatePopupLoose(r: RecordModel): Omit<PopupRecord, "id"> {
  try {
    return validatePopup({
      name: r.name,
      content: repairDuplicateItemIds(r.content),
      trigger: r.trigger,
      delay_seconds: r.delay_seconds || undefined,
      scroll_percent: r.scroll_percent || undefined,
      frequency: r.frequency || undefined,
      show_on: r.show_on || undefined,
      page_ids: r.page_ids ?? [],
      enabled: r.enabled === true,
    });
  } catch {
    return {
      name: typeof r.name === "string" ? r.name : "",
      content: { items: [] },
      trigger: "click",
      delay_seconds: 5,
      scroll_percent: 50,
      frequency: "once-per-visitor",
      show_on: "button-only",
      page_ids: [],
      enabled: false,
    };
  }
}

function sanitizeItems(items: ColumnItem[]): ColumnItem[] {
  return items.map((item) =>
    item.kind === "text"
      ? { ...item, html: sanitizeRichText(item.html) }
      : item,
  );
}

/** The name, then every item's text (rich text as plain text), blanks dropped. */
function textsOf(name: string, items: ColumnItem[]): string[] {
  const out = [name];
  for (const item of items) {
    if (item.kind === "text") out.push(htmlToPlainText(item.html));
    else out.push(...itemTexts(item));
  }
  return out.filter((t) => typeof t === "string" && t !== "");
}

/** Every link, image URL and built embed URL of the items, blanks dropped. */
function urlsOf(items: ColumnItem[]): string[] {
  return items
    .flatMap(itemUrls)
    .filter((u) => typeof u === "string" && u !== "");
}

/** Every show_on page id must be one of the org's pages (T-03-15). */
async function assertPagesOwned(
  pb: PocketBase,
  ctx: OrgContext,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const rows = await pb.collection("pages").getFullList({
    filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
    fields: "id",
  });
  const set = new Set(rows.map((p) => p.id));
  if (ids.some((id) => !set.has(id))) throw new NotFound();
}

// ---------------------------------------------------------------------------------------
// Public API

/** Content read on the superuser client, PB errors mapped. */
function read<T>(
  ctx: OrgContext,
  fn: (pb: PocketBase) => Promise<T>,
): Promise<T> {
  requirePermission(ctx, "content", "read");
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** The org's pop-ups by name. Soft-deleted ones only with `includeDeleted` (07-28). */
export function listPopups(
  ctx: OrgContext,
  opts: { includeDeleted?: boolean } = {},
): Promise<PopupWithState[]> {
  return read(ctx, async (pb) => {
    const expr =
      opts.includeDeleted === true
        ? "organization = {:org}"
        : "organization = {:org} && deleted_at = ''";
    const rows = await pb.collection(COLLECTION).getList(1, 500, {
      filter: pb.filter(expr, { org: ctx.orgId }),
      sort: "name,id",
    });
    return rows.items.map(withState);
  });
}

/** One pop-up (soft-deleted ones too, flagged `deleted`); foreign or absent = NotFound. */
export function getPopup(ctx: OrgContext, id: string): Promise<PopupWithState> {
  return read(ctx, async (pb) =>
    withState(await scopedGet(pb, ctx, COLLECTION, id)),
  );
}

/** Create or update a pop-up. `held` = the scanner held it, so it was saved switched off. */
export async function savePopup(
  ctx: OrgContext,
  deps: ContentDeps,
  raw: { id?: string } & Record<string, unknown>,
): Promise<{ popup: PopupRecord; held: boolean }> {
  requirePermission(ctx, "content", "write");
  const input = asInput(raw, "pop-up input");
  rejectForeignOrg(ctx, input);
  const idRaw = own(input, "id");
  if (idRaw !== undefined) assertId(idRaw);
  const v = validatePopup(input);
  const items = sanitizeItems(v.content.items);
  const outcome = await screen(
    ctx,
    deps,
    textsOf(v.name, items),
    urlsOf(items),
  );
  const held = outcome.verdict === "held";
  const body = {
    ...v,
    content: { items },
    enabled: held ? false : v.enabled,
  };
  const id = await run(ctx, async (pb) => {
    await assertPagesOwned(pb, ctx, v.page_ids);
    await assertRefsOwned(pb, ctx, unionRefs(items.map(itemRefs)));
    if (typeof idRaw === "string") {
      await scopedGet(pb, ctx, COLLECTION, idRaw);
      await commit(
        pb,
        ctx,
        [{ collection: COLLECTION, op: "update", id: idRaw, body }],
        {
          action: `${COLLECTION}.update`,
          targetCollection: COLLECTION,
          targetId: idRaw,
        },
      );
      return idRaw;
    }
    const newId = newRecordId();
    await commit(
      pb,
      ctx,
      [
        {
          collection: COLLECTION,
          op: "create",
          id: newId,
          body: { ...body, organization: ctx.orgId },
        },
      ],
      {
        action: `${COLLECTION}.create`,
        targetCollection: COLLECTION,
        targetId: newId,
      },
    );
    return newId;
  });
  await afterLiveSave(ctx, deps, outcome, { collection: COLLECTION, id });
  return { popup: await getPopup(ctx, id), held };
}

/** Scanning the same pop-up again after a concurrent edit gives up after this many tries. */
const ENABLE_ATTEMPTS = 3;

export const POPUP_CHANGED_COPY =
  "This pop-up changed while it was being switched on. Try again.";

/** What the scanner sees of a pop-up: its fingerprint decides whether a scan still applies. */
function scanInputsOf(p: PopupRecord): { texts: string[]; urls: string[] } {
  return {
    texts: textsOf(p.name, p.content.items),
    urls: urlsOf(p.content.items),
  };
}

/**
 * Switch a pop-up on or off. Switching on re-screens it: a held pop-up stays off
 * (returns held: true), so the toggle cannot bypass the scanner. The scan runs outside the
 * per-org lock, so the commit re-reads the row under the lock and only writes when the
 * content it scanned is still the content stored (WR-A03); a concurrent save rescans.
 */
export async function setPopupEnabled(
  ctx: OrgContext,
  deps: ContentDeps,
  id: string,
  enabled: boolean,
): Promise<{ held: boolean }> {
  requirePermission(ctx, "content", "write");
  if (typeof enabled !== "boolean") {
    throw new InvalidInput("enabled must be true or false");
  }
  for (let attempt = 0; attempt < ENABLE_ATTEMPTS; attempt++) {
    const scanned = scanInputsOf(await getPopup(ctx, id));
    const fingerprint = JSON.stringify(scanned);
    const outcome: ScanOutcome = enabled
      ? await screen(ctx, deps, scanned.texts, scanned.urls)
      : { verdict: "clean", reasons: [] };
    const held = outcome.verdict === "held";
    const committed = await run(ctx, async (pb) => {
      const row = await scopedGet(pb, ctx, COLLECTION, id);
      if (
        enabled &&
        JSON.stringify(scanInputsOf(toPopup(row))) !== fingerprint
      ) {
        return false;
      }
      await commit(
        pb,
        ctx,
        [
          {
            collection: COLLECTION,
            op: "update",
            id: row.id,
            body: { enabled: enabled && !held },
          },
        ],
        {
          action: `${COLLECTION}.update`,
          targetCollection: COLLECTION,
          targetId: row.id,
          meta: { enabled: enabled && !held },
        },
      );
      return true;
    });
    if (!committed) continue;
    await afterLiveSave(ctx, deps, outcome, { collection: COLLECTION, id });
    return { held };
  }
  throw new InvalidInput(POPUP_CHANGED_COPY);
}

/**
 * Where the pop-up is used (choice 6): draft pages plus pages whose kept versions use it
 * (sorted by title), whether a kept version uses it, whether the menu or footer opens it.
 * The hub picks the delete dialog body from it; deletePopup re-decides inside its lock.
 */
export async function popupUsage(
  ctx: OrgContext,
  deps: Pick<ContentDeps, "sections">,
  id: string,
): Promise<PopupUsage> {
  requirePermission(ctx, "content", "write");
  return run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    const h = await findRefHolders(pb, ctx, deps.sections, "popups", row.id);
    const pages = new Map(h.draftPages.map((p) => [p.id, p.title]));
    const missing = h.versionPages.filter((pid) => !pages.has(pid));
    if (missing.length > 0) {
      const all = await pb.collection("pages").getFullList({
        filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
        fields: "id,title",
      });
      for (const p of all) {
        if (missing.includes(p.id)) pages.set(p.id, String(p.title ?? ""));
      }
    }
    const referenced = await isReferenced(
      pb,
      ctx,
      deps.sections,
      "popups",
      row.id,
    );
    const inVersions = h.versionPages.length > 0;
    const inMenu = (await chromePopupIds(pb, ctx)).includes(row.id);
    return {
      pages: [...pages]
        .map(([pid, title]) => ({ id: pid, title }))
        .sort((x, y) => x.title.localeCompare(y.title)),
      inVersions,
      inMenu,
      used: referenced,
    };
  });
}

/**
 * D275 delete (choice 5): soft when a draft, a kept version or the menu uses it (it keeps
 * opening from its buttons), else hard. Never refused for being in use. Deleting a
 * soft-deleted pop-up re-runs the rule, so one nothing uses any more goes for good.
 */
export async function deletePopup(
  ctx: OrgContext,
  deps: ContentDeps,
  id: string,
): Promise<DeleteOutcome> {
  requirePermission(ctx, "content", "write");
  const outcome = await run(ctx, async (pb) => {
    const row = await scopedGet(pb, ctx, COLLECTION, id);
    const referenced = await isReferenced(
      pb,
      ctx,
      deps.sections,
      "popups",
      row.id,
    );
    return softOrHard(pb, ctx, COLLECTION, row, referenced, {
      name: row.name,
    });
  });
  deps.invalidator.invalidate([liveTag(ctx.orgId)]);
  return outcome;
}
