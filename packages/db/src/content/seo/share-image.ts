// Share image ownership (07-30 choices 5, 6; CONT-14, CONT-28; invariant 1; T-07-30-04).
//
// A page or site share image is a library photo id. It must be the org's own image row
// (any image kind), ready, not removed. Lock holders pass their held `pb`. Every filter is
// bound params concatenated with fixed text (T-02-13 gate: never a template literal).
// Internal (by path): pages.ts, chrome/settings.ts, history/versions.ts.
import { InvalidInput } from "@cds/core";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { IMAGE_ROW_KINDS } from "../../media/library/list";

export const SHARE_IMAGE_COPY = "Choose a photo from your media.";
const ID_RE = /^[a-z0-9]{15}$/;

export type ShareImageState = "ok" | "deleted" | "gone";

/** "ok" (own ready image), "deleted" (own, soft-deleted) or "gone" (anything else). */
export async function shareImageState(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<ShareImageState> {
  if (typeof id !== "string" || !ID_RE.test(id)) return "gone";
  const params: Record<string, unknown> = { id, org: orgId };
  const kinds = IMAGE_ROW_KINDS.map((k, i) => {
    params["k" + i] = k;
    return "kind = {:k" + i + "}";
  });
  const expr =
    "id = {:id} && organization = {:org} && status = 'ready' && removed_at = '' && (" +
    kinds.join(" || ") +
    ")";
  try {
    const row = await pb
      .collection("media_assets")
      .getFirstListItem(pb.filter(expr, params), { fields: "id,deleted_at" });
    return typeof row.deleted_at === "string" && row.deleted_at !== ""
      ? "deleted"
      : "ok";
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return "gone";
    throw err;
  }
}

/** Throws InvalidInput unless `id` is the org's own ready, live image. */
export async function assertOwnShareImage(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<void> {
  if ((await shareImageState(pb, orgId, id)) !== "ok") {
    throw new InvalidInput(SHARE_IMAGE_COPY);
  }
}
