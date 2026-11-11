// packages/db/src/staff/failsafe.ts (13-18; STAFF-14, D155, D269, D291, P13-P14, P13-P31).
// Platform side of the fail-safe capture service (apps/failsafe, 13-04):
// - FailsafeCapture port, selected by CDS_FAILSAFE: unset → notDeployedFailsafe (no
//   requests, status not_deployed); "http" → signed pull + ack against FAILSAFE_URL with
//   FAILSAFE_PULL_SECRET; anything else throws (fail loudly, like getContentScanner).
// - jobSyncFailsafe (step `failsafe-sync` of health:run, 13-44): pull since the
//   `failsafe:last_pull` cursor, route each request by org slug + installed add-on, create
//   `failsafe_requests` rows (unique capture_id keeps it idempotent), ack only ids stored
//   under a site, then advance the cursor past requests in a final state only. A request
//   that matches no site is stored org-less as `unmatched` (staff-only, not acked) and
//   re-matched every run (CR-A01); a store that keeps failing is parked the same way (WR-A01).
// - Staff inbox (`failsafe_requests` feature, both roles): list, convert (delegates to the
//   premium add-on's own convertCapture, which runs its own conflict check; the row is
//   claimed under a platform lock first, WR-A02), dismiss. Unmatched rows list with pending
//   and count as pending (health check 8), can be dismissed, never converted.
// - listPendingRequests: the tenant read for the add-on's v1.1 "Pending requests" view.
// The signed strings must match apps/failsafe/src/pull.ts exactly (13-04); a unit test pins
// them. @cds/db never imports apps/failsafe nor @cds/addon-registry: manifests are passed in
// by the caller (Invariant 4, P13-P7). Errors are logged by class name only.
import { createHmac } from "node:crypto";
import { authorizeStaff, InvalidInput, NotFound } from "@cds/core";
import type {
  AddonManifest,
  CaptureConvertResult,
  FailsafeRequestView,
} from "@cds/core/addons";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { auditBody } from "../audit";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  mintOrgContext,
  mintSystemContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import {
  acquirePlatformLock,
  readPlatformMeta,
  releasePlatformLock,
  writePlatformMeta,
} from "../platform-meta";
import { requirePermission, tenantRepo } from "../repository";
import { errName } from "../support/shared";

const COLLECTION = "failsafe_requests";
export const FAILSAFE_CURSOR_KEY = "failsafe:last_pull";
export const FAILSAFE_SYNC_AT_KEY = "failsafe:last_sync_at";
/** The http adapter's per-call timeout. */
export const FAILSAFE_TIMEOUT_MS = 5000;
/** Dismiss reason limit (kept in the audit meta only). */
export const FAILSAFE_DISMISS_REASON_MAX = 200;
const EPOCH = "1970-01-01T00:00:00.000Z";
const ORG_ID_RE = /^[a-z0-9]{15}$/;
const CAPTURE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_PULL = 1000;

// ---------------------------------------------------------------- signing (13-04 contract)

/** `pull|<since>|<ts>` (apps/failsafe pullMessage). */
export function failsafePullMessage(since: string, ts: number): string {
  return `pull|${since}|${ts}`;
}

/** `ack|<ids joined by ",">|<ts>` (apps/failsafe ackMessage). */
export function failsafeAckMessage(ids: readonly string[], ts: number): string {
  return `ack|${ids.join(",")}|${ts}`;
}

