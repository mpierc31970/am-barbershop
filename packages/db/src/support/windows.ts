// P12 service windows (12-08; COMM-11, COMM-12; D99-D102, P12-P6, P12-P8, P12-P10, P12-P12).
//
// Staff writes (CLI in P12, console in P13): create, list and clear a planned-work window.
// `support_agent` may set organization / page / component scope; platform and add-on scope
// need `super_admin` (`service_window_platform`, D100). Each write and its audit row commit in
// one batch. The display code is `W-<seq>` (P12-P6), allocated max + 1 with a retry on the
// unique index.
//
// Tenant read: `activeServiceNotices` returns the windows that reach this org now or start
// within 24 h, in owner words (NOTICE-ACTIVE / NOTICE-PLANNED via @cds/core/support). One
// bound query (cached 15 s per org in lock.ts); a failure returns [] and logs the error name
// only (Pitfall 12). An upcoming notice this person dismissed (`notice:<id>` in
// member_prefs.dismissed, P12-P10) is dropped for them only.
//
// Job helpers (12-31 and creation): `jobStartServiceWindows` raises one urgent `cds.notice` per
// reached org for started org-wide-or-wider windows and stamps `alerted_at` (P12-P8);
// `jobClearEndedWindows` stamps `cleared_at` on ended windows.
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import {
  formatNoticeEnd,
  noticeTarget,
  noticeText,
  SITE_PARTS,
  windowPhase,
  windowReaches,
  type IncidentView,
  type NoticeLabels,
  type NoticeReach,
  type ServiceNotice,
  type WindowScope,
} from "@cds/core/support";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { isUniqueViolation } from "../payments/staff-alert";
import { acquirePlatformLock, releasePlatformLock } from "../platform-meta";
import { newRecordId } from "../repository";
import { readMemberPrefs } from "../today/prefs";
import {
  invalidateWindowCache,
  orgWindowRows,
  toWindowRow,
  type ServiceWindowRow,
} from "./lock";
import { notifySupport, type SupportNotifyDeps } from "./notify";
import { OPEN_ORG_FILTER, isOpenOrg } from "./shared";

const WINDOWS = "service_windows";
const MESSAGE_MAX = 280;
const MAX_SPAN_MS = 14 * 24 * 3_600_000;
const SEQ_RETRIES = 5;
const ID_RE = /^[a-z0-9]{15}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOTICE_HREF = "/hub/support?tab=messages";
const SCOPES: readonly WindowScope[] = [
  "platform",
  "addon",
  "organization",
  "page",
  "component",
];
const WIDE: ReadonlySet<WindowScope> = new Set([
  "platform",
  "addon",
  "organization",
]);

export type WindowClock = { now(): Date };
const SYSTEM_CLOCK: WindowClock = { now: () => new Date() };

/** An add-on the CLI knows from @cds/addon-registry (db never imports add-ons, invariant 4). */
export type KnownAddon = { slug: string; name: string };

export type ServiceWindowInput = {
  scope: WindowScope;
  /** organization, page and component scope. */
  orgId?: string;
  /** add-on scope: a known add-on slug. */
  addon?: string;
  /** page scope: a page of `orgId`. */
  pageId?: string;
  /** component scope: header, footer, menus, or an add-on slug active on `orgId`. */
  component?: string;
  message?: string;
  /** Defaults to now. */
  startsAt?: Date;
  endsAt: Date;
  /** An `incidents` id whose public text the notice links (COMM-12). */
  incident?: string;
};

export type ServiceWindowOpts = {
  clock?: WindowClock;
  /** Known add-ons (slug + name); required for add-on scope. */
  addons?: readonly KnownAddon[];
  /** Passed to notifySupport when a started window alerts at creation (P12-P8). */
  notify?: SupportNotifyDeps;
};

export type ServiceWindowView = {
  id: string;
  code: string;
  scope: WindowScope;
  orgId: string;
  addon: string;
  page: string;
  component: string;
  message: string;
  startsAt: string;
  endsAt: string;
  incident: string;
  createdBy: string;
  alertedAt: string;
  clearedAt: string;
  phase: "upcoming" | "active" | "ended" | "later";
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validDate(d: unknown, what: string): Date {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new InvalidInput(`${what} must be a valid date`);
  }
  return d;
}

