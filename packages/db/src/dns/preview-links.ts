// packages/db/src/dns/preview-links.ts (P14, DOM-07, D22, D57, D172).
// Owner: 14-16 (14-EXECUTOR-BRIEF "Module seams"). Filled by that plan; nobody else edits it.
//
// Two short-lived signed tokens for the preview host (`<slug>.sites.<platform>`):
//   preview.  v1.<org>.<page>.<expMs>.<mac>            one page's draft, 60 minutes
//   review.   v1.<org>.<member>.<mode>.<expMs>.<mac>   review mode (D172), 60 minutes
// mac = base64url(HMAC-SHA256(linkSecret(), "<purpose>.<fields>.<exp>")). The purpose prefix
// keeps these MACs apart from every other link signed with the same secret (`rating.`,
// `support-file.`, `cds-host.` never verify here, and the reverse). The review token is carried
// in a host-only cookie on the preview host, never the hub session cookie (Invariant 10).
// Verification is strict, timing-safe and never throws (rating-links shape).
//
// mintPreviewLink (added by 14-20, the consumer) authorizes, finds the preview host and audits.
// previewPageForLink renders the draft through `previewPage` (draftRows + projectPublishedPage)
// under a read-only context for the token's org only; it never reads the 60 s site cache.
import { createHmac, timingSafeEqual } from "node:crypto";
import { InvalidInput, NotFound } from "@cds/core";
import type { PublishedPage, SectionRegistry } from "@cds/core/content";
import { ClientResponseError } from "pocketbase";
import { appendAudit } from "../audit";
import { withSuperuser } from "../client";
import { previewPage } from "../content/project";
import { mintOrgContext, type OrgContext } from "../context";
import { linkSecret } from "../email/env";
import { requirePermission } from "../repository";

/** How long a preview link lasts (D22: 60 minutes). */
export const PREVIEW_LINK_MS = 60 * 60 * 1000;
/** How long a review token lasts (D172: 60 minutes, refreshed by the hub). */
export const REVIEW_LINK_MS = 60 * 60 * 1000;

export type ReviewMode = "review" | "phone";

const ID_RE = /^[a-z0-9]{15}$/;
const EXP_RE = /^\d{1,15}$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;
const MODES: readonly ReviewMode[] = ["review", "phone"];

function isMode(v: unknown): v is ReviewMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

function nowMs(now: Date | number): number {
  const t = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t)) throw new InvalidInput("now must be a valid date");
  return t;
}

function mac(message: string): Buffer {
  return createHmac("sha256", linkSecret()).update(message).digest();
}

function assertId(id: unknown, what: string): asserts id is string {
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new InvalidInput(`invalid ${what} id`);
  }
}

/** Parses exp + sig and compares the MAC; null when malformed or tampered. Never throws. */
function checkMac(
  message: (exp: number) => string,
  expRaw: string | undefined,
  sig: string | undefined,
): number | null {
  if (typeof expRaw !== "string" || !EXP_RE.test(expRaw)) return null;
  if (typeof sig !== "string" || !SIG_RE.test(sig)) return null;
  const expiresAt = Number(expRaw);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) return null;
  const given = Buffer.from(sig, "base64url");
  if (given.toString("base64url") !== sig) return null;
  let expected: Buffer;
  try {
    expected = mac(message(expiresAt));
  } catch {
    return null;
  }
  if (given.length !== expected.length) return null;
  if (!timingSafeEqual(given, expected)) return null;
  return expiresAt;
}

// ------------------------------------------------------------------ preview. tokens

export type PreviewTokenResult =
  | { status: "valid"; orgId: string; pageId: string; expiresAt: number }
  | { status: "expired" | "invalid" };

const previewMessage = (orgId: string, pageId: string, exp: number) =>
  `preview.${orgId}.${pageId}.${exp}`;

/** A 60-minute draft link token for one org page. */
export function signPreviewToken(
  orgId: string,
  pageId: string,
  now: Date | number = Date.now(),
): string {
  assertId(orgId, "org");
  assertId(pageId, "page");
  const exp = nowMs(now) + PREVIEW_LINK_MS;
  const sig = mac(previewMessage(orgId, pageId, exp)).toString("base64url");
  return `v1.${orgId}.${pageId}.${exp}.${sig}`;
}

/** "valid", "expired" (untampered, past expiry) or "invalid" (anything else). Never throws. */
export function verifyPreviewToken(
  token: unknown,
  now: Date | number = Date.now(),
): PreviewTokenResult {
  if (typeof token !== "string" || token.length > 200) {
    return { status: "invalid" };
  }
  const parts = token.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return { status: "invalid" };
  const [, orgId, pageId, expRaw, sig] = parts;
  if (!orgId || !ID_RE.test(orgId) || !pageId || !ID_RE.test(pageId)) {
    return { status: "invalid" };
  }
  const expiresAt = checkMac(
    (exp) => previewMessage(orgId, pageId, exp),
    expRaw,
    sig,
  );
  if (expiresAt === null) return { status: "invalid" };
  const t = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t)) return { status: "invalid" };
  if (expiresAt <= t) return { status: "expired" };
  return { status: "valid", orgId, pageId, expiresAt };
}

// ------------------------------------------------------------------ review. tokens

export type ReviewTokenResult =
  | {
      status: "valid";
      orgId: string;
      memberId: string;
      mode: ReviewMode;
      expiresAt: number;
    }
  | { status: "expired" | "invalid" };

const reviewMessage = (
  orgId: string,
  memberId: string,
  mode: ReviewMode,
  exp: number,
) => `review.${orgId}.${memberId}.${mode}.${exp}`;

