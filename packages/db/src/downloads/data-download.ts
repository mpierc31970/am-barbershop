// "Download my data" (LIFE-04, D284, D285; 11-40). The Owner asks for a copy of everything
// the site holds; a background build writes one CSV per exportable collection plus the media
// originals into one zip, uploads it, and tells the Owner it is ready.
//
// Safety:
//   - Collections and columns come only from the LIFE-03 export allowlists (deny by default,
//     `exportableCollections()` shared with export.ts); every row goes through toSnapshot,
//     so auth, password, token, key, push and invite-hash fields can never appear
//     (T-11-40-01). Personal collections (a colleague's own prefs) are left out.
//   - Every cell goes through `csvLine`, which runs guardFormula (cells starting with
//     = + - @ tab or CR get a leading ') and RFC 4180 quoting (T-11-40-02).
//   - The zip is streamed to a temp file with fflate (Zip, ZipDeflate for CSVs,
//     ZipPassThrough for media), never held in memory (Pitfall 14, T-11-40-05), then uploaded
//     with ObjectStore.putFile (S3 multipart, local copy). The temp file is always removed.
//   - Only the Owner asks, never impersonating staff (explicit `ctx.impersonator` refusal:
//     exports:run is waived under impersonation for staff tenant_export, Pitfall 5,
//     T-11-40-03), at most once per 24 hours; the request is audited.
//   - State lives in `data_exports` (queued -> building -> ready | failed; ready -> expired).
//     The ready zip lasts DOWNLOAD_LINK_DAYS; the retention job prunes it.
//   - A build heartbeats its row every DOWNLOAD_HEARTBEAT_MS. A row cut off by a deploy or
//     crash (stale heartbeat, or queued with nobody building it) reads as failed
//     ("interrupted") at once on the Owner's panel and is cleared by the next request, so the
//     Owner never waits for the daily job (review 11 WR-B08).
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CdsError,
  Forbidden,
  ImpersonationDenied,
  InvalidInput,
  NotFound,
} from "@cds/core";
import { CSV_BOM, csvLine } from "@cds/core/csv";
import { Zip, ZipDeflate, ZipPassThrough } from "fflate";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { raiseAlert } from "../alerts/raise";
import type { PushSender } from "../alerts/push";
import { appendAudit } from "../audit";
import { withSuperuser } from "../client";
import { withOrgLock } from "../content/lock";
import {
  assertOrgContext,
  assertSystemContext,
  mintSystemContext,
  type OrgContext,
  type SystemContext,
} from "../context";
import { platformUrl } from "../email/env";
import { sendEmail } from "../email/send";
import type { EmailTransport } from "../email/transport";
import {
  assertAddonCollectionsRegistered,
  exportableCollections,
} from "../export";
import { getCollectionSpec, rowFilterTemplate } from "../registry";
import { requirePermission } from "../repository";
import { toSnapshot } from "../snapshot";
import {
  getRangedObjectStore,
  tenantDownloadKey,
  tenantExportPrefix,
  tenantMediaKey,
  tenantSupportPrefix,
  type MediaObjectName,
  type ObjectStore,
  type RangedObjectStore,
} from "../storage";
import {
  DOWNLOAD_LINK_DAYS,
  downloadLinkPath,
  verifyDownloadLink,
} from "./links";

/**
 * fflate writes no ZIP64 records, so a zip must stay under 4 GiB; the build stops a little
 * below that (11-40 choice 8; the plan's 20 GiB needs ZIP64, recorded as a GO-LIVE note).
 */
export const DOWNLOAD_MAX_BYTES = 4 * 1024 ** 3 - 64 * 1024 ** 2;

/** The zip would pass DOWNLOAD_MAX_BYTES. Recorded as error_kind "too_large". */
export class DownloadTooLarge extends CdsError {
  override readonly code = "too_large";
}

export type DownloadCollection = {
  /** Registry collection name. */
  name: string;
  /** File name inside the zip, in plain words ("form-messages.csv"). */
  file: string;
  /** CSV header: the collection's export allowlist. */
  fields: readonly string[];
  /** Row filter from the registry (12-04): rows outside it are never written. */
  rowFilter?: Readonly<{ field: string; equals: string }>;
};

/** Plain-word file names (UI-SPEC "Download my data"); anything else is kebab-case. */
const FILE_NAMES: Readonly<Record<string, string>> = {
  form_submissions: "form-messages",
  org_hosts: "web-addresses",
  org_addons: "add-ons",
  org_intake: "setup-answers",
  org_email_routes: "email-addresses",
  media_assets: "media-library",
  billing_invoices: "invoices",
  care_plan_time: "care-plan-time",
  agreement_signatures: "signed-agreements",
  site_policy_acks: "policy-acceptances",
  site_daily_stats: "visitor-stats",
  audit_log: "activity-log",
};

