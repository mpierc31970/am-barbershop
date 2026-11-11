// SEO fixtures for apps/web tenant tests (07-30). Like media-seed.ts, the superuser client
// stays inside packages/db (invariant 1): callers pass plain fields and get ids back.
import sharp from "sharp";
import { superuser } from "../src/client";

export async function seedHost(
  orgId: string,
  hostname: string,
  kind: "preview" | "custom",
  primary = false,
): Promise<string> {
  const pb = await superuser();
  return (
    await pb
      .collection("org_hosts")
      .create({ hostname, organization: orgId, kind, primary })
  ).id;
}

export async function setOrgName(orgId: string, name: string): Promise<void> {
  const pb = await superuser();
  await pb.collection("organizations").update(orgId, { name });
}

export async function setBusinessProfile(
  orgId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const pb = await superuser();
  const row = await pb
    .collection("business_profile")
    .getFirstListItem(pb.filter("organization = {:org}", { org: orgId }));
  await pb.collection("business_profile").update(row.id, fields);
}

/** A solid-colour PNG for uploads. */
export async function pngBytes(w: number, h: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width: w,
        height: h,
        channels: 3,
        background: { r: 30, g: 90, b: 160 },
      },
    })
      .png()
      .toBuffer(),
  );
}

/** 07-31: raw page writes (a password with no republish, a system-404 kind) for app tests. */
export async function setPageFields(
  pageId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  const pb = await superuser();
  await pb.collection("pages").update(pageId, fields);
}
