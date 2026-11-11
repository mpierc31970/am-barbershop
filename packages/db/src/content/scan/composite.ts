// Composite publish scan (13-08 choice 5; STAFF-23, D248; RESEARCH Pattern 5).
//
// Runs the TextChecker, ImageModerator and LinkChecker with Promise.allSettled; the worst
// verdict wins: held > unsure > error > clean. A rejected sub-check is `error` naming its
// provider. `skipped` / `unchecked` sub-results add reasons but never change the verdict.
// `error` (with nothing held or unsure) is thrown as Error("scanner unavailable: …") so
// screen()'s existing catch maps it to verdict `error` (the ContentScanner contract is
// unchanged: it only ever returns clean / unsure / held).
//
// Checkers default to the env getters, resolved when the composite is built, so an unknown
// CDS_TEXT_CHECKER / CDS_IMAGE_MODERATOR / CDS_LINK_CHECKER throws at first use (T-13-08-04).
import type {
  ContentScanner,
  ImageModerator,
  LinkChecker,
  ScanInput,
  ScanResult,
  SubResult,
  TextChecker,
} from "../ports";
import { getImageModerator } from "./image";
import { getLinkChecker } from "./link";
import { getTextChecker, keywordTextChecker } from "./text";

export type CompositeDeps = {
  text?: TextChecker;
  image?: ImageModerator;
  link?: LinkChecker;
};

type Slot = "text" | "image" | "link";

const MAX_REASONS = 20;

function note(slot: Slot, r: SubResult): string[] {
  const reasons = Array.isArray(r.reasons) ? r.reasons : [];
  if (r.verdict === "skipped") {
    return reasons.map((x) => `${slot} check skipped: ${x}`);
  }
  return reasons;
}

// Composites whose text check is the keyword stand-in (12-REVIEW WR-A07: callers such as
// submitIdea hold every item for staff while only the keyword list guards the text).
const keywordTextComposites = new WeakSet<ContentScanner>();

/** True when `scanner` is a composite whose text check is the keyword stand-in. */
export function usesKeywordTextStandIn(scanner: ContentScanner): boolean {
  return keywordTextComposites.has(scanner);
}

export function compositeScanner(deps: CompositeDeps = {}): ContentScanner {
  const checkers: [Slot, TextChecker | ImageModerator | LinkChecker][] = [
    ["text", deps.text ?? getTextChecker()],
    ["image", deps.image ?? getImageModerator()],
    ["link", deps.link ?? getLinkChecker()],
  ];
  const scanner: ContentScanner = {
    async scan(input: ScanInput): Promise<ScanResult> {
      const settled = await Promise.allSettled(
        checkers.map(([, c]) => c.check(input)),
      );
      const held: string[] = [];
      const unsure: string[] = [];
      const notes: string[] = [];
      const failed: string[] = [];
      let anyHeld = false;
      let anyUnsure = false;
      settled.forEach((s, i) => {
        const [slot, checker] = checkers[i]!;
        if (s.status === "rejected") {
          const why =
            s.reason instanceof Error ? s.reason.name : typeof s.reason;
          console.warn(`[content/scan] ${slot} check failed: ${why}`);
          failed.push(`${slot} (${checker.name})`);
          return;
        }
        const r = s.value;
        if (r.verdict === "held") {
          anyHeld = true;
          held.push(...note(slot, r));
        } else if (r.verdict === "unsure") {
          anyUnsure = true;
          unsure.push(...note(slot, r));
        } else if (r.verdict === "skipped" || r.verdict === "unchecked") {
          notes.push(...note(slot, r));
        }
      });
      if (anyHeld) {
        return {
          verdict: "held",
          reasons: [...held, ...unsure, ...notes].slice(0, MAX_REASONS),
        };
      }
      if (anyUnsure) {
        return {
          verdict: "unsure",
          reasons: [...unsure, ...notes].slice(0, MAX_REASONS),
        };
      }
      if (failed.length > 0) {
        throw new Error(`scanner unavailable: ${failed.join(", ")}`);
      }
      return { verdict: "clean", reasons: notes.slice(0, MAX_REASONS) };
    },
  };
  if (checkers[0]![1] === keywordTextChecker)
    keywordTextComposites.add(scanner);
  return scanner;
}

/** Provider names per slot, for GET /api/monitor/status (13-40). */
export function scannerProviders(): {
  text: string;
  image: string;
  link: string;
} {
  return {
    text: getTextChecker().name,
    image: getImageModerator().name,
    link: getLinkChecker().name,
  };
}
