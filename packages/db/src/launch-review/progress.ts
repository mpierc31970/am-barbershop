// packages/db/src/launch-review/progress.ts (P14, DOM-10).
// Owner: 14-33 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// The launch review state behind org-stage.ts `launchReviewStore` (P11 stand-in replaced in
// 14-33, same signature): which of the six D172 items are done, and whether the review is
// open (stage ready_for_review: Today shows Continue review). Item ids are the P11
// LAUNCH_REVIEW_ITEMS ids. Callers pass an id they already scoped (launchReviewProgress passes
// its OrgContext's own id); an unknown or junk id reads as nothing done and unavailable.
import { ClientResponseError } from "pocketbase";
import { reviewFactsFor } from "./facts";

const ORG_ID = /^[a-z0-9]{15}$/;

export async function launchReviewState(
  orgId: string,
): Promise<{ done: ReadonlySet<string>; available: boolean }> {
  if (typeof orgId !== "string" || !ORG_ID.test(orgId)) {
    return { done: new Set<string>(), available: false };
  }
  try {
    const facts = await reviewFactsFor(orgId);
    return {
      done: facts.done,
      available: facts.stage === "ready_for_review",
    };
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) {
      return { done: new Set<string>(), available: false };
    }
    throw err;
  }
}