/** Lowercase hex HMAC-SHA256 (apps/failsafe hmacHex). */
export function failsafeSign(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

// ---------------------------------------------------------------- port

/** One request as the fail-safe service returns it (13-04 FailsafeRequest, validated). */
export type CapturedRequest = {
  id: string;
  orgSlug: string;
  addon: string;
  name: string;
  email: string;
  phone: string;
  preferred: string;
  message: string;
  created_at: string;
};

export type FailsafeCaptureStatus = "not_deployed" | "ok" | "error";

export type FailsafeCapture = {
  readonly name: "not_deployed" | "http";
  pull(since: string): Promise<CapturedRequest[]>;
  ack(ids: readonly string[]): Promise<void>;
  status(): Promise<FailsafeCaptureStatus>;
};

/** CDS_FAILSAFE unset: nothing is deployed, so there is never anything to pull. */
export const notDeployedFailsafe: FailsafeCapture = Object.freeze({
  name: "not_deployed" as const,
  async pull(): Promise<CapturedRequest[]> {
    return [];
  },
  async ack(): Promise<void> {},
  async status(): Promise<FailsafeCaptureStatus> {
    return "not_deployed";
  },
});

function capped(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string" || v.length > max) return null;
  return v;
}

/** Shape-check one pulled request (T-13-18-01); null when anything is off. */
export function parseCapturedRequest(v: unknown): CapturedRequest | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !CAPTURE_ID_RE.test(r.id)) return null;
  if (typeof r.orgSlug !== "string" || !SLUG_RE.test(r.orgSlug)) return null;
  if (typeof r.addon !== "string" || !SLUG_RE.test(r.addon)) return null;
  if (
    typeof r.created_at !== "string" ||
    Number.isNaN(Date.parse(r.created_at))
  )
    return null;
  const name = capped(r.name, 200);
  const email = capped(r.email, 254);
  const phone = capped(r.phone, 40);
  const preferred = capped(r.preferred, 500);
  const message = capped(r.message, 2000);
  if (
    name === null ||
    name.trim() === "" ||
    email === null ||
    phone === null ||
    preferred === null ||
    message === null
  ) {
    return null;
  }
  return {
    id: r.id,
    orgSlug: r.orgSlug,
    addon: r.addon,
    name,
    email,
    phone,
    preferred,
    message,
    created_at: r.created_at,
  };
}

function clip(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/**
 * CR-A01: a pulled item that fails the strict shape check but still has a usable capture id
 * and time is kept, clipped to the column limits, rather than dropped (the cursor would move
 * past it and it would never be pulled again). A slug or add-on outside the pattern becomes
 * "" (stored as unmatched for staff). Null only when it cannot be identified or ordered.
 */
export function salvageCapturedRequest(v: unknown): CapturedRequest | null {
  const strict = parseCapturedRequest(v);
  if (strict) return strict;
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== "string" || !CAPTURE_ID_RE.test(r.id)) return null;
  if (
    typeof r.created_at !== "string" ||
    Number.isNaN(Date.parse(r.created_at))
  )
    return null;
  const slug = (x: unknown) =>
    typeof x === "string" && SLUG_RE.test(x) ? x : "";
  return {
    id: r.id,
    orgSlug: slug(r.orgSlug),
    addon: slug(r.addon),
    name: clip(r.name, 200).trim() || "(no name)",
    email: clip(r.email, 254),
    phone: clip(r.phone, 40),
    preferred: clip(r.preferred, 500),
    message: clip(r.message, 2000),
    created_at: r.created_at,
  };
}

export type HttpFailsafeOptions = {
  url: string;
  secret: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
};