/** A 60-minute review-mode token (D172) for one member of one org. */
export function signReviewToken(
  orgId: string,
  memberId: string,
  mode: ReviewMode,
  now: Date | number = Date.now(),
): string {
  assertId(orgId, "org");
  assertId(memberId, "member");
  if (!isMode(mode)) throw new InvalidInput("invalid review mode");
  const exp = nowMs(now) + REVIEW_LINK_MS;
  const sig = mac(reviewMessage(orgId, memberId, mode, exp)).toString(
    "base64url",
  );
  return `v1.${orgId}.${memberId}.${mode}.${exp}.${sig}`;
}

/** "valid", "expired" (untampered, past expiry) or "invalid" (anything else). Never throws. */
export function verifyReviewToken(
  token: unknown,
  now: Date | number = Date.now(),
): ReviewTokenResult {
  if (typeof token !== "string" || token.length > 200) {
    return { status: "invalid" };
  }
  const parts = token.split(".");
  if (parts.length !== 6 || parts[0] !== "v1") return { status: "invalid" };
  const [, orgId, memberId, mode, expRaw, sig] = parts;
  if (!orgId || !ID_RE.test(orgId) || !memberId || !ID_RE.test(memberId)) {
    return { status: "invalid" };
  }
  if (!isMode(mode)) return { status: "invalid" };
  const expiresAt = checkMac(
    (exp) => reviewMessage(orgId, memberId, mode, exp),
    expRaw,
    sig,
  );
  if (expiresAt === null) return { status: "invalid" };
  const t = typeof now === "number" ? now : now.getTime();
  if (!Number.isFinite(t)) return { status: "invalid" };
  if (expiresAt <= t) return { status: "expired" };
  return { status: "valid", orgId, memberId, mode, expiresAt };
}

// ------------------------------------------------------------------ draft reader

/**
 * A read-only system OrgContext for one org (viewer: `content` read only, no write feature).
 * Private to this file: only `previewPage` receives it (choice 2).
 */
function readOnlyOrgContext(orgId: string): OrgContext {
  return mintOrgContext({
    orgId,
    actor: "",
    role: "viewer",
    grants: [],
    systemJob: "preview-link",
    ip: "system:preview-link",
  });
}

export type PreviewLinkResult =
  { status: "draft"; page: PublishedPage } | { status: "expired" | "invalid" };

/**
 * The draft of the token's page, for the preview host only. The token's org must equal the
 * resolved site's org (else "invalid"); a deleted or missing page is "invalid". Reads the
 * draft rows directly (never the site cache), so callers must send `Cache-Control: no-store`.
 */
export async function previewPageForLink(
  site: { orgId: string },
  token: string,
  registry: SectionRegistry,
  now: Date | number = Date.now(),
): Promise<PreviewLinkResult> {
  const v = verifyPreviewToken(token, now);
  if (v.status !== "valid") return { status: v.status };
  if (
    !site ||
    typeof site.orgId !== "string" ||
    !ID_RE.test(site.orgId) ||
    site.orgId !== v.orgId
  ) {
    return { status: "invalid" };
  }
  try {
    const page = await previewPage(
      readOnlyOrgContext(v.orgId),
      v.pageId,
      registry,
    );
    return { status: "draft", page };
  } catch (err) {
    if (err instanceof NotFound) return { status: "invalid" };
    throw err;
  }
}

// ------------------------------------------------------------------ minting (14-20)

export type MintedPreviewLink = {
  /** The org's preview hostname (`kind = preview` row), never a custom host. */
  host: string;
  token: string;
  expiresAt: number;
};

/**
 * 14-20 (DOM-07, D22): a 60-minute draft link for one page of the caller's own org.
 * Anyone who can edit content (Owner/Admin/Editor) may mint one; allowed while impersonating
 * (audited with the impersonator). The page must be the org's and not in Recently deleted.
 * The host is the org's `kind = preview` org_hosts row (InvalidInput when none). Audited as
 * `preview.link_minted` with the page id (T-14-20-04).
 */
export async function mintPreviewLink(
  ctx: OrgContext,
  pageId: string,
  now: Date | number = Date.now(),
): Promise<MintedPreviewLink> {
  requirePermission(ctx, "content", "write");
  assertId(pageId, "page");
  const at = nowMs(now);
  const host = await withSuperuser(async (pb) => {
    try {
      const page = await pb.collection("pages").getFirstListItem(
        pb.filter("id = {:id} && organization = {:org}", {
          id: pageId,
          org: ctx.orgId,
        }),
        { fields: "id,deleted_at" },
      );
      if (typeof page.deleted_at === "string" && page.deleted_at !== "") {
        throw new NotFound();
      }
    } catch (err) {
      if (err instanceof ClientResponseError && err.status === 404) {
        throw new NotFound();
      }
      throw err;
    }
    const rows = await pb.collection("org_hosts").getList(1, 1, {
      filter: pb.filter("organization = {:org} && kind = 'preview'", {
        org: ctx.orgId,
      }),
      sort: "-primary,created,id",
      fields: "hostname",
    });
    const h = rows.items[0]?.hostname;
    return typeof h === "string" ? h : "";
  });
  if (!host) {
    throw new InvalidInput("Your preview address isn't ready yet.");
  }
  const token = signPreviewToken(ctx.orgId, pageId, at);
  await appendAudit(ctx, {
    action: "preview.link_minted",
    targetCollection: "pages",
    targetId: pageId,
  });
  return { host, token, expiresAt: at + PREVIEW_LINK_MS };
}