/** One line per file for README.txt; anything else gets a generic line. */
const DESCRIPTIONS: Readonly<Record<string, string>> = {
  pages: "Your pages: titles, web addresses and status.",
  page_sections: "The blocks on each page and what they say.",
  site_settings: "Your menu, footer, banner and site settings.",
  popups: "Your pop-ups.",
  forms: "Your forms and their questions.",
  form_submissions: "Messages people sent through your forms.",
  contacts: "Your contacts and subscribers.",
  contact_lists: "Your contact lists.",
  contact_list_members: "Who is on each contact list.",
  contact_notes: "Notes you wrote about contacts.",
  contact_events: "What each contact did and when.",
  media_assets:
    "Details of your photos, videos and audio. The files are in the media folder.",
  business_profile: "Your business details.",
  team_members: "Your team list.",
  services: "Your services and prices.",
  memberships: "The people who help run the site and their roles.",
  audit_log: "Who changed what, and when.",
  billing_invoices: "Your invoices from Support.",
  agreement_signatures: "The agreements you signed.",
  social_accounts: "Your social media links.",
  site_daily_stats: "Daily visitor counts per page.",
  org_hosts: "Your web addresses.",
  org_addons: "The add-ons on your site.",
  org_intake: "Your answers from setting up the site.",
  org_email_routes: "The email addresses your site sends from and to.",
  email_suppressions: "Addresses that asked not to get your emails.",
  content_flags: "Content checks on your site.",
  form_drafts: "Form answers people saved to finish later.",
  site_policy_acks: "When people accepted your site's policies.",
  billing_accounts: "Your plan with us.",
  gateway_accounts: "Your payment account connection.",
  work_orders: "Quotes for extra work from Support.",
  care_plan_time: "Care Plan time Support logged for you.",
  member_invites: "Invites you sent to people.",
};

function fileFor(name: string): string {
  return `${FILE_NAMES[name] ?? name.replace(/_/g, "-")}.csv`;
}

/**
 * The collections in a data download: every exportable collection (field-list export, not
 * auth), core + registered add-ons, minus personal ones (11-40 choice 2). Add-on collections
 * register at runtime, so this is a function rather than a constant.
 */
export function downloadCollections(): DownloadCollection[] {
  return exportableCollections()
    .filter(({ spec }) => spec.personal !== true)
    .map(({ name, spec }) => ({
      name,
      file: fileFor(name),
      fields: spec.export,
      ...(spec.rowFilter ? { rowFilter: spec.rowFilter } : {}),
    }));
}

/** Alias named in the plan; see downloadCollections. */
export const DOWNLOAD_COLLECTIONS = downloadCollections;

export type DownloadMediaItem = {
  id: string;
  /** The file name shown in the library (may be empty). */
  name: string;
  /** Candidate private object keys, best first (the original, then the kept derivative). */
  keys: readonly string[];
  /**
   * Zip folder (12-07 choice 10): "media" (default) for the media library, "support" for
   * support attachments and CDS documents.
   */
  folder?: "media" | "support";
};

export type OpenedMedia = { key: string; stream: ReadableStream<Uint8Array> };

export type DownloadSource = {
  orgName: string;
  now: Date;
  collections: readonly DownloadCollection[];
  /** Raw rows of one collection, page by page. The builder applies toSnapshot. */
  rows(collection: string): AsyncIterable<readonly Record<string, unknown>[]>;
  media: readonly DownloadMediaItem[];
  /** The first candidate key that exists, streamed whole; null when none exists. */
  openMedia(keys: readonly string[]): Promise<OpenedMedia | null>;
  /**
   * Support attachments still waiting for a scan (12-REVIEW WR-A03): left out of the zip,
   * counted in README.txt. Absent means none.
   */
  supportPending?: number;
  /**
   * Plain-text files written as they are (14-40: `dns/zone.txt`, the CDS zone as a BIND
   * file, D-UI-P14-22). Absent means none.
   */
  extraFiles?: readonly { name: string; text: string; readme: string }[];
  /** Extra README.txt lines (14-40: why the zone file is missing). */
  notes?: readonly string[];
};

export type BuildResult = {
  /** Zip size in bytes. */
  bytes: number;
  /** Every entry name, in zip order. */
  files: string[];
  /** Rows per collection. */
  counts: Record<string, number>;
  mediaFiles: number;
  mediaMissing: number;
  /** Support attachments and CDS documents written under support/ (12-07). */
  supportFiles: number;
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (
    typeof v === "number" ||
    typeof v === "boolean" ||
    typeof v === "bigint"
  ) {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  // JSON and object fields: compact JSON, then the same guard as every other cell.
  return JSON.stringify(v) ?? "";
}

function safeBase(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 60);
}

/**
 * media/<asset-id>-<safe-filename>.<ext> (or support/... for a support file); the extension
 * comes from the stored object.
 */
export function mediaEntryName(item: DownloadMediaItem, key: string): string {
  const object = key.slice(key.lastIndexOf("/") + 1);
  const m = /\.([a-z0-9]{1,8})$/i.exec(object);
  const ext = m ? m[1]!.toLowerCase() : "bin";
  const base = safeBase(item.name);
  const folder = item.folder === "support" ? "support" : "media";
  return `${folder}/${item.id}${base ? `-${base}` : ""}.${ext}`;
}

const DAY_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function readme(source: DownloadSource, result: BuildResult): string {
  const lines: string[] = [
    `Your data from ${source.orgName}`,
    `Made on ${DAY_FMT.format(source.now)} (UTC).`,
    "",
    "Each .csv file opens in Excel, Numbers or Google Sheets. One file per kind of record:",
    "",
  ];
  for (const c of source.collections) {
    const n = result.counts[c.name] ?? 0;
    const what =
      DESCRIPTIONS[c.name] ?? `Records of ${c.name.replace(/_/g, " ")}.`;
    lines.push(`  ${c.file} (${n} ${n === 1 ? "row" : "rows"}): ${what}`);
  }
  lines.push(
    "",
    `media/: the original files from your media library (${result.mediaFiles}).`,
  );
  if (result.mediaMissing > 0) {
    lines.push(
      `  ${result.mediaMissing} ${result.mediaMissing === 1 ? "file was" : "files were"} not found in storage and are not included.`,
    );
  }
  if (result.supportFiles > 0) {
    lines.push(
      `support/: files from your support tickets and messages, and documents from Support (${result.supportFiles}).`,
    );
  }
  const pending = source.supportPending ?? 0;
  if (pending > 0) {
    lines.push(
      `  ${pending} support ${pending === 1 ? "file is" : "files are"} still being checked and ${pending === 1 ? "is" : "are"} not included.`,
    );
  }
  for (const f of source.extraFiles ?? []) lines.push(`${f.name}: ${f.readme}`);
  for (const note of source.notes ?? []) lines.push(note);
  lines.push(
    "",
    "Never included: passwords, card details, security keys, sign-in links and device keys.",
    "A cell that starts with = + - or @ has a ' in front so a spreadsheet does not run it.",
    "",
  );
  return lines.join("\r\n");
}