function code(seq: number): string {
  return `W-${seq}`;
}

function parseCode(raw: string): number {
  const m = /^W-([1-9][0-9]{0,8})$/i.exec(raw.trim());
  if (!m) throw new NotFound();
  return Number(m[1]);
}

function assertIdLike(v: unknown, what: string): string {
  if (typeof v !== "string" || !ID_RE.test(v)) {
    throw new InvalidInput(`${what} must be a record id`);
  }
  return v;
}

async function exists(
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

function permissionFor(scope: WindowScope) {
  return scope === "platform" || scope === "addon"
    ? "service_window_platform"
    : "service_window_org";
}

type Validated = {
  scope: WindowScope;
  org_id: string;
  addon: string;
  page: string;
  component: string;
  message: string;
  startsAt: Date;
  endsAt: Date;
  incident: string;
};

async function validate(
  pb: PocketBase,
  input: ServiceWindowInput,
  now: Date,
  addons: readonly KnownAddon[] | undefined,
): Promise<Validated> {
  const scope = input.scope;
  const message = str(input.message ?? "").trim();
  if (message.length > MESSAGE_MAX) {
    throw new InvalidInput(`message must be at most ${MESSAGE_MAX} characters`);
  }
  const startsAt = validDate(input.startsAt ?? now, "startsAt");
  const endsAt = validDate(input.endsAt, "endsAt");
  if (endsAt.getTime() <= startsAt.getTime()) {
    throw new InvalidInput("the end must be after the start");
  }
  if (endsAt.getTime() <= now.getTime()) {
    throw new InvalidInput("the end must be in the future");
  }
  if (endsAt.getTime() - startsAt.getTime() > MAX_SPAN_MS) {
    throw new InvalidInput("a window can last at most 14 days");
  }
  const out: Validated = {
    scope,
    org_id: "",
    addon: "",
    page: "",
    component: "",
    message,
    startsAt,
    endsAt,
    incident: "",
  };
  if (scope === "addon") {
    const slug = str(input.addon);
    if (!addons) {
      throw new InvalidInput("add-on scope needs the add-on list");
    }
    if (!addons.some((a) => a.slug === slug)) {
      throw new InvalidInput("unknown add-on");
    }
    out.addon = slug;
  }
  if (scope === "organization" || scope === "page" || scope === "component") {
    const orgId = assertIdLike(input.orgId, "org");
    const org = await exists(
      pb,
      "organizations",
      pb.filter("id = {:id}", { id: orgId }),
    );
    if (!org) throw new NotFound("No site with that id.");
    out.org_id = orgId;
  }
  if (scope === "page") {
    const pageId = assertIdLike(input.pageId, "page");
    const page = await exists(
      pb,
      "pages",
      pb.filter("id = {:id} && organization = {:org}", {
        id: pageId,
        org: out.org_id,
      }),
    );
    if (!page) throw new NotFound("That page isn't on this site.");
    out.page = pageId;
  }
  if (scope === "component") {
    const key = str(input.component).trim();
    const part = SITE_PARTS.some((p) => p.key === key);
    if (!part) {
      if (!SLUG_RE.test(key)) throw new InvalidInput("unknown component");
      const row = await exists(
        pb,
        "org_addons",
        pb.filter(
          "organization = {:org} && addon = {:a} && status = 'active'",
          {
            org: out.org_id,
            a: key,
          },
        ),
      );
      if (!row) {
        throw new InvalidInput(
          "component must be header, footer, menus or an add-on this site has on",
        );
      }
    }
    out.component = key;
  }
  if (!SCOPES.includes(scope)) throw new InvalidInput("unknown scope");
  if (input.incident !== undefined && input.incident !== "") {
    const id = assertIdLike(input.incident, "incident");
    const row = await exists(pb, "incidents", pb.filter("id = {:id}", { id }));
    if (!row) throw new NotFound("No incident with that id.");
    out.incident = id;
  }
  return out;
}

async function nextSeq(pb: PocketBase): Promise<number> {
  const res = await pb
    .collection(WINDOWS)
    .getList(1, 1, { sort: "-seq", fields: "seq" });
  const top = res.items[0];
  const last = top && typeof top.seq === "number" ? top.seq : 0;
  return last + 1;
}

function view(row: ServiceWindowRow, now: Date): ServiceWindowView {
  return {
    id: row.id,
    code: code(row.seq),
    scope: row.scope,
    orgId: row.org_id ?? "",
    addon: row.addon ?? "",
    page: row.page ?? "",
    component: row.component ?? "",
    message: row.message ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    incident: row.incident,
    createdBy: row.created_by,
    alertedAt: row.alerted_at,
    clearedAt: row.cleared_at ?? "",
    phase: windowPhase(row, now) ?? "later",
  };
}

/**
 * Creates a service window (choice 1). Platform and add-on scope need super_admin. A window
 * that has already started and reaches an org or wider alerts now (P12-P8).
 */
export async function staffCreateServiceWindow(
  ctx: PlatformContext,
  input: ServiceWindowInput,
  opts: ServiceWindowOpts = {},
): Promise<{ id: string; code: string; alerted: number }> {
  assertPlatformContext(ctx);
  if (typeof input !== "object" || input === null) {
    throw new InvalidInput("window input must be an object");
  }
  if (!SCOPES.includes(input.scope)) throw new InvalidInput("unknown scope");
  authorizeStaff(ctx.staffRole, permissionFor(input.scope));
  const clock = opts.clock ?? SYSTEM_CLOCK;
  const now = validDate(clock.now(), "now");
  const created = await withSuperuser(async (pb) => {
    const v = await validate(pb, input, now, opts.addons);
    for (let attempt = 0; attempt < SEQ_RETRIES; attempt++) {
      const seq = await nextSeq(pb);
      const id = newRecordId();
      const batch = pb.createBatch();
      batch.collection(WINDOWS).create({
        id,
        seq,
        scope: v.scope,
        org_id: v.org_id,
        addon: v.addon,
        page: v.page,
        component: v.component,
        message: v.message,
        starts_at: v.startsAt.toISOString(),
        ends_at: v.endsAt.toISOString(),
        incident: v.incident,
        created_by: ctx.actor,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "platform.service_window_set",
          organization: v.org_id || null,
          targetCollection: WINDOWS,
          targetId: id,
          meta: {
            code: code(seq),
            scope: v.scope,
            addon: v.addon,
            page: v.page,
            component: v.component,
            startsAt: v.startsAt.toISOString(),
            endsAt: v.endsAt.toISOString(),
            incident: v.incident,
          },
        }),
      );
      try {
        await batch.send();
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      return { id, seq, started: v.startsAt.getTime() <= now.getTime() };
    }
    throw new InvalidInput("window numbers are busy; try again");
  });
  invalidateWindowCache();
  let alerted = 0;
  if (created.started && WIDE.has(input.scope)) {
    alerted = (await jobStartServiceWindows(now, opts.notify ?? {}, created.id))
      .alerted;
  }
  return { id: created.id, code: code(created.seq), alerted };
}

/** Staff list of windows, soonest first; ended and cleared ones only with `includeEnded`. */
export async function staffListServiceWindows(
  ctx: PlatformContext,
  opts: { includeEnded?: boolean } = {},
  clock: WindowClock = SYSTEM_CLOCK,
): Promise<ServiceWindowView[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "service_window_org");
  const now = validDate(clock.now(), "now");
  const rows = await withSuperuser((pb) =>
    pb.collection(WINDOWS).getFullList({
      ...(opts.includeEnded
        ? {}
        : {
            filter: pb.filter("cleared_at = '' && ends_at > {:now}", { now }),
          }),
      sort: "starts_at,seq",
    }),
  );
  return rows.map((r) => view(toWindowRow(r), now));
}

