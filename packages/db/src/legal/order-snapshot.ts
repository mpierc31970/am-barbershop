// The order shown on a signed copy (CONTEXT A1-Q3; 09-10 choice 3). Reference only: the
// signature never binds a price, P10 billing re-prices at checkout. Built from the org's
// intake selections and its booking path, priced with the one priceQuote function every
// quote figure comes from (D79, D264). Integer cents only. Null when the org has no
// sellable path yet or no build price exists (the copy then shows no order section).
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import type { OrderSnapshot } from "@cds/core/legal";
import { priceQuote } from "@cds/core/pricing";
import { readPriceCatalog } from "../catalog";
import { withSuperuser } from "../client";
import type { OrgContext } from "../context";
import { intakeFromRow } from "../intake/org-intake";
import { orgRow } from "../intake/shared";
import { requirePermission } from "../repository";

const PATH_LABELS: Record<AddonPath, string> = {
  standard: "Standard",
  studio: "Studio",
  shop: "Shop",
};

/** "studio-booking" -> "Studio Booking" (fallback when no display name is supplied). */
function humanize(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function isPath(v: unknown): v is AddonPath {
  return (
    typeof v === "string" && (ADDON_PATHS as readonly string[]).includes(v)
  );
}

/**
 * The org's order at this moment, or null. Owner-scoped read (the signer is the owner);
 * `addonNames` maps add-on slugs to display names (the web app passes the registry's).
 */
export async function orderSnapshotFor(
  ctx: OrgContext,
  opts: { addonNames?: Readonly<Record<string, string>> } = {},
): Promise<OrderSnapshot> {
  requirePermission(ctx, "business", "read");
  const { path, intakeRow } = await withSuperuser(async (pb) => {
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "id,path" });
    return {
      path: org.path as unknown,
      intakeRow: await orgRow(pb, ctx, "org_intake"),
    };
  });
  if (!isPath(path)) return null;
  const selections = intakeFromRow(intakeRow).selections;
  const quote = priceQuote(
    await readPriceCatalog(),
    selections,
    path,
    selections.cadence,
  );
  if (quote.build.cents === null) return null;
  const names = opts.addonNames ?? {};
  const monthlyItems: { label: string; monthlyCents: number | null }[] = [
    {
      label: `${PATH_LABELS[path]} plan`,
      monthlyCents: quote.plan.monthlyCents,
    },
    ...quote.addons.map((a) => ({
      label: names[a.key] ?? humanize(a.key),
      monthlyCents: a.monthlyCents,
    })),
  ];
  if (quote.carePlan) {
    monthlyItems.push({
      label: "Care Plan",
      monthlyCents: quote.carePlan.monthlyCents,
    });
  }
  return {
    path: PATH_LABELS[path],
    cadence: quote.cadence,
    buildCents: quote.build.cents,
    installments: quote.build.installments,
    monthlyItems,
    monthlyTotalCents: monthlyItems.some((i) => i.monthlyCents === null)
      ? null
      : quote.monthlyCents,
  };
}