/**
 * Build the download zip into `outPath` (a new file; it must not exist). Streams: memory use
 * is one page of rows or one media chunk at a time. On any failure the partial file is
 * removed and the error is rethrown; above `maxBytes` it throws DownloadTooLarge.
 */
export async function buildDownloadZip(
  source: DownloadSource,
  outPath: string,
  opts: { maxBytes?: number } = {},
): Promise<BuildResult> {
  const maxBytes = opts.maxBytes ?? DOWNLOAD_MAX_BYTES;
  const result: BuildResult = {
    bytes: 0,
    files: [],
    counts: {},
    mediaFiles: 0,
    mediaMissing: 0,
    supportFiles: 0,
  };
  const ws = createWriteStream(outPath, { flags: "wx" });
  let failed: unknown = null;
  let needDrain = false;
  ws.on("error", (err) => {
    failed ??= err;
  });
  const zip = new Zip((err, chunk) => {
    if (failed) return;
    if (err) {
      failed = err;
      return;
    }
    result.bytes += chunk.length;
    if (result.bytes > maxBytes) {
      failed = new DownloadTooLarge("the download is too large to build");
      return;
    }
    if (!ws.write(chunk)) needDrain = true;
  });

  // Backpressure: after every push, wait for the file to drain when it asked us to.
  const settle = async (): Promise<void> => {
    if (failed) throw failed;
    if (needDrain) {
      needDrain = false;
      await once(ws, "drain");
    }
    if (failed) throw failed;
  };
  const enc = new TextEncoder();

  const addText = async (
    name: string,
    chunks: AsyncIterable<string> | Iterable<string>,
  ): Promise<void> => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    result.files.push(name);
    for await (const s of chunks) {
      if (s.length === 0) continue;
      f.push(enc.encode(s));
      await settle();
    }
    f.push(new Uint8Array(0), true);
    await settle();
  };

  async function* csvChunks(c: DownloadCollection): AsyncIterable<string> {
    let count = 0;
    yield `${CSV_BOM}${csvLine(c.fields)}\r\n`;
    for await (const page of source.rows(c.name)) {
      let out = "";
      for (const raw of page) {
        // Row filter (12-04): an internal support note is skipped, never written.
        if (c.rowFilter && raw[c.rowFilter.field] !== c.rowFilter.equals) {
          continue;
        }
        // toSnapshot keeps only the approved fields (deny by default); csvLine runs
        // guardFormula and RFC 4180 quoting on every cell.
        const snap = toSnapshot(c.name, raw);
        out += `${csvLine(c.fields.map((f) => cellText(snap[f])))}\r\n`;
        count += 1;
      }
      yield out;
    }
    result.counts[c.name] = count;
  }

  try {
    for (const c of source.collections) {
      await addText(c.file, csvChunks(c));
    }
    for (const item of source.media) {
      const opened = await source.openMedia(item.keys);
      if (!opened) {
        result.mediaMissing += 1;
        continue;
      }
      const name = mediaEntryName(item, opened.key);
      const f = new ZipPassThrough(name);
      zip.add(f);
      result.files.push(name);
      const reader = opened.stream.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            f.push(value);
            await settle();
          }
        }
      } catch (err) {
        await reader.cancel().catch(() => undefined);
        throw err;
      } finally {
        reader.releaseLock();
      }
      f.push(new Uint8Array(0), true);
      await settle();
      if (item.folder === "support") result.supportFiles += 1;
      else result.mediaFiles += 1;
    }
    for (const extra of source.extraFiles ?? []) {
      await addText(extra.name, [extra.text]);
    }
    await addText("README.txt", [readme(source, result)]);
    zip.end();
    await settle();
    ws.end();
    await once(ws, "finish");
    if (failed) throw failed;
    return result;
  } catch (err) {
    zip.terminate();
    ws.destroy();
    await rm(outPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------------------------------
// Request, build, notify, prune (11-40 choices 1, 4, 5, 7, 8)

const COLLECTION = "data_exports";
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const ID_RE = /^[a-z0-9]{15}$/;
const PAGE = 200;

/** At most one download per this window (D284). A failed build does not count. */
export const DOWNLOAD_COOLDOWN_MS = DAY_MS;
/** The retention tick builds queued rows older than this (crash recovery, choice 1). */
export const DOWNLOAD_STALE_QUEUED_MS = 2 * MINUTE_MS;
/** While a zip builds, its row's `updated` stamp (the heartbeat) moves this often. */
export const DOWNLOAD_HEARTBEAT_MS = MINUTE_MS;
/**
 * A "building" row whose heartbeat is older than this was interrupted (a deploy or crash
 * mid-build; review 11 WR-B08). Measured from the heartbeat, never from requested_at, so a
 * long build queued behind another is never cut while it runs.
 */
export const DOWNLOAD_ORPHAN_BUILDING_MS = 5 * MINUTE_MS;
/** Failed rows are deleted after this many days (choice 7). */
export const DOWNLOAD_FAILED_KEEP_DAYS = 7;
/** Where the ready alert lands: Settings > Business info > Your data (UI-SPEC). */
export const DATA_DOWNLOAD_HREF = "/hub/settings?tab=business#your-data";

export type DataDownloadStatus =
  "queued" | "building" | "ready" | "failed" | "expired";

export type DataDownloadRow = {
  id: string;
  status: DataDownloadStatus;
  requestedAt: string;
  readyAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
  errorKind: string | null;
  /** Signed link path, only for a ready, unexpired download. */
  href: string | null;
};

export type DataDownloadState = {
  /** "owner" may ask; staff impersonating and other roles get their own copy. */
  who: "owner" | "not-owner" | "impersonating";
  /** The newest request of this org, or null. */
  latest: DataDownloadRow | null;
  /** ISO time the 24-hour limit lifts, when it applies now. */
  nextAllowedAt: string | null;
  canRequest: boolean;
};

export type DataDownloadDeps = {
  now?: Date;
  store?: ObjectStore;
  transport?: EmailTransport;
  push?: PushSender;
  /** Folder for the temp zip; defaults to os.tmpdir(). */
  tmpDir?: string;
  maxBytes?: number;
  /** requestDataDownload only: false skips the fire-and-forget build (tests, jobs). */
  run?: boolean;
  /** Test seam: heartbeat period while building (default DOWNLOAD_HEARTBEAT_MS). */
  heartbeatMs?: number;
};

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function toDate(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function errorKind(err: unknown): string {
  if (err instanceof DownloadTooLarge) return "too_large";
  const name = err instanceof Error ? err.name || err.constructor.name : "";
  return name.slice(0, 60) || "Error";
}

function logFailure(what: string, err: unknown): void {
  // Error class name only: never an org name, email or storage detail.
  console.error(`[downloads] ${what} ${errorKind(err)}`);
}

function assertOwnerAsking(ctx: OrgContext): void {
  assertOrgContext(ctx);
  if (ctx.impersonator) {
    throw new ImpersonationDenied("data downloads are off while impersonating");
  }
  if (ctx.systemJob) {
    throw new Forbidden("only the site owner can download the site's data");
  }
  requirePermission(ctx, "exports", "run");
}

async function rowsOf(pb: PocketBase, orgId: string): Promise<RecordModel[]> {
  return pb.collection(COLLECTION).getFullList({
    filter: pb.filter("organization = {:org}", { org: orgId }),
    sort: "-requested_at,-id",
  });
}

/** The newest request that counts toward the 24-hour limit (failed ones do not). */
function nextAllowed(rows: readonly RecordModel[], now: Date): Date | null {
  const last = rows.find((r) => r.status !== "failed");
  const at = last ? toDate(last.requested_at) : null;
  if (!at) return null;
  const next = new Date(at.getTime() + DOWNLOAD_COOLDOWN_MS);
  return next.getTime() > now.getTime() ? next : null;
}

function isActive(r: RecordModel): boolean {
  return r.status === "queued" || r.status === "building";
}

/** Orgs with a build call waiting or running in this process (the request's fire-and-forget). */
const pendingOrgs = new Map<string, number>();

/**
 * WR-B08: an active row nobody is working on. "building" with a stale heartbeat (`updated`
 * is the PocketBase clock, so it is compared with the wall clock), or "queued" past
 * DOWNLOAD_STALE_QUEUED_MS with no build call waiting for its org in this process.
 */
function isOrphan(r: RecordModel, now: Date): boolean {
  if (r.status === "building") {
    const at = Date.parse(str(r.updated).replace(" ", "T"));
    return Number.isFinite(at) && Date.now() - at > DOWNLOAD_ORPHAN_BUILDING_MS;
  }
  if (r.status === "queued") {
    if ((pendingOrgs.get(str(r.organization)) ?? 0) > 0) return false;
    const at = toDate(r.requested_at);
    return !!at && now.getTime() - at.getTime() > DOWNLOAD_STALE_QUEUED_MS;
  }
  return false;
}

/** An orphaned row reads as failed ("interrupted"): Try again is offered at once. */
function withOrphansFailed(
  rows: readonly RecordModel[],
  now: Date,
): RecordModel[] {
  return rows.map((r) =>
    isOrphan(r, now)
      ? ({ ...r, status: "failed", error_kind: "interrupted" } as RecordModel)
      : r,
  );
}

function rowView(r: RecordModel, now: Date): DataDownloadRow {
  const expires = toDate(r.expires_at);
  let status = r.status as DataDownloadStatus;
  if (status === "ready" && (!expires || expires.getTime() <= now.getTime())) {
    status = "expired";
  }
  const size = typeof r.size_bytes === "number" ? r.size_bytes : null;
  return {
    id: r.id,
    status,
    requestedAt: toDate(r.requested_at)?.toISOString() ?? "",
    readyAt: toDate(r.ready_at)?.toISOString() ?? null,
    expiresAt: expires?.toISOString() ?? null,
    sizeBytes: status === "ready" || status === "expired" ? size : null,
    errorKind: status === "failed" ? str(r.error_kind) || null : null,
    href:
      status === "ready" && expires
        ? downloadLinkPath(r.id, expires.getTime())
        : null,
  };
}

/**
 * The Settings › Business info › Your data panel state (UI-SPEC "Download my data"). Admins,
 * Editors and impersonating staff get only `who`; nothing about the download is read.
 */
export async function readDataDownloadState(
  ctx: OrgContext,
  now: Date = new Date(),
): Promise<DataDownloadState> {
  assertOrgContext(ctx);
  const none = { latest: null, nextAllowedAt: null, canRequest: false };
  if (ctx.impersonator) return { who: "impersonating", ...none };
  if (ctx.systemJob || ctx.role !== "owner") {
    return { who: "not-owner", ...none };
  }
  requirePermission(ctx, "exports", "run");
  const rows = withOrphansFailed(
    await withSuperuser((pb) => rowsOf(pb, ctx.orgId)),
    now,
  );
  const next = nextAllowed(rows, now);
  return {
    who: "owner",
    latest: rows[0] ? rowView(rows[0], now) : null,
    nextAllowedAt: next?.toISOString() ?? null,
    canRequest: !rows.some(isActive) && next === null,
  };
}

/**
 * The Owner asks for a download (choice 1). Refuses impersonating staff
 * (ImpersonationDenied), other roles (Forbidden), a build already queued or running, and a
 * second request within 24 hours (InvalidInput naming the next allowed time). Creates a
 * `queued` row, audits `data_export.requested`, then starts the build without waiting.
 */
export async function requestDataDownload(
  ctx: OrgContext,
  deps: DataDownloadDeps = {},
): Promise<{ id: string }> {
  assertOwnerAsking(ctx);
  const now = deps.now ?? new Date();
  const id = await withOrgLock(`data-download:${ctx.orgId}`, () =>
    withSuperuser(async (pb) => {
      const stored = await rowsOf(pb, ctx.orgId);
      // WR-B08: a build cut off by a deploy or crash never blocks the Owner until the daily
      // job: its row is marked failed ("interrupted") here and a new request goes ahead.
      for (const r of stored) {
        if (isOrphan(r, now)) {
          await pb
            .collection(COLLECTION)
            .update(r.id, { status: "failed", error_kind: "interrupted" });
        }
      }
      const rows = withOrphansFailed(stored, now);
      if (rows.some(isActive)) {
        throw new InvalidInput("your download is already being prepared");
      }
      const next = nextAllowed(rows, now);
      if (next) {
        throw new InvalidInput(
          `you can ask for a new download after ${next.toISOString()}`,
        );
      }
      const row = await pb.collection(COLLECTION).create({
        organization: ctx.orgId,
        requested_by: ctx.actor,
        status: "queued",
        requested_at: now.toISOString(),
      });
      return row.id;
    }),
  );
  await appendAudit(ctx, {
    action: "data_export.requested",
    targetCollection: COLLECTION,
    targetId: id,
  });
  if (deps.run !== false) {
    void runDataDownloads(mintSystemContext({ job: "data-download" }), {
      ...deps,
      org: ctx.orgId,
    }).catch((err) => logFailure("build failed", err));
  }
  return { id };
}

// ------------------------------------------------------------------ the build

let chain: Promise<unknown> = Promise.resolve();

/** One build at a time in this process (1 GB container; assumes one container, 11-50). */
function withBuildLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function mediaKeys(orgId: string, row: RecordModel): string[] {
  const kind = str(row.kind);
  const ext = str(row.original_ext);
  const names: MediaObjectName[] = [];
  if (kind === "video") names.push("original.mp4", "video.mp4");
  else if (kind === "audio") names.push("audio.mp3");
  else {
    if (ext === "jpg" || ext === "png" || ext === "webp") {
      names.push(`original.${ext}`);
    }
    names.push("web.webp");
  }
  return names.map((n) => tenantMediaKey(orgId, row.id, n));
}

function isRanged(store: ObjectStore): store is RangedObjectStore {
  return typeof (store as RangedObjectStore).readRange === "function";
}

function bytesStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      if (bytes.length > 0) c.enqueue(bytes);
      c.close();
    },
  });
}

