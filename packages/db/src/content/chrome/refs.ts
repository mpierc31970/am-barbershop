// Ownership check for menu/footer targets (07-25 choice 3; invariant 1, TEN-03; T-07-25-02).
// Internal: never exported from the chrome barrel. Every page:<id> and popup:<id> a menu or
// footer points at must belong to the org; a foreign or unknown id is InvalidInput with the
// same copy (no oracle). One filtered query per collection, chunks of 50.
import { InvalidInput } from "@cds/core";
import { NAV_COPY } from "@cds/core/content";
import { withSuperuser } from "../../client";
import type { OrgContext } from "../../context";

const CHUNK = 50;

async function countOwned(
  ctx: OrgContext,
  collection: "pages" | "popups",
  ids: string[],
): Promise<number> {
  let found = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const params: Record<string, string> = { org: ctx.orgId };
    const ors = chunk.map((id, j) => {
      params[`p${j}`] = id;
      return `id = {:p${j}}`;
    });
    // Bound params only: the expression holds placeholders, never an id (T-02-13).
    const expr = "organization = {:org} && (" + ors.join(" || ") + ")";
    found += await withSuperuser(async (pb) => {
      const rows = await pb.collection(collection).getFullList({
        filter: pb.filter(expr, params),
        fields: "id",
      });
      return rows.length;
    });
  }
  return found;
}

export async function assertNavRefsOwned(
  ctx: OrgContext,
  refs: { pages: string[]; popups: string[] },
): Promise<void> {
  const pages = [...new Set(refs.pages)];
  const popups = [...new Set(refs.popups)];
  if (
    pages.length > 0 &&
    (await countOwned(ctx, "pages", pages)) !== pages.length
  ) {
    throw new InvalidInput(NAV_COPY.ownPage);
  }
  if (
    popups.length > 0 &&
    (await countOwned(ctx, "popups", popups)) !== popups.length
  ) {
    throw new InvalidInput(NAV_COPY.ownPage);
  }
}