/** Signed pull + ack against apps/failsafe (13-04 contract). */
export function httpFailsafe(opts: HttpFailsafeOptions): FailsafeCapture {
  const base = new URL(opts.url);
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    throw new Error("FAILSAFE_URL must be an http(s) URL");
  }
  if (typeof opts.secret !== "string" || opts.secret === "") {
    throw new Error("FAILSAFE_PULL_SECRET is required when CDS_FAILSAFE=http");
  }
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const timeoutMs = opts.timeoutMs ?? FAILSAFE_TIMEOUT_MS;
  const at = (path: string) => new URL(path, base);

  async function call(url: URL, init: RequestInit = {}): Promise<Response> {
    return doFetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return {
    name: "http",
    async pull(since: string): Promise<CapturedRequest[]> {
      // WR-B01: POST with a JSON body, so the signature never sits in a URL or a log.
      const ts = now().getTime();
      const res = await call(at("/pull"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          since,
          ts,
          sig: failsafeSign(opts.secret, failsafePullMessage(since, ts)),
        }),
      });
      if (!res.ok) throw new Error(`failsafe pull answered ${res.status}`);
      const body = (await res.json()) as unknown;
      const list =
        body && typeof body === "object"
          ? (body as { requests?: unknown }).requests
          : undefined;
      if (!Array.isArray(list)) throw new Error("failsafe pull: bad shape");
      const out: CapturedRequest[] = [];
      let dropped = 0;
      for (const item of list.slice(0, MAX_PULL)) {
        const parsed = salvageCapturedRequest(item);
        if (parsed) out.push(parsed);
        else dropped += 1;
      }
      if (dropped > 0) {
        console.warn(`[failsafe] dropped ${dropped} with no usable id or time`);
      }
      return out;
    },
    async ack(ids: readonly string[]): Promise<void> {
      if (ids.length === 0) return;
      const ts = now().getTime();
      const res = await call(at("/ack"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids,
          ts,
          sig: failsafeSign(opts.secret, failsafeAckMessage(ids, ts)),
        }),
      });
      if (!res.ok) throw new Error(`failsafe ack answered ${res.status}`);
    },
    async status(): Promise<FailsafeCaptureStatus> {
      try {
        const res = await call(at("/healthz"));
        return res.ok ? "ok" : "error";
      } catch {
        return "error";
      }
    },
  };
}

/** P13-P14: unset → not deployed; "http" → signed pull; anything else throws. */
export function getFailsafeCapture(
  env: NodeJS.ProcessEnv = process.env,
  deps: { fetch?: typeof fetch; now?: () => Date } = {},
): FailsafeCapture {
  const v = env.CDS_FAILSAFE;
  if (v === undefined || v === "") return notDeployedFailsafe;
  if (v === "http") {
    return httpFailsafe({
      url: env.FAILSAFE_URL ?? "",
      secret: env.FAILSAFE_PULL_SECRET ?? "",
      ...deps,
    });
  }
  throw new Error(
    `CDS_FAILSAFE="${v}" has no implementation (unset it, or use "http")`,
  );
}

// ---------------------------------------------------------------- sync (system job)

export type FailsafeSyncResult = {
  pulled: number;
  stored: number;
  duplicates: number;
  /** Pulled requests that matched no site (stored org-less, staff-visible, not acked). */
  unmatched: number;
  /** Earlier unmatched rows that now match a site (moved to pending and acked). */
  rematched: number;
  acked: number;
  failed: number;
  /** Requests whose store kept failing, parked org-less for staff (WR-A01). */
  parked: number;
};

export type FailsafeSyncDeps = { capture?: FailsafeCapture };

/** Runs a request's store may fail before it is parked for staff so the cursor moves on. */
export const FAILSAFE_MAX_STORE_ATTEMPTS = 5;
/** platform_meta JSON `{ <capture id>: <failed runs> }` (WR-A01). */
export const FAILSAFE_FAILURES_KEY = "failsafe:store_failures";
const FAILURES_MAX = 100;
const REMATCH_MAX = 200;

export type FailsafeUnmatchedReason =
  "no_site" | "addon_inactive" | "store_failed";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function orFilter(
  pb: PocketBase,
  field: string,
  values: readonly string[],
): string {
  return values
    .map((v, i) => pb.filter(field + " = {:v" + i + "}", { ["v" + i]: v }))
    .join(" || ");
}

type Routing = {
  orgBySlug: Map<string, string>;
  installed: Set<string>;
};

async function loadRouting(slugs: readonly string[]): Promise<Routing> {
  if (slugs.length === 0) return { orgBySlug: new Map(), installed: new Set() };
  return withSuperuser(async (pb) => {
    const orgs = await pb.collection("organizations").getFullList({
      filter: orFilter(pb, "slug", slugs),
      fields: "id,slug",
    });
    const map = new Map(orgs.map((o) => [str(o.slug), o.id]));
    const ids = [...map.values()];
    const addons = ids.length
      ? await pb.collection("org_addons").getFullList({
          filter:
            "status = 'active' && (" + orFilter(pb, "organization", ids) + ")",
          fields: "organization,addon",
        })
      : [];
    return {
      orgBySlug: map,
      installed: new Set(
        addons.map((a) => `${str(a.organization)}|${str(a.addon)}`),
      ),
    };
  });
}

