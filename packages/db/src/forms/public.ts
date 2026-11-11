// Visitor reads of forms (CONT-25, D187, D270; invariant 1; T-07-15-07; 07-15).
//
// readPublicForms projects through the registry `public` list (never notify_route or
// deleted_at), then to PublicForm: hidden fields removed, after_submit reduced to
// kind / message / button_text. Held forms (D270) are never returned. Soft-deleted forms
// still are (D275 "nothing breaks", resolution f).
// 10-36 (BILL-14, D233): `pro` (rules, steps, save flag; never auto-reply or routing) is
// added only while the org holds Builder Pro; otherwise the form is a free form.
// 10-38 (D234): File upload fields are kept only while uploads are open: Builder Pro on, a
// real scanner configured (the "unavailable" stand-in hides them) and the org under its 1 GB
// of form uploads. Otherwise they are dropped and the form still submits.
import { NotFound } from "@cds/core";
import { publicProOf, type PublicForm } from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import { entitlementsFor } from "../payments/entitlements";
import { getCollectionSpec, projectPublic } from "../registry";
import { FORMS, formFromRow, heldFormIds } from "./shared";
import { uploadsOpenFor, type UploadDeps } from "./uploads";

const MAX_IDS = 50;
const ID_RE = /^[a-z0-9]{1,64}$/i;

/** Builder Pro for this org right now (system read; no member context on the tenant host). */
export async function formsProActive(
  pb: PocketBase,
  orgId: string,
): Promise<boolean> {
  return (await entitlementsFor(pb, orgId)).keys.has("builder-pro");
}

function toPublicForm(
  id: string,
  row: RecordModel,
  proActive: boolean,
  uploadsOpen = false,
): PublicForm {
  const pub = projectPublic(getCollectionSpec(FORMS), row);
  const def = formFromRow(pub as unknown as RecordModel);
  // The Pro part comes from the full row (the public projection never carries `pro`).
  const pro = proActive ? publicProOf(formFromRow(row), { proActive }) : null;
  return {
    id,
    name: def.name,
    layout: def.layout,
    fields: def.fields
      .filter((f) => f.type !== "hidden" && (f.type !== "file" || uploadsOpen))
      .map((f) => ({ ...f, value: "" })),
    after_submit: {
      kind: def.after_submit.kind,
      message: def.after_submit.message,
      button_text: def.after_submit.button_text,
    },
    newsletter_checkbox: def.newsletter_checkbox,
    newsletter_wording: def.newsletter_checkbox ? def.newsletter_wording : "",
    ...(pro ? { pro } : {}),
  };
}

/** This org's forms by id (unknown, foreign and held ids are left out). */
export async function readPublicForms(
  site: SiteContext,
  ids: readonly unknown[],
  deps: UploadDeps = {},
): Promise<Record<string, PublicForm>> {
  assertSiteContext(site);
  const wanted = [
    ...new Set(
      (Array.isArray(ids) ? ids : [])
        .filter((v): v is string => typeof v === "string" && ID_RE.test(v))
        .slice(0, MAX_IDS),
    ),
  ];
  const out: Record<string, PublicForm> = {};
  if (wanted.length === 0) return out;
  const params: Record<string, string> = { org: site.orgId };
  const ors = wanted.map((id, i) => {
    params[`i${i}`] = id;
    return `id = {:i${i}}`;
  });
  const { rows, held, proActive, uploadsOpen } = await withSuperuser(
    async (pb) => {
      const rows = await pb.collection(FORMS).getFullList({
        filter: pb.filter(
          "organization = {:org} && (" + ors.join(" || ") + ")",
          params,
        ),
      });
      const held = await heldFormIds(pb, site.orgId);
      const proActive = await formsProActive(pb, site.orgId);
      const anyFile = rows.some(
        (r) =>
          Array.isArray(r.fields) &&
          (r.fields as { type?: unknown }[]).some((f) => f?.type === "file"),
      );
      const uploadsOpen =
        proActive && anyFile
          ? await uploadsOpenFor(pb, site.orgId, deps, { proActive })
          : false;
      return { rows, held, proActive, uploadsOpen };
    },
  );
  for (const row of rows) {
    if (held.has(row.id)) continue;
    out[row.id] = toPublicForm(row.id, row, proActive, uploadsOpen);
  }
  return out;
}

/** Internal: the full row a visitor may send to, or NotFound (foreign, unknown or held). */
export async function loadFormForSubmit(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<RecordModel> {
  let row: RecordModel;
  try {
    row = await pb
      .collection(FORMS)
      .getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", { id, org: orgId }),
      );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      throw new NotFound();
    }
    throw err;
  }
  if ((await heldFormIds(pb, orgId)).has(row.id)) throw new NotFound();
  return row;
}