/** Ends a window now (sets `cleared_at`); audited. Platform / add-on ones need super_admin. */
export async function staffClearServiceWindow(
  ctx: PlatformContext,
  which: { id?: string; code?: string },
  clock: WindowClock = SYSTEM_CLOCK,
): Promise<{ id: string; code: string; cleared: boolean }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "service_window_org");
  const now = validDate(clock.now(), "now");
  const result = await withSuperuser(async (pb) => {
    let filter: string;
    if (which?.id !== undefined) {
      filter = pb.filter("id = {:id}", { id: assertIdLike(which.id, "id") });
    } else if (typeof which?.code === "string") {
      filter = pb.filter("seq = {:seq}", { seq: parseCode(which.code) });
    } else {
      throw new InvalidInput("give a window id or code");
    }
    const found = await exists(pb, WINDOWS, filter);
    if (!found) throw new NotFound();
    const row = toWindowRow(found);
    authorizeStaff(ctx.staffRole, permissionFor(row.scope));
    if (windowPhase(row, now) === "ended") {
      return { id: row.id, code: code(row.seq), cleared: false };
    }
    const batch = pb.createBatch();
    batch.collection(WINDOWS).update(row.id, { cleared_at: now.toISOString() });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "platform.service_window_cleared",
        organization: row.org_id || null,
        targetCollection: WINDOWS,
        targetId: row.id,
        meta: { code: code(row.seq), scope: row.scope },
      }),
    );
    await batch.send();
    return { id: row.id, code: code(row.seq), cleared: true };
  });
  invalidateWindowCache();
  return result;
}

