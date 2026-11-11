// P8 (08-11): the per-org assembly ledger in `org_intake.assembly` (CONTEXT A2-Q3; TMPL-02;
// ASVS V5; T-08-11-01, T-08-11-03).
//
// The stored JSON steers which pages a re-run rebuilds, so it is read deny-by-default: only
// the AssemblyLedger keys survive, each type-checked; a wrong type falls back to its default
// (or the key is dropped when optional); status is one of four words; attempts a small
// non-negative integer; page ids must look like PocketBase ids. A corrupt value reads as an
// empty ledger and never throws (a rebuild is still guarded by the draft print and "never
// recreate a deleted page"). writeLedger stores only what parseLedger lets through.
//
// Reads and writes run under the caller's OrgContext with a bound `organization = {:org}`
// filter (invariant 1). No org lock is taken here: the orchestrator (08-16) holds its own
// lock around a run, and the content lock is not re-entrant. A write updates the single
// `assembly` field only, so it never clobbers the owner's other intake answers.
import { NotFound } from "@cds/core";
import type {
  AssemblyLedger,
  AssemblyReport,
  LedgerPage,
  PageOutcome,
  SlotReportLine,
  SlotSource,
} from "@cds/core/templates";
import type PocketBase from "pocketbase";
import { ClientResponseError } from "pocketbase";
import { withSuperuser } from "../client";
import { assertOrgContext, type OrgContext } from "../context";
import { assertId, mapError, requirePermission } from "../repository";

const COLLECTION = "org_intake";
const STATUSES = new Set<AssemblyLedger["status"]>([
  "queued",
  "running",
  "done",
  "failed",
]);
const SOURCES = new Set<SlotSource>(["provided", "fallback", "omitted"]);
const OUTCOMES = new Set<PageOutcome>([
  "created",
  "rebuilt",
  "unchanged",
  "edited",
  "deleted",
  "held",
  "skipped_existing",
]);
/** A PocketBase record id (15 lowercase alphanumerics; newRecordId). */
const PB_ID = /^[a-z0-9]{15}$/;
/** A template page key (`home`, `about`). */
const PAGE_KEY = /^[a-z][a-z0-9-]{0,39}$/;
const ERROR_CODE = /^[A-Z_]{2,40}$/;
const SLUG = /^[a-z0-9-]{0,100}$/;
const MAX_ATTEMPTS = 1000;
const MAX_PAGES = 50;
const MAX_LINES = 500;
const SHORT = 200;
const LONG = 1000;

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.length <= max ? v : undefined;

const int = (v: unknown, max: number): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max
    ? v
    : undefined;

/** A fresh ledger: queued, no attempts, no pages, no template yet. */
export function emptyLedger(): AssemblyLedger {
  return {
    template_id: "",
    template_version: 0,
    status: "queued",
    attempts: 0,
    pages: {},
  };
}

function parsePage(v: unknown): LedgerPage | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === "string" && PB_ID.test(v.id) ? v.id : null;
  const slug = typeof v.slug === "string" && SLUG.test(v.slug) ? v.slug : null;
  const print = str(v.print, SHORT);
  if (id === null || slug === null || print === undefined) return null;
  const out: LedgerPage = {
    id,
    slug,
    print,
    published: v.published === true,
  };
  if (v.pending === true) out.pending = true;
  const versionKey = str(v.versionKey, LONG);
  if (versionKey !== undefined) out.versionKey = versionKey;
  return out;
}

function parsePages(v: unknown): Record<string, LedgerPage> {
  const out: Record<string, LedgerPage> = {};
  if (!isObj(v)) return out;
  let n = 0;
  for (const [key, raw] of Object.entries(v)) {
    if (n >= MAX_PAGES) break;
    if (!PAGE_KEY.test(key)) continue;
    const page = parsePage(raw);
    if (page) {
      out[key] = page;
      n++;
    }
  }
  return out;
}

function parseSlotLine(v: unknown): SlotReportLine | null {
  if (!isObj(v)) return null;
  const page = str(v.page, SHORT);
  const slot = str(v.slot, SHORT);
  const source = v.source;
  if (
    page === undefined ||
    slot === undefined ||
    typeof source !== "string" ||
    !SOURCES.has(source as SlotSource)
  ) {
    return null;
  }
  const out: SlotReportLine = { page, slot, source: source as SlotSource };
  if (v.note !== undefined) {
    const note = str(v.note, LONG);
    if (note === undefined) return null;
    out.note = note;
  }
  return out;
}

type ReportPage = AssemblyReport["pages"][number];

