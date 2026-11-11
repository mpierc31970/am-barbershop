// Dev tenant bootstrap (DEV ONLY; CONT-08, CONT-30; 03-CONTEXT "Claude's Discretion": exit
// check + dev seed script). Creates or updates one organization, its preview host, an owner
// user and the owner membership, so `npm run tenants:seed-dev` can then sign in as that owner
// and build the site through the normal @cds/db writers. Invariant 1: this is the only place
// the seed touches the superuser client; the script itself never holds a PocketBase client.
//
// Idempotent by org slug, hostname and owner email: a second run updates, never duplicates.
// Refuses to run unless CDS_ENV is exactly "dev" (T-03-63, WR-A05): an unset CDS_ENV is not
// proof of a dev database, so the guard fails closed. Not exported from the @cds/db root
// (WR-A05): only the seed script imports it, by relative path inside packages/db, and the
// lint ban on "@cds/db/*" keeps apps/web from reaching it. It never takes over an account
// that belongs to another organization.
import { classifyHost, InvalidInput, parsePlatformHosts } from "@cds/core";
import * as theme from "@cds/core/theme";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "./audit";
import { withSuperuser } from "./client";
import type { Invalidator } from "./content/ports";
import { mintSystemContext } from "./context";
import {
  isOrgStage,
  ORG_STAGES,
  setOrgStage,
  type OrgStage,
} from "./org-stage";
import { queueDesignWrite, themeTag } from "./theme";

export type DevTenantInput = {
  slug: string;
  name: string;
  host: string;
  ownerEmail: string;
  ownerPassword: string;
  /** Optional theme (THEME-01): validated before any write; omitted = left untouched. */
  design?: unknown;
  /**
   * 07-33 choice 2: the primary host's kind. Default "preview" (demo / demo-b unchanged);
   * the every-block tenant uses "custom" so its pages are indexable (Lighthouse SEO).
   */
  hostKind?: "preview" | "custom";
};

export type DevTenant = { orgId: string; ownerId: string; created: boolean };

export const REFUSE_PRODUCTION = "refusing to seed in production";
export const REFUSE_NOT_DEV =
  'refusing to seed: CDS_ENV must be exactly "dev" to confirm a dev database';

/** Throws unless CDS_ENV is exactly "dev": seeding is a dev-only operation (fails closed). */
export function assertDevEnvironment(): void {
  const env = process.env.CDS_ENV;
  if (env === "production") throw new Error(REFUSE_PRODUCTION);
  if (env !== "dev") throw new Error(REFUSE_NOT_DEV);
}

async function firstOrNull(
  pb: PocketBase,
  collection: string,
  filter: string,
): Promise<RecordModel | null> {
  try {
    return await pb.collection(collection).getFirstListItem(filter);
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return null;
    throw err;
  }
}

/**
 * DEV ONLY. Upsert an active organization, its primary preview host, an owner user (the
 * password is (re)set so the seed can sign in) and the owner membership.
 */
export async function bootstrapDevTenant(
  input: DevTenantInput,
  deps: { invalidator?: Invalidator } = {},
): Promise<DevTenant> {
  assertDevEnvironment();
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  const email = input.ownerEmail.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new InvalidInput("slug must be lowercase letters, numbers, hyphens");
  }
  if (!name) throw new InvalidInput("name is required");
  if (!email.includes("@")) throw new InvalidInput("owner email is invalid");
  if (input.ownerPassword.length < 10) {
    throw new InvalidInput("owner password must be at least 10 characters");
  }
  const cls = classifyHost(
    input.host,
    parsePlatformHosts(process.env.PLATFORM_HOSTS),
  );
  if (cls.kind !== "tenant") {
    throw new InvalidInput("host must be a tenant hostname");
  }
  const hostname = cls.host;
  const hostKind = input.hostKind ?? "preview";
  if (hostKind !== "preview" && hostKind !== "custom") {
    throw new InvalidInput("host kind must be preview or custom");
  }
  const design: theme.OrganizationDesign | undefined =
    input.design === undefined
      ? undefined
      : theme.validateOrganizationDesign(input.design);

  const result = await withSuperuser(async (pb) => {
    let created = false;

    // Organization, by slug.
    const existingOrg = await firstOrNull(
      pb,
      "organizations",
      pb.filter("slug = {:slug}", { slug }),
    );
    let org: RecordModel;
    if (existingOrg) {
      org = await pb
        .collection("organizations")
        .update(existingOrg.id, { name, status: "active" });
    } else {
      org = await pb
        .collection("organizations")
        .create({ name, slug, status: "active" });
      created = true;
    }

    // Theme, through the one design writer (WR-01): validated, audited in the same batch.
    if (design !== undefined) {
      const batch = pb.createBatch();
      queueDesignWrite(
        batch,
        mintSystemContext({ job: "dev-seed" }),
        org.id,
        org.design,
        design,
        "dev-seed",
      );
      await batch.send();
    }

    // Preview host, by hostname. A hostname belongs to exactly one organization.
    // 14-14 (choice 4): a custom host is seeded verified, so dev behaves like prod (the edge
    // allows a custom row only once verified_at is set; P14-P4).
    const verified =
      hostKind === "custom" ? { verified_at: new Date().toISOString() } : {};
    const host = await firstOrNull(
      pb,
      "org_hosts",
      pb.filter("hostname = {:h}", { h: hostname }),
    );
    if (host) {
      if (host.organization !== org.id) {
        throw new InvalidInput("host already belongs to another organization");
      }
      await pb
        .collection("org_hosts")
        .update(host.id, { kind: hostKind, primary: true, ...verified });
    } else {
      await pb.collection("org_hosts").create({
        hostname,
        organization: org.id,
        kind: hostKind,
        primary: true,
        ...verified,
      });
    }

    // Owner user, by email. Staff accounts are never reused as a tenant owner.
    const existingOwner = await firstOrNull(
      pb,
      "users",
      pb.filter("email = {:e}", { e: email }),
    );
    const password = input.ownerPassword;
    let owner: RecordModel;
    if (existingOwner) {
      if (existingOwner.staff_role) {
        throw new InvalidInput("owner email belongs to a CDS staff account");
      }
      // Never reset the password of, or hand this org to, an account that belongs to any
      // other organization (WR-A05; D286: one owned org per user).
      const elsewhere = await pb.collection("memberships").getList(1, 1, {
        filter: pb.filter("user = {:u} && organization != {:o}", {
          u: existingOwner.id,
          o: org.id,
        }),
        fields: "id",
      });
      if (elsewhere.totalItems > 0) {
        throw new InvalidInput(
          "owner email belongs to an account outside this dev tenant",
        );
      }
      // Nor promote a member of this org who is not already its owner: the seed would reset
      // their password and hand them the org (IN-R01).
      const here = await firstOrNull(
        pb,
        "memberships",
        pb.filter("user = {:u} && organization = {:o}", {
          u: existingOwner.id,
          o: org.id,
        }),
      );
      if (here && here.role !== "owner") {
        throw new InvalidInput(
          "owner email belongs to a member of this dev tenant who is not its owner",
        );
      }
      owner = await pb
        .collection("users")
        .update(existingOwner.id, { password, passwordConfirm: password });
    } else {
      owner = await pb
        .collection("users")
        .create({ email, password, passwordConfirm: password });
    }

    // Owner membership, by user + org.
    const membership = await firstOrNull(
      pb,
      "memberships",
      pb.filter("user = {:u} && organization = {:o}", {
        u: owner.id,
        o: org.id,
      }),
    );
    // An existing membership is already the owner (a non-owner member is refused above).
    if (!membership) {
      await pb
        .collection("memberships")
        .create({ user: owner.id, organization: org.id, role: "owner" });
    }

    return { orgId: org.id, ownerId: owner.id, created };
  });
  if (design !== undefined)
    deps.invalidator?.invalidate([themeTag(result.orgId)]);
  return result;
}

