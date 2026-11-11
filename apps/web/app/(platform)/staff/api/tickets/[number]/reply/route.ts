// POST /staff/api/tickets/<number>/reply: a staff reply or internal note WITH files (13-41
// choice 4; STAFF-08, P13-P20; T-13-41-02, T-13-41-03). The Server Action body cap is 2 MB, so
// the composer posts multipart here when files are attached (replies without files use
// staffReplyAction). Fields: `body`, `internal` ("1" | "true"), `status` (optional), `file`
// (repeated, ≤ 5, ≤ 10 MB each: the P12 limits; ≤ 20 MB in all, WR-C01: the middleware buffers
// a request body up to 22 MB (next.config.ts middlewareClientMaxBodySize) and silently cuts off
// the rest, so a larger reply could never arrive whole).
// Order: same origin -> staff session -> support_reply (before the body is read) -> ticket
// number -> capped body read (declared and real length) -> field checks -> staffReplyToTicket
// with in-memory files (stored `scan: "staff"`, P12-P3; type checked by content in @cds/db).
// Answers JSON `{ message, messageId, raised, statusFrom, statusTo }` (the CLI result line) or
// `{ error: <copy> }`. Nothing here logs a body, a file name or bytes.
import { CdsError } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import {
  isTicketStatus,
  parseTicketNumber,
  statusLabel,
  type TicketStatus,
} from "@cds/core/support";
import {
  SUPPORT_FILE_MAX_BYTES,
  SUPPORT_FILES_PER_MESSAGE,
  staffReplyToTicket,
  staffSupportLabels,
  type PlatformContext,
  type StaffReplyInput,
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

/** Room for the text fields on top of the files. */
const FIELDS_ALLOWANCE = 64 * 1024;
/** All files in one reply (WR-C01): below the 22 MB middleware body buffer. */
const STAFF_REPLY_FILES_MAX_BYTES = 20 * 1024 * 1024;
const STAFF_REPLY_MAX_BYTES =
  STAFF_REPLY_FILES_MAX_BYTES + FIELDS_ALLOWANCE + MULTIPART_OVERHEAD;
const MAX_BODY = 10_000;

const STAFF_REPLY_ROUTE_COPY = {
  tooBig:
    "Files must be 10 MB or smaller, up to 20 MB in one reply, 5 at most.",
  tooMany: "Attach up to 5 files at a time.",
  bad: "That reply couldn't be read. Try again.",
  tooLong: "That message is too long.",
  status: "Choose a status from the list.",
  notFound: "That ticket wasn't found.",
} as const;
const R = STAFF_REPLY_ROUTE_COPY;

// CLI result lines (support-reply.ts), as staffReplyAction words them.
const INTERNAL_SAVED = "Saved as an internal note. The owner never sees it.";

function alerts(n: number): string {
  return `${n} alert${n === 1 ? "" : "s"} raised`;
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

async function businessOf(
  ctx: PlatformContext,
  orgId: string,
): Promise<string> {
  try {
    const labels = await staffSupportLabels(ctx, { orgIds: [orgId] });
    return labels.orgs[orgId]?.trim() || "The owner";
  } catch (err) {
    console.error("[staff reply] business name read failed", errorName(err));
    return "The owner";
  }
}

function numberOf(raw: string): number | null {
  try {
    return parseTicketNumber(decodeURIComponent(raw).trim());
  } catch {
    return null;
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ number: string }> },
): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: P13_COPY.REFUSED_ROLE });
  let session;
  try {
    session = await getStaffSession();
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    console.error("[staff reply] session read failed", errorName(err));
    return json(500, { error: SAVE_FAILED_COPY });
  }
  if (!session) return json(401, { error: P13_COPY.SESSION_ENDED });
  if (!staffCan(session.role, "support_reply")) {
    return json(403, { error: P13_COPY.REFUSED_ROLE });
  }

  const number = numberOf((await params).number);
  if (number === null) return json(404, { error: R.notFound });

  let form: FormData | null;
  try {
    form = await readCappedFormData(req, STAFF_REPLY_MAX_BYTES);
  } catch {
    return json(400, { error: R.bad });
  }
  if (form === null) return json(413, { error: R.tooBig });

  const rawBody = form.get("body");
  const body = typeof rawBody === "string" ? rawBody : "";
  if (body.length > MAX_BODY) return json(400, { error: R.tooLong });
  const internalRaw = form.get("internal");
  const internal = internalRaw === "1" || internalRaw === "true";
  const statusRaw = form.get("status");
  let status: TicketStatus | undefined;
  if (typeof statusRaw === "string" && statusRaw !== "") {
    if (!isTicketStatus(statusRaw)) return json(400, { error: R.status });
    status = statusRaw;
  }
  const blobs = form
    .getAll("file")
    .filter((f): f is File => f instanceof Blob && f.size > 0) as File[];
  if (blobs.length > SUPPORT_FILES_PER_MESSAGE) {
    return json(400, { error: R.tooMany });
  }
  if (
    blobs.some((f) => f.size > SUPPORT_FILE_MAX_BYTES) ||
    blobs.reduce((n, f) => n + f.size, 0) > STAFF_REPLY_FILES_MAX_BYTES
  ) {
    return json(413, { error: R.tooBig });
  }

  try {
    const files = await Promise.all(
      blobs.map(async (f) => ({
        name: typeof f.name === "string" ? f.name : "",
        bytes: new Uint8Array(await f.arrayBuffer()),
      })),
    );
    const input: StaffReplyInput = { number, internal, files };
    if (body.trim() !== "") input.body = body;
    if (status !== undefined) input.status = status;
    const r = await staffReplyToTicket(session.ctx, input);
    const moved = r.statusTo !== r.statusFrom;
    const message = internal
      ? moved
        ? `${INTERNAL_SAVED} Status ${statusLabel(r.statusFrom)} → ${statusLabel(r.statusTo)}; ${alerts(r.raised)}.`
        : INTERNAL_SAVED
      : `Sent. ${await businessOf(session.ctx, r.orgId)} sees it in the hub; ${alerts(r.raised)}.`;
    try {
      revalidatePath("/staff", "layout");
    } catch (err) {
      console.error("[staff reply] revalidate failed", errorName(err));
    }
    return json(200, {
      message,
      messageId: r.messageId,
      raised: r.raised,
      statusFrom: r.statusFrom,
      statusTo: r.statusTo,
    });
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    if (!(err instanceof CdsError)) {
      console.error("[staff reply] reply failed", errorName(err));
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
