// Staff media usage per site (07-27; CONT-19, D221 / D225; CONTEXT Area 1 row 5). The
// `media:usage` CLI calls this; P13's staff console calls it too (never re-implement it).
// super_admin or support_agent (STAFF_MATRIX.media_usage). Storage comes from
// mediaUsageByOrg (bytes counted once per asset, against each org's own allowance: 2 GB + packs,
// 10-33); delivery is null ("not tracked yet") until
// Bunny statistics are wired (the app stand-in cannot measure it).
import { Forbidden, authorizeStaff } from "@cds/core";
import { isPlatformContext, type PlatformContext } from "../../context";
import { orgNamesFor } from "./alerts";
import { mediaUsageByOrg, type UsageLevel } from "../cdn/usage";
import { getMediaDelivery } from "../library/delivery";
import type { MediaDelivery } from "../ports";

export type MediaUsageRow = {
  orgId: string;
  name: string;
  usedBytes: number;
  allowanceBytes: number;
  ratio: number;
  level: UsageLevel;
  assets: number;
  /** Stored bytes per kind (13-45: the console's Images / Video / Audio columns). */
  byKind: { image: number; video: number; audio: number };
  label: string;
  /** Bytes delivered this month; null until Bunny stats exist. */
  deliveryBytes: number | null;
};

export type MediaUsageOptions = {
  /** Only sites at 80 % or more. */
  over?: boolean;
  orgId?: string;
  /** `YYYY-MM`, default the current UTC month. */
  month?: string;
};

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function listMediaUsage(
  ctx: PlatformContext,
  opts: MediaUsageOptions = {},
  deps: { delivery?: MediaDelivery } = {},
): Promise<MediaUsageRow[]> {
  if (!isPlatformContext(ctx)) {
    throw new Forbidden("media usage is for CDS staff");
  }
  authorizeStaff(ctx.staffRole, "media_usage");
  const month =
    opts.month && MONTH_RE.test(opts.month)
      ? opts.month
      : new Date().toISOString().slice(0, 7);
  const usage = await mediaUsageByOrg(ctx);
  let ids = [...usage.keys()];
  if (opts.orgId !== undefined) ids = ids.filter((id) => id === opts.orgId);
  if (opts.over) {
    ids = ids.filter((id) => usage.get(id)!.level !== "ok");
  }
  const names = await orgNamesFor(ids);
  const delivery = deps.delivery ?? getMediaDelivery();
  const rows: MediaUsageRow[] = [];
  for (const id of ids) {
    const u = usage.get(id)!;
    let deliveryBytes: number | null = null;
    try {
      deliveryBytes = await delivery.deliveryBytes(id, month);
    } catch {
      deliveryBytes = null;
    }
    rows.push({
      orgId: id,
      name: names.get(id) ?? "",
      usedBytes: u.usedBytes,
      allowanceBytes: u.allowanceBytes,
      ratio: u.ratio,
      level: u.level,
      assets: u.assets,
      byKind: { ...u.byKind },
      label: u.label,
      deliveryBytes,
    });
  }
  return rows.sort(
    (a, b) => b.usedBytes - a.usedBytes || a.orgId.localeCompare(b.orgId),
  );
}