function matchOf(
  r: Routing,
  slug: string,
  addon: string,
): { orgId: string; reason: FailsafeUnmatchedReason | "" } {
  const orgId = r.orgBySlug.get(slug);
  if (!orgId) return { orgId: "", reason: "no_site" };
  if (!r.installed.has(`${orgId}|${addon}`)) {
    return { orgId: "", reason: "addon_inactive" };
  }
  return { orgId, reason: "" };
}

function parseFailures(raw: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (CAPTURE_ID_RE.test(k) && typeof n === "number" && n > 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function rowBody(
  req: CapturedRequest,
  organization: string,
  status: "pending" | "unmatched",
  reason: FailsafeUnmatchedReason | "",
) {
  return {
    organization,
    org_slug: req.orgSlug,
    reason,
    addon: req.addon,
    capture_id: req.id,
    name: req.name.slice(0, 200),
    email: req.email,
    phone: req.phone,
    preferred: req.preferred,
    message: req.message,
    captured_at: req.created_at,
    status,
  };
}

/** The stored row for a capture id (any org, unique index), or null. */
async function rowByCapture(
  pb: PocketBase,
  captureId: string,
): Promise<RecordModel | null> {
  const res = await pb.collection(COLLECTION).getList(1, 1, {
    filter: pb.filter("capture_id = {:cid}", { cid: captureId }),
    fields: "id,organization",
  });
  return res.items[0] ?? null;
}

/**
 * Pull, store and ack (choice 3). Every pulled request reaches a final state before the
 * cursor moves past it (CR-A01, D155): stored under its site (acked), already stored
 * (acked), or stored org-less as `unmatched` for staff (not acked, so the fail-safe
 * service keeps it too). A failed create holds the cursor and is retried next run; after
 * FAILSAFE_MAX_STORE_ATTEMPTS runs it is parked as `unmatched` / `store_failed` (WR-A01).
 * Each run first re-matches earlier unmatched rows (an add-on reactivated after a billing
 * lapse, a site created later) and acks those.
 */
export async function jobSyncFailsafe(
  now: Date = new Date(),
  deps: FailsafeSyncDeps = {},
): Promise<FailsafeSyncResult> {
  const sys = mintSystemContext({ job: "failsafe-sync" });
  const capture = deps.capture ?? getFailsafeCapture();
  const result: FailsafeSyncResult = {
    pulled: 0,
    stored: 0,
    duplicates: 0,
    unmatched: 0,
    rematched: 0,
    acked: 0,
    failed: 0,
    parked: 0,
  };
  if (capture.name === "not_deployed") return result;

  const since = (await readPlatformMeta(FAILSAFE_CURSOR_KEY)) || EPOCH;
  const pulled = (await capture.pull(since))
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  result.pulled = pulled.length;

  const waiting = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getList(1, REMATCH_MAX, {
      filter: "status = 'unmatched' && reason != 'store_failed'",
      fields: "id,org_slug,addon,capture_id",
      sort: "captured_at,id",
    }),
  );
  const slugs = [
    ...new Set([
      ...pulled.map((r) => r.orgSlug),
      ...waiting.items.map((r) => str(r.org_slug)),
    ]),
  ].filter((slug) => slug !== "");
  const routing = await loadRouting(slugs);

  const done = new Set<string>(); // capture ids to ack (stored under a site)
  for (const row of waiting.items) {
    const m = matchOf(routing, str(row.org_slug), str(row.addon));
    if (m.orgId === "") continue;
    try {
      await withSuperuser((pb) =>
        pb.collection(COLLECTION).update(row.id, {
          organization: m.orgId,
          status: "pending",
          reason: "",
        }),
      );
      result.rematched += 1;
      done.add(str(row.capture_id));
    } catch (err) {
      console.error(`[failsafe] rematch failed ${errName(err)}`);
    }
  }

  const failuresRaw = await readPlatformMeta(FAILSAFE_FAILURES_KEY);
  const failures = parseFailures(failuresRaw);
  const finalOrder: { at: string; ok: boolean }[] = [];
  for (const req of pulled) {
    const m = matchOf(routing, req.orgSlug, req.addon);
    try {
      const outcome = await withSuperuser(async (pb) => {
        const existing = await rowByCapture(pb, req.id);
        if (existing) {
          return str(existing.organization) === ""
            ? ("held" as const)
            : ("duplicate" as const);
        }
        const body =
          m.orgId === ""
            ? rowBody(req, "", "unmatched", m.reason || "no_site")
            : rowBody(req, m.orgId, "pending", "");
        try {
          await pb.collection(COLLECTION).create(body);
          return m.orgId === "" ? ("unmatched" as const) : ("stored" as const);
        } catch (err) {
          // Lost a race on the unique capture_id index: already stored.
          const again = await rowByCapture(pb, req.id);
          if (again) {
            return str(again.organization) === ""
              ? ("held" as const)
              : ("duplicate" as const);
          }
          throw err;
        }
      });
      if (outcome === "stored") result.stored += 1;
      else if (outcome === "unmatched") result.unmatched += 1;
      else result.duplicates += 1;
      if (outcome === "stored" || outcome === "duplicate") done.add(req.id);
      delete failures[req.id];
      finalOrder.push({ at: req.created_at, ok: true });
    } catch (err) {
      console.error(`[failsafe] store failed ${errName(err)}`);
      const attempts = (failures[req.id] ?? 0) + 1;
      if (attempts >= FAILSAFE_MAX_STORE_ATTEMPTS && (await park(req))) {
        delete failures[req.id];
        result.parked += 1;
        finalOrder.push({ at: req.created_at, ok: true });
      } else {
        failures[req.id] = attempts;
        result.failed += 1;
        finalOrder.push({ at: req.created_at, ok: false });
      }
    }
  }

  let ackOk = true;
  if (done.size > 0) {
    try {
      await capture.ack([...done]);
      result.acked = done.size;
    } catch (err) {
      ackOk = false;
      console.error(`[failsafe] ack failed ${errName(err)}`);
    }
  }

  if (ackOk) {
    let cursor = since;
    for (const item of finalOrder) {
      if (!item.ok) break;
      cursor = item.at;
    }
    if (cursor !== since) {
      await writePlatformMeta(sys, FAILSAFE_CURSOR_KEY, cursor);
    }
  }
  const ids = Object.keys(failures).slice(-FAILURES_MAX);
  const nextFailures = JSON.stringify(
    Object.fromEntries(ids.map((k) => [k, failures[k]!])),
  );
  if (nextFailures !== (failuresRaw ?? "{}")) {
    await writePlatformMeta(sys, FAILSAFE_FAILURES_KEY, nextFailures);
  }
  await writePlatformMeta(sys, FAILSAFE_SYNC_AT_KEY, now.toISOString());
  return result;
}

/**
 * Park a request whose store keeps failing: an org-less `unmatched` row, reason
 * `store_failed`, not acked (the fail-safe service keeps the full request). Falls back to
 * the routing fields only when the contact fields are what PocketBase rejects.
 */
async function park(req: CapturedRequest): Promise<boolean> {
  const full = rowBody(req, "", "unmatched", "store_failed");
  const minimal = {
    organization: "",
    org_slug: req.orgSlug,
    reason: "store_failed",
    addon: req.addon,
    capture_id: req.id,
    name: req.name.slice(0, 200),
    captured_at: req.created_at,
    status: "unmatched",
  };
  for (const body of [full, minimal]) {
    try {
      await withSuperuser((pb) => pb.collection(COLLECTION).create(body));
      return true;
    } catch (err) {
      console.error(`[failsafe] park failed ${errName(err)}`);
    }
  }
  return false;
}

export type FailsafeStatusView = {
  /** A premium health check is failing for some site (always false in v1.0). */
  active: boolean;
  /** Requests waiting on staff: pending plus unmatched (CR-A01). */
  pending_requests: number;
  deployed: boolean;
  /** ISO time of the last sync run, null when never. */
  last_pull: string | null;
};

/** Monitor §4 `failsafe` block (13-40) and Health › Fail-safe (13-45). No network call. */
export async function failsafeStatus(
  deps: FailsafeSyncDeps = {},
): Promise<FailsafeStatusView> {
  const capture = deps.capture ?? getFailsafeCapture();
  const pending = await withSuperuser((pb) =>
    pb.collection(COLLECTION).getList(1, 1, {
      filter: OPEN_FILTER,
      fields: "id",
    }),
  );
  return {
    active: false,
    pending_requests: pending.totalItems,
    deployed: capture.name !== "not_deployed",
    last_pull: (await readPlatformMeta(FAILSAFE_SYNC_AT_KEY)) || null,
  };
}

// ---------------------------------------------------------------- staff inbox

/** Rows waiting on staff: pending, or unmatched (no site yet). */
const OPEN_FILTER = "(status = 'pending' || status = 'unmatched')";

export const FAILSAFE_STATUSES = ["pending", "converted", "dismissed"] as const;
export type FailsafeRequestStatus = (typeof FAILSAFE_STATUSES)[number];

export type StaffFailsafeRow = FailsafeRequestView & {
  business: string;
  /** An unmatched row (no site yet, CR-A01) lists as `pending` with `unmatched` set. */
  status: FailsafeRequestStatus;
  unmatched: { orgSlug: string; reason: string } | null;
  convertedAt: string | null;
  convertedRef: string;
  dismissedAt: string | null;
};

const ROW_FIELDS =
  "id,organization,org_slug,reason,addon,capture_id,name,email,phone,preferred,message,captured_at,status,converted_at,converted_ref,dismissed_at";

function isoOrNull(v: unknown): string | null {
  const s = str(v);
  return s ? new Date(Date.parse(s)).toISOString() : null;
}

function viewOf(r: RecordModel): FailsafeRequestView {
  return {
    id: r.id,
    orgId: str(r.organization),
    addon: str(r.addon),
    captureId: str(r.capture_id),
    name: str(r.name),
    email: str(r.email),
    phone: str(r.phone),
    preferred: str(r.preferred),
    message: str(r.message),
    capturedAt: isoOrNull(r.captured_at) ?? "",
  };
}

function statusOf(v: unknown): FailsafeRequestStatus {
  return (FAILSAFE_STATUSES as readonly string[]).includes(str(v))
    ? (str(v) as FailsafeRequestStatus)
    : "pending";
}

function checkOrgScope(orgId: string | undefined): void {
  if (orgId !== undefined && !ORG_ID_RE.test(orgId)) throw new NotFound();
}

/** Staff list (Health › Fail-safe requests), newest first, with the business name. */
export async function staffListFailsafeRequests(
  ctx: PlatformContext,
  opts: { status?: FailsafeRequestStatus | "all"; orgId?: string } = {},
): Promise<StaffFailsafeRow[]> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "failsafe_requests");
  checkOrgScope(opts.orgId);
  const status = opts.status ?? "pending";
  if (
    status !== "all" &&
    !(FAILSAFE_STATUSES as readonly string[]).includes(status)
  ) {
    throw new InvalidInput("unknown fail-safe status");
  }
  return withSuperuser(async (pb) => {
    const terms: string[] = [];
    if (status === "pending") terms.push(OPEN_FILTER);
    else if (status !== "all") {
      terms.push(pb.filter("status = {:s}", { s: status }));
    }
    if (opts.orgId) {
      terms.push(pb.filter("organization = {:org}", { org: opts.orgId }));
    }
    const rows = await pb.collection(COLLECTION).getFullList({
      ...(terms.length ? { filter: terms.join(" && ") } : {}),
      fields: ROW_FIELDS,
      sort: "-captured_at,-id",
    });
    const orgIds = [
      ...new Set(rows.map((r) => str(r.organization)).filter((o) => o !== "")),
    ];
    const orgs = orgIds.length
      ? await pb.collection("organizations").getFullList({
          filter: orFilter(pb, "id", orgIds),
          fields: "id,name",
        })
      : [];
    const names = new Map(orgs.map((o) => [o.id, str(o.name)]));
    return rows.map((r) => {
      const unmatched =
        str(r.status) === "unmatched" || str(r.organization) === ""
          ? { orgSlug: str(r.org_slug), reason: str(r.reason) }
          : null;
      return {
        ...viewOf(r),
        business: unmatched
          ? `No site matched (${unmatched.orgSlug || "unknown"})`
          : (names.get(str(r.organization)) ?? ""),
        status: statusOf(r.status),
        unmatched,
        convertedAt: isoOrNull(r.converted_at),
        convertedRef: str(r.converted_ref),
        dismissedAt: isoOrNull(r.dismissed_at),
      };
    });
  });
}

