// POST /staff/api/catalog/upload: one catalog screenshot per request (13-37 choice 1; STAFF-07,
// P13-P21; T-13-37-01, T-13-37-02). The Server Action body cap is 2 MB, so ScreenshotList
// posts each image here as multipart (`slug`, `alt`, `file`).
// Order: same origin -> staff session -> catalog_listings (before the body is read) -> capped
// body read (2 MB + multipart overhead; declared and real length) -> staffAddScreenshot, which
// checks the type by magic bytes, 2 MB, 6 per add-on and alt text, and writes through the
// platform ObjectStore at platform/catalog/<slug>/<id>.<ext>. Errors answer JSON
// `{ error: <copy> }`. Nothing here logs a file name, bytes or a key.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { CdsError } from "@cds/core";
import { P13_COPY } from "@cds/core/staff";
import { CATALOG_SCREENSHOT_MAX_BYTES, staffAddScreenshot } from "@cds/db";
import { SAVE_FAILED_COPY, toActionError } from "../../../../../../lib/action";
import { readCappedFormData } from "../../../../../../lib/capped-body";
import { toCatalogManifestInput } from "../../../../../../lib/catalog-view";
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

/** UI copy for the route's own refusals (the db's InvalidInput messages pass through). */
const CATALOG_UPLOAD_COPY = {
  tooBig: "Screenshots must be 2 MB or smaller.",
  noFile: "Choose an image file.",
} as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ALT_FIELD_MAX = 400;

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
    console.error("[staff] catalog upload session read failed", errorName(err));
    return json(500, { error: SAVE_FAILED_COPY });
  }
  if (!session) return json(401, { error: P13_COPY.SESSION_ENDED });
  if (!staffCan(session.role, "catalog_listings")) {
    return json(403, { error: P13_COPY.REFUSED_ROLE });
  }

  let form: FormData | null;
  try {
    form = await readCappedFormData(
      req,
      CATALOG_SCREENSHOT_MAX_BYTES + MULTIPART_OVERHEAD,
    );
  } catch {
    return json(400, { error: CATALOG_UPLOAD_COPY.noFile });
  }
  if (form === null) return json(413, { error: CATALOG_UPLOAD_COPY.tooBig });

  const slug = form.get("slug");
  const alt = form.get("alt");
  const file = form.get("file");
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return json(404, { error: "That add-on wasn't found." });
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return json(400, { error: CATALOG_UPLOAD_COPY.noFile });
  }
  if (file.size > CATALOG_SCREENSHOT_MAX_BYTES) {
    return json(413, { error: CATALOG_UPLOAD_COPY.tooBig });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const shot = await staffAddScreenshot(
      session.ctx,
      {
        slug,
        bytes,
        contentType: file.type || undefined,
        alt: typeof alt === "string" ? alt.slice(0, ALT_FIELD_MAX) : "",
      },
      ADDON_REGISTRY.list().map(toCatalogManifestInput),
    );
    return json(200, { screenshot: shot });
  } catch (err) {
    if (!(err instanceof CdsError)) {
      console.error("[staff] catalog upload failed", errorName(err));
      return json(500, { error: SAVE_FAILED_COPY });
    }
    const failure = toActionError(err, {
      forbidden: P13_COPY.REFUSED_ROLE,
      impersonation: P13_COPY.REFUSED_ROLE,
    });
    return json(statusFor(failure.code), { error: failure.message });
  }
}