async function openObject(
  store: ObjectStore,
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  if (isRanged(store)) return store.readRange(key, null);
  const bytes = await store.get(key);
  return bytes ? { stream: bytesStream(bytes), size: bytes.length } : null;
}

/**
 * Support attachments on public messages and non-removed CDS documents, as files under
 * support/ (12-07 choice 10). Keys stay server-side: they are never written to any CSV, and a
 * key outside this org's support prefix is skipped.
 */
async function supportItems(
  pb: PocketBase,
  orgId: string,
): Promise<{ items: DownloadMediaItem[]; bytes: number; pending: number }> {
  const prefix = tenantSupportPrefix(orgId);
  const [all, docs] = await Promise.all([
    pb.collection("support_files").getFullList({
      filter: pb.filter(
        "organization = {:org} && message.visibility = 'public'",
        { org: orgId },
      ),
      sort: "created,id",
      fields: "id,name,size,object_key,scan",
    }),
    pb.collection("cds_documents").getFullList({
      filter: pb.filter("organization = {:org} && removed_at = ''", {
        org: orgId,
      }),
      sort: "created,id",
      fields: "id,filename,size,object_key",
    }),
  ]);
  // 12-REVIEW WR-A03: a file still waiting for its scan is never handed out, here either
  // (fail closed, as openSupportFile does); README.txt says how many were left out.
  const files = all.filter((r) => str(r.scan) !== "pending");
  const pending = all.length - files.length;
  const items: DownloadMediaItem[] = [];
  let bytes = 0;
  for (const r of [...files, ...docs]) {
    const key = str(r.object_key);
    if (!key.startsWith(prefix)) continue;
    items.push({
      id: r.id,
      name: str(r.name) || str(r.filename),
      keys: [key],
      folder: "support",
    });
    bytes += typeof r.size === "number" ? r.size : 0;
  }
  return { items, bytes, pending };
}

