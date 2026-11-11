// Tenant site Privacy policy and Terms: acknowledgement, review, state and public read (AGR-08,
// D217, D287; CONTEXT Area 5 A5-Q1..Q4; RESEARCH Open Question 3; invariants 1 and 4).
//
// - acknowledgeSitePolicies (owner only, impersonation-denied: legal_ack:run) refuses until
//   legal_name and privacy_contact are set, renders both pages at the latest template
//   version, and appends one site_policy_acks row (kind "ack") plus its audit row in ONE batch.
// - recordSitePolicyReview (same permission) appends a kind "review" row when the owner opens
//   Preview; it resets the "added since" baseline for the ADDON-CHANGED notice (choice 2).
// - readPublishedSitePolicy (SiteContext, public) is null until an ack exists, then renders
//   live from the acknowledged template version, the current business profile and the
//   currently active add-ons (A5-Q2, A5-Q4).
// - The add-on registry is always a parameter, never imported here (invariant 4, choice 1).
// Rows are append-only (09-03 hook): this module never updates or deletes them.
import { InvalidInput } from "@cds/core";
import type { AddonManifest } from "@cds/core/addons";
import {
  latestSitePolicyVersion,
  renderSitePolicy,
  retainUntil,
  type RenderedSitePolicy,
  type SitePolicyFacts,
  type SitePolicyPage,
  type SitePolicyTemplate,
} from "@cds/core/legal";
import type PocketBase from "pocketbase";
import { ClientResponseError, type RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import type { OrgContext } from "../context";
import { mapError, newRecordId, requirePermission } from "../repository";
import { sha256Hex } from "./hash";

const COLLECTION = "site_policy_acks";

/** UI-SPEC MISSING-LEGAL-INPUTS. */
export const SITE_POLICY_INPUTS_MISSING_COPY =
  "Add your legal business name and a privacy contact email in Business info first. Your policy pages use them.";

/** legal_name or privacy_contact is empty: Preview and Publish wait for Business info. */
export class SitePolicyInputsMissing extends InvalidInput {
  override readonly code: string = "site_policy_inputs_missing";
  constructor() {
    super(SITE_POLICY_INPUTS_MISSING_COPY);
  }
}

/** The add-on registry, passed in by the caller (invariant 4). */
export type SitePolicyRegistry = { list(): readonly AddonManifest[] };

export type SitePolicyState = {
  published: boolean;
  ack: { templateVersion: number; ackedAt: string; userName: string } | null;
  latestTemplateVersion: number;
  templateUpdateWaiting: boolean;
  /** Active add-ons whose clauses joined the live privacy page since the last ack or review. */
  addedSinceReview: readonly { slug: string; label: string }[];
  missingInputs: readonly ("legal_name" | "privacy_contact")[];
  /** The privacy page's clause headings ("Covers: ..."). */
  coveredLabels: readonly string[];
  /** Later of the ack and the newest activation of an add-on whose clauses appear. */
  lastUpdated: string | null;
};

export type PublishedSitePolicy = RenderedSitePolicy & { lastUpdated: string };

type Deps = { now?: () => Date };

// ---------------------------------------------------------------- test seam (not in barrel)

let testTemplates: readonly SitePolicyTemplate[] | null = null;

/** Tests only: swap the compiled template set (null restores it). Never in the barrel. */
export function __setSitePolicyTemplatesForTests(
  templates: readonly SitePolicyTemplate[] | null,
): void {
  testTemplates = templates;
}

function templates(): readonly SitePolicyTemplate[] | undefined {
  return testTemplates ?? undefined;
}

// ---------------------------------------------------------------- facts

type Loaded = {
  facts: SitePolicyFacts;
  legalName: string;
  privacyContact: string;
  /** Active add-on slug -> activation time (ISO, "" when unknown). */
  activatedAt: Map<string, string>;
};

/** PocketBase date -> ISO, or "" (Pitfall 10). */
function isoOf(v: unknown): string {
  if (typeof v !== "string" || v === "") return "";
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Every read is filtered by the one org id passed in (invariant 1). */
async function loadFacts(
  pb: PocketBase,
  orgId: string,
  registry: SitePolicyRegistry,
): Promise<Loaded> {
  const byOrg = pb.filter("organization = {:org}", { org: orgId });
  const [org, profile, addons, lists, newsletterForms] = await Promise.all([
    pb.collection("organizations").getOne(orgId, { fields: "id,name" }),
    pb.collection("business_profile").getList(1, 1, {
      filter: byOrg,
      fields: "legal_name,privacy_contact,legal_region,ga4_id",
    }),
    pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:org} && status = 'active'", {
        org: orgId,
      }),
      fields: "addon,installed_at,updated",
      sort: "addon,id",
    }),
    pb
      .collection("contact_lists")
      .getList(1, 1, { filter: byOrg, fields: "id" }),
    pb.collection("forms").getList(1, 1, {
      filter: pb.filter(
        "organization = {:org} && newsletter_checkbox = true && deleted_at = ''",
        { org: orgId },
      ),
      fields: "id",
    }),
  ]);
  const p = profile.items[0];
  const legalName = str(p?.legal_name);
  const privacyContact = str(p?.privacy_contact);
  const activatedAt = new Map<string, string>();
  for (const r of addons) {
    if (typeof r.addon !== "string" || r.addon === "") continue;
    activatedAt.set(r.addon, isoOf(r.installed_at) || isoOf(r.updated));
  }
  return {
    legalName,
    privacyContact,
    activatedAt,
    facts: {
      legalName,
      businessName: str(org.name),
      privacyContact,
      legalRegion: str(p?.legal_region),
      // Choice 3: newsletter = any contact list or a form with the newsletter checkbox.
      hasNewsletter: lists.items.length > 0 || newsletterForms.items.length > 0,
      // Choice 3: analytics = a GA4 id is set.
      hasAnalytics: str(p?.ga4_id) !== "",
      // Choice 3: conservative; no cheap existing read says otherwise.
      hasEmbeds: true,
      activeAddons: new Set(activatedAt.keys()),
      addons: registry,
    },
  };
}

