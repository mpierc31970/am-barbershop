"use server";
// Publish from the builder header and the preview strip (CONT-30; D254, D248; T-03-53,
// T-03-54, T-03-57). The tenant comes only from the session cookie via runAction. A held
// result is a success with reasons (the earlier published version stays live). Any other
// failure becomes the ERR-PUBLISH copy, so database error text never reaches the browser.
import { publishPage, type PublishResult } from "@cds/db";
import { runAction, type ActionResult } from "../../lib/action";
import { contentDeps } from "../../lib/content";

const ERR_PUBLISH =
  "Publishing didn't finish. Your draft is safe and your live page hasn't changed. Try again in a minute.";

/** Codes whose own copy is clearer than ERR-PUBLISH. */
const KEEP = new Set([
  "signed_out",
  "forbidden",
  "not_found",
  "agreement_required",
]);

export async function publishPageAction(
  pageId: string,
): Promise<ActionResult<PublishResult>> {
  const id = typeof pageId === "string" ? pageId : "";
  const res = await runAction((s) => publishPage(s.ctx, id, contentDeps()));
  if (!res.ok && !KEEP.has(res.code)) {
    return { ok: false, code: "publish_failed", message: ERR_PUBLISH };
  }
  return res;
}