async function loadSource(
  orgId: string,
  now: Date,
  store: ObjectStore,
): Promise<{ source: DownloadSource; mediaBytes: number }> {
  const { orgName, media, mediaBytes, supportPending } = await withSuperuser(
    async (pb) => {
      const org = await pb
        .collection("organizations")
        .getOne(orgId, { fields: "id,name" });
      const assets = await pb.collection("media_assets").getFullList({
        filter: pb.filter(
          "organization = {:org} && deleted_at = '' && removed_at = ''",
          { org: orgId },
        ),
        sort: "sort_order,id",
        fields: "id,kind,original_ext,name,bytes",
      });
      const support = await supportItems(pb, orgId);
      return {
        orgName: str(org.name),
        supportPending: support.pending,
        media: [
          ...assets.map((a) => ({
            id: a.id,
            name: str(a.name),
            keys: mediaKeys(orgId, a),
          })),
          ...support.items,
        ],
        mediaBytes:
          assets.reduce(
            (n, a) => n + (typeof a.bytes === "number" ? a.bytes : 0),
            0,
          ) + support.bytes,
      };
    },
  );
  const source: DownloadSource = {
    orgName,
    now,
    collections: downloadCollections(),
    async *rows(name) {
      const spec = getCollectionSpec(name);
      const rowFilter = rowFilterTemplate(spec);
      for (let page = 1; ; page++) {
        const res = await withSuperuser((pb) =>
          pb.collection(name).getList(page, PAGE, {
            filter:
              pb.filter("organization = {:org}", { org: orgId }) +
              (rowFilter
                ? " && " + pb.filter(rowFilter.template, rowFilter.params)
                : ""),
            sort: "id",
          }),
        );
        yield res.items;
        if (page >= res.totalPages || res.items.length === 0) return;
      }
    },
    media,
    supportPending,
    async openMedia(keys) {
      for (const key of keys) {
        const read = await openObject(store, key);
        if (read) return { key, stream: read.stream };
      }
      return null;
    },
  };
  const dns = await dnsZoneFile(orgId, now, store);
  source.extraFiles = dns.files;
  source.notes = dns.notes;
  return { source, mediaBytes };
}

