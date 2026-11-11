"use server";
// Settings › Legal section 2 actions (09-23; AGR-08; D217, D287; CONTEXT A5-Q3, A5-Q4;
// T-09-23-01, -02, -04). Public POST endpoints: every argument is untrusted. The org, the
// role and impersonation come only from the session cookie via runAction; the chokepoint
// enforces owner-only `legal_ack:run` (impersonation-denied) for publish and reviews. The IP
// is the trusted-hop one from the session helper. Logs carry codes only, never tenant text.
//
// Publish revalidates the /hub layout (badges, "Legal · 1") and the tenant's live cache tag,
// so /privacy, /terms and the footer links appear at once (09-22 caches them 60 s).
// Preview (09-23 choice 1) returns sanitised HTML for one page; when the caller is the Owner
// signed in as themselves it also records a review, which clears ADDON-CHANGED. Admins and
// staff only preview.
import { ADDON_REGISTRY } from "@cds/addon-registry/server";
import { InvalidInput } from "@cds/core";
import { sanitizeLegalHtml } from "@cds/core/content/sanitize";
import {
  acknowledgeSitePolicies,
  addonsTag,
  liveTag,
  previewSitePolicy,
  recordSitePolicyReview,
} from "@cds/db";
import { revalidatePath, revalidateTag } from "next/cache";
import { runAction, type ActionResult } from "../../lib/action";
import * as hubSession from "../../lib/session";

const PUBLISH_COPY = {
  forbidden: "Only the site owner can publish these pages.",
  impersonation:
    "You're viewing as support staff, so publishing is turned off. Only the owner can publish these pages.",
};
const ERR_PUBLISH =
  "We couldn't publish your policy pages. Nothing changed on your site. Try again in a minute.";
const MISSING_INPUTS =
  "Add your legal business name and a privacy contact email first, in Setup › Domain & the rest. Your policy pages use them.";
const UNKNOWN_PAGE = "That policy page doesn't exist. Reload and try again.";

type Page = "privacy" | "terms";

function pageOf(raw: unknown): Page {
  if (raw !== "privacy" && raw !== "terms") {
    throw new InvalidInput(UNKNOWN_PAGE);
  }
  return raw;
}

function refresh(orgId: string): void {
  try {
    revalidatePath("/hub", "layout");
    revalidateTag(liveTag(orgId));
    revalidateTag(addonsTag(orgId));
  } catch (err) {
    console.error(
      "[legal] revalidate failed",
      err instanceof Error ? err.name : typeof err,
    );
  }
}

/** Acknowledge and publish both policy pages (owner only; D217). */
export async function publishSitePoliciesAction(): Promise<
  ActionResult<{ templateVersion: number; ackedAt: string }>
> {
  let orgId = "";
  const res = await runAction(async (s) => {
    orgId = s.ctx.orgId;
    const ip = await hubSession.clientIp();
    return acknowledgeSitePolicies(s.ctx, ADDON_REGISTRY, { ip });
  }, PUBLISH_COPY);
  if (res.ok) {
    refresh(orgId);
    return res;
  }
  if (res.code === "site_policy_inputs_missing") {
    return { ok: false, code: res.code, message: MISSING_INPUTS };
  }
  if (res.code === "forbidden" || res.code === "impersonation_denied") {
    return res;
  }
  if (res.code === "signed_out" || res.code === "agreement_required") {
    return res;
  }
  return { ok: false, code: res.code, message: ERR_PUBLISH };
}

/** One page at the latest template version, sanitised, for the Preview drawer. */
export async function previewSitePolicyAction(
  page: Page,
): Promise<ActionResult<{ title: string; html: string }>> {
  const res = await runAction(async (s) => {
    const p = pageOf(page);
    const rendered = await previewSitePolicy(s.ctx, ADDON_REGISTRY, p);
    if (s.ctx.role === "owner" && !s.ctx.impersonator) {
      try {
        const ip = await hubSession.clientIp();
        await recordSitePolicyReview(s.ctx, ADDON_REGISTRY, { ip });
      } catch (err) {
        // The preview still opens; ADDON-CHANGED stays until the next Preview.
        console.error(
          "[legal] site policy review failed",
          err instanceof Error ? err.name : typeof err,
        );
      }
    }
    return {
      title: String(rendered.title ?? ""),
      html: sanitizeLegalHtml(String(rendered.html ?? "")),
    };
  });
  if (!res.ok && res.code === "site_policy_inputs_missing") {
    return { ok: false, code: res.code, message: MISSING_INPUTS };
  }
  return res;
}
