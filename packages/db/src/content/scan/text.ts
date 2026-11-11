// Text check sub-port selection (13-08 choice 2; STAFF-23, D248).
// Stand-in: keywordTextChecker wraps the existing keywordScanner unchanged, so every
// __cds_test_held__ / __cds_test_unsure__ test keeps its verdict. The real AI check is the
// GO-LIVE P6 Anthropic row. CDS_TEXT_CHECKER unset / "keyword" → the stand-in; any other
// value throws (fail loud, like getContentScanner).
import type { ScanInput, SubResult, TextChecker } from "../ports";
import { keywordScanner } from "../scan-standin";

export const keywordTextChecker: TextChecker = {
  name: "keyword",
  async check(input: ScanInput): Promise<SubResult> {
    const r = await keywordScanner.scan(input);
    return { verdict: r.verdict, reasons: r.reasons, provider: "keyword" };
  },
};

export function getTextChecker(): TextChecker {
  const v = process.env.CDS_TEXT_CHECKER;
  if (v === undefined || v === "" || v === "keyword") return keywordTextChecker;
  throw new Error(
    `CDS_TEXT_CHECKER="${v}" has no implementation yet (unset it to use the keyword stand-in)`,
  );
}