function missingOf(l: Loaded): ("legal_name" | "privacy_contact")[] {
  const out: ("legal_name" | "privacy_contact")[] = [];
  if (l.legalName === "") out.push("legal_name");
  if (l.privacyContact === "") out.push("privacy_contact");
  return out;
}

/** Facts with placeholder legal inputs: clause labels never depend on them. */
function labelFacts(l: Loaded): SitePolicyFacts {
  return {
    ...l.facts,
    legalName: l.legalName || "Business",
    privacyContact: "privacy@example.com",
  };
}

/** Clause id -> the active add-on that contributed it (registry order). */
function clauseOwners(
  registry: SitePolicyRegistry,
  active: ReadonlySet<string>,
): Map<string, AddonManifest> {
  const out = new Map<string, AddonManifest>();
  let list: readonly AddonManifest[] = [];
  try {
    list = registry.list();
  } catch {
    return out;
  }
  if (!Array.isArray(list)) return out;
  for (const m of list) {
    if (!active.has(m.slug) || !Array.isArray(m.privacyClauses)) continue;
    for (const c of m.privacyClauses) {
      if (c && typeof c.id === "string" && !out.has(c.id)) out.set(c.id, m);
    }
  }
  return out;
}

/** Choice 4: the later of the ack and the newest activation among add-ons with clauses shown. */
function lastUpdatedOf(
  ackedAt: string,
  rendered: RenderedSitePolicy,
  l: Loaded,
  registry: SitePolicyRegistry,
): string {
  let latest = ackedAt;
  const owners = clauseOwners(registry, l.facts.activeAddons);
  for (const id of rendered.clauseIds) {
    const m = owners.get(id);
    if (!m) continue;
    const at = l.activatedAt.get(m.slug) ?? "";
    if (at !== "" && at > latest) latest = at;
  }
  return latest;
}

// ---------------------------------------------------------------- rows

type AckRow = {
  id: string;
  kind: "ack" | "review";
  templateVersion: number;
  userName: string;
  clauseIds: readonly string[];
  ackedAt: string;
};

function rowOf(r: RecordModel): AckRow {
  return {
    id: r.id,
    kind: r.kind === "review" ? "review" : "ack",
    templateVersion:
      typeof r.template_version === "number" ? r.template_version : 0,
    userName: String(r.user_name ?? ""),
    clauseIds: Array.isArray(r.clause_ids)
      ? (r.clause_ids as unknown[]).filter(
          (x): x is string => typeof x === "string",
        )
      : [],
    ackedAt: isoOf(r.acked_at),
  };
}

