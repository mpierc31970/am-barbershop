// Content ports (CONT-31, D248, D253, D270; CONTEXT A1-Q4, A3-Q4; RESEARCH Pattern 4).
//
// The content writers depend on three seams, never on a concrete service:
//   - ContentScanner  screens tenant text and URLs on save/publish. 13-08: a composite of
//                     TextChecker, ImageModerator and LinkChecker (content/scan/*), each with
//                     a free stand-in until GO-LIVE
//   - SearchPinger    tells search engines a URL changed (stand-in logs a count, GO-LIVE P14
//                     IndexNow row; CONT-16 is P14)
//   - Invalidator     drops cached renders by tag. apps/web passes one that calls Next's
//                     revalidateTag; @cds/db never imports next/* (RESEARCH anti-pattern).
// The composed section registry is injected the same way (DI, RESEARCH Pattern 3).
import type { AddonRegistry } from "@cds/core/addons";
import type { SectionRegistry } from "@cds/core/content";

export type ScanVerdict = "clean" | "unsure" | "held";

export type ScanInput = {
  orgId: string;
  texts: string[];
  urls: string[];
  /** 13-08: images to moderate (URL, plus the bytes when the caller already has them). */
  images?: { url: string; bytes?: Uint8Array }[];
};

export type ScanResult = { verdict: ScanVerdict; reasons: string[] };

export interface ContentScanner {
  scan(input: ScanInput): Promise<ScanResult>;
}

// ---- 13-08 (STAFF-23, D248, D295): the three sub-ports behind the composite scanner.
// `skipped` = no provider ran (stand-in); `unchecked` = the provider was not asked (budget cap).
// Neither changes the composite verdict; both only add reasons.
export type SubVerdict = "clean" | "unsure" | "held" | "skipped" | "unchecked";

export type SubResult = {
  verdict: SubVerdict;
  reasons: string[];
  provider: string;
};

/** Acceptable-use check over the texts (stand-in: the keyword lists). */
export interface TextChecker {
  name: string;
  check(input: ScanInput): Promise<SubResult>;
}

/** Image moderation (real: AWS Rekognition, GO-LIVE; stand-in: skipped). */
export interface ImageModerator {
  name: string;
  check(input: ScanInput): Promise<SubResult>;
}

/** Link reputation (real: Google Web Risk, GO-LIVE; stand-in: skipped). */
export interface LinkChecker {
  name: string;
  check(input: ScanInput): Promise<SubResult>;
}

/** 13-19 (STAFF-17, D190): what one ping did, recorded per site in `org_indexing`. */
export type PingResultKind = "logged" | "ok" | "error" | "skipped";

export type PingResult = { orgId: string; result: PingResultKind };

export interface SearchPinger {
  /**
   * Tell search engines the URLs changed. 13-19: returns the per-org result (the stand-in
   * answers `logged`). A pinger that returns nothing is read as `ok`; a throw as `error`.
   */
  ping(urls: string[], opts?: { orgId?: string }): Promise<PingResult | void>;
}

export interface Invalidator {
  invalidate(tags: string[]): void;
}

export type ContentDeps = {
  sections: SectionRegistry;
  invalidator: Invalidator;
  /** Defaults to getContentScanner() (the keyword stand-in). */
  scanner?: ContentScanner;
  /** Defaults to getSearchPinger() (the logging stand-in). */
  pinger?: SearchPinger;
  /** 07-31: used by the site index for add-on publicIndex hooks (CONT-37). */
  addons?: Pick<AddonRegistry, "list">;
};

/** Every cached render of the org's site (manifest, nav, all pages). */
export function siteTag(orgId: string): string {
  return `org:${orgId}:site`;
}

/** One published page's cached render. */
export function pageTag(orgId: string, pageId: string): string {
  return `org:${orgId}:page:${pageId}`;
}

/** Live records resolved at request time: banner and pop-ups (D253). */
export function liveTag(orgId: string): string {
  return `org:${orgId}:live`;
}

/** The org's installed add-on set (install, uninstall, re-enable). */
export function addonsTag(orgId: string): string {
  return `org:${orgId}:addons`;
}

/** One add-on's cached renders for an org. */
export function addonTag(orgId: string, slug: string): string {
  return `org:${orgId}:addon:${slug}`;
}

/** An Invalidator that only records the tags it was given (tests and CLI scripts). */
export function recordingInvalidator(): Invalidator & { tags: string[] } {
  const tags: string[] = [];
  return {
    tags,
    invalidate(next: string[]) {
      tags.push(...next);
    },
  };
}
