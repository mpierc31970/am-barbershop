// POST /_site/review/mark on a preview host (14-35 choice 2; DOM-10, D172, D-UI-P14-12,
// D-UI-P14-13; T-14-35-01, T-14-35-02). The ReviewBar's no-JS form: fields `page` and `choice`
// (`looks_good | needs_change | phone`). The request Origin must equal the preview host
// (checked in reviewPost, else 403) and the `cds_rv` cookie must give the owner's context
// through reviewContextForToken (else 403).
//   - looks_good   -> markPage, 303 to the next page not yet Looks good with `?rs=marked&rp=<id>`
//                     ("Marked About us as looks good."); none left -> the same page `?rs=done`
//   - needs_change -> 303 to /_site/review/note?page=<id> (the note page files the ticket)
//   - phone        -> markPhoneCheck, 303 back to the page with `?rs=phone`
//   - any failure  -> 303 back to the page with `?rs=error` (ERR-SEND). Logs carry the class only.
import { markPage, markPhoneCheck, reviewPages } from "@cds/db";
import {
  REVIEW_NOTE_PATH,
  REVIEW_PAGE_ID_RE,
  nextUnreviewed,
  refuse,
  safeReviewPath,
  see303,
  withQuery,
  type ReviewChoice,
} from "../../../../../../lib/review-mode";
import { field, reviewPost } from "../../../../../../lib/review-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ host: string }> };

const CHOICES: readonly ReviewChoice[] = [
  "looks_good",
  "needs_change",
  "phone",
];

export async function POST(
  req: Request,
  { params }: Params,
): Promise<Response> {
  const { host } = await params;
  const guard = await reviewPost(req, host);
  if (guard instanceof Response) return guard;
  const { ctx, form } = guard;

  const choice = field(form, "choice") as ReviewChoice;
  if (!CHOICES.includes(choice)) return refuse(403);
  const pageField = field(form, "page");
  const pageId = REVIEW_PAGE_ID_RE.test(pageField) ? pageField : null;
  if (choice !== "phone" && pageId === null) return refuse(403);

  let back = "/";
  try {
    const pages = await reviewPages(ctx);
    const current = pageId ? pages.find((p) => p.id === pageId) : undefined;
    if (pageId && !current && choice !== "phone") return refuse(403);
    back = safeReviewPath(current?.path) ?? "/";

    if (choice === "needs_change") {
      return see303(withQuery(REVIEW_NOTE_PATH, { page: current!.id }));
    }
    if (choice === "phone") {
      await markPhoneCheck(ctx);
      return see303(withQuery(back, { rs: "phone" }));
    }
    await markPage(ctx, current!.id, "looks_good");
    const marked = pages.map((p) =>
      p.id === current!.id ? { ...p, status: "looks_good" as const } : p,
    );
    const next = nextUnreviewed(marked, current!.id);
    return next
      ? see303(
          withQuery(safeReviewPath(next.path) ?? "/", {
            rs: "marked",
            rp: current!.id,
          }),
        )
      : see303(withQuery(back, { rs: "done" }));
  } catch (err) {
    console.error(
      "[review] mark failed",
      err instanceof Error ? err.name : typeof err,
    );
    return see303(withQuery(back, { rs: "error" }));
  }
}