function parseReportPage(v: unknown): ReportPage | null {
  if (!isObj(v)) return null;
  const key = str(v.key, SHORT);
  const label = str(v.label, SHORT);
  const path = str(v.path, LONG);
  const outcome = v.outcome;
  if (
    key === undefined ||
    label === undefined ||
    path === undefined ||
    typeof outcome !== "string" ||
    !OUTCOMES.has(outcome as PageOutcome)
  ) {
    return null;
  }
  return { key, label, outcome: outcome as PageOutcome, path };
}

/** Every element must parse, else null (a half-trusted report is not kept). */
function all<T>(v: unknown, parse: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > MAX_LINES) return null;
  const out: T[] = [];
  for (const x of v) {
    const p = parse(x);
    if (p === null) return null;
    out.push(p);
  }
  return out;
}

/** The stored report, or undefined when any part of it is malformed. */
export function parseReport(v: unknown): AssemblyReport | undefined {
  if (!isObj(v)) return undefined;
  const templateId = str(v.templateId, SHORT);
  const templateVersion = int(v.templateVersion, 1_000_000);
  const slots = all(v.slots, parseSlotLine);
  const polish = all(v.polish, (x) => str(x, LONG) ?? null);
  const pages = all(v.pages, parseReportPage);
  if (
    templateId === undefined ||
    templateVersion === undefined ||
    slots === null ||
    polish === null ||
    pages === null
  ) {
    return undefined;
  }
  return { templateId, templateVersion, slots, polish, pages };
}

/** Stored ledger JSON → AssemblyLedger, deny by default. Never throws. */
export function parseLedger(raw: unknown): AssemblyLedger {
  const out = emptyLedger();
  if (!isObj(raw)) return out;
  out.template_id = str(raw.template_id, SHORT) ?? "";
  out.template_version = int(raw.template_version, 1_000_000) ?? 0;
  if (
    typeof raw.status === "string" &&
    STATUSES.has(raw.status as AssemblyLedger["status"])
  ) {
    out.status = raw.status as AssemblyLedger["status"];
  }
  out.attempts = int(raw.attempts, MAX_ATTEMPTS) ?? 0;
  const started = str(raw.started_at, 64);
  if (started !== undefined) out.started_at = started;
  const assembled = str(raw.assembled_at, 64);
  if (assembled !== undefined) out.assembled_at = assembled;
  if (isObj(raw.error)) {
    const code = raw.error.code;
    if (typeof code === "string" && ERROR_CODE.test(code)) {
      const page = raw.error.page;
      out.error =
        typeof page === "string" && PAGE_KEY.test(page)
          ? { code, page }
          : { code };
    }
  }
  if (typeof raw.form_id === "string" && PB_ID.test(raw.form_id)) {
    out.form_id = raw.form_id;
  }
  if (typeof raw.failure_emailed === "boolean") {
    out.failure_emailed = raw.failure_emailed;
  }
  out.pages = parsePages(raw.pages);
  const report = parseReport(raw.report);
  if (report !== undefined) out.report = report;
  return out;
}

function pbRun<T>(fn: (pb: PocketBase) => Promise<T>): Promise<T> {
  return withSuperuser(fn).catch((err: unknown) => {
    if (err instanceof ClientResponseError) mapError(err);
    throw err;
  });
}

/** The org's ledger and its org_intake row id. No intake row: NotFound. */
export async function readLedger(
  ctx: OrgContext,
): Promise<{ rowId: string; ledger: AssemblyLedger }> {
  assertOrgContext(ctx);
  requirePermission(ctx, "business", "read");
  return pbRun(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("organization = {:org}", { org: ctx.orgId }),
      fields: "id,assembly",
    });
    const row = res.items[0];
    if (!row) throw new NotFound();
    return { rowId: row.id, ledger: parseLedger(row.assembly) };
  });
}

/**
 * Store the ledger on the org's own intake row (a foreign or unknown row id: NotFound).
 * The value is validated through parseLedger first; returns what was stored.
 */
export async function writeLedger(
  ctx: OrgContext,
  rowId: string,
  ledger: AssemblyLedger,
): Promise<AssemblyLedger> {
  assertOrgContext(ctx);
  requirePermission(ctx, "business", "write");
  assertId(rowId);
  const clean = parseLedger(ledger);
  return pbRun(async (pb) => {
    const res = await pb.collection(COLLECTION).getList(1, 1, {
      filter: pb.filter("organization = {:org} && id = {:id}", {
        org: ctx.orgId,
        id: rowId,
      }),
      fields: "id",
    });
    if (!res.items[0]) throw new NotFound();
    const saved = await pb
      .collection(COLLECTION)
      .update(rowId, { assembly: clean });
    return parseLedger(saved.assembly);
  });
}