/** The zip name of the zone file (14-40, D-UI-P14-22). */
export const DOWNLOAD_ZONE_FILE = "dns/zone.txt";

/**
 * 14-40 (choice 5, D-UI-P14-22): when the org has a CDS zone (active, moved or handed back and
 * not yet deleted), the zip gains dns/zone.txt (the handback export). A failed export adds a
 * README line instead of failing the zip.
 */
async function dnsZoneFile(
  orgId: string,
  now: Date,
  store: ObjectStore,
): Promise<{
  files: { name: string; text: string; readme: string }[];
  notes: string[];
}> {
  const zones = await withSuperuser((pb) =>
    pb.collection("dns_zones").getFullList({
      filter: pb.filter(
        "org_id = {:org} && provider_zone_id != '' && (status = 'active' || status = 'moved' || status = 'handed_back')",
        { org: orgId },
      ),
      sort: "-updated",
      fields: "id,status",
    }),
  );
  const zone =
    zones.find((z) => z.status === "active" || z.status === "moved") ??
    zones[0];
  if (!zone) return { files: [], notes: [] };
  try {
    // Loaded lazily: offboarding/steps imports this module (no static import cycle).
    const { exportZoneFile } = await import("../offboarding/handback");
    const { text } = await exportZoneFile(orgId, zone.id, { now, store });
    return {
      files: [
        {
          name: DOWNLOAD_ZONE_FILE,
          text,
          readme:
            "your domain's DNS records as a zone file (BIND format). Its first lines say which records point to us and which to remove.",
        },
      ],
      notes: [],
    };
  } catch (err) {
    logFailure("zone file failed", err);
    return {
      files: [],
      notes: [
        `${DOWNLOAD_ZONE_FILE}: your DNS records couldn't be added this time. Ask Support for your zone file.`,
      ],
    };
  }
}

async function upload(
  store: ObjectStore,
  key: string,
  path: string,
): Promise<void> {
  if (typeof store.putFile === "function") {
    await store.putFile(key, path, "application/zip");
    return;
  }
  // Plain fakes without putFile: small test zips only.
  await store.put(key, new Uint8Array(await readFile(path)), "application/zip");
}

const EXPIRES_ON = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "America/Chicago",
});

/** Bell + push for every Owner, and the dedicated email to the Owner who asked. Never throws. */
async function notifyReady(
  row: RecordModel,
  orgName: string,
  expiresAt: Date,
  deps: DataDownloadDeps,
): Promise<void> {
  const orgId = str(row.organization);
  try {
    await raiseAlert(
      { orgId, as: mintSystemContext({ job: "data-download" }) },
      {
        type: "data_export.ready",
        sourceKey: `export:${row.id}`,
        title: "Your data download is ready",
        safeTitle: "Your data download is ready",
        href: DATA_DOWNLOAD_HREF,
        actionLabel: "Download",
      },
      { now: deps.now, push: deps.push, transport: deps.transport },
    );
  } catch (err) {
    logFailure("alert failed", err);
  }
  try {
    const requester = str(row.requested_by);
    const to = await withSuperuser(async (pb) => {
      // Only while the requester is still an owner of this org.
      const owner = await pb
        .collection("memberships")
        .getFirstListItem(
          pb.filter(
            "organization = {:org} && user = {:user} && role = 'owner'",
            { org: orgId, user: requester },
          ),
          { fields: "id" },
        )
        .catch(() => null);
      if (!owner) return null;
      const user = await pb
        .collection("users")
        .getOne(requester, { fields: "id,email" })
        .catch(() => null);
      return user ? str(user.email) : null;
    });
    if (!to) return;
    await sendEmail(
      { kind: "org", ctx: mintSystemContext({ job: "data-download" }), orgId },
      "data_export.ready",
      to,
      {
        business: orgName,
        href: platformUrl(downloadLinkPath(row.id, expiresAt.getTime())),
        expiresOn: EXPIRES_ON.format(expiresAt),
      },
      { transport: deps.transport },
    );
  } catch (err) {
    logFailure("email failed", err);
  }
}

