// Theme chokepoint (THEME-01, THEME-02, THEME-03; D44-D46; invariants 1 and 10;
// CONTEXT A1-Q3, A2-Q3).
//
// organization.design reaches the database in exactly one place: queueDesignWrite (below),
// which validates the design (validateOrganizationDesign: deny by default, AA re-check) and
// queues the field update plus a "theme.import" audit_log row on the caller's batch, so no
// unvalidated or unaudited theme change can commit. It is internal to @cds/db (never
// re-exported from the root index) and has exactly three callers, each of which drops the
// org's cached theme (themeTag) after the batch commits (WR-01):
//   - setOrganizationDesign (the public writer), which
//       - requires a minted PlatformContext and the staff permission "theme_import"
//         (super_admin, support_agent). There is no OrgContext overload: owners never write
//         their own theme (A1-Q3, CDS authors it), and a member context is refused.
//       - refuses an unknown or malformed org id with NotFound (never reveal which)
//   - restoreTenant (export.ts): the bundle's design is validated like an import; an
//     invalid one is dropped and reported as skipped, never stored (meta.via "restore")
//   - bootstrapDevTenant (dev-seed.ts, DEV ONLY): audited under a system context
//     (meta.job "dev-seed")
// A source scan (theme-writer.test.ts) fails if any other file writes the field.
// Reads never take a caller-supplied org id:
//   - readPublicDesign(SiteContext): visitors, ORGANIZATION_PUBLIC_FIELDS only, projected to
//     PublicDesign (never `source`)
//   - readOrganizationDesign(OrgContext): owners' hub previews, same projection
// A stored design that no longer validates comes back as its projection (the emitter falls
// back per token); a missing design is null (neutral preset). @cds/db never imports the Next.js runtime.
import { authorizeStaff, CdsError, NotFound } from "@cds/core";
import {
  projectPublicDesign,
  validateOrganizationDesign,
  type OrganizationDesign,
  type PublicDesign,
} from "@cds/core/theme";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
  type SystemContext,
} from "./context";
import type { Invalidator } from "./content/ports";
import { assertSiteContext, type SiteContext } from "./content/site-context";
import { ORGANIZATION_PUBLIC_FIELDS } from "./registry";
import { regenerateSiteIcons } from "./content/seo/site-icons";

export type ThemeDeps = { invalidator: Invalidator };

export type ThemeWriteResult = { from: string | null; to: string };

/** The theme write reached the database and was refused; nothing was changed. */
export class ThemeWriteFailed extends CdsError {
  override readonly code = "write_failed";
}

const ORG_ID_RE = /^[a-z0-9]{1,64}$/i;
const HASH_RE = /^[0-9a-f]{8,64}$/;

/** The org's cached theme (the per-org CSS scope and font set). */
export function themeTag(orgId: string): string {
  return `org:${orgId}:theme`;
}

function hashOf(design: unknown): string | null {
  if (typeof design !== "object" || design === null) return null;
  const h: unknown = Object.prototype.hasOwnProperty.call(design, "sourceHash")
    ? (design as Record<string, unknown>).sourceHash
    : undefined;
  return typeof h === "string" && HASH_RE.test(h) ? h : null;
}

type Batch = ReturnType<PocketBase["createBatch"]>;

/** Why a design is being written: an import (the public writer), a restore, the dev seed or the demo seed (13-31). */
export type DesignWriteVia = "import" | "restore" | "dev-seed" | "demo-seed";

/**
 * INTERNAL to @cds/db (never re-export from index.ts): the only code that puts
 * organizations.design on a PocketBase request. Queues the update and its "theme.import"
 * audit row on `batch` (one all-or-nothing send by the caller). The design is (re-)validated
 * here, so InvalidInput is thrown before anything is queued. `null` clears the theme (the
 * neutral preset; restore of an org that had none) and is audited the same way. The caller
 * must drop themeTag(orgId) after the batch commits.
 */
export function queueDesignWrite(
  batch: Batch,
  actor: PlatformContext | SystemContext,
  orgId: string,
  current: unknown,
  design: unknown,
  via: DesignWriteVia,
): { from: string | null; to: string | null } {
  const valid: OrganizationDesign | null =
    design === null ? null : validateOrganizationDesign(design);
  const from = hashOf(current);
  const to = valid === null ? null : valid.sourceHash;
  batch.collection("organizations").update(orgId, { design: valid });
  batch.collection("audit_log").create(
    auditBody(actor, {
      action: "theme.import",
      organization: orgId,
      targetCollection: "organizations",
      targetId: orgId,
      meta: {
        from,
        to,
        name: valid === null ? null : valid.name,
        adjustments: valid === null ? 0 : valid.contrast.adjustments.length,
        ...(via === "import" ? {} : { via }),
      },
    }),
  );
  return { from, to };
}

/** CDS staff only: store a validated design on an organization (audited, one batch). */
export async function setOrganizationDesign(
  pctx: PlatformContext,
  orgId: string,
  design: unknown,
  deps: ThemeDeps,
): Promise<ThemeWriteResult> {
  assertPlatformContext(pctx);
  authorizeStaff(pctx.staffRole, "theme_import");
  const valid = validateOrganizationDesign(design);
  if (typeof orgId !== "string" || !ORG_ID_RE.test(orgId)) {
    throw new NotFound();
  }

  const result = await withSuperuser(async (pb) => {
    let current: RecordModel;
    try {
      current = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,design" });
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound();
      }
      throw err;
    }
    const batch = pb.createBatch();
    const { from } = queueDesignWrite(
      batch,
      pctx,
      orgId,
      current.design,
      valid,
      "import",
    );
    const to = valid.sourceHash;
    try {
      await batch.send();
    } catch (err) {
      if (err instanceof ClientResponseError) {
        throw new ThemeWriteFailed(
          `theme write failed in the database (HTTP ${err.status}); nothing was changed`,
        );
      }
      throw err;
    }
    return { from, to };
  });

  deps.invalidator.invalidate([themeTag(orgId)]);
  // 07-30 (CONT-28): the share image uses the theme primary; regenerate, best effort.
  await regenerateSiteIcons(orgId, {
    force: true,
    invalidator: deps.invalidator,
  }).catch(() => undefined);
  return result;
}

async function readDesignOf(orgId: string): Promise<PublicDesign | null> {
  let row: RecordModel;
  try {
    row = await withSuperuser((pb) =>
      pb
        .collection("organizations")
        .getOne(orgId, { fields: ORGANIZATION_PUBLIC_FIELDS.join(",") }),
    );
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
  // Copy the public fields one by one (never spread the record).
  const pub: Record<string, unknown> = Object.fromEntries(
    ORGANIZATION_PUBLIC_FIELDS.map((f) => [f, row[f] ?? null]),
  );
  return projectPublicDesign(pub.design);
}

/** A visitor's view of their own site's theme, or null (neutral preset). */
export async function readPublicDesign(
  site: SiteContext,
): Promise<PublicDesign | null> {
  assertSiteContext(site);
  return readDesignOf(site.orgId);
}

/** An org member's view of their own theme for hub previews, or null. */
export async function readOrganizationDesign(
  ctx: OrgContext,
): Promise<PublicDesign | null> {
  assertOrgContext(ctx);
  return readDesignOf(ctx.orgId);
}
