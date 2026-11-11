"use server";
// Builder "Open on your preview address" / "Copy preview link" (14-20 choice 1; DOM-07, D22,
// D57; T-14-20-03, T-14-20-04). A POST Server Action (never a GET mint): the org comes only
// from the session (runAction); the page id is narrowed to a record id. @cds/db
// mintPreviewLink checks content write (Owner/Admin/Editor; allowed while impersonating),
// that the page is the org's, finds the org's `kind = preview` host (never the custom host),
// signs the 60-minute `preview.` token (signPreviewToken) and audits `preview.link_minted`.
// The URL points at the preview host's /_site/preview landing, which swaps the token for the
// host-only cds_pv cookie: the hub session cookie never crosses hosts (Invariant 10).
// Production is https; elsewhere http on the hub request's port (`*.sites.localhost:3000`).
import { InvalidInput } from "@cds/core";
import { mintPreviewLink } from "@cds/db";
import { headers } from "next/headers";
import { runAction, type ActionResult } from "../../lib/action";

const RECORD_ID = /^[a-z0-9]{15}$/;

export type PreviewLink = { url: string; expiresAt: number };

/** The scheme and port for links to tenant hosts from this hub request. */
async function originParts(): Promise<{ scheme: string; port: string }> {
  if (process.env.CDS_ENV === "production") {
    return { scheme: "https", port: "" };
  }
  const host = (await headers()).get("host") ?? "";
  const m = /:(\d{1,5})$/.exec(host);
  return { scheme: "http", port: m ? `:${m[1]}` : "" };
}

export async function mintPreviewLinkAction(
  pageId: unknown,
): Promise<ActionResult<PreviewLink>> {
  return runAction(async ({ ctx }) => {
    if (typeof pageId !== "string" || !RECORD_ID.test(pageId)) {
      throw new InvalidInput(
        "This page couldn't be found. Reload and try again.",
      );
    }
    const link = await mintPreviewLink(ctx, pageId);
    const { scheme, port } = await originParts();
    return {
      url: `${scheme}://${link.host}${port}/_site/preview?t=${encodeURIComponent(link.token)}`,
      expiresAt: link.expiresAt,
    };
  });
}
