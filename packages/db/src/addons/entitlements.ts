// Entitlement reads (ADDON-05, ADDON-06; CONTEXT A2-Q1). One org_addons row per
// (organization, addon); every read is scoped `organization = {:org}` with bound params.
// readOrgAddon / activeSet / assertAddonActive are internal (never exported from index.ts).
import { AddonNotActive, type AddonManifest } from "@cds/core/addons";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { requirePermission } from "../repository";
import type {
  InstallSource,
  OrgAddonRow,
  Seeded,
  SeededRecordsMarker,
} from "./types";

const COLLECTION = "org_addons";
const SOURCES: readonly InstallSource[] = [
  "hub",
  "staff",
  "assembly",
  "billing",
];

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The stored ledger, normalized: anything malformed reads as absent. */
export function seededOf(raw: unknown): Seeded {
  const out: Seeded = {};
  if (!isObj(raw)) return out;
  const page = raw.page;
  if (isObj(page) && typeof page.id === "string" && page.id !== "") {
    out.page = { id: page.id, slug: str(page.slug) };
    if (page.pending === true) {
      out.page.pending = true;
      // R2-WR-02: the draft fingerprint only means something on a pending page.
      if (typeof page.draft === "string" && /^[0-9a-f]{64}$/.test(page.draft)) {
        out.page.draft = page.draft;
      }
    }
  }
  const records = raw.records;
  if (isObj(records)) {
    const r: Record<string, SeededRecordsMarker> = {};
    for (const [key, marker] of Object.entries(records)) {
      if (Array.isArray(marker)) {
        // Legacy form (before A-CR-01): the created ids.
        r[key] = marker.filter((v): v is string => typeof v === "string");
      } else if (
        isObj(marker) &&
        typeof marker.count === "number" &&
        Number.isInteger(marker.count) &&
        marker.count >= 0
      ) {
        r[key] = { count: marker.count, at: str(marker.at) };
      }
    }
    out.records = r;
  }
  return out;
}

export function toOrgAddonRow(r: RecordModel): OrgAddonRow {
  const source = SOURCES.includes(r.source as InstallSource)
    ? (r.source as InstallSource)
    : "hub";
  return {
    id: r.id,
    addon: str(r.addon),
    status: r.status === "active" ? "active" : "disabled",
    disabled_reason: str(r.disabled_reason),
    source,
    installed_version: str(r.installed_version),
    seeded: seededOf(r.seeded),
    installed_at: str(r.installed_at),
    disabled_at: str(r.disabled_at),
  };
}

/** The org's row for one add-on, or null. */
export async function readOrgAddon(
  pb: PocketBase,
  orgId: string,
  slug: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && addon = {:slug}", {
      org: orgId,
      slug,
    }),
  });
  return res.items[0] ?? null;
}

async function rowsOf(pb: PocketBase, orgId: string): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "addon,id",
  });
}

/** The org's active add-on slugs. */
export async function activeSet(
  pb: PocketBase,
  orgId: string,
): Promise<Set<string>> {
  const rows = await pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org} && status = 'active'", {
      org: orgId,
    }),
    fields: "addon",
  });
  return new Set(rows.map((r) => str(r.addon)).filter((s) => s !== ""));
}

/** Owner-facing copy when an add-on's data is changed while it is off. */
export function notActiveCopy(manifest: Pick<AddonManifest, "name">): string {
  return `${manifest.name} is off. Add it back from Get add-ons to change it.`;
}

/** Throw AddonNotActive unless the org's row for the add-on is active. */
export async function assertAddonActive(
  pb: PocketBase,
  orgId: string,
  manifest: Pick<AddonManifest, "slug" | "name">,
  message?: string,
): Promise<void> {
  const row = await readOrgAddon(pb, orgId, manifest.slug);
  if (!row || row.status !== "active") {
    throw new AddonNotActive(message ?? notActiveCopy(manifest));
  }
}

/** Every add-on row of the org, active and disabled (owner/admin: addons:read). */
export async function listOrgAddons(ctx: OrgContext): Promise<OrgAddonRow[]> {
  requirePermission(ctx, "addons", "read");
  const rows = await withSuperuser((pb) => rowsOf(pb, ctx.orgId));
  return rows.map(toOrgAddonRow);
}

/**
 * The add-on's seeded page for its tab's page line (05-12, UI-SPEC "Add-on tabs" page line):
 * null when the install seeded no page (or the add-on was never added), { deleted: true }
 * when the owner deleted it since, else its id and current slug. Requires addon:<slug> read.
 */
export async function addonPageInfo(
  ctx: OrgContext,
  slug: string,
): Promise<{ id: string; slug: string } | { deleted: true } | null> {
  if (typeof slug !== "string" || slug === "") return null;
  requirePermission(ctx, `addon:${slug}`, "read");
  return withSuperuser(async (pb) => {
    const row = await readOrgAddon(pb, ctx.orgId, slug);
    const page = row ? seededOf(row.seeded).page : undefined;
    if (!page) return null;
    // 11-29: a seeded page in Recently deleted reads as deleted.
    const res = await pb.collection("pages").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && id = {:id} && deleted_at = ''",
        { org: ctx.orgId, id: page.id },
      ),
      fields: "id,slug",
    });
    const found = res.items[0];
    if (!found) return { deleted: true as const };
    return { id: found.id, slug: str(found.slug) || page.slug };
  });
}

/** The org's active add-on slugs. Any member may ask (hub nav, builder picker). */
export async function activeAddons(ctx: OrgContext): Promise<string[]> {
  assertOrgContext(ctx);
  const set = await withSuperuser((pb) => activeSet(pb, ctx.orgId));
  return [...set].sort();
}

/**
 * The org's add-on slugs paused by a billing lapse (`disabled` / `billing_lapse`, D27;
 * 10-32). Any member may ask, like activeAddons: the Website tab alert and the builder's
 * block badge say "paused because payment stopped" instead of "off". Slugs only.
 */
export async function pausedAddons(ctx: OrgContext): Promise<string[]> {
  assertOrgContext(ctx);
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter(
        "organization = {:org} && status = 'disabled' && disabled_reason = 'billing_lapse'",
        { org: ctx.orgId },
      ),
      fields: "addon",
    }),
  );
  return [...new Set(rows.map((r) => str(r.addon)).filter(Boolean))].sort();
}

/**
 * Active add-ons installed at or after `since` (11-19, From CDS "new add-on training"): slug and
 * install time only, newest first. Any member may ask, like activeAddons; the caller keeps
 * only add-ons the person can read (`addon:<slug>`).
 */
export async function recentAddonInstalls(
  ctx: OrgContext,
  since: Date,
): Promise<{ slug: string; installedAt: string }[]> {
  assertOrgContext(ctx);
  if (!(since instanceof Date) || !Number.isFinite(since.getTime())) return [];
  const iso = since.toISOString().replace("T", " ");
  const rows = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getFullList({
      filter: pb.filter(
        "organization = {:org} && status = 'active' && installed_at >= {:since}",
        { org: ctx.orgId, since: iso },
      ),
      fields: "addon,installed_at",
      sort: "-installed_at",
    }),
  );
  return rows
    .map((r) => ({ slug: str(r.addon), installedAt: str(r.installed_at) }))
    .filter((r) => r.slug !== "" && r.installedAt !== "");
}
