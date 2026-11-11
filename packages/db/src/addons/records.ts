// Internal add-on record helpers shared by addonRepo and the installer's record seeding
// (ADDON-06, D248, D270; RESEARCH Pattern 6, Pitfalls 7 and 12). Never exported from index.ts.
//   - the collection must be one the manifest declares (own property only)
//   - values come from the add-on's pure validator, then lose every system/organization key
//     and any non-plain key (PB modifiers)
//   - text and URLs are screened; "held" forces is_published false and flags the record
import { InvalidInput } from "@cds/core";
import type { AddonManifest, AddonRecordSpec } from "@cds/core/addons";
import type PocketBase from "pocketbase";
import type { OrgContext } from "../context";
import { addonTag } from "../content/ports";
import { afterLiveSave, screen, type ScanOutcome } from "../content/screen";
import { asInput, rejectForeignOrg } from "../content/shared";
import type { AddonDeps } from "./types";

const PLAIN_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SYSTEM_KEYS: ReadonlySet<string> = new Set([
  "id",
  "organization",
  "created",
  "updated",
  "collectionId",
  "collectionName",
  "expand",
]);

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

/** The record spec of a declared collection (InvalidInput otherwise). */
export function declaredRecordSpec(
  manifest: AddonManifest,
  name: unknown,
): { name: string; spec: AddonRecordSpec } {
  if (typeof name !== "string" || !hasOwn(manifest.collections, name)) {
    throw new InvalidInput(`unknown collection for ${manifest.slug}`);
  }
  if (!hasOwn(manifest.records, name)) {
    throw new InvalidInput(`${manifest.slug} has no record rules for ${name}`);
  }
  return { name, spec: manifest.records[name]! };
}

/** Validator output without system keys; a non-plain key is refused. */
export function cleanValues(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (!PLAIN_KEY.test(k)) throw new InvalidInput(`bad field name ${k}`);
    if (SYSTEM_KEYS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

export type PreparedRecord = {
  body: Record<string, unknown>;
  outcome: ScanOutcome;
  held: boolean;
};

/** Validate and screen one record input. The caller writes it. */
export async function prepareRecord(
  ctx: OrgContext,
  deps: AddonDeps,
  spec: AddonRecordSpec,
  raw: unknown,
): Promise<PreparedRecord> {
  const input = asInput(raw, "record input");
  rejectForeignOrg(ctx, input);
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k !== "id" && k !== "organization") rest[k] = v;
  }
  const body = cleanValues(spec.validate(rest));
  const outcome = await screen(
    ctx,
    deps,
    spec.textsOf(body),
    spec.urlsOf(body),
  );
  const held = outcome.verdict === "held";
  if (held) body.is_published = false;
  return { body, outcome, held };
}

/** The next sort_order at the end of the org's list. */
export async function nextSortOrder(
  pb: PocketBase,
  orgId: string,
  collection: string,
): Promise<number> {
  const res = await pb.collection(collection).getList(1, 1, {
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "-sort_order,-id",
    fields: "sort_order",
  });
  const top = res.items[0]?.sort_order;
  return (typeof top === "number" ? top : 0) + 1;
}

/** Flag (if not clean), invalidate live + add-on tags, ping. */
export async function afterRecordSave(
  ctx: OrgContext,
  deps: AddonDeps,
  slug: string,
  outcome: ScanOutcome,
  target: { collection: string; id: string },
): Promise<void> {
  await afterLiveSave(ctx, deps, outcome, target);
  deps.invalidator.invalidate([addonTag(ctx.orgId, slug)]);
}
