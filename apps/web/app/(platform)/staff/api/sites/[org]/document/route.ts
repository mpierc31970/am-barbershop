// POST /staff/api/sites/<org>/document: share a document with one site (13-43 choice 3;
// STAFF-19 console side of `cds:post --document`; COMM-04; T-13-43-03). The Server Action
// body cap is 2 MB, so the Post to site dialog posts multipart here for the Document kind.
// Fields: `title` (1-120), `note` (optional, up to 500), `file` (exactly one, 10 MB).
// Order: same origin -> staff session -> cds_post (before the body is read) -> org id ->
// capped body read (declared and real length) -> field checks -> staffShareDocument (the
// function the CLI calls; it checks the type by content, stores the object and writes the
// row + audit row in one batch, then alerts Owners, Admins and Editors).
// Answers JSON `{ message, id, raised }` (the CLI result line) or `{ error, code? }`.
// Nothing here logs a body, a title, a file name or bytes.
import { CdsError } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import {
  CDS_DOCUMENT_NOTE_MAX,
  CDS_DOCUMENT_TITLE_MAX,
  SUPPORT_FILE_MAX_BYTES,
  staffShareDocument,
} from "@cds/db";
import { revalidatePath } from "next/cache";
import {
  SAVE_FAILED_COPY,
  toActionError,
} from "../../../../../../../lib/action";
import { readCappedFormData } from "../../../../../../../lib/capped-body";
import {
  json,
  MULTIPART_OVERHEAD,
  sameOrigin,
} from "../../../../../../../lib/media-route";
import {
  errorName,
  isNextControlFlow,
} from "../../../../../../../lib/staff-action";
import {
  getStaffSession,
  staffCan,
} from "../../../../../../../lib/staff-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORG_RE = /^[a-z0-9]{15}$/;
/** Room for the text fields on top of the file. */
const FIELDS_ALLOWANCE = 16 * 1024;
const STAFF_DOCUMENT_MAX_BYTES =
  SUPPORT_FILE_MAX_BYTES + FIELDS_ALLOWANCE + MULTIPART_OVERHEAD;

const STAFF_DOCUMENT_ROUTE_COPY = {
  tooBig: "The file must be 10 MB or smaller.",
  bad: "That document couldn't be read. Try again.",
  noFile: "Choose a file to share.",
  oneFile: "Share one file at a time.",
  title: `Give the document a title of up to ${CDS_DOCUMENT_TITLE_MAX} characters.`,
  note: `Keep the note to ${CDS_DOCUMENT_NOTE_MAX} characters.`,
  notFound: "That site wasn't found.",
} as const;
const R = STAFF_DOCUMENT_ROUTE_COPY;

function people(n: number): string {
  return `${n} ${n === 1 ? "person" : "people"}`;
}

function statusFor(code: string): number {
  switch (code) {
    case "invalid_input":
      return 400;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    default:
      return 500;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ org: string }> },
): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: P13_COPY.REFUSED_ROLE });
  let session;
  try {
    session = await getStaffSession();
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    console.error("[staff document] session read failed", errorName(err));
    return json(500, { error: SAVE_FAILED_COPY });
  }
  if (!session) return json(401, { error: P13_COPY.SESSION_ENDED });
  if (!staffCan(session.role, "cds_post")) {
    return json(403, { error: P13_COPY.REFUSED_ROLE });
  }

  const org = (await params).org;
  if (typeof org !== "string" || !ORG_RE.test(org)) {
    return json(404, { error: R.notFound });
  }

  let form: FormData | null;
  try {
    form = await readCappedFormData(req, STAFF_DOCUMENT_MAX_BYTES);
  } catch {
    return json(400, { error: R.bad });
  }
  if (form === null) return json(413, { error: R.tooBig });

  const titleRaw = form.get("title");
  const title =
    typeof titleRaw === "string" ? titleRaw.replace(/\s+/g, " ").trim() : "";
  if (title === "" || title.length > CDS_DOCUMENT_TITLE_MAX) {
    return json(400, { error: R.title, field: "title" });
  }
  const noteRaw = form.get("note");
  const note = typeof noteRaw === "string" ? noteRaw.trim() : "";
  if (note.length > CDS_DOCUMENT_NOTE_MAX) {
    return json(400, { error: R.note, field: "note" });
  }
  const files = form
    .getAll("file")
    .filter((f): f is File => f instanceof Blob && f.size > 0) as File[];
  if (files.length === 0) return json(400, { error: R.noFile, field: "file" });
  if (files.length > 1) return json(400, { error: R.oneFile, field: "file" });
  const file = files[0]!;
  if (file.size > SUPPORT_FILE_MAX_BYTES) {
    return json(413, { error: R.tooBig, field: "file" });
  }

  try {
    const r = await staffShareDocument(session.ctx, {
      orgId: org,
      title,
      ...(note ? { note } : {}),
      filename: typeof file.name === "string" ? file.name : "",
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    try {
      revalidatePath(`/staff/sites/${org}`);
    } catch (err) {
      console.error("[staff document] revalidate failed", errorName(err));
    }
    return json(200, {
      message: `Posted. Bell and email (logged) for ${people(r.raised)}.`,
      id: r.id,
      raised: r.raised,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    if (!(err instanceof CdsError)) {
      console.error("[staff document] share failed", errorName(err));
      return json(500, { error: P13_COPY.ERR_SEND });
    }
    const failure =
      err.code === "not_found"
        ? { code: "not_found", message: R.notFound }
        : toActionError(err, {
            forbidden: P13_COPY.REFUSED_ROLE,
            impersonation: P13_COPY.REFUSED_ROLE,
          });
    return json(statusFor(failure.code), {
      error: failure.message,
      code: failure.code,
    });
  }
}