/** One row; NotFound when missing or outside the caller's org scope (attack keys). */
async function loadRow(
  pb: PocketBase,
  id: string,
  orgId: string | undefined,
): Promise<RecordModel> {
  if (typeof id !== "string" || !ORG_ID_RE.test(id)) throw new NotFound();
  checkOrgScope(orgId);
  const row = await pb
    .collection(COLLECTION)
    .getOne(id, { fields: ROW_FIELDS })
    .catch(() => {
      throw new NotFound();
    });
  if (orgId !== undefined && str(row.organization) !== orgId) {
    throw new NotFound();
  }
  return row;
}

/** Convert: only a pending row under a site (an unmatched row has no site to book on). */
function assertPending(row: RecordModel): void {
  const status = str(row.status);
  if (status === "unmatched" || str(row.organization) === "") {
    throw new InvalidInput(
      "This request matched no site. Handle it by hand, then dismiss it.",
    );
  }
  if (status !== "pending") {
    throw new InvalidInput("This request is already handled.");
  }
}

/** Dismiss: a pending or an unmatched row. */
function assertOpen(row: RecordModel): void {
  const status = str(row.status);
  if (status !== "pending" && status !== "unmatched") {
    throw new InvalidInput("This request is already handled.");
  }
}

export type StaffConvertFailsafeOptions = {
  /** The add-on manifests (`ADDON_REGISTRY.list()` in apps/web; P13-P7). */
  manifests: readonly AddonManifest[];
  /** Scope to one site (Sites › site): another site's row is NotFound. */
  orgId?: string;
  now?: Date;
};

