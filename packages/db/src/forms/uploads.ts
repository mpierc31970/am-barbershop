// Forms Pro file uploads (BILL-14, D233, D234; P7 07-15 scanner seam; 10-38).
//
// D234: PDF, JPG, PNG, HEIC, DOC and DOCX; 10 MB per file; 1 GB per site; every file scanned
// before it is stored; stored PRIVATELY under tenants/<org>/forms/<form>/<submission>/ (never
// the public store or the CDN); not counted against the media allowance; kept until the owner
// deletes the submission; warn at 80 %, hide upload fields at 100 %.
//
// Choices (10-38, recorded in SUMMARY):
//   1. Type check = extension allowlist AND magic bytes, both must name the same type; a
//      mismatch is refused. The stored/served MIME comes from the detected type, never the
//      browser's claim.
//   2. Limits are re-checked here per file and against the org total (the route caps the body
//      first).
//   3. The answer is { file_id, name, size, type }; the object key is rebuilt from the
//      submission row and never leaves the server.
//   4. Usage = the sum of `size` over this org's stored file answers (one bound query over
//      form_submissions whose data mentions a file answer). No extra collection or index:
//      at 10-50 tenants the scan is cheap, and a submission's files and its row are deleted
//      together, so the sum is always the truth.
//   5. Scanner = getFileScanner() (fail closed: "unavailable" hides upload fields; a scan
//      error refuses the file with the paused copy; "infected" refuses and stores nothing).
//
// Every visitor entry point takes a minted SiteContext; owner reads go through
// runFormsRead (content read, org-scoped). A foreign or unknown file id is NotFound.
import { NotFound } from "@cds/core";
import {
  FILE_UPLOAD_COPY,
  FORM_UPLOAD_TYPES,
  FormErrors,
  isFieldVisible,
  isFileAnswer,
  type FileAnswer,
  type FormAnswer,
  type FormDefinition,
  type FormUploadExt,
} from "@cds/core/forms";
import type PocketBase from "pocketbase";
import { withSuperuser } from "../client";
import { assertSiteContext, type SiteContext } from "../content/site-context";
import type { OrgContext } from "../context";
import {
  FORM_UPLOAD_MAX_BYTES,
  FORM_UPLOAD_ORG_MAX_BYTES,
  getObjectStore,
  getRangedObjectStore,
  tenantFormUploadKey,
  tenantFormUploadPrefix,
  type ObjectStore,
  type RangedObjectStore,
} from "../storage";
import { assertId, newRecordId } from "../repository";
import { getFileScanner, unavailableScanner } from "./scanner";
import type { FileScanner } from "./scanner-port";
import { formsProActive, loadFormForSubmit } from "./public";
import { FORMS, SUBMISSIONS, formFromRow, runFormsRead } from "./shared";

export { FORM_UPLOAD_TYPES };

/** Usage at or above this share of the 1 GB shows the owner warning (D234). */
export const FORM_UPLOAD_WARN_RATIO = 0.8;

const MAX_NAME = 120;

export type FormUploadFile = {
  /** The form field id the file was sent under. */
  field: string;
  name: string;
  /** The browser's claim; informational only (the detected type wins). */
  type: string;
  bytes: Uint8Array;
};

export type FormUploadLevel = "ok" | "warn" | "full";

export type FormUploadUsage = {
  usedBytes: number;
  limitBytes: number;
  level: FormUploadLevel;
  /** Any live form of the org has a File upload field (the Forms tab shows alerts only then). */
  hasFileFields: boolean;
};

export type UploadDeps = { scanner?: FileScanner; store?: ObjectStore };

type UploadType = (typeof FORM_UPLOAD_TYPES)[number];

// ---- type detection (choice 1) ----

function startsWith(
  bytes: Uint8Array,
  sig: readonly number[],
  at = 0,
): boolean {
  if (bytes.byteLength < at + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (bytes[at + i] !== sig[i]) return false;
  }
  return true;
}

function ascii(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function contains(bytes: Uint8Array, needle: string): boolean {
  const n = ascii(needle);
  const last = bytes.byteLength - n.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < n.length; j++) {
      if (bytes[i + j] !== n[j]) continue outer;
    }
    return true;
  }
  return false;
}

const HEIC_BRANDS = new Set(["heic", "heix", "mif1"]);

