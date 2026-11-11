// Staff Sites read model (13-10; STAFF-02, D5; T-13-10-01..03). Every org with its state,
// path, plan + Care Plan, active add-ons, hosts, last owner activity and open tickets, for the
// console Sites list and site detail. 10-50 orgs: one superuser read per collection, joined in
// memory, `fields:` always explicit. Members are names and roles only (never an email); the
// audit log is the tenant query behind a staff check. 13-33: `repeatInfringer` comes from the
// review read (13-23 `repeatInfringerFor`, P13-P25), and `staffSiteAddons` lists one org's
// add-on entitlements (active and disabled) for the site detail Add-ons tab.
// 14-45 (LIFE-01; 14-UI-SPEC "Sites list"): `leavingDays` = whole days left in an open
// offboarding notice (null when none); the Status filter value `leaving` keeps only those
// sites. Leaving is shown beside the state, never instead of it.
import { ADDON_PATHS, type AddonPath } from "@cds/core/addons";
import { authorizeStaff, NotFound } from "@cds/core";
import type { RecordModel } from "pocketbase";
import { clampInt } from "../audit";
import { withSuperuser } from "../client";
import { assertPlatformContext, type PlatformContext } from "../context";
import { repeatInfringerFor } from "./review/cases";

const ORG_ID = /^[a-z0-9]{15}$/;
const OPEN_TICKET_STATUSES = ["open", "in_progress", "waiting_on_you"];
const ROLE_ORDER = ["owner", "admin", "editor", "viewer", "staff", "renter"];

export const STAFF_SITE_STATES = [
  "live",
  "building",
  "held",
  "suspended",
  "notice",
  "closed",
  "lapsed",
  "intake",
  "fit_review",
  "ready_for_build",
  "ready_for_review",
] as const;
export type StaffSiteState = (typeof STAFF_SITE_STATES)[number];

export type StaffSiteRow = {
  orgId: string;
  name: string;
  slug: string;
  state: StaffSiteState;
  path: AddonPath | "";
  /** billing_accounts.cadence ("monthly" / "yearly"); "" before checkout. */
  plan: string;
  carePlan: boolean;
  /** Active add-on slugs, sorted. */
  addons: string[];
  /** Primary custom host, else any custom host; null before a domain is connected. */
  liveHost: string | null;
  previewHost: string | null;
  created: string;
  /** Newest audit row written by an Owner (not under impersonation); null when none. */
  lastOwnerActivity: string | null;
  openTickets: number;
  demo: boolean;
  repeatInfringer: boolean;
  /** Days left in an open offboarding notice (rounded up, min 0); null when not leaving. */
  leavingDays: number | null;
};

/** Sites list Status filter value for sites in an offboarding notice (14-45). */
export const STAFF_SITES_LEAVING = "leaving";

export type StaffSitesFilter = {
  /** Business name, slug, org id or any host, case-insensitive. */
  q?: string;
  /** A site state, or `leaving` (an offboarding notice is open). */
  status?: StaffSiteState | typeof STAFF_SITES_LEAVING;
  path?: AddonPath;
  addon?: string;
  now?: Date;
};

export type StaffSiteMember = { name: string; role: string };

export type StaffSiteBilling = {
  state: string;
  plan: string;
  carePlan: boolean;
  nextRenewal: string | null;
};

export type StaffSiteSuspension = {
  mode: string;
  category: string;
  note: string;
  suspendedAt: string | null;
  noticeSentAt: string | null;
  fixBy: string | null;
  fixedAt: string | null;
  liftedAt: string | null;
};

export type StaffSiteDetail = StaffSiteRow & {
  members: StaffSiteMember[];
  billing: StaffSiteBilling;
  suspension: StaffSiteSuspension | null;
};

export type StaffAuditRow = {
  id: string;
  action: string;
  actorName: string;
  /** True when CDS staff acted inside the tenant. */
  byStaff: boolean;
  /** True when the row was written while staff viewed the hub as a member (13-33). */
  impersonated: boolean;
  impersonatorName: string;
  targetCollection: string;
  targetId: string;
  meta: unknown;
  created: string;
};

