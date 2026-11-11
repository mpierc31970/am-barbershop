// POST /_site/review/send on a preview host (14-35 choice 3; DOM-10, D172; T-14-35-01,
// T-14-35-02): the note page's no-JS form (fields `page`, `note`). It lives beside the note
// page, not in it: Next refuses a page.tsx and a route.ts in one segment. The request Origin
// must equal the preview host and `cds_rv` must give the owner's context (reviewPost, else
// 403). requestPageChange files a P12 change ticket (target `page:<id>`) and marks the page
// Needs a change, then 303 to the page with `?rs=sent` ("Sent. CDS will make the change and
// tell you."). Under 10 characters -> back to the note page with `e=short` (NOTE-SHORT; the
// short text comes back so nothing typed is lost); any other failure -> `e=send` (ERR-SEND).
import { InvalidInput } from "@cds/core";
import { P14_COPY } from "@cds/core/dns";
import { requestPageChange, reviewPages } from "@cds/db";
import {
  REVIEW_NOTE_PATH,
  REVIEW_PAGE_ID_RE,
  refuse,
  safeReviewPath,
  see303,
  withQuery,
} from "../../../../../../lib/review-mode";
import { field, reviewPost } from "../../../../../../lib/review-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

const NOTE_MIN = 10;

export async function POST(
  req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const guard = await reviewPost(req, host);
  if (guard instanceof Response) return guard;
  const { ctx, form } = guard;

  const pageField = field(form, "page");
  if (!REVIEW_PAGE_ID_RE.test(pageField)) return refuse(403);
  const note = field(form, "note");
  const notePage = (q: Record<string, string>) =>
    see303(withQuery(REVIEW_NOTE_PATH, { page: pageField, ...q }));
  if (note.length < NOTE_MIN) {
    return notePage(note ? { e: "short", n: note } : { e: "short" });
  }
  try {
    const page = (await reviewPages(ctx)).find((p) => p.id === pageField);
    if (!page) return refuse(403);
    await requestPageChange(ctx, page.id, note);
    return see303(withQuery(safeReviewPath(page.path) ?? "/", { rs: "sent" }));
  } catch (err) {
    if (err instanceof InvalidInput && err.message === P14_COPY.NOTE_SHORT) {
      return notePage({ e: "short" });
    }
    console.error(
      "[review] note failed",
      err instanceof Error ? err.name : typeof err,
    );
    return notePage({ e: "send" });
  }
}
