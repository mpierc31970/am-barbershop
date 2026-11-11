// POST /staff/api/domain/zone-file: a staff zone-file upload for a site's open domain move
// (14-51 choice 3; DOM-08, DOM-05; T-14-51-02, T-14-51-03). Multipart `org` + `file`.
// Order: same origin -> staff session -> `domains` feature (before the body is read) -> capped
// body read (256 KiB + multipart overhead; declared and real length) -> the file itself
// <= 256 KiB, read as UTF-8 text -> staffAddZoneFile (the same parsing and P14_COPY.ZONE_*
// errors as the owner upload; it re-checks the matrix and audits). Errors answer JSON
// `{ error: <copy> }`. Nothing here logs a file name, the file text, a domain or a host.
import { CdsError } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { P13_COPY } from "@cds/core/staff";
import { staffAddZoneFile } from "@cds/db";
import { SAVE_FAILED_COPY, toActionError } from "../../../../../../lib/action";
import { readCappedFormData } from "../../../../../../lib/capped-body";
import {
  json,
  MULTIPART_OVERHEAD,
  sameOrigin,
} from "../../../../../../lib/media-route";
import {
  errorName,
  isNextControlFlow,
} from "../../../../../../lib/staff-action";
import { getStaffSession, staffCan } from "../../../../../../lib/staff-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 256 KiB, the owner upload's cap (P14_COPY.ZONE_TOO_BIG). */
const STAFF_ZONE_FILE_MAX_BYTES = 256 * 1024;

const ORG_RE = /^[a-z0-9]{15}$/;
const NO_FILE = "Choose a zone file.";

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

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { error: P13_COPY.REFUSED_ROLE });
  let session;
  try {
    session = await getStaffSession();
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    console.error("[staff] zone file session read failed", errorName(err));
    return json(500, { error: SAVE_FAILED_COPY });
  }
  if (!session) return json(401, { error: P13_COPY.SESSION_ENDED });
  if (!staffCan(session.role, "domains")) {
    return json(403, { error: P13_COPY.REFUSED_ROLE });
  }

  let form: FormData | null;
  try {
    form = await readCappedFormData(
      req,
      STAFF_ZONE_FILE_MAX_BYTES + MULTIPART_OVERHEAD,
    );
  } catch {
    return json(400, { error: NO_FILE });
  }
  if (form === null) return json(413, { error: P14_COPY.ZONE_TOO_BIG });

  const org = form.get("org");
  const file = form.get("file");
  if (typeof org !== "string" || !ORG_RE.test(org)) {
    return json(404, { error: "That site wasn't found." });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return json(400, { error: NO_FILE });
  }
  if (file.size > STAFF_ZONE_FILE_MAX_BYTES) {
    return json(413, { error: P14_COPY.ZONE_TOO_BIG });
  }

  try {
    const text = await file.text();
    const move = await staffAddZoneFile(session.ctx, org, text);
    return json(200, {
      message: "Zone file added. The copy and gate run again.",
      code: move.code,
    });
  } catch (err) {
    if (!(err instanceof CdsError)) {
      console.error("[staff] zone file upload failed", errorName(err));
      return json(500, { error: SAVE_FAILED_COPY });
    }
    const failure = toActionError(err, {
      forbidden: P13_COPY.REFUSED_ROLE,
      impersonation: P13_COPY.REFUSED_ROLE,
    });
    return json(statusFor(failure.code), { error: failure.message });
  }
}
