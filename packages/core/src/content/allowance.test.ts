import { describe, expect, it } from "vitest";
import { CdsError } from "../errors";
import {
  PAGE_BASE,
  PAGE_PACK_SIZE,
  PageLimitReached,
  countPagesTowardLimit,
  countsTowardLimit,
  pageAllowance,
  pagesFullCopy,
  pagesFullMemberCopy,
  pagesPackRefusedCopy,
} from "./allowance";
import * as content from "./index";

describe("pageAllowance (D185)", () => {
  it("is 10 + 5 per pack, never below 10", () => {
    expect(PAGE_BASE).toBe(10);
    expect(PAGE_PACK_SIZE).toBe(5);
    expect(pageAllowance(0)).toBe(10);
    expect(pageAllowance(1)).toBe(15);
    expect(pageAllowance(3)).toBe(25);
    expect(pageAllowance(-1)).toBe(10);
  });

  it("treats junk as zero packs and floors fractions", () => {
    expect(pageAllowance(Number.NaN)).toBe(10);
    expect(pageAllowance(Number.POSITIVE_INFINITY)).toBe(10);
    expect(pageAllowance(1.9)).toBe(15);
    expect(pageAllowance(undefined as unknown as number)).toBe(10);
  });
});

describe("countsTowardLimit (D273)", () => {
  it("counts live, open builder pages only", () => {
    expect(countsTowardLimit({ kind: "builder" })).toBe(true);
    expect(countsTowardLimit({ kind: "builder", deleted_at: "" })).toBe(true);
    expect(countsTowardLimit({ kind: "system-404" })).toBe(false);
    expect(countsTowardLimit({ kind: "policy" })).toBe(false);
    expect(
      countsTowardLimit({
        kind: "builder",
        deleted_at: "2026-10-01 10:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      countsTowardLimit({ kind: "builder", password_protected: true }),
    ).toBe(false);
  });

  it("counts a list", () => {
    expect(
      countPagesTowardLimit([
        { kind: "builder" },
        { kind: "builder", password_protected: true },
        { kind: "system-404" },
        { kind: "builder" },
      ]),
    ).toBe(2);
  });
});

describe("PageLimitReached", () => {
  it("is a typed CdsError with code page_limit carrying the allowance", () => {
    const e = new PageLimitReached(15);
    expect(e).toBeInstanceOf(CdsError);
    expect(e.code).toBe("page_limit");
    expect(e.allowance).toBe(15);
    expect(e.name).toBe("PageLimitReached");
    expect(e.message).toBe(pagesFullCopy(15));
  });
});

describe("copy", () => {
  it("PAGES-FULL tracks the allowance and quotes only the catalog price (WR-C02)", () => {
    expect(pagesFullCopy(10, "$10/mo")).toBe(
      "You've used all 10 pages included with your site. Add 5 more pages for $10/mo.",
    );
    expect(pagesFullCopy(15, "$12/mo")).toContain("for $12/mo.");
    expect(pagesFullCopy(15)).toBe(
      "You've used all 15 pages included with your site.",
    );
    expect(pagesFullCopy(10, null)).not.toMatch(/\$|Add 5/);
  });

  it("PageLimitReached's message names no price (WR-C02)", () => {
    expect(new PageLimitReached(10).message).not.toMatch(/\$|month/);
  });

  it("PAGES-FULL-MEMBER tracks the allowance", () => {
    expect(pagesFullMemberCopy(10)).toBe(
      "You've used all 10 pages included with your site. Ask your site owner to add more pages.",
    );
  });

  it("PAGES-PACK-REFUSED matches the UI-SPEC and handles one page", () => {
    expect(pagesPackRefusedCopy(13, 10)).toBe(
      "You have 13 pages, more than the 10 you'd have left. Delete 3 pages first, then remove the pack.",
    );
    expect(pagesPackRefusedCopy(11, 10)).toBe(
      "You have 11 pages, more than the 10 you'd have left. Delete 1 page first, then remove the pack.",
    );
  });

  it("is exported from @cds/core/content", () => {
    expect(content.pageAllowance).toBe(pageAllowance);
    expect(content.PageLimitReached).toBe(PageLimitReached);
  });
});