/** The org's newest row of one kind, or null. */
async function latestRow(
  pb: PocketBase,
  orgId: string,
  kind: "ack" | "review",
): Promise<AckRow | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("organization = {:org} && kind = {:k}", {
      org: orgId,
      k: kind,
    }),
    sort: "-acked_at,-id",
  });
  const r = res.items[0];
  return r ? rowOf(r) : null;
}

function mapped<T>(p: Promise<T>): Promise<T> {
  return p.catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

// ---------------------------------------------------------------- owner / admin reads

/** The live facts for the org (agreements:read). */
export async function sitePolicyFacts(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
): Promise<SitePolicyFacts> {
  requirePermission(ctx, "agreements", "read");
  return mapped(
    withSuperuser(
      async (pb) => (await loadFacts(pb, ctx.orgId, registry)).facts,
    ),
  );
}

/** Settings > Legal section 2 state (agreements:read; A5-Q3, A5-Q4). */
export async function sitePolicyState(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
): Promise<SitePolicyState> {
  requirePermission(ctx, "agreements", "read");
  return mapped(
    withSuperuser(async (pb) => {
      const [l, ack, review] = await Promise.all([
        loadFacts(pb, ctx.orgId, registry),
        latestRow(pb, ctx.orgId, "ack"),
        latestRow(pb, ctx.orgId, "review"),
      ]);
      const latest = latestSitePolicyVersion(templates());
      const version = ack ? ack.templateVersion : latest;
      // An acknowledged template version no longer in code falls back to the latest, so
      // Settings > Legal still renders (the public read returns null instead; IN-A03).
      let labels: RenderedSitePolicy;
      try {
        labels = renderSitePolicy(
          "privacy",
          labelFacts(l),
          version,
          templates(),
        );
      } catch (err) {
        if (!(err instanceof InvalidInput) || version === latest) throw err;
        labels = renderSitePolicy(
          "privacy",
          labelFacts(l),
          latest,
          templates(),
        );
      }
      const missing = missingOf(l);

      let addedSinceReview: { slug: string; label: string }[] = [];
      let lastUpdated: string | null = null;
      if (ack) {
        const baseline = review && review.ackedAt > ack.ackedAt ? review : ack;
        const seen = new Set(baseline.clauseIds);
        const owners = clauseOwners(registry, l.facts.activeAddons);
        const added = new Map<string, string>();
        for (const id of labels.clauseIds) {
          const m = owners.get(id);
          if (!m || seen.has(id) || added.has(m.slug)) continue;
          added.set(m.slug, m.name || m.slug);
        }
        addedSinceReview = [...added].map(([slug, label]) => ({ slug, label }));
        lastUpdated = lastUpdatedOf(ack.ackedAt, labels, l, registry);
      }

      return {
        published: ack !== null,
        ack: ack
          ? {
              templateVersion: ack.templateVersion,
              ackedAt: ack.ackedAt,
              userName: ack.userName,
            }
          : null,
        latestTemplateVersion: latest,
        templateUpdateWaiting: ack !== null && ack.templateVersion < latest,
        addedSinceReview,
        missingInputs: missing,
        coveredLabels: labels.coveredLabels,
        lastUpdated,
      };
    }),
  );
}

/** One page at the latest template version, for the Preview drawer (agreements:read). */
export async function previewSitePolicy(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
  page: SitePolicyPage,
): Promise<RenderedSitePolicy> {
  requirePermission(ctx, "agreements", "read");
  const p = pageOf(page);
  return mapped(
    withSuperuser(async (pb) => {
      const l = await loadFacts(pb, ctx.orgId, registry);
      if (missingOf(l).length > 0) throw new SitePolicyInputsMissing();
      return renderSitePolicy(
        p,
        l.facts,
        latestSitePolicyVersion(templates()),
        templates(),
      );
    }),
  );
}

function pageOf(page: unknown): SitePolicyPage {
  if (page !== "privacy" && page !== "terms") {
    throw new InvalidInput("Unknown policy page.");
  }
  return page;
}

// ---------------------------------------------------------------- owner writes

async function userNameOf(pb: PocketBase, userId: string): Promise<string> {
  try {
    const u = await pb
      .collection("users")
      .getOne(userId, { fields: "id,name" });
    return String(u.name ?? "").slice(0, 120);
  } catch {
    return "";
  }
}

function ipOf(input: unknown): string {
  if (input === null || typeof input !== "object") return "";
  const ip = (input as { ip?: unknown }).ip;
  return typeof ip === "string" ? ip.slice(0, 64) : "";
}

/** Shared ack/review writer: render both pages, one row + one audit row in one batch. */
async function writeRow(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
  input: { ip: string },
  kind: "ack" | "review",
  deps: Deps,
): Promise<{ templateVersion: number; ackedAt: string }> {
  return mapped(
    withOrgLock(ctx.orgId, () =>
      withSuperuser(async (pb) => {
        const l = await loadFacts(pb, ctx.orgId, registry);
        if (missingOf(l).length > 0) throw new SitePolicyInputsMissing();
        let version = latestSitePolicyVersion(templates());
        if (kind === "review") {
          // A review records what is live: the acknowledged version when there is one.
          const ack = await latestRow(pb, ctx.orgId, "ack");
          if (ack) version = ack.templateVersion;
        }
        const privacy = renderSitePolicy(
          "privacy",
          l.facts,
          version,
          templates(),
        );
        const terms = renderSitePolicy("terms", l.facts, version, templates());
        const privacySha = sha256Hex(privacy.html);
        const termsSha = sha256Hex(terms.html);
        const at = (deps.now ?? (() => new Date()))();
        const ackedAt = at.toISOString();
        const id = newRecordId();
        const userName = await userNameOf(pb, ctx.actor);

        const batch = pb.createBatch();
        batch.collection(COLLECTION).create({
          id,
          organization: ctx.orgId,
          user: ctx.actor,
          user_name: userName,
          kind,
          template_version: version,
          privacy_sha256: privacySha,
          terms_sha256: termsSha,
          clause_ids: [...privacy.clauseIds],
          ip: ipOf(input),
          acked_at: ackedAt,
          retain_until: retainUntil(at).toISOString(),
        });
        batch.collection("audit_log").create(
          auditBody(ctx, {
            action:
              kind === "ack" ? "site_policies.publish" : "site_policies.review",
            targetCollection: COLLECTION,
            targetId: id,
            meta: {
              template_version: version,
              privacy_sha256: privacySha,
              terms_sha256: termsSha,
            },
          }),
        );
        await batch.send();
        return { templateVersion: version, ackedAt };
      }),
    ),
  );
}

/** Acknowledge and publish both policy pages (owner only, impersonation-denied; D217, D287). */
export async function acknowledgeSitePolicies(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
  input: { ip: string },
  deps: Deps = {},
): Promise<{ templateVersion: number; ackedAt: string }> {
  requirePermission(ctx, "legal_ack", "run");
  return writeRow(ctx, registry, input, "ack", deps);
}

/** The owner opened Preview after an add-on change: reset the ADDON-CHANGED baseline. */
export async function recordSitePolicyReview(
  ctx: OrgContext,
  registry: SitePolicyRegistry,
  input: { ip: string },
  deps: Deps = {},
): Promise<void> {
  requirePermission(ctx, "legal_ack", "run");
  await writeRow(ctx, registry, input, "review", deps);
}

// ---------------------------------------------------------------- public read

/**
 * The live policy page for a tenant host (choice 5: the same SiteContext the tenant routes
 * use). Null until the org has acknowledged, or when the legal inputs are now blank (the
 * route 404s and the footer hides the links). Renders the acknowledged template version.
 */
export async function readPublishedSitePolicy(
  site: SiteContext,
  registry: SitePolicyRegistry,
  page: SitePolicyPage,
): Promise<PublishedSitePolicy | null> {
  assertSiteContext(site);
  const p = pageOf(page);
  return mapped(
    withSuperuser(async (pb) => {
      const ack = await latestRow(pb, site.orgId, "ack");
      if (!ack) return null;
      const l = await loadFacts(pb, site.orgId, registry);
      if (missingOf(l).length > 0) return null;
      let rendered: RenderedSitePolicy;
      try {
        rendered = renderSitePolicy(
          p,
          l.facts,
          ack.templateVersion,
          templates(),
        );
      } catch (err) {
        if (err instanceof InvalidInput) return null;
        throw err;
      }
      return {
        ...rendered,
        lastUpdated: lastUpdatedOf(ack.ackedAt, rendered, l, registry),
      };
    }),
  );
}
