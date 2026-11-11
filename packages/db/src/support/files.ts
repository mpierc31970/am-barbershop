// Support files (COMM-04, COMM-08, D94; 12-07; P12-P1, P12-P3). Attachments on tickets and
// messages, and the objects behind CDS documents.
//
// Type check (choice 1): the extension allowlist AND the bytes must name the same type, else
// the file is refused. The stored and served MIME comes from the detection, never from the
// browser. Text and CSV have no magic number: they must decode as UTF-8 and hold no NUL.
// The sniff helpers repeat forms/uploads.ts's logic (not exported from forms on purpose).
//
// Flow (RESEARCH Pattern 6; the 2 MB Server Action cap forces a route, Pitfall 5):
//   1. stageSupportUpload: one file per request from /hub/api/support/upload. support:write
//      (impersonation refused by the MATRIX), 10 MB, type, the 50/day/org limiter, scan, then
//      the object goes to tenants/<org>/support/staging/<user>/<upload>.<ext>. The answer
//      carries a signed token (support-upload. HMAC over linkSecret()).
//   2. attachStagedUploads: the send path (12-12/12-15) verifies ≤ 5 tokens for this org and
//      actor (timing-safe), copies each object to threads/<thread>/<message>/<file>.<ext>,
//      creates the support_files rows and deletes the staging objects. A failure removes what
//      it wrote.
//   3. Scan states (P12-P3): clean, pending (the scanner could not answer; "Checking file",
//      tenants can't download it) or staff (CDS-authored, trusted). Infected is refused and
//      nothing is stored. support:run rescans pending files once a real scanner exists.
//   4. Downloads: mintSupportFileLink (support:read, this org, public message, not pending)
//      returns a 15-minute signed path; openSupportFile re-checks everything for the route.
//      A foreign id, a file on an internal note and a missing id are the same NotFound.
// Errors are logged by class name only; never names, keys or bodies.
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput, NotFound, authorizeStaff } from "@cds/core";
import type { TenantAttachment, ThreadFile } from "@cds/core/support";
import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { withSuperuser } from "../client";
import {
  assertOrgContext,
  assertPlatformContext,
  type OrgContext,
  type PlatformContext,
} from "../context";
import { linkSecret } from "../email/env";
import { getFileScanner, unavailableScanner } from "../forms/scanner";
import type { FileScanner } from "../forms/scanner-port";
import { beginSupportAction } from "../rate-limit";
import { assertId, newRecordId, requirePermission } from "../repository";
import {
  getObjectStore,
  tenantCdsDocumentKey,
  tenantSupportFileKey,
  tenantSupportPrefix,
  tenantSupportStagingKey,
  type ObjectStore,
  type RangedObjectStore,
} from "../storage";
import {
  SUPPORT_FILE_LINK_MS,
  SupportLinkExpired,
  supportFileLinkPath,
  supportFileLinkState,
} from "./links";

/** One file per request, at most 10 MB (CONTEXT Area 2, D94). */
export const SUPPORT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Files per message (CONTEXT Area 2). */
export const SUPPORT_FILES_PER_MESSAGE = 5;

export type SupportFileExt =
  | "png"
  | "jpg"
  | "webp"
  | "gif"
  | "pdf"
  | "txt"
  | "csv"
  | "docx"
  | "xlsx"
  | "pptx";

export type SupportFileType = Readonly<{
  ext: SupportFileExt;
  exts: readonly string[];
  mime: string;
}>;

export const SUPPORT_FILE_TYPES: readonly SupportFileType[] = Object.freeze([
  { ext: "png", exts: ["png"], mime: "image/png" },
  { ext: "jpg", exts: ["jpg", "jpeg"], mime: "image/jpeg" },
  { ext: "webp", exts: ["webp"], mime: "image/webp" },
  { ext: "gif", exts: ["gif"], mime: "image/gif" },
  { ext: "pdf", exts: ["pdf"], mime: "application/pdf" },
  { ext: "txt", exts: ["txt"], mime: "text/plain" },
  { ext: "csv", exts: ["csv"], mime: "text/csv" },
  {
    ext: "docx",
    exts: ["docx"],
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    ext: "xlsx",
    exts: ["xlsx"],
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    ext: "pptx",
    exts: ["pptx"],
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
] as const);

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

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function isOoxml(bytes: Uint8Array, dir: string): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    contains(bytes, "[Content_Types].xml") &&
    contains(bytes, dir)
  );
}