async function buildOne(
  row: RecordModel,
  deps: DataDownloadDeps,
): Promise<void> {
  const orgId = str(row.organization);
  const store = deps.store ?? getRangedObjectStore();
  const maxBytes = deps.maxBytes ?? DOWNLOAD_MAX_BYTES;
  const tmp = join(
    deps.tmpDir ?? tmpdir(),
    `cds-download-${orgId}-${Date.now()}-${randomBytes(4).toString("hex")}.zip`,
  );
  let uploadedKey: string | null = null;
  try {
    const startedAt = deps.now ?? new Date();
    const { source, mediaBytes } = await loadSource(orgId, startedAt, store);
    // Fail fast: the media alone would pass the cap (choice 8).
    if (mediaBytes > maxBytes) {
      throw new DownloadTooLarge("the media library is too large to zip");
    }
    const built = await buildDownloadZip(source, tmp, { maxBytes });
    const key = tenantDownloadKey(orgId, startedAt);
    await upload(store, key, tmp);
    uploadedKey = key;
    const readyAt = deps.now ?? new Date();
    const expiresAt = new Date(readyAt.getTime() + DOWNLOAD_LINK_DAYS * DAY_MS);
    await withSuperuser((pb) =>
      pb.collection(COLLECTION).update(row.id, {
        status: "ready",
        object_key: key,
        size_bytes: built.bytes,
        ready_at: readyAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        error_kind: "",
      }),
    );
    await notifyReady(row, source.orgName, expiresAt, deps);
  } catch (err) {
    if (uploadedKey) await store.delete(uploadedKey).catch(() => undefined);
    throw err;
  } finally {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

export type RunDataDownloadsOptions = DataDownloadDeps & {
  /** Build this org's queued requests now (the request path). Without it: the job tick. */
  org?: string;
};

export type RunDataDownloadsResult = {
  built: string[];
  failed: { id: string; errorKind: string }[];
  /** "building" rows with no heartbeat for DOWNLOAD_ORPHAN_BUILDING_MS marked failed ("interrupted"). */
  interrupted: number;
};

/**
 * Build queued downloads (choice 1). With `org`: that org's queued rows at once (the
 * request's fire-and-forget). Without: the job tick, which builds queued rows older than
 * DOWNLOAD_STALE_QUEUED_MS (a crash between request and build) and marks rows stuck in
 * "building" as failed. One build at a time per process. A failure marks the row failed
 * with `error_kind` (class name, or "too_large") and sends no alert (choice 8).
 */
export async function runDataDownloads(
  ctx: SystemContext,
  opts: RunDataDownloadsOptions = {},
): Promise<RunDataDownloadsResult> {
  // Review 11 WR-B07 (invariant 1): a system job only, with a context minted in @cds/db.
  assertSystemContext(ctx);
  if (opts.org !== undefined && !ID_RE.test(opts.org)) throw new NotFound();
  assertAddonCollectionsRegistered();
  const org = opts.org;
  if (org === undefined) return runLocked(opts);
  pendingOrgs.set(org, (pendingOrgs.get(org) ?? 0) + 1);
  try {
    return await runLocked(opts);
  } finally {
    const left = (pendingOrgs.get(org) ?? 1) - 1;
    if (left > 0) pendingOrgs.set(org, left);
    else pendingOrgs.delete(org);
  }
}

/** Move a building row's `updated` stamp (an empty update) so others see it is alive. */
function startHeartbeat(id: string, ms: number): () => void {
  const timer = setInterval(() => {
    void withSuperuser((pb) => pb.collection(COLLECTION).update(id, {})).catch(
      (err: unknown) => logFailure("heartbeat failed", err),
    );
  }, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

function runLocked(
  opts: RunDataDownloadsOptions,
): Promise<RunDataDownloadsResult> {
  return withBuildLock(async () => {
    const now = opts.now ?? new Date();
    const result: RunDataDownloadsResult = {
      built: [],
      failed: [],
      interrupted: 0,
    };
    const { queued, stuck } = await withSuperuser(async (pb) => {
      const queuedCut = new Date(now.getTime() - DOWNLOAD_STALE_QUEUED_MS);
      // WR-B08: stuck = no heartbeat for DOWNLOAD_ORPHAN_BUILDING_MS (checked below).
      const stuckFilter = "status = 'building'";
      const queuedFilter = opts.org
        ? pb.filter("organization = {:org} && status = 'queued'", {
            org: opts.org,
          })
        : pb.filter("status = 'queued' && requested_at <= {:cut}", {
            cut: queuedCut,
          });
      return {
        stuck: opts.org
          ? []
          : await pb
              .collection(COLLECTION)
              .getFullList({ filter: stuckFilter, fields: "id,status,updated" })
              .then((rows) => rows.filter((r) => isOrphan(r, now))),
        queued: await pb
          .collection(COLLECTION)
          .getFullList({ filter: queuedFilter, sort: "requested_at,id" }),
      };
    });
    for (const s of stuck) {
      await withSuperuser((pb) =>
        pb
          .collection(COLLECTION)
          .update(s.id, { status: "failed", error_kind: "interrupted" }),
      );
      result.interrupted += 1;
    }
    for (const q of queued) {
      // Claim: re-read, so a row another run already took is skipped.
      const row = await withSuperuser(async (pb) => {
        const fresh = await pb.collection(COLLECTION).getOne(q.id);
        if (fresh.status !== "queued") return null;
        return pb.collection(COLLECTION).update(q.id, { status: "building" });
      });
      if (!row) continue;
      const stopHeartbeat = startHeartbeat(
        row.id,
        opts.heartbeatMs ?? DOWNLOAD_HEARTBEAT_MS,
      );
      try {
        await buildOne(row, opts);
        result.built.push(row.id);
      } catch (err) {
        const kind = errorKind(err);
        logFailure("build failed", err);
        await withSuperuser((pb) =>
          pb
            .collection(COLLECTION)
            .update(row.id, { status: "failed", error_kind: kind }),
        ).catch((e: unknown) => logFailure("mark failed", e));
        result.failed.push({ id: row.id, errorKind: kind });
      } finally {
        stopHeartbeat();
      }
    }
    return result;
  });
}

// ------------------------------------------------------------------ the download route

/** The link is genuine but past its 7 days, or the zip was pruned (UI-SPEC expired page). */
export class DownloadLinkExpired extends CdsError {
  override readonly code = "download_link_expired";
}

export type OpenedDownload = {
  stream: ReadableStream<Uint8Array>;
  size: number;
  /** "<org-slug>-data-<yyyy-mm-dd>.zip" */
  filename: string;
};

/**
 * For the download route (11-41): the Owner of this org (never impersonating), a link whose
 * HMAC matches this row's expiry, and a ready, unexpired zip. A tampered link, a foreign id
 * or a missing object is NotFound; a genuine but expired link is DownloadLinkExpired.
 */
export async function openDataDownload(
  ctx: OrgContext,
  id: string,
  link: { exp: unknown; sig: unknown },
  deps: { store?: ObjectStore; now?: Date } = {},
): Promise<OpenedDownload> {
  assertOwnerAsking(ctx);
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  const now = (deps.now ?? new Date()).getTime();
  if (!verifyDownloadLink(id, link.exp, link.sig, now)) {
    if (verifyDownloadLink(id, link.exp, link.sig, 0)) {
      throw new DownloadLinkExpired("this download link has expired");
    }
    throw new NotFound();
  }
  const { row, slug } = await withSuperuser(async (pb) => {
    const found = await pb
      .collection(COLLECTION)
      .getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id,
          org: ctx.orgId,
        }),
      )
      .catch(() => null);
    if (!found) throw new NotFound();
    const org = await pb
      .collection("organizations")
      .getOne(ctx.orgId, { fields: "id,slug" });
    return { row: found, slug: str(org.slug) };
  });
  const expires = toDate(row.expires_at);
  if (!expires || expires.getTime() !== Number(link.exp)) throw new NotFound();
  if (row.status === "expired") {
    throw new DownloadLinkExpired("this download link has expired");
  }
  const key = str(row.object_key);
  if (
    row.status !== "ready" ||
    !key.startsWith(tenantExportPrefix(ctx.orgId))
  ) {
    throw new NotFound();
  }
  const read = await openObject(deps.store ?? getRangedObjectStore(), key);
  if (!read) throw new NotFound();
  const day = (toDate(row.ready_at) ?? expires).toISOString().slice(0, 10);
  return {
    stream: read.stream,
    size: read.size,
    filename: `${slug || "site"}-data-${day}.zip`,
  };
}

// ------------------------------------------------------------------ retention (choice 7)

export type PruneDataDownloadsResult = {
  /** Ready zips past expires_at: object deleted, row -> expired. */
  expired: number;
  /** Failed rows older than DOWNLOAD_FAILED_KEEP_DAYS, deleted. */
  failedDeleted: number;
};

/** Called by the retention job (its SystemContext, WR-B07). dryRun counts only and writes nothing. */
export async function pruneDataDownloads(
  ctx: SystemContext,
  opts: {
    now: Date;
    dryRun?: boolean;
    store?: ObjectStore;
  },
): Promise<PruneDataDownloadsResult> {
  assertSystemContext(ctx);
  const { now } = opts;
  const failedCut = new Date(
    now.getTime() - DOWNLOAD_FAILED_KEEP_DAYS * DAY_MS,
  );
  const { ready, failed } = await withSuperuser(async (pb) => {
    const readyFilter = pb.filter("status = 'ready' && expires_at <= {:now}", {
      now,
    });
    const failedFilter = pb.filter(
      "status = 'failed' && requested_at <= {:cut}",
      { cut: failedCut },
    );
    return {
      ready: await pb.collection(COLLECTION).getFullList({
        filter: readyFilter,
        fields: "id,organization,object_key",
      }),
      failed: await pb
        .collection(COLLECTION)
        .getFullList({ filter: failedFilter, fields: "id" }),
    };
  });
  if (opts.dryRun) {
    return { expired: ready.length, failedDeleted: failed.length };
  }
  const store = opts.store ?? getRangedObjectStore();
  for (const r of ready) {
    const key = str(r.object_key);
    let prefix = "";
    try {
      prefix = tenantExportPrefix(str(r.organization));
    } catch {
      prefix = "";
    }
    if (key && prefix && key.startsWith(prefix)) await store.delete(key);
    await withSuperuser((pb) =>
      pb
        .collection(COLLECTION)
        .update(r.id, { status: "expired", object_key: "" }),
    );
  }
  for (const f of failed) {
    await withSuperuser((pb) => pb.collection(COLLECTION).delete(f.id));
  }
  return { expired: ready.length, failedDeleted: failed.length };
}