export type StaffConvertFailsafeResult =
  { converted: true; ref: string } | { converted: false; conflict: string };

function convertHook(
  manifests: readonly AddonManifest[],
  slug: string,
):
  | ((
      ctx: OrgContext,
      request: FailsafeRequestView,
    ) => Promise<CaptureConvertResult>)
  | null {
  const m = manifests.find((x) => x.slug === slug);
  const capture = m?.premium?.captureMode;
  if (!capture || "waived" in capture) return null;
  return typeof capture.convertCapture === "function"
    ? capture.convertCapture
    : null;
}

/** A convert or dismiss holds this long at most; a crashed holder's claim is taken over. */
const CLAIM_STALE_MS = 5 * 60_000;

/**
 * Hold the row's cross-process claim (platform_meta `lock:failsafe:<id>`) for `fn` (WR-A02):
 * two converts, or a convert and a dismiss, never run the add-on hook twice. A busy claim
 * answers InvalidInput.
 */
async function withRowClaim<T>(
  id: string,
  now: Date,
  fn: () => Promise<T>,
): Promise<T> {
  if (typeof id !== "string" || !ORG_ID_RE.test(id)) throw new NotFound();
  const key = `lock:failsafe:${id}`;
  const token = await acquirePlatformLock(key, {
    now,
    staleMs: CLAIM_STALE_MS,
  });
  if (!token) {
    throw new InvalidInput(
      "This request is being handled. Try again in a moment.",
    );
  }
  try {
    return await fn();
  } finally {
    await releasePlatformLock(key, token).catch((err: unknown) => {
      console.error(`[failsafe] claim release failed ${errName(err)}`);
    });
  }
}