/** Do the bytes really hold this type? */
function bytesAre(ext: SupportFileExt, bytes: Uint8Array): boolean {
  switch (ext) {
    case "png":
      return startsWith(
        bytes,
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      );
    case "jpg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "webp":
      return (
        startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)
      );
    case "gif":
      return (
        startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))
      );
    case "pdf":
      return startsWith(bytes, ascii("%PDF"));
    case "txt":
    case "csv":
      return isUtf8Text(bytes);
    case "docx":
      return isOoxml(bytes, "word/");
    case "xlsx":
      return isOoxml(bytes, "xl/");
    case "pptx":
      return isOoxml(bytes, "ppt/");
  }
}

function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** The allowed type both the name and the bytes agree on, or null (refused). */
export function detectSupportFileType(
  name: string,
  bytes: Uint8Array,
): SupportFileType | null {
  if (typeof name !== "string" || !(bytes instanceof Uint8Array)) return null;
  const ext = extOf(name);
  const byName = SUPPORT_FILE_TYPES.find((t) => t.exts.includes(ext));
  if (!byName) return null;
  return bytesAre(byName.ext, bytes) ? byName : null;
}

/** The type for a stored extension (rows keep `ext`), or null. */
export function supportFileTypeOf(ext: string): SupportFileType | null {
  return SUPPORT_FILE_TYPES.find((t) => t.ext === ext) ?? null;
}

const MAX_NAME = 120;