export type StaffWindowTargets = {
  /** That site's pages (title order); deleted pages are gone from the collection. */
  pages: { id: string; title: string; status: string }[];
  /** Add-on slugs active on that site (component scope may name them). */
  activeAddons: string[];
};

/**
 * 13-36 choice 1: the console Target pickers for one site: its pages and its active add-on
 * slugs (the same rows `validate` accepts). `service_window_org`; unknown org = NotFound.
 */
export async function staffWindowTargets(
  ctx: PlatformContext,
  orgId: string,
): Promise<StaffWindowTargets> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "service_window_org");
  const org = assertIdLike(orgId, "org");
  return withSuperuser(async (pb) => {
    const found = await exists(
      pb,
      "organizations",
      pb.filter("id = {:id}", { id: org }),
    );
    if (!found) throw new NotFound("No site with that id.");
    const pages = await pb.collection("pages").getFullList({
      filter: pb.filter("organization = {:org}", { org }),
      fields: "id,title,status",
      sort: "title,id",
    });
    const addons = await pb.collection("org_addons").getFullList({
      filter: pb.filter("organization = {:org} && status = 'active'", { org }),
      fields: "addon",
      sort: "addon",
    });
    return {
      pages: pages.map((p) => ({
        id: p.id,
        title: str(p.title),
        status: str(p.status),
      })),
      activeAddons: [...new Set(addons.map((a) => str(a.addon)))].filter((s) =>
        SLUG_RE.test(s),
      ),
    };
  });
}

export type NoticeOpts = {
  /** The org's active add-on slugs (the hub layout already has them, Open Q2). */
  activeAddons: readonly string[];
  now?: Date;
  /** Add-on display names by slug, for `{target}`. */
  addonNames?: Readonly<Record<string, string>>;
};

async function labelsFor(
  pb: PocketBase,
  orgId: string,
  row: ServiceWindowRow,
  addonNames: Readonly<Record<string, string>>,
): Promise<NoticeLabels> {
  if (row.scope === "addon" && row.addon) {
    const name = addonNames[row.addon];
    return name ? { addonName: name } : {};
  }
  if (row.scope === "page" && row.page) {
    const page = await exists(
      pb,
      "pages",
      pb.filter("id = {:id} && organization = {:org}", {
        id: row.page,
        org: orgId,
      }),
    );
    const title = page ? str(page.title).trim() : "";
    return title ? { pageTitle: title } : {};
  }
  if (row.scope === "component" && row.component) {
    const part = SITE_PARTS.find((p) => p.key === row.component);
    const label = part?.label ?? addonNames[row.component];
    return label ? { componentLabel: label } : {};
  }
  return {};
}