/**
 * One-click convert (choice 4): the add-on's convertCapture runs its own conflict check
 * (D269). `{ ref }` → converted + audit `failsafe.converted`; `{ conflict }` → returned, the
 * row stays pending. Check, hook and write run under the row claim (WR-A02).
 */
export async function staffConvertFailsafeRequest(
  ctx: PlatformContext,
  id: string,
  opts: StaffConvertFailsafeOptions,
): Promise<StaffConvertFailsafeResult> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "failsafe_requests");
  const at = opts.now ?? new Date();
  return withRowClaim(id, at, () => convertClaimed(ctx, id, opts, at));
}

async function convertClaimed(
  ctx: PlatformContext,
  id: string,
  opts: StaffConvertFailsafeOptions,
  at: Date,
): Promise<StaffConvertFailsafeResult> {
  const row = await withSuperuser((pb) => loadRow(pb, id, opts.orgId));
  assertPending(row);
  const view = viewOf(row);
  const hook = convertHook(opts.manifests ?? [], view.addon);
  if (!hook) {
    throw new InvalidInput("This add-on cannot convert fail-safe requests.");
  }
  const orgCtx = mintOrgContext({
    orgId: view.orgId,
    actor: "",
    role: "owner",
    grants: [],
    systemJob: "failsafe-convert",
    ip: ctx.ip,
  });
  const outcome = await hook(orgCtx, view);
  if ("conflict" in outcome) {
    return { converted: false, conflict: String(outcome.conflict) };
  }
  const ref = String(outcome.ref ?? "").slice(0, 64);
  if (ref === "") throw new InvalidInput("The add-on returned no record.");
  await withSuperuser(async (pb) => {
    // T-13-18-04: re-check right before the write (a second click finds it handled).
    assertPending(await loadRow(pb, id, opts.orgId));
    const batch = pb.createBatch();
    batch.collection(COLLECTION).update(id, {
      status: "converted",
      converted_at: at.toISOString(),
      converted_ref: ref,
      handled_by: ctx.actor,
    });
    batch.collection("audit_log").create(
      auditBody(ctx, {
        action: "failsafe.converted",
        organization: view.orgId,
        targetCollection: COLLECTION,
        targetId: id,
        meta: { addon: view.addon, ref },
      }),
    );
    await batch.send();
  });
  return { converted: true, ref };
}