/** Audit tab filter (13-33): every row, CDS rows (console + impersonation), impersonation only. */
export const STAFF_AUDIT_FILTERS = ["all", "cds", "impersonation"] as const;
export type StaffAuditFilter = (typeof STAFF_AUDIT_FILTERS)[number];

export type StaffAuditPage = {
  items: StaffAuditRow[];
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
};

const ORG_FIELDS =
  "id,name,slug,status,path,stage,billing_status,closed_at,closed_reason," +
  "suspended_at,suspension,demo,created";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateOrNull(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function pathOf(v: unknown): AddonPath | "" {
  return (ADDON_PATHS as readonly string[]).includes(str(v))
    ? (v as AddonPath)
    : "";
}

function suspensionOf(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** The one state shown for an org; the most urgent fact wins. */
function stateOf(org: RecordModel): StaffSiteState {
  if (str(org.closed_at) !== "" || str(org.closed_reason) !== "") {
    return "closed";
  }
  if (str(org.suspended_at) !== "") return "suspended";
  const s = suspensionOf(org.suspension);
  if (
    s &&
    s.mode === "notice" &&
    !dateOrNull(s.lifted_at) &&
    !dateOrNull(s.fixed_at)
  ) {
    return "notice";
  }
  if (org.billing_status === "lapsed") return "lapsed";
  if (org.status === "held" || org.status === "disabled") return "held";
  switch (org.stage) {
    case "live":
      return "live";
    case "being_built":
      return "building";
    case "fit_review":
    case "ready_for_build":
    case "ready_for_review":
      return org.stage;
    default:
      return "intake";
  }
}

function orgIdOf(orgId: unknown): string {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    throw new NotFound("organization not found");
  }
  return orgId;
}

function byOrg(rows: RecordModel[]): Map<string, RecordModel[]> {
  const m = new Map<string, RecordModel[]>();
  for (const r of rows) {
    const k = str(r.organization);
    if (k === "") continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

/** `organization = a || organization = b …`, or no filter for the full list. */
function orgFilter(
  pb: { filter(raw: string, params?: Record<string, unknown>): string },
  orgIds: readonly string[] | null,
  extra = "",
): string {
  const parts: string[] = [];
  if (orgIds) {
    parts.push(
      "(" +
        orgIds
          .map((id) => pb.filter("organization = {:org}", { org: id }))
          .join(" || ") +
        ")",
    );
  }
  if (extra) parts.push(extra);
  return parts.join(" && ");
}

type Joined = {
  orgs: RecordModel[];
  hosts: Map<string, RecordModel[]>;
  addons: Map<string, RecordModel[]>;
  billing: Map<string, RecordModel[]>;
  tickets: Map<string, RecordModel[]>;
  owners: Map<string, RecordModel[]>;
  lastOwner: Map<string, string>;
  /** org id -> notice end (ISO) of its open offboarding. */
  leaving: Map<string, string>;
};

async function readJoined(orgIds: readonly string[] | null): Promise<Joined> {
  return withSuperuser(async (pb) => {
    const orgs = orgIds
      ? await Promise.all(
          orgIds.map((id) =>
            pb.collection("organizations").getOne(id, { fields: ORG_FIELDS }),
          ),
        )
      : await pb
          .collection("organizations")
          .getFullList({ fields: ORG_FIELDS, sort: "name,id" });
    const ids = orgIds ?? orgs.map((o) => o.id);
    const scope = orgIds ? ids : null;
    const [hosts, addons, billing, tickets, owners, offboardings] =
      await Promise.all([
        pb.collection("org_hosts").getFullList({
          filter: orgFilter(pb, scope),
          fields: "organization,hostname,kind,primary",
          sort: "-primary,hostname",
        }),
        pb.collection("org_addons").getFullList({
          filter: orgFilter(pb, scope, "status = 'active'"),
          fields: "organization,addon",
        }),
        pb.collection("billing_accounts").getFullList({
          filter: orgFilter(pb, scope),
          fields: "organization,status,cadence,care_plan,current_period_end",
          sort: "-updated",
        }),
        pb.collection("support_threads").getFullList({
          filter: orgFilter(
            pb,
            scope,
            "kind = 'ticket' && (" +
              OPEN_TICKET_STATUSES.map((s) => `status = '${s}'`).join(" || ") +
              ")",
          ),
          fields: "organization",
        }),
        pb.collection("memberships").getFullList({
          filter: orgFilter(pb, scope, "role = 'owner'"),
          fields: "organization,user",
        }),
        pb.collection("offboardings").getFullList({
          // org_id is text (P13-P5), so the scope is bound per id rather than via orgFilter.
          filter: scope
            ? "(" +
              scope
                .map((id) =>
                  pb.filter("org_id = {:org} && status = {:s}", {
                    org: id,
                    s: "notice",
                  }),
                )
                .join(" || ") +
              ")"
            : pb.filter("status = {:s}", { s: "notice" }),
          fields: "org_id,notice_ends_at",
        }),
      ]);
    const ownersByOrg = byOrg(owners);
    // Last owner activity: the newest audit row by one of the org's Owners that was not
    // written under impersonation. One small indexed read per org (10-50 orgs).
    const lastOwner = new Map<string, string>();
    await Promise.all(
      ids.map(async (id) => {
        const userIds = (ownersByOrg.get(id) ?? [])
          .map((m) => str(m.user))
          .filter((u) => u !== "");
        if (userIds.length === 0) return;
        const actorClause = userIds
          .map((u) => pb.filter("actor = {:actor}", { actor: u }))
          .join(" || ");
        const res = await pb.collection("audit_log").getList(1, 1, {
          filter:
            pb.filter("organization = {:org} && impersonator = ''", {
              org: id,
            }) + ` && (${actorClause})`,
          fields: "created",
          sort: "-created,-id",
          skipTotal: true,
        });
        const at = str(res.items[0]?.created);
        if (at !== "") lastOwner.set(id, at);
      }),
    );
    return {
      orgs,
      hosts: byOrg(hosts),
      addons: byOrg(addons),
      billing: byOrg(billing),
      tickets: byOrg(tickets),
      owners: ownersByOrg,
      lastOwner,
      leaving: new Map(
        offboardings.map((o) => [str(o.org_id), str(o.notice_ends_at)]),
      ),
    };
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days left until `endsAt` (rounded up, min 0); null when not leaving. */
export function leavingDaysLeft(
  endsAt: string | undefined,
  now: Date,
): number | null {
  if (endsAt === undefined) return null;
  const t = Date.parse(endsAt.replace(" ", "T"));
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now.getTime()) / DAY_MS));
}

function rowOf(
  org: RecordModel,
  j: Joined,
  repeat: ReadonlySet<string>,
  now: Date = new Date(),
): StaffSiteRow {
  const hosts = j.hosts.get(org.id) ?? [];
  const custom = hosts.filter((h) => h.kind === "custom");
  const preview = hosts.filter((h) => h.kind !== "custom");
  const pick = (list: RecordModel[]): string | null => {
    const h = list.find((x) => x.primary === true) ?? list[0];
    const name = h ? str(h.hostname).trim() : "";
    return name === "" ? null : name;
  };
  const account = (j.billing.get(org.id) ?? [])[0];
  return {
    orgId: org.id,
    name: str(org.name),
    slug: str(org.slug),
    state: stateOf(org),
    path: pathOf(org.path),
    plan: account ? str(account.cadence) : "",
    carePlan: account?.care_plan === true,
    addons: [
      ...new Set(
        (j.addons.get(org.id) ?? []).map((a) => str(a.addon)).filter(Boolean),
      ),
    ].sort(),
    liveHost: pick(custom),
    previewHost: pick(preview),
    created: str(org.created),
    lastOwnerActivity: j.lastOwner.get(org.id) ?? null,
    openTickets: (j.tickets.get(org.id) ?? []).length,
    demo: org.demo === true,
    repeatInfringer: repeat.has(org.id),
    leavingDays: leavingDaysLeft(j.leaving.get(org.id), now),
  };
}

function matches(
  row: StaffSiteRow,
  hosts: RecordModel[],
  f: StaffSitesFilter,
): boolean {
  if (f.status === STAFF_SITES_LEAVING) {
    if (row.leavingDays === null) return false;
  } else if (f.status && row.state !== f.status) return false;
  if (f.path && row.path !== f.path) return false;
  if (f.addon && !row.addons.includes(f.addon)) return false;
  const q = typeof f.q === "string" ? f.q.trim().toLowerCase() : "";
  if (q !== "") {
    const hay = [
      row.name,
      row.slug,
      row.orgId,
      ...hosts.map((h) => str(h.hostname)),
    ]
      .join("\n")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Every org for the console Sites list, sorted by name, filtered in memory (`console`). */
export async function staffListSites(
  ctx: PlatformContext,
  filter: StaffSitesFilter = {},
): Promise<StaffSiteRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const j = await readJoined(null);
  const repeat = await repeatInfringerFor(
    j.orgs.map((o) => o.id),
    filter?.now ? { now: filter.now } : {},
  );
  return j.orgs
    .map((org) => rowOf(org, j, repeat, filter?.now ?? new Date()))
    .filter((row) => matches(row, j.hosts.get(row.orgId) ?? [], filter ?? {}))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "en", { sensitivity: "base" }) ||
        a.orgId.localeCompare(b.orgId),
    );
}

/** One org for the console site detail: row + members (names, roles), billing, suspension. */
export async function staffGetSite(
  ctx: PlatformContext,
  orgId: string,
): Promise<StaffSiteDetail> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const id = orgIdOf(orgId);
  let j: Joined;
  try {
    j = await readJoined([id]);
  } catch (err) {
    if (
      err !== null &&
      typeof err === "object" &&
      (err as { status?: unknown }).status === 404
    ) {
      throw new NotFound("organization not found");
    }
    throw err;
  }
  const org = j.orgs[0];
  if (!org) throw new NotFound("organization not found");
  const row = rowOf(org, j, await repeatInfringerFor([id]));
  const memberRows = await withSuperuser((pb) =>
    pb.collection("memberships").getFullList({
      filter: pb.filter("organization = {:org}", { org: id }),
      expand: "user",
      // Names and roles only: the user's email is never read (T-13-10-02).
      fields: "role,created,expand.user.name",
      sort: "created,id",
    }),
  );
  const members: StaffSiteMember[] = memberRows
    .map((m) => {
      const u = (m.expand as { user?: { name?: unknown } } | undefined)?.user;
      return { name: str(u?.name).trim(), role: str(m.role) };
    })
    .filter((m) => ROLE_ORDER.includes(m.role))
    .sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.name.localeCompare(b.name),
    );
  const account = (j.billing.get(id) ?? [])[0];
  const billing: StaffSiteBilling = {
    state: account ? str(account.status) : str(org.billing_status) || "none",
    plan: row.plan,
    carePlan: row.carePlan,
    nextRenewal: account ? dateOrNull(account.current_period_end) : null,
  };
  const s = suspensionOf(org.suspension);
  const suspendedAt = dateOrNull(org.suspended_at);
  const suspension: StaffSiteSuspension | null =
    s || suspendedAt
      ? {
          mode: str(s?.mode),
          category: str(s?.category),
          note: str(s?.note),
          suspendedAt,
          noticeSentAt: dateOrNull(s?.notice_sent_at),
          fixBy: dateOrNull(s?.fix_by),
          fixedAt: dateOrNull(s?.fixed_at),
          liftedAt: dateOrNull(s?.lifted_at),
        }
      : null;
  return { ...row, members, billing, suspension };
}