/** A display name: no path, no control characters or quotes, at most 120 characters. */
export function cleanSupportFileName(raw: string, ext: string): string {
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

// ---------------------------------------------------------------------------------------
// Errors, deps, shared helpers

/** Over 10 MB (route: 413 FILE-TOO-BIG). */
export class SupportFileTooLarge extends InvalidInput {
  override readonly code: string = "file_too_big";
}

/** Not an allowed type (route: 415 FILE-TYPE). */
export class SupportFileRefused extends InvalidInput {
  override readonly code: string = "file_type";
}

/**
 * The scanner refused the file (route: 422 FILE-REFUSED). Its own code so the owner is not
 * told to "use a PDF" about the PDF that was flagged (review IN-B01).
 */
export class SupportFileInfected extends SupportFileRefused {
  override readonly code: string = "file_refused";
}

/** Choice 6: a tenant asks for a file that is still "Checking file". */
export const SUPPORT_FILE_PENDING_COPY =
  "This file is still being checked. Try again later.";

export type SupportFileDeps = {
  scanner?: FileScanner;
  store?: ObjectStore;
  now?: Date;
};

const FILES = "support_files";
const MESSAGES = "support_messages";
const DOCUMENTS = "cds_documents";
const ID_RE = /^[a-z0-9]{15}$/;

function scannerOf(deps: SupportFileDeps): FileScanner {
  if (deps.scanner) return deps.scanner;
  try {
    return getFileScanner();
  } catch {
    // A misconfigured scanner is the fail-closed stand-in, never an open door.
    return unavailableScanner;
  }
}

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

async function scanVerdict(
  scanner: FileScanner,
  bytes: Uint8Array,
): Promise<"clean" | "infected" | "error"> {
  try {
    return await scanner.scan(once(bytes));
  } catch {
    return "error";
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function logFailure(what: string, err: unknown): void {
  console.error(
    `[support-files] ${what}: ${err instanceof Error ? err.name : typeof err}`,
  );
}

/** Size and type rules shared by every writer. Returns the detected type. */
function checkFile(name: unknown, bytes: unknown): SupportFileType {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw new SupportFileRefused("empty file");
  }
  if (bytes.byteLength > SUPPORT_FILE_MAX_BYTES) {
    throw new SupportFileTooLarge("file is larger than 10 MB");
  }
  const type = detectSupportFileType(String(name ?? ""), bytes);
  if (!type) throw new SupportFileRefused("file type not allowed");
  return type;
}

function attachmentOf(r: RecordModel): TenantAttachment {
  const scan = r.scan === "clean" || r.scan === "staff" ? r.scan : "pending";
  return {
    id: r.id,
    name: str(r.name),
    size: typeof r.size === "number" ? r.size : 0,
    mime: str(r.mime),
    scan,
  };
}

// ---------------------------------------------------------------------------------------
// Staging tokens (choice 2): base64url(JSON payload) + "." + base64url(HMAC-SHA256(
// linkSecret(), "support-upload.<payload>")). The payload names org, actor, upload id, size,
// mime, ext, scan and the cleaned name; nothing in it is trusted until the MAC matches.

type UploadClaim = {
  o: string;
  a: string;
  u: string;
  n: string;
  s: number;
  m: string;
  e: SupportFileExt;
  c: "clean" | "pending";
};

const TOKEN_RE = /^([A-Za-z0-9_-]{1,800})\.([A-Za-z0-9_-]{43})$/;

function uploadMac(payload: string): Buffer {
  return createHmac("sha256", linkSecret())
    .update(`support-upload.${payload}`)
    .digest();
}

function signUpload(claim: UploadClaim): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${uploadMac(payload).toString("base64url")}`;
}

/** The claim for this org and actor, or null (tampered, foreign, malformed). */
function readUpload(token: unknown, ctx: OrgContext): UploadClaim | null {
  if (typeof token !== "string") return null;
  const m = TOKEN_RE.exec(token);
  if (!m) return null;
  const [, payload, sig] = m as unknown as [string, string, string];
  const given = Buffer.from(sig, "base64url");
  if (given.toString("base64url") !== sig) return null;
  const expected = uploadMac(payload);
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;
  let c: Partial<UploadClaim>;
  try {
    c = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Partial<UploadClaim>;
  } catch {
    return null;
  }
  if (typeof c !== "object" || c === null) return null;
  if (c.o !== ctx.orgId || c.a !== ctx.actor) return null;
  if (typeof c.u !== "string" || !ID_RE.test(c.u)) return null;
  const type = typeof c.e === "string" ? supportFileTypeOf(c.e) : null;
  if (!type || c.m !== type.mime) return null;
  if (c.c !== "clean" && c.c !== "pending") return null;
  if (
    typeof c.s !== "number" ||
    !Number.isSafeInteger(c.s) ||
    c.s <= 0 ||
    c.s > SUPPORT_FILE_MAX_BYTES
  ) {
    return null;
  }
  if (typeof c.n !== "string" || c.n === "") return null;
  return c as UploadClaim;
}

// ---------------------------------------------------------------------------------------
// Stage (choice 2)

export type StagedSupportUpload = {
  uploadId: string;
  name: string;
  size: number;
  mime: string;
  scan: "clean" | "pending";
  token: string;
};

/**
 * Check, scan and stage one file for a member about to send a message. Throws Forbidden
 * (viewer), ImpersonationDenied, SupportFileTooLarge, SupportFileRefused (type),
 * SupportFileInfected (scanner)
 * or RateLimited (RATE-UPLOADS).
 */
export async function stageSupportUpload(
  ctx: OrgContext,
  input: { name: string; bytes: Uint8Array },
  deps: SupportFileDeps = {},
): Promise<StagedSupportUpload> {
  requirePermission(ctx, "support", "write");
  const type = checkFile(input?.name, input?.bytes);
  beginSupportAction("upload", { orgId: ctx.orgId, actorId: ctx.actor });
  const bytes = input.bytes;
  const verdict = await scanVerdict(scannerOf(deps), bytes);
  if (verdict === "infected") {
    throw new SupportFileInfected("file refused by the scanner");
  }
  const scan = verdict === "clean" ? "clean" : "pending";
  const uploadId = newRecordId();
  const name = cleanSupportFileName(input.name, type.ext);
  const store = deps.store ?? getObjectStore();
  await store.put(
    tenantSupportStagingKey(ctx.orgId, ctx.actor, uploadId, type.ext),
    bytes,
    type.mime,
  );
  const token = signUpload({
    o: ctx.orgId,
    a: ctx.actor,
    u: uploadId,
    n: name,
    s: bytes.byteLength,
    m: type.mime,
    e: type.ext,
    c: scan,
  });
  return {
    uploadId,
    name,
    size: bytes.byteLength,
    mime: type.mime,
    scan,
    token,
  };
}

// ---------------------------------------------------------------------------------------
// Attach (choice 3)

async function loadMessage(
  pb: PocketBase,
  orgId: string,
  threadId: string,
  messageId: string,
): Promise<RecordModel> {
  assertId(threadId);
  assertId(messageId);
  const row = await pb
    .collection(MESSAGES)
    .getFirstListItem(
      pb.filter("id = {:m} && organization = {:org} && thread = {:t}", {
        m: messageId,
        org: orgId,
        t: threadId,
      }),
    )
    .catch(() => null);
  if (!row) throw new NotFound();
  return row;
}

/**
 * Attach up to 5 staged uploads to a message of this org (called inside 12-12/12-15's write
 * path with their superuser client). Returns the attachments summary for the message row.
 */
export async function attachStagedUploads(
  pb: PocketBase,
  ctx: OrgContext,
  input: { threadId: string; messageId: string; tokens: readonly string[] },
  deps: { store?: ObjectStore } = {},
): Promise<TenantAttachment[]> {
  requirePermission(ctx, "support", "write");
  const tokens = Array.isArray(input?.tokens) ? input.tokens : [];
  if (tokens.length === 0) return [];
  if (tokens.length > SUPPORT_FILES_PER_MESSAGE) {
    throw new InvalidInput("at most 5 files per message");
  }
  const claims: UploadClaim[] = [];
  for (const t of tokens) {
    const c = readUpload(t, ctx);
    if (!c) throw new InvalidInput("invalid upload");
    if (claims.some((x) => x.u === c.u)) {
      throw new InvalidInput("duplicate upload");
    }
    claims.push(c);
  }
  await loadMessage(pb, ctx.orgId, input.threadId, input.messageId);

  const store = deps.store ?? getObjectStore();
  const staged: { claim: UploadClaim; key: string; bytes: Uint8Array }[] = [];
  for (const c of claims) {
    const key = tenantSupportStagingKey(ctx.orgId, ctx.actor, c.u, c.e);
    const bytes = await store.get(key);
    if (!bytes || bytes.byteLength !== c.s) {
      throw new InvalidInput("upload expired");
    }
    if (detectSupportFileType(`file.${c.e}`, bytes)?.ext !== c.e) {
      throw new SupportFileRefused("file type not allowed");
    }
    staged.push({ claim: c, key, bytes });
  }

  const written: string[] = [];
  const rows: string[] = [];
  const out: TenantAttachment[] = [];
  try {
    for (const { claim: c, bytes } of staged) {
      const fileId = newRecordId();
      const key = tenantSupportFileKey(
        ctx.orgId,
        input.threadId,
        input.messageId,
        fileId,
        c.e,
      );
      await store.put(key, bytes, c.m);
      written.push(key);
      const row = await pb.collection(FILES).create({
        id: fileId,
        organization: ctx.orgId,
        thread: input.threadId,
        message: input.messageId,
        name: c.n,
        size: c.s,
        mime: c.m,
        ext: c.e,
        scan: c.c,
        author_kind: "member",
        // Members only ever post public messages (12-REVIEW CR-A02).
        visibility: "public",
        object_key: key,
      });
      rows.push(row.id);
      out.push(attachmentOf(row));
    }
  } catch (err) {
    logFailure("attach", err);
    await Promise.all([
      ...written.map((k) => store.delete(k).catch(() => undefined)),
      ...rows.map((id) =>
        pb
          .collection(FILES)
          .delete(id)
          .catch(() => undefined),
      ),
    ]);
    throw err;
  }
  await Promise.all(
    staged.map((s) => store.delete(s.key).catch(() => undefined)),
  );
  return out;
}

// ---------------------------------------------------------------------------------------
// Staff files (choice 4)

/**
 * A CDS-authored attachment on a message (support:reply CLI): same type and size rules,
 * `scan: "staff"` (P12-P3), author_kind staff. `visibility` is the message's (12-REVIEW
 * CR-A02); when omitted it is read from the stored message.
 */
export async function staffStoreSupportFile(
  ctx: PlatformContext,
  input: {
    orgId: string;
    threadId: string;
    messageId: string;
    name: string;
    bytes: Uint8Array;
    visibility?: "public" | "internal";
  },
  deps: { store?: ObjectStore } = {},
): Promise<TenantAttachment> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_reply");
  assertId(input?.orgId);
  const type = checkFile(input.name, input.bytes);
  const name = cleanSupportFileName(input.name, type.ext);
  const store = deps.store ?? getObjectStore();
  return withSuperuser(async (pb) => {
    const message = await loadMessage(
      pb,
      input.orgId,
      input.threadId,
      input.messageId,
    );
    const visibility =
      input.visibility === "public" || input.visibility === "internal"
        ? input.visibility
        : message.visibility === "public"
          ? "public"
          : "internal";
    const fileId = newRecordId();
    const key = tenantSupportFileKey(
      input.orgId,
      input.threadId,
      input.messageId,
      fileId,
      type.ext,
    );
    await store.put(key, input.bytes, type.mime);
    try {
      const row = await pb.collection(FILES).create({
        id: fileId,
        organization: input.orgId,
        thread: input.threadId,
        message: input.messageId,
        name,
        size: input.bytes.byteLength,
        mime: type.mime,
        ext: type.ext,
        scan: "staff",
        author_kind: "staff",
        visibility,
        object_key: key,
      });
      return attachmentOf(row);
    } catch (err) {
      logFailure("staff store", err);
      await store.delete(key).catch(() => undefined);
      throw err;
    }
  });
}

export type CdsDocumentObject = {
  object_key: string;
  size: number;
  mime: string;
  ext: SupportFileExt;
  filename: string;
};

/**
 * The object behind a CDS document (12-16 creates the cds_documents row with `docId`). Same
 * type and size rules; written to tenants/<org>/support/documents/<doc>.<ext>.
 */
export async function staffStoreCdsDocumentObject(
  ctx: PlatformContext,
  input: { orgId: string; docId: string; name: string; bytes: Uint8Array },
  deps: { store?: ObjectStore } = {},
): Promise<CdsDocumentObject> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "cds_post");
  assertId(input?.orgId);
  if (typeof input.docId !== "string" || !ID_RE.test(input.docId)) {
    throw new InvalidInput("invalid document id");
  }
  const type = checkFile(input.name, input.bytes);
  await withSuperuser(async (pb) => {
    await pb
      .collection("organizations")
      .getOne(input.orgId, { fields: "id" })
      .catch(() => {
        throw new NotFound();
      });
  });
  const key = tenantCdsDocumentKey(input.orgId, input.docId, type.ext);
  const store = deps.store ?? getObjectStore();
  await store.put(key, input.bytes, type.mime);
  return {
    object_key: key,
    size: input.bytes.byteLength,
    mime: type.mime,
    ext: type.ext,
    filename: cleanSupportFileName(input.name, type.ext),
  };
}

// ---------------------------------------------------------------------------------------
// Lookup, links, opening (choice 6)

type FoundFile = {
  orgId: string;
  key: string;
  ext: string;
  filename: string;
  scan: "clean" | "pending" | "staff";
};

/**
 * A tenant-visible file of this org: a support_files row on a public message, or a
 * non-removed cds_documents row. Null otherwise (the caller throws one NotFound).
 */
async function findTenantFile(
  pb: PocketBase,
  orgId: string,
  id: string,
): Promise<FoundFile | null> {
  const file = await pb
    .collection(FILES)
    .getFirstListItem(
      pb.filter(
        "id = {:id} && organization = {:org} && message.visibility = 'public'",
        { id, org: orgId },
      ),
    )
    .catch(() => null);
  if (file) return foundOf(file, str(file.name));
  const doc = await pb
    .collection(DOCUMENTS)
    .getFirstListItem(
      pb.filter("id = {:id} && organization = {:org} && removed_at = ''", {
        id,
        org: orgId,
      }),
    )
    .catch(() => null);
  if (doc)
    return { ...foundOf(doc, str(doc.filename)), scan: "staff" as const };
  return null;
}

function foundOf(r: RecordModel, filename: string): FoundFile {
  const scan = r.scan === "clean" || r.scan === "staff" ? r.scan : "pending";
  return {
    orgId: str(r.organization),
    key: str(r.object_key),
    ext: str(r.ext),
    filename,
    scan,
  };
}

/**
 * A 15-minute signed path to one of this org's files (Documents "Download", minted on
 * click). A foreign, internal or missing id is NotFound; a pending file is InvalidInput.
 */
export async function mintSupportFileLink(
  ctx: OrgContext,
  id: string,
  deps: { now?: Date } = {},
): Promise<string> {
  requirePermission(ctx, "support", "read");
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  const found = await withSuperuser((pb) => findTenantFile(pb, ctx.orgId, id));
  if (!found) throw new NotFound();
  if (found.scan === "pending") {
    throw new InvalidInput(SUPPORT_FILE_PENDING_COPY);
  }
  const now = (deps.now ?? new Date()).getTime();
  return supportFileLinkPath(id, now + SUPPORT_FILE_LINK_MS);
}

export type OpenedSupportFile = {
  stream: ReadableStream<Uint8Array>;
  mime: string;
  size: number;
  filename: string;
  /** True only for detected image types (served inline). */
  inline: boolean;
};

function isRanged(store: ObjectStore): store is RangedObjectStore {
  return typeof (store as RangedObjectStore).readRange === "function";
}

async function openObject(
  store: ObjectStore,
  key: string,
): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  if (isRanged(store)) {
    const read = await store.readRange(key, null);
    return read ? { stream: read.stream, size: read.size } : null;
  }
  const bytes = await store.get(key);
  if (!bytes) return null;
  return {
    stream: new ReadableStream({
      start(c) {
        if (bytes.length > 0) c.enqueue(bytes);
        c.close();
      },
    }),
    size: bytes.length,
  };
}

async function openFound(
  found: FoundFile,
  store: ObjectStore,
): Promise<OpenedSupportFile> {
  const type = supportFileTypeOf(found.ext);
  if (!type || !found.key.startsWith(tenantSupportPrefix(found.orgId))) {
    throw new NotFound();
  }
  const read = await openObject(store, found.key);
  if (!read) throw new NotFound();
  return {
    stream: read.stream,
    mime: type.mime,
    size: read.size,
    filename: cleanSupportFileName(found.filename, type.ext),
    inline: type.mime.startsWith("image/"),
  };
}

/**
 * For the download route: support:read in this org (never impersonating), a valid signed
 * link, a tenant-visible file of this org that is not pending. A genuine but expired link is
 * SupportLinkExpired; everything else is one NotFound.
 */
export async function openSupportFile(
  ctx: OrgContext,
  id: string,
  link: { exp: unknown; sig: unknown },
  deps: { store?: ObjectStore; now?: Date } = {},
): Promise<OpenedSupportFile> {
  assertOrgContext(ctx);
  if (ctx.impersonator) throw new NotFound();
  requirePermission(ctx, "support", "read");
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  const now = (deps.now ?? new Date()).getTime();
  const state = supportFileLinkState(id, link?.exp, link?.sig, now);
  if (state === "expired") {
    throw new SupportLinkExpired("this download link has expired");
  }
  if (state !== "valid") throw new NotFound();
  const found = await withSuperuser((pb) => findTenantFile(pb, ctx.orgId, id));
  if (!found || found.scan === "pending") throw new NotFound();
  return openFound(found, deps.store ?? getObjectStore());
}

/**
 * Staff triage (CONTEXT Area 2): any support file or CDS document by id, pending and
 * internal included. The CLI prints the org; the bytes are never logged.
 */
export async function staffOpenSupportFile(
  ctx: PlatformContext,
  id: string,
  deps: { store?: ObjectStore } = {},
): Promise<OpenedSupportFile & { orgId: string }> {
  assertPlatformContext(ctx);
  authorizeStaff(ctx.staffRole, "support_read");
  if (typeof id !== "string" || !ID_RE.test(id)) throw new NotFound();
  const found = await withSuperuser(async (pb) => {
    const file = await pb
      .collection(FILES)
      .getOne(id)
      .catch(() => null);
    if (file) return foundOf(file, str(file.name));
    const doc = await pb
      .collection(DOCUMENTS)
      .getOne(id)
      .catch(() => null);
    if (doc)
      return { ...foundOf(doc, str(doc.filename)), scan: "staff" as const };
    return null;
  });
  if (!found || !found.orgId) throw new NotFound();
  const opened = await openFound(found, deps.store ?? getObjectStore());
  return { ...opened, orgId: found.orgId };
}

// ---------------------------------------------------------------------------------------
// Documents list (choice 7)

export const THREAD_FILES_PAGE = 50;

/**
 * Files from this org's tickets and messages (public messages only), newest first.
 * `from`: all, cds (staff-authored) or you (members). `before`: an ISO `created` cursor.
 */
export async function listThreadFiles(
  ctx: OrgContext,
  opts: {
    from?: "all" | "cds" | "you";
    limit?: number;
    before?: string;
    /** IN-C07 / 12-REVIEW IN-A02: the id of the row `before` came from (same-ms tie-break). */
    beforeId?: string;
  } = {},
): Promise<ThreadFile[]> {
  requirePermission(ctx, "support", "read");
  const limit = Math.min(
    Math.max(Math.trunc(Number(opts.limit) || THREAD_FILES_PAGE), 1),
    100,
  );
  return withSuperuser(async (pb) => {
    let filter = pb.filter(
      "organization = {:org} && message.visibility = 'public'",
      { org: ctx.orgId },
    );
    if (opts.from === "cds") filter += " && author_kind = 'staff'";
    else if (opts.from === "you") filter += " && author_kind = 'member'";
    if (typeof opts.before === "string" && opts.before !== "") {
      const t = new Date(opts.before);
      if (Number.isNaN(t.getTime())) throw new InvalidInput("invalid cursor");
      const before = t.toISOString().replace("T", " ");
      const beforeId = opts.beforeId;
      if (beforeId !== undefined && beforeId !== "") {
        if (typeof beforeId !== "string" || !ID_RE.test(beforeId)) {
          throw new InvalidInput("invalid cursor");
        }
        filter +=
          " && " +
          pb.filter(
            "(created < {:before} || (created = {:before} && id < {:id}))",
            { before, id: beforeId },
          );
      } else {
        filter += " && " + pb.filter("created < {:before}", { before });
      }
    }
    const res = await pb.collection(FILES).getList(1, limit, {
      filter,
      sort: "-created,-id",
      expand: "thread",
    });
    return res.items.map((r) => {
      const thread = (r.expand as { thread?: RecordModel } | undefined)?.thread;
      const number =
        thread && thread.kind === "ticket" && typeof thread.number === "number"
          ? thread.number
          : null;
      return {
        ...attachmentOf(r),
        threadId: str(r.thread),
        ticketNumber: number && number > 0 ? number : null,
        authorKind: r.author_kind === "staff" ? "staff" : "member",
        created: str(r.created),
      } satisfies ThreadFile;
    });
  });
}

// ---------------------------------------------------------------------------------------
// Job helpers (choice 8; called by support:run, 12-31)

export type RescanResult = {
  /** True when no real scanner is configured (nothing was checked). */
  skipped: boolean;
  checked: number;
  clean: number;
  infected: number;
  /** Still pending (scanner error or missing object). */
  failed: number;
};

/** Rescan pending tenant files once a real scanner answers. Infected files are removed. */
export async function jobRescanPendingFiles(
  deps: { scanner?: FileScanner; store?: ObjectStore; limit?: number } = {},
): Promise<RescanResult> {
  const scanner = scannerOf(deps);
  const result: RescanResult = {
    skipped: false,
    checked: 0,
    clean: 0,
    infected: 0,
    failed: 0,
  };
  if (scanner.name === "unavailable") return { ...result, skipped: true };
  const store = deps.store ?? getObjectStore();
  const limit = Math.min(Math.max(deps.limit ?? 200, 1), 500);
  await withSuperuser(async (pb) => {
    const rows = await pb.collection(FILES).getList(1, limit, {
      filter: "scan = 'pending'",
      sort: "created",
    });
    for (const r of rows.items) {
      result.checked += 1;
      try {
        const key = str(r.object_key);
        const orgId = str(r.organization);
        if (!orgId || !key.startsWith(tenantSupportPrefix(orgId))) {
          result.failed += 1;
          continue;
        }
        const bytes = await store.get(key);
        if (!bytes) {
          result.failed += 1;
          continue;
        }
        const verdict = await scanVerdict(scanner, bytes);
        if (verdict === "clean") {
          await pb.collection(FILES).update(r.id, { scan: "clean" });
          await patchSummary(pb, str(r.message), r.id, "clean");
          result.clean += 1;
        } else if (verdict === "infected") {
          await store.delete(key);
          await pb.collection(FILES).delete(r.id);
          await patchSummary(pb, str(r.message), r.id, null);
          result.infected += 1;
        } else {
          result.failed += 1;
        }
      } catch (err) {
        logFailure("rescan", err);
        result.failed += 1;
      }
    }
  });
  return result;
}

/** Keep the message's attachments summary in step: new scan state, or drop the file. */
async function patchSummary(
  pb: PocketBase,
  messageId: string,
  fileId: string,
  scan: "clean" | null,
): Promise<void> {
  if (!messageId) return;
  const msg = await pb
    .collection(MESSAGES)
    .getOne(messageId, { fields: "id,attachments" })
    .catch(() => null);
  if (!msg || !Array.isArray(msg.attachments)) return;
  const list = msg.attachments as Record<string, unknown>[];
  if (!list.some((a) => a?.id === fileId)) return;
  const next =
    scan === null
      ? list.filter((a) => a?.id !== fileId)
      : list.map((a) => (a?.id === fileId ? { ...a, scan } : a));
  await pb.collection(MESSAGES).update(messageId, { attachments: next });
}

export const SUPPORT_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Delete staged uploads older than 24 hours (never sent). */
export async function jobPruneStagedUploads(
  now: Date = new Date(),
  deps: { store?: ObjectStore } = {},
): Promise<{ deleted: number }> {
  const store = deps.store ?? getObjectStore();
  const cutoff = now.getTime() - SUPPORT_STAGING_MAX_AGE_MS;
  const orgs = await withSuperuser((pb) =>
    pb.collection("organizations").getFullList({ fields: "id" }),
  );
  let deleted = 0;
  for (const o of orgs) {
    let objects;
    try {
      objects = await store.list(`${tenantSupportPrefix(o.id)}staging/`);
    } catch (err) {
      logFailure("prune list", err);
      continue;
    }
    for (const obj of objects) {
      if (obj.lastModified.getTime() >= cutoff) continue;
      await store.delete(obj.key).catch((err: unknown) => {
        logFailure("prune delete", err);
      });
      deleted += 1;
    }
  }
  return { deleted };
}
