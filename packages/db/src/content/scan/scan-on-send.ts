// scanOnSend: the send-time scan seam for the v1.1 Newsletter (13-11; STAFF-25, D270).
// Unused in v1.0. A campaign is public content the moment it is sent, so it runs the same
// composite publish scan (text + image + link) as a page publish, through screen(): a thrown
// scan maps to `error` (D248), never a silent pass. The caller decides what `held` means for
// a send (refuse it); this seam only answers. Org context is required (invariant 1).
import { assertOrgContext, type OrgContext } from "../../context";
import type { ContentScanner } from "../ports";
import { screen, type ScanOutcome } from "../screen";
import { getContentScanner } from "../scan-standin";

export type CampaignScanInput = {
  subject: string;
  html: string;
  links: string[];
  images: string[];
};

export type ScanOnSendDeps = {
  /** Defaults to getContentScanner() (the composite publish scan). */
  scanner?: ContentScanner;
};

const MAX_ITEMS = 500;

const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === "string" && s !== "")
        .slice(0, MAX_ITEMS)
    : [];

export async function scanOnSend(
  ctx: OrgContext,
  campaign: CampaignScanInput,
  deps: ScanOnSendDeps = {},
): Promise<ScanOutcome> {
  assertOrgContext(ctx);
  const subject = typeof campaign?.subject === "string" ? campaign.subject : "";
  const html = typeof campaign?.html === "string" ? campaign.html : "";
  const texts = [subject, html].filter((t) => t !== "");
  const urls = strings(campaign?.links);
  const images = strings(campaign?.images);
  const scanner = deps.scanner ?? getContentScanner();
  // screen() keeps the D248 contract; the images ride on the scanner input.
  const withImages: ContentScanner = {
    scan: (input) =>
      scanner.scan({ ...input, images: images.map((url) => ({ url })) }),
  };
  return screen(ctx, { scanner: withImages }, texts, urls);
}