async function incidentView(
  pb: PocketBase,
  id: string,
): Promise<IncidentView | null> {
  if (!id || !ID_RE.test(id)) return null;
  const row = await exists(pb, "incidents", pb.filter("id = {:id}", { id }));
  if (!row) return null;
  return {
    title: str(row.title),
    public_text: str(row.public_text),
    status: row.status === "resolved" ? "resolved" : "open",
  };
}

/**
 * The notice strips for this person (choice 2): active windows first, then upcoming (within
 * 24 h), each reaching this org. Never another org's window (T-12-08-04).
 */
/** 12-14: page and component windows show only on their own screens (noticesForPath). */
function noticeReach(row: ServiceWindowRow): NoticeReach {
  if (row.scope === "page" && row.page)
    return { scope: "page", page: row.page };
  if (row.scope === "component" && row.component) {
    return { scope: "component", component: row.component };
  }
  return { scope: "everywhere" };
}

export async function activeServiceNotices(
  ctx: OrgContext,
  opts: NoticeOpts,
): Promise<ServiceNotice[]> {
  assertOrgContext(ctx);
  const now = opts.now ?? new Date();
  const active = [...(opts.activeAddons ?? [])];
  const names = opts.addonNames ?? {};
  try {
    const prefs = await readMemberPrefs(ctx);
    const dismissed = new Set(prefs.dismissed);
    return await withSuperuser(async (pb) => {
      const rows = await orgWindowRows(pb, ctx.orgId, now);
      const out: ServiceNotice[] = [];
      for (const row of rows) {
        if (!windowReaches(row, { orgId: ctx.orgId, activeAddons: active })) {
          continue;
        }
        const phase = windowPhase(row, now);
        if (phase !== "active" && phase !== "upcoming") continue;
        if (phase === "upcoming" && dismissed.has(`notice:${row.id}`)) continue;
        const labels = await labelsFor(pb, ctx.orgId, row, names);
        const text = noticeText(row, labels, now);
        if (!text) continue;
        out.push({
          id: row.id,
          code: code(row.seq),
          phase,
          text,
          message: row.message ?? "",
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          incident: await incidentView(pb, row.incident),
          dismissible: phase === "upcoming",
          reach: noticeReach(row),
          // 12-17: editors test their own target with core lockCovers.
          scope: row.scope,
          ...(row.scope === "addon" && row.addon ? { addon: row.addon } : {}),
        });
      }
      out.sort((a, b) =>
        a.phase === b.phase
          ? Date.parse(a.startsAt) - Date.parse(b.startsAt)
          : a.phase === "active"
            ? -1
            : 1,
      );
      return out;
    });
  } catch (err) {
    console.error(
      "[support] service notices failed:",
      err instanceof Error ? err.name : typeof err,
    );
    return [];
  }
}

async function reachedOrgs(
  pb: PocketBase,
  row: ServiceWindowRow,
): Promise<{ id: string; name: string }[]> {
  const pick = (r: RecordModel) => ({ id: r.id, name: str(r.name) });
  if (row.scope === "platform") {
    return (
      await pb
        .collection("organizations")
        .getFullList({ filter: OPEN_ORG_FILTER, fields: "id,name", sort: "id" })
    ).map(pick);
  }
  if (row.scope === "addon" && row.addon) {
    const subs = await pb.collection("org_addons").getFullList({
      filter: pb.filter("addon = {:a} && status = 'active'", { a: row.addon }),
      fields: "organization",
    });
    const ids = [...new Set(subs.map((s) => str(s.organization)))].filter(
      (id) => ID_RE.test(id),
    );
    const out: { id: string; name: string }[] = [];
    for (const id of ids.sort()) {
      const org = await exists(
        pb,
        "organizations",
        pb.filter("id = {:id}", { id }),
      );
      // 12-REVIEW WR-A01: a closed site waiting for deletion is never reached.
      if (org && isOpenOrg(org)) out.push(pick(org));
    }
    return out;
  }
  if (row.scope === "organization" && row.org_id) {
    const org = await exists(
      pb,
      "organizations",
      pb.filter("id = {:id}", { id: row.org_id }),
    );
    return org && isOpenOrg(org) ? [pick(org)] : [];
  }
  return [];
}