/** Dismiss (spam, already handled by phone …); the reason goes in the audit meta only. */
export async function staffDismissFailsafeRequest(
  ctx: PlatformContext,
  id: string,
  reason: string,
  opts: { orgId?: string; now?: Date } = {},
): Promise<{ dismissedAt: string }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "failsafe_requests");
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text === "" || text.length > FAILSAFE_DISMISS_REASON_MAX) {
    throw new InvalidInput(
      `Give a reason (up to ${FAILSAFE_DISMISS_REASON_MAX} characters).`,
    );
  }
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  await withRowClaim(id, now, () =>
    withSuperuser(async (pb) => {
      const row = await loadRow(pb, id, opts.orgId);
      assertOpen(row);
      const batch = pb.createBatch();
      batch.collection(COLLECTION).update(id, {
        status: "dismissed",
        dismissed_at: at,
        handled_by: ctx.actor,
      });
      batch.collection("audit_log").create(
        auditBody(ctx, {
          action: "failsafe.dismissed",
          organization: str(row.organization),
          targetCollection: COLLECTION,
          targetId: id,
          meta: { addon: str(row.addon), reason: text },
        }),
      );
      await batch.send();
    }),
  );
  return { dismissedAt: at };
}

// ---------------------------------------------------------------- tenant read (v1.1 view)

/** The org's pending requests for one add-on (Owner/Admin: `addons` read), oldest first. */
export async function listPendingRequests(
  ctx: OrgContext,
  addon: string,
): Promise<FailsafeRequestView[]> {
  assertOrgContext(ctx);
  requirePermission(ctx, "addons", "read");
  if (typeof addon !== "string" || !SLUG_RE.test(addon)) {
    throw new InvalidInput("unknown add-on");
  }
  const res = await tenantRepo(COLLECTION).list(ctx, {
    filter: "addon = {:addon} && status = {:status}",
    params: { addon, status: "pending" },
    sort: "captured_at",
    perPage: 200,
  });
  return res.items.map(viewOf);
}