/** One org's audit log, newest first, for the site detail Audit tab (`console`). */
export async function staffListAuditLog(
  ctx: PlatformContext,
  orgId: string,
  opts: { page?: number; perPage?: number; who?: StaffAuditFilter } = {},
): Promise<StaffAuditPage> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const id = orgIdOf(orgId);
  const page = clampInt(opts?.page, 1, 1, Number.MAX_SAFE_INTEGER);
  const perPage = clampInt(opts?.perPage, 50, 1, 50);
  // Platform rows carry actor = impersonator = the staff member; impersonated rows carry the
  // member as actor and the staff member as impersonator (audit.ts auditBody).
  const who: StaffAuditFilter = STAFF_AUDIT_FILTERS.includes(
    opts?.who as StaffAuditFilter,
  )
    ? (opts.who as StaffAuditFilter)
    : "all";
  const whoClause =
    who === "cds"
      ? " && impersonator != ''"
      : who === "impersonation"
        ? " && impersonator != '' && actor != impersonator"
        : "";
  const res = await withSuperuser(async (pb) => {
    try {
      await pb.collection("organizations").getOne(id, { fields: "id" });
    } catch (err) {
      if ((err as { status?: unknown })?.status === 404) {
        throw new NotFound("organization not found");
      }
      throw err;
    }
    return pb.collection("audit_log").getList(page, perPage, {
      filter: pb.filter("organization = {:org}", { org: id }) + whoClause,
      sort: "-created,-id",
      expand: "actor,impersonator",
      // No ip, no email: names only (T-13-10-02).
      fields:
        "id,action,actor,impersonator,target_collection,target_id,meta,created," +
        "expand.actor.name,expand.impersonator.name",
    });
  });
  const items: StaffAuditRow[] = res.items.map((r) => {
    const ex = r.expand as
      | { actor?: { name?: unknown }; impersonator?: { name?: unknown } }
      | undefined;
    return {
      id: r.id,
      action: str(r.action),
      actorName: str(ex?.actor?.name).trim(),
      byStaff: str(r.impersonator) !== "",
      impersonated:
        str(r.impersonator) !== "" && str(r.actor) !== str(r.impersonator),
      impersonatorName: str(ex?.impersonator?.name).trim(),
      targetCollection: str(r.target_collection),
      targetId: str(r.target_id),
      meta: r.meta ?? null,
      created: str(r.created),
    };
  });
  return {
    items,
    page: res.page,
    perPage: res.perPage,
    totalItems: res.totalItems,
    totalPages: res.totalPages,
  };
}