/**
 * Started, uncleared, unalerted windows (choice 6): org-wide and wider ones raise one urgent
 * `cds.notice` per reached org; page and component windows raise nothing. Every handled window
 * is stamped `alerted_at`, so a second run is a no-op. `onlyId` limits it to one window
 * (creation path). A failed raise for one org is logged by error name and does not stop the
 * others; the window is still stamped (no repeat emails on the next run).
 *
 * 12-REVIEW WR-A05: the creation path (CLI process) and the scheduled job (web process) can
 * both select the same unalerted window, so each window is claimed (stamped under a short
 * cross-process lock) BEFORE any alert goes out. Only the claimer notifies; a crash mid-loop
 * can miss some orgs but never emails anyone twice.
 */
export async function jobStartServiceWindows(
  now: Date = new Date(),
  deps: SupportNotifyDeps = {},
  onlyId?: string,
): Promise<{ windows: number; alerted: number }> {
  validDate(now, "now");
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(WINDOWS).getFullList({
      filter: onlyId
        ? pb.filter(
            "alerted_at = '' && cleared_at = '' && starts_at <= {:now} && ends_at > {:now} && id = {:id}",
            { now, id: onlyId },
          )
        : pb.filter(
            "alerted_at = '' && cleared_at = '' && starts_at <= {:now} && ends_at > {:now}",
            { now },
          ),
      sort: "starts_at,seq",
    });
    const as = mintSystemContext({ job: "support-windows" });
    let alerted = 0;
    let windows = 0;
    for (const r of rows) {
      const row = toWindowRow(r);
      if (!(await claimWindowAlert(pb, row.id, now))) continue;
      windows++;
      if (WIDE.has(row.scope)) {
        const target = noticeTarget(row, {});
        const end = formatNoticeEnd(new Date(row.ends_at), now);
        for (const org of await reachedOrgs(pb, row)) {
          try {
            await notifySupport(
              {
                orgId: org.id,
                as,
                type: "cds.notice",
                title: `CDS is working on ${target} until ${end}`,
                href: NOTICE_HREF,
                ...(row.message ? { excerpt: row.message } : {}),
                businessName: org.name || "your site",
                windowId: row.id,
              },
              { ...deps, now },
            );
            alerted++;
          } catch (err) {
            console.error(
              "[support] service window alert failed:",
              err instanceof Error ? err.name : typeof err,
            );
          }
        }
      }
    }
    if (windows > 0) invalidateWindowCache();
    return { windows, alerted };
  });
}

const CLAIM_STALE_MS = 60_000;

/**
 * 12-REVIEW WR-A05: stamp `alerted_at` under a per-window platform lock, after re-reading
 * that it is still empty. True only for the one caller that stamped it.
 */
async function claimWindowAlert(
  pb: PocketBase,
  id: string,
  now: Date,
): Promise<boolean> {
  const key = `lock:window-alert:${id}`;
  const token = await acquirePlatformLock(key, {
    now,
    staleMs: CLAIM_STALE_MS,
  });
  if (token === null) return false;
  try {
    const fresh = await pb.collection(WINDOWS).getOne(id, {
      fields: "id,alerted_at",
    });
    if (str(fresh.alerted_at) !== "") return false;
    await pb.collection(WINDOWS).update(id, { alerted_at: now.toISOString() });
    return true;
  } finally {
    await releasePlatformLock(key, token);
  }
}

/** Stamps `cleared_at` (= its end) on every ended, uncleared window. */
export async function jobClearEndedWindows(
  now: Date = new Date(),
): Promise<{ cleared: number }> {
  validDate(now, "now");
  return withSuperuser(async (pb) => {
    const rows = await pb.collection(WINDOWS).getFullList({
      filter: pb.filter("cleared_at = '' && ends_at <= {:now}", { now }),
      fields: "id,ends_at",
    });
    for (const r of rows) {
      await pb
        .collection(WINDOWS)
        .update(r.id, { cleared_at: str(r.ends_at) || now.toISOString() });
    }
    if (rows.length > 0) invalidateWindowCache();
    return { cleared: rows.length };
  });
}