/** The type the bytes really are, or null. */
function sniff(bytes: Uint8Array): FormUploadExt | null {
  if (startsWith(bytes, ascii("%PDF"))) return "pdf";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, ascii("ftyp"), 4) && bytes.byteLength >= 12) {
    const brand = String.fromCharCode(...bytes.subarray(8, 12));
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "doc";
  }
  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    contains(bytes, "[Content_Types].xml") &&
    contains(bytes, "word/")
  ) {
    return "docx";
  }
  return null;
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The allowed type both the name and the bytes agree on, or null (refused). */
export function detectFormUploadType(
  name: string,
  bytes: Uint8Array,
): UploadType | null {
  const ext = extOf(name);
  const byName = FORM_UPLOAD_TYPES.find((t) =>
    (t.exts as readonly string[]).includes(ext),
  );
  if (!byName) return null;
  return sniff(bytes) === byName.ext ? byName : null;
}

/** A display name: no path, no control characters, at most 120 characters. */
function cleanName(raw: string, ext: string): string {
  const base = String(raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f-\u009f"]/g, "")
    .trim();
  if (base === "") return `file.${ext}`;
  if (base.length <= MAX_NAME) return base;
  const tail = `.${extOf(base)}`;
  return base.slice(0, MAX_NAME - tail.length) + tail;
}

// ---- usage (choice 4) ----

async function orgUploadBytes(pb: PocketBase, orgId: string): Promise<number> {
  const rows = await pb.collection(SUBMISSIONS).getFullList({
    filter: pb.filter("organization = {:org} && data ~ {:needle}", {
      org: orgId,
      needle: '"file_id"',
    }),
    fields: "data",
  });
  let total = 0;
  for (const r of rows) {
    const data = r.data;
    if (typeof data !== "object" || data === null) continue;
    for (const v of Object.values(data as Record<string, unknown>)) {
      if (isFileAnswer(v) && v.size > 0) total += v.size;
    }
  }
  return total;
}

function levelOf(used: number): FormUploadLevel {
  if (used >= FORM_UPLOAD_ORG_MAX_BYTES) return "full";
  if (used >= FORM_UPLOAD_ORG_MAX_BYTES * FORM_UPLOAD_WARN_RATIO) return "warn";
  return "ok";
}

function usageOf(used: number, hasFileFields: boolean): FormUploadUsage {
  return {
    usedBytes: used,
    limitBytes: FORM_UPLOAD_ORG_MAX_BYTES,
    level: levelOf(used),
    hasFileFields,
  };
}

async function orgHasFileFields(
  pb: PocketBase,
  orgId: string,
): Promise<boolean> {
  const rows = await pb.collection(FORMS).getFullList({
    filter: pb.filter("organization = {:org} && deleted_at = ''", {
      org: orgId,
    }),
    fields: "fields",
  });
  return rows.some(
    (r) =>
      Array.isArray(r.fields) &&
      (r.fields as { type?: unknown }[]).some((f) => f?.type === "file"),
  );
}

function isSite(x: unknown): x is SiteContext {
  try {
    assertSiteContext(x);
    return true;
  } catch {
    return false;
  }
}

/** Internal: usage for a system caller already holding a superuser client. */
export async function formUploadUsageFor(
  pb: PocketBase,
  orgId: string,
): Promise<FormUploadUsage> {
  const [used, hasFileFields] = await Promise.all([
    orgUploadBytes(pb, orgId),
    orgHasFileFields(pb, orgId),
  ]);
  return usageOf(used, hasFileFields);
}

/** The org's form-upload usage against its 1 GB (owner: content read; or a visitor's site). */
export function formUploadUsage(
  ctx: OrgContext | SiteContext,
): Promise<FormUploadUsage> {
  if (isSite(ctx)) {
    return withSuperuser((pb) => formUploadUsageFor(pb, ctx.orgId));
  }
  return runFormsRead(ctx, (pb) => formUploadUsageFor(pb, ctx.orgId));
}

/**
 * Internal: are upload fields offered right now? Builder Pro on, a real scanner configured
 * (the "unavailable" stand-in hides them, P7 fail closed) and the org under its 1 GB.
 */
export async function uploadsOpenFor(
  pb: PocketBase,
  orgId: string,
  deps: UploadDeps = {},
  known: { proActive?: boolean } = {},
): Promise<boolean> {
  const proActive = known.proActive ?? (await formsProActive(pb, orgId));
  if (!proActive) return false;
  if (scannerOf(deps).name === "unavailable") return false;
  return (await formUploadUsageFor(pb, orgId)).level !== "full";
}

function scannerOf(deps: UploadDeps): FileScanner {
  if (deps.scanner) return deps.scanner;
  try {
    return getFileScanner();
  } catch {
    // A misconfigured scanner is the fail-closed stand-in, never an open door.
    return unavailableScanner;
  }
}

/**
 * How many file fields of this form can take a file right now (0 when uploads are closed or
 * the form is unknown). The route sizes its body cap from it (choice 2).
 */
export async function formUploadSlots(
  site: SiteContext,
  formId: string,
  deps: UploadDeps = {},
): Promise<number> {
  assertSiteContext(site);
  if (typeof formId !== "string" || !/^[a-z0-9]{1,64}$/i.test(formId)) return 0;
  return withSuperuser(async (pb) => {
    const row = await loadFormForSubmit(pb, site.orgId, formId).catch(
      () => null,
    );
    if (!row) return 0;
    const n = formFromRow(row).fields.filter((f) => f.type === "file").length;
    if (n === 0) return 0;
    return (await uploadsOpenFor(pb, site.orgId, deps)) ? n : 0;
  });
}

// ---- accept (scan, store) ----

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/**
 * Internal core of acceptFormFiles, for submitForm (which already loaded the form). Returns
 * the answers by field id. Throws FormErrors keyed by field id (type, size, infected, paused,
 * full, required). Nothing is stored unless every file passes; a failed write removes what
 * was written.
 */
export async function storeFormFiles(
  pb: PocketBase,
  input: {
    orgId: string;
    formId: string;
    submissionId: string;
    def: FormDefinition;
    proActive: boolean;
    /** Validated answers, for Forms Pro visibility rules. */
    answers: Record<string, FormAnswer>;
    files: readonly FormUploadFile[];
  },
  deps: UploadDeps = {},
): Promise<Record<string, FileAnswer>> {
  const { orgId, formId, submissionId, def, proActive, answers } = input;
  assertId(formId);
  assertId(submissionId);
  // Without Builder Pro file fields are not accepted (D233): files are dropped, like P7.
  if (!proActive) return {};
  const rules = def.pro?.rules ?? [];
  const fileFields = def.fields.filter(
    (f) =>
      f.type === "file" &&
      (rules.length === 0 || isFieldVisible(rules, f.id, answers)),
  );
  if (fileFields.length === 0) return {};

  // One file per field; empty parts (a no-JS form with nothing chosen) are no file.
  const byField = new Map<string, FormUploadFile>();
  for (const f of input.files ?? []) {
    if (!f || typeof f.field !== "string" || !(f.bytes instanceof Uint8Array)) {
      continue;
    }
    if (f.bytes.byteLength === 0) continue;
    if (!fileFields.some((x) => x.id === f.field)) continue;
    if (!byField.has(f.field)) byField.set(f.field, f);
  }

  const scanner = scannerOf(deps);
  const open = scanner.name !== "unavailable";
  const errors: Record<string, string> = {};

  // File fields are always optional: the definition stores required = false for them (not
  // an INPUT_TYPE), which also suits D234 (the field disappears when uploads close).
  if (byField.size === 0) return {};
  const used = open ? await orgUploadBytes(pb, orgId) : 0;

  const checked: {
    field: string;
    name: string;
    type: UploadType;
    bytes: Uint8Array;
  }[] = [];
  for (const [field, f] of byField) {
    if (f.bytes.byteLength > FORM_UPLOAD_MAX_BYTES) {
      errors[field] = FILE_UPLOAD_COPY.size;
      continue;
    }
    const type = detectFormUploadType(String(f.name ?? ""), f.bytes);
    if (!type) {
      errors[field] = FILE_UPLOAD_COPY.type;
      continue;
    }
    checked.push({
      field,
      name: cleanName(f.name, type.ext),
      type,
      bytes: f.bytes,
    });
  }
  if (!open) {
    for (const c of checked) errors[c.field] = FILE_UPLOAD_COPY.paused;
  }
  if (Object.keys(errors).length > 0) throw new FormErrors(errors);

  // The org's 1 GB (D234): over it, refuse with the paused copy (the form hides the field).
  const incoming = checked.reduce((n, c) => n + c.bytes.byteLength, 0);
  if (used + incoming > FORM_UPLOAD_ORG_MAX_BYTES) {
    for (const c of checked) errors[c.field] = FILE_UPLOAD_COPY.paused;
    throw new FormErrors(errors);
  }

  // Scan every file before anything is written (T-10-38-01, fail closed).
  for (const c of checked) {
    let verdict: string;
    try {
      verdict = await scanner.scan(once(c.bytes));
    } catch {
      verdict = "error";
    }
    if (verdict === "infected") errors[c.field] = FILE_UPLOAD_COPY.infected;
    else if (verdict !== "clean") errors[c.field] = FILE_UPLOAD_COPY.paused;
  }
  if (Object.keys(errors).length > 0) throw new FormErrors(errors);

  const store = deps.store ?? getObjectStore();
  const written: string[] = [];
  const out: Record<string, FileAnswer> = {};
  try {
    for (const c of checked) {
      const fileId = newRecordId();
      const key = tenantFormUploadKey(
        orgId,
        formId,
        submissionId,
        fileId,
        c.type.ext,
      );
      await store.put(key, c.bytes, c.type.mime);
      written.push(key);
      out[c.field] = {
        file_id: fileId,
        name: c.name,
        size: c.bytes.byteLength,
        type: c.type.mime,
      };
    }
  } catch (err) {
    await Promise.all(
      written.map((k) => store.delete(k).catch(() => undefined)),
    );
    throw err;
  }
  return out;
}

/**
 * Check, scan and store a visitor's files for one submission (10-38 interface). Returns the
 * answers by field id; throws FormErrors (type, size, infected, paused, over the limit).
 */
export async function acceptFormFiles(
  site: SiteContext,
  formId: string,
  submissionId: string,
  files: readonly FormUploadFile[],
  deps: UploadDeps = {},
): Promise<Record<string, FileAnswer>> {
  assertSiteContext(site);
  assertId(formId);
  assertId(submissionId);
  return withSuperuser(async (pb) => {
    const row = await loadFormForSubmit(pb, site.orgId, formId);
    const proActive = await formsProActive(pb, site.orgId);
    return storeFormFiles(
      pb,
      {
        orgId: site.orgId,
        formId,
        submissionId,
        def: formFromRow(row),
        proActive,
        answers: {},
        files,
      },
      deps,
    );
  });
}

// ---- owner read and delete ----

export type FormFileRead = {
  name: string;
  type: string;
  size: number;
  stream: ReadableStream<Uint8Array>;
};

function extForMime(mime: string): FormUploadExt | null {
  return FORM_UPLOAD_TYPES.find((t) => t.mime === mime)?.ext ?? null;
}

/**
 * One stored file for the hub download route (content read; org-scoped). Another org's file,
 * an unknown id or a missing object are all NotFound (T-10-38-04).
 */
export function readFormFile(
  ctx: OrgContext,
  fileId: string,
  deps: { store?: RangedObjectStore } = {},
): Promise<FormFileRead> {
  return runFormsRead(ctx, async (pb) => {
    if (typeof fileId !== "string" || !/^[a-z0-9]{1,64}$/i.test(fileId)) {
      throw new NotFound();
    }
    const rows = await pb.collection(SUBMISSIONS).getFullList({
      filter: pb.filter("organization = {:org} && data ~ {:fid}", {
        org: ctx.orgId,
        fid: fileId,
      }),
      fields: "id,form,organization,data",
    });
    for (const r of rows) {
      if (r.organization !== ctx.orgId) continue;
      const data = r.data;
      if (typeof data !== "object" || data === null) continue;
      for (const v of Object.values(data as Record<string, unknown>)) {
        if (!isFileAnswer(v) || v.file_id !== fileId) continue;
        const ext = extForMime(v.type);
        if (!ext || typeof r.form !== "string") throw new NotFound();
        const key = tenantFormUploadKey(ctx.orgId, r.form, r.id, fileId, ext);
        const store = deps.store ?? getRangedObjectStore();
        const read = await store.readRange(key, null);
        if (!read) throw new NotFound();
        return {
          name: v.name,
          type: v.type,
          size: read.size,
          stream: read.stream,
        };
      }
    }
    throw new NotFound();
  });
}

/**
 * Delete every stored file of one submission (D234: kept until the submission is deleted).
 * Idempotent. The 10-38 interface sketched (pb, orgId, submissionId); the key layout needs the
 * form id, and no database read is involved.
 */
export async function deleteFormFiles(
  orgId: string,
  formId: string,
  submissionId: string,
  store: ObjectStore = getObjectStore(),
): Promise<number> {
  assertId(orgId);
  assertId(formId);
  assertId(submissionId);
  const prefix = `${tenantFormUploadPrefix(orgId)}${formId}/${submissionId}/`;
  const objects = await store.list(prefix);
  for (const o of objects) await store.delete(o.key);
  return objects.length;
}