export type StaffSiteAddon = {
  slug: string;
  /** org_addons.status: "active" (on the site) or "disabled" (removed, data kept). */
  status: "active" | "disabled";
  /** installed_at when active, disabled_at when removed; null when not recorded. */
  since: string | null;
  /** How it arrived: staff, owner, assembly, billing (org_addons.source). */
  source: string;
};

/** One org's add-on entitlements (active first, then removed) for the site detail (`console`). */
export async function staffSiteAddons(
  ctx: PlatformContext,
  orgId: string,
): Promise<StaffSiteAddon[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "console");
  const id = orgIdOf(orgId);
  const rows = await withSuperuser(async (pb) => {
    try {
      await pb.collection("organizations").getOne(id, { fields: "id" });
    } catch (err) {
      if ((err as { status?: unknown })?.status === 404) {
        throw new NotFound("organization not found");
      }
      throw err;
    }
    return pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:org}", { org: id }),
      fields: "addon,status,source,installed_at,disabled_at",
      sort: "addon,id",
    });
  });
  const seen = new Set<string>();
  const out: StaffSiteAddon[] = [];
  for (const r of rows) {
    const slug = str(r.addon);
    if (slug === "" || seen.has(slug)) continue;
    seen.add(slug);
    const active = r.status === "active";
    out.push({
      slug,
      status: active ? "active" : "disabled",
      since: dateOrNull(active ? r.installed_at : r.disabled_at),
      source: str(r.source),
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.status === "active") - Number(a.status === "active") ||
      a.slug.localeCompare(b.slug),
  );
}
