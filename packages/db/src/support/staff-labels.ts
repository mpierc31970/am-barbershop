// Staff CLI labels (12-30): business names and page titles the staff CLIs print in their
// previews and result lines (cds:post, service:window). The CLIs may not hold a PocketBase
// client (Invariant 1), so this read lives in the chokepoint layer. Not re-exported by the
// support barrel; the scripts import it directly. Staff only (`cds_post`: super_admin,
// support_agent). Unknown or malformed ids are simply absent from the result.
import { authorizeStaff } from "@cds/core";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";

const ID_RE = /^[a-z0-9]{15}$/;
const MAX_IDS = 200;

export type StaffSupportLabels = {
  /** organizations.name by org id. */
  orgs: Record<string, string>;
  /** pages.title by page id. */
  pages: Record<string, string>;
};

function ids(v: readonly string[] | undefined): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(v.filter((x) => typeof x === "string" && ID_RE.test(x))),
  ].slice(0, MAX_IDS);
}

/** Business names and page titles for staff output. */
export async function staffSupportLabels(
  ctx: PlatformContext,
  input: { orgIds?: readonly string[]; pageIds?: readonly string[] },
): Promise<StaffSupportLabels> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  const orgIds = ids(input?.orgIds);
  const pageIds = ids(input?.pageIds);
  return withSuperuser(async (pb) => {
    const out: StaffSupportLabels = { orgs: {}, pages: {} };
    for (const id of orgIds) {
      try {
        const row = await pb
          .collection("organizations")
          .getOne(id, { fields: "id,name" });
        out.orgs[id] = typeof row.name === "string" ? row.name : "";
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) continue;
        throw err;
      }
    }
    for (const id of pageIds) {
      try {
        const row = await pb
          .collection("pages")
          .getOne(id, { fields: "id,title" });
        out.pages[id] = typeof row.title === "string" ? row.title : "";
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) continue;
        throw err;
      }
    }
    return out;
  });
}
