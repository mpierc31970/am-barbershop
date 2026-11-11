// media_assets rows for apps/web media tests (07-09). Like seeded.ts, the superuser client
// stays inside packages/db (invariant 1): callers pass plain fields and get ids back.
import { superuser } from "../src/client";

export async function seedMediaRow(
  orgId: string,
  fields: Record<string, unknown> = {},
): Promise<string> {
  const pb = await superuser();
  const rec = await pb.collection("media_assets").create({
    organization: orgId,
    kind: "library",
    status: "ready",
    source: "library",
    original_ext: "webp",
    storage_dir: `tenants/${orgId}/media/test`,
    sort_order: 1,
    ...fields,
  });
  return rec.id;
}

export async function updateMediaRow(
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const pb = await superuser();
  await pb.collection("media_assets").update(id, fields);
}