export type DevStageResult = {
  orgId: string;
  from: OrgStage;
  to: Exclude<OrgStage, "">;
  /** forward: through setOrgStage; back: the dev-only reset; same: nothing written. */
  moved: "forward" | "back" | "same";
  launchedAt: string | null;
};

/**
 * DEV ONLY (11-42): place a seeded dev tenant (by slug, default "demo") in any stage, for
 * walks and human checks. A forward move goes through setOrgStage with a system context (the
 * one stage transition: audited org.stage_changed, launched_at set at live, the team's
 * site.stage alert raised). setOrgStage never moves backwards, so a backward move is a
 * dev-only reset written here: the stage, launched_at cleared below live, audited
 * org.stage_dev_reset in the same batch. Refuses unless CDS_ENV is exactly "dev"
 * (T-11-42-03) and refuses an unknown stage before any database call.
 */
export async function setDevTenantStage(
  stage: string,
  slug = "demo",
): Promise<DevStageResult> {
  assertDevEnvironment();
  if (!isOrgStage(stage)) {
    throw new InvalidInput(`stage must be one of ${ORG_STAGES.join(", ")}`);
  }
  const org = await withSuperuser((pb) =>
    firstOrNull(pb, "organizations", pb.filter("slug = {:slug}", { slug })),
  );
  if (!org) {
    throw new InvalidInput(
      `no "${slug}" dev tenant: run npm run tenants:seed-dev first`,
    );
  }
  const from: OrgStage = isOrgStage(org.stage) ? org.stage : "";
  const ctx = mintSystemContext({ job: "dev-seed" });
  const launched =
    typeof org.launched_at === "string" && org.launched_at !== ""
      ? org.launched_at
      : null;
  if (from === stage) {
    return {
      orgId: org.id,
      from,
      to: stage,
      moved: "same",
      launchedAt: launched,
    };
  }
  if (from === "" || ORG_STAGES.indexOf(stage) > ORG_STAGES.indexOf(from)) {
    const r = await setOrgStage(ctx, org.id, stage);
    return {
      orgId: org.id,
      from,
      to: stage,
      moved: "forward",
      launchedAt: r.launchedAt,
    };
  }
  const reset: Record<string, string> = { stage };
  if (stage !== "live") reset.launched_at = "";
  await withSuperuser(async (pb) => {
    // Review 11 IN-A05: the stage alerts are deduped on `stage:<to>`, so walking the stage
    // forward again after a reset would raise nothing. Clear them with the reset.
    const stageAlerts = await pb.collection("alerts").getFullList({
      filter: pb.filter("organization = {:org} && type = 'site.stage'", {
        org: org.id,
      }),
      fields: "id",
    });
    const batch = pb.createBatch();
    batch.collection("organizations").update(org.id, reset);
    for (const a of stageAlerts) batch.collection("alerts").delete(a.id);
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "org.stage_dev_reset",
        organization: org.id,
        targetCollection: "organizations",
        targetId: org.id,
        meta: { from, to: stage },
      }),
    );
    await batch.send();
  });
  return {
    orgId: org.id,
    from,
    to: stage,
    moved: "back",
    launchedAt: stage === "live" ? launched : null,
  };
}
