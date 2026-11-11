// Comparison, footnotes, sources and the no-JS calculator (15-12; 15-UI-SPEC "Comparison", "Calculator";
// HUB-06, D182, D296, A2-Q4). Server render in the node unit project. No `$`+digit literal here
// (tests/marketing-boundary.test.ts rule e): money is built with calcMoney.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CALC_DEFAULTS,
  CLAIMS,
  MK_COMPARISON_HEADING,
  MK_COPY,
  MK_GATEWAY_SENTENCE,
  compareCosts,
  formatCheckedDate,
  visibleClaims,
  type Claim,
} from "@cds/core/marketing";
import { PRICE_SOON } from "@cds/core/pricing";
import {
  CALC_ISLAND_ID,
  CalculatorStatic,
  calcAnchors,
  calcMoney,
  calcRange,
  calculatorAvailable,
} from "./CalculatorStatic";
import { ClaimFootnotes } from "./ClaimFootnotes";
import {
  ComparisonTable,
  comparisonAnchors,
  comparisonRows,
  footnoteOrder,
} from "./ComparisonTable";
import { SourcesTable } from "./SourcesTable";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const unescape = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
const text = (markup: string) => unescape(markup.replace(/<[^>]+>/g, ""));
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const DEV = visibleClaims(CLAIMS, false);
const verified = (ids: readonly string[]): Claim[] =>
  CLAIMS.map((c) =>
    ids.includes(c.id) ? { ...c, status: "verified" as const } : c,
  );
/** Every claim marked verified: renders with drafts hidden, and with no DRAFT badge. */
const ALL_VERIFIED = verified(CLAIMS.map((c) => c.id));
const PLAN = { standard: 3900, studio: 7900 };

describe("ComparisonTable", () => {
  it("production with only draft claims renders nothing (A2-Q4)", () => {
    const prod = visibleClaims(CLAIMS, true);
    expect(prod).toHaveLength(0);
    expect(html(<ComparisonTable claims={prod} showDrafts={false} />)).toBe("");
    expect(
      html(<ClaimFootnotes claims={prod} order={footnoteOrder(prod)} />),
    ).toBe("");
    expect(html(<SourcesTable claims={prod} />)).toBe("");
  });

  it("dev: verbatim heading, DRAFT page note and a badge after each draft claim", () => {
    const out = html(<ComparisonTable claims={DEV} showDrafts />);
    expect(text(out)).toContain(MK_COMPARISON_HEADING);
    expect(out).toContain("<h2");
    expect(text(out)).toContain(MK_COPY.COMPARISON.DRAFT_NOTE);
    const shown = comparisonRows(DEV).flatMap((r) => r.claims);
    expect(count(out, `>${MK_COPY.COMMON.DRAFT}<`)).toBe(shown.length);
    for (const c of shown) expect(text(out)).toContain(c.text);
  });

  it("four rows by money mechanism, each Elsewhere claim followed by its [n] ref", () => {
    const out = html(
      <ComparisonTable claims={ALL_VERIFIED} showDrafts={false} />,
    );
    expect(count(out, 'scope="row"')).toBe(4);
    for (const h of [
      "Card processing",
      "Marketplace fees",
      "Add-ons that stack",
      "Contracts",
    ])
      expect(text(out)).toContain(h);
    const order = footnoteOrder(ALL_VERIFIED);
    for (const c of comparisonRows(ALL_VERIFIED).flatMap((r) => r.claims)) {
      const n = order.indexOf(c.id) + 1;
      expect(out).toContain(`href="#claim-${c.id}" id="ref-${c.id}"`);
      expect(out).toMatch(new RegExp(`id="ref-${c.id}"[^>]*>\\[${n}\\]<`));
    }
    expect(out).not.toContain(MK_COPY.COMMON.DRAFT + "<");
  });

  it("the gateway sentence appears exactly once, under the table", () => {
    const out = html(
      <ComparisonTable claims={ALL_VERIFIED} showDrafts={false} />,
    );
    const s = unescape(out);
    expect(count(s, MK_GATEWAY_SENTENCE)).toBe(1);
    expect(s.indexOf(MK_GATEWAY_SENTENCE)).toBeGreaterThan(
      s.indexOf("</table>"),
    );
  });

  it("a row with no visible claim hides; verified-only production keeps the rest", () => {
    const prod = visibleClaims(
      verified(["processing-range", "vagaro-stack", "stripe-online"]),
      true,
    );
    const out = html(<ComparisonTable claims={prod} showDrafts={false} />);
    expect(count(out, 'scope="row"')).toBe(2);
    expect(text(out)).not.toContain("Marketplace fees");
    expect(text(out)).not.toContain(MK_COPY.COMPARISON.DRAFT_NOTE);
  });

  it("numbers footnotes by first appearance: table rows, then the gateway, then the rest", () => {
    const order = footnoteOrder(DEV);
    expect(order.slice(0, 7)).toEqual([
      "processing-range",
      "fresha-marketplace",
      "booksy-boost",
      "vagaro-stack",
      "mindbody-contract",
      "boulevard-contract",
      "stripe-online",
    ]);
    expect(new Set(order).size).toBe(DEV.length);
  });
});

describe("Draft guard with drafts hidden (WR-C05)", () => {
  // A caller that forgot visibleClaims(): the raw list still holds drafts.
  const RAW = verified(["processing-range", "stripe-online"]);
  const draft = RAW.find((c) => c.id === "fresha-marketplace")!;

  it("ComparisonTable drops drafts it is given and numbers what is left from 1", () => {
    expect(html(<ComparisonTable claims={DEV} showDrafts={false} />)).toBe("");
    const out = html(
      <ComparisonTable
        claims={RAW}
        showDrafts={false}
        order={footnoteOrder(RAW)}
      />,
    );
    expect(text(out)).toContain(
      RAW.find((c) => c.id === "processing-range")!.text,
    );
    expect(text(out)).not.toContain(draft.text);
    expect(out).not.toContain(`ref-${draft.id}`);
    expect(out).toMatch(/id="ref-processing-range"[^>]*>\[1\]</);
    expect(out).toMatch(/id="ref-stripe-online"[^>]*>\[2\]</);
  });

  it("ClaimFootnotes and SourcesTable list verified claims only", () => {
    const notes = html(
      <ClaimFootnotes claims={RAW} order={footnoteOrder(RAW)} />,
    );
    expect(count(notes, "<li")).toBe(2);
    expect(notes).not.toContain(`claim-${draft.id}`);
    expect(text(notes)).toContain("[2] ");
    const sources = html(<SourcesTable claims={RAW} />);
    expect(count(sources, 'scope="row"')).toBe(2);
    expect(text(sources)).not.toContain(draft.figure);
  });
});

describe("ClaimFootnotes", () => {
  it("lists [n] title (new tab) + Checked date + Back to text, ids pairing with the refs", () => {
    const order = footnoteOrder(DEV);
    const table = html(<ComparisonTable claims={DEV} showDrafts />);
    const notes = html(
      <ClaimFootnotes claims={DEV} order={order} showDrafts />,
    );
    expect(count(notes, "<li")).toBe(DEV.length);
    for (const [i, id] of order.entries()) {
      const c = DEV.find((x) => x.id === id)!;
      expect(notes).toContain(`id="claim-${id}"`);
      expect(notes).toContain(`href="#ref-${id}"`);
      expect(text(notes)).toContain(`[${i + 1}] ${c.sourceTitle}`);
      expect(text(notes)).toContain(
        `Checked ${formatCheckedDate(c.verifiedOn)}.`,
      );
    }
    // Every ref in the table has a footnote target.
    for (const m of table.matchAll(/href="#claim-([a-z-]+)"/g))
      expect(notes).toContain(`id="claim-${m[1]}"`);
    expect(count(notes, 'target="_blank" rel="noopener"')).toBe(DEV.length);
    expect(text(notes)).toContain(MK_COPY.COMMON.NEW_TAB);
    expect(count(text(notes), MK_COPY.COMPARISON.BACK_TO_TEXT)).toBe(
      DEV.length,
    );
    expect(count(notes, `>${MK_COPY.COMMON.DRAFT}<`)).toBe(DEV.length);
  });
});

describe("SourcesTable", () => {
  it("one row per shown claim: competitor, figure, source, checked date", () => {
    const out = html(<SourcesTable claims={DEV} showDrafts />);
    expect(count(out, "<tbody>")).toBe(1);
    expect(count(out, 'scope="row"')).toBe(DEV.length);
    for (const col of MK_COPY.SOURCES.COLUMNS) expect(text(out)).toContain(col);
    for (const c of DEV) {
      expect(text(out)).toContain(c.competitor);
      expect(text(out)).toContain(c.figure);
      expect(out).toContain(`href="${c.sourceUrl}"`);
      expect(text(out)).toContain(formatCheckedDate(c.verifiedOn));
    }
  });
});

describe("CalculatorStatic", () => {
  const out = html(
    <CalculatorStatic claims={DEV} planMonthlyCents={PLAN} path="standard" />,
  );

  it("is a noscript table that hides the island", () => {
    expect(out.startsWith("<noscript>")).toBe(true);
    expect(out).toContain(`#${CALC_ISLAND_ID}{display:none}`);
    expect(out).toContain("<table");
    expect(text(out)).toContain(
      `Example: ${calcMoney(CALC_DEFAULTS.salesCents)} in card sales a month, ${calcMoney(CALC_DEFAULTS.avgCents)} average sale, no app clients.`,
    );
  });

  it("carries the calculator-only ref anchors, so no-JS Back to text has a target (WR-C06)", () => {
    const owned = [...calcAnchors(DEV)];
    expect(owned).toEqual(
      expect.arrayContaining(["mindbody-online", "boulevard-online"]),
    );
    for (const id of owned) expect(out).toContain(`id="ref-${id}"`);
    // The comparison section owns the rest; ids stay unique on the page.
    for (const id of comparisonAnchors(DEV))
      expect(out).not.toContain(`id="ref-${id}"`);
  });

  it("computes from CALC_DEFAULTS with compareCosts", () => {
    const r = compareCosts({
      ...CALC_DEFAULTS,
      planMonthlyCents: PLAN.standard,
      claims: DEV,
    });
    const t = text(out);
    expect(t).toContain(calcRange(r.elsewhere.processing));
    expect(t).toContain(calcRange(r.elsewhere.total));
    expect(t).toContain(calcMoney(r.cds.gatewayCents));
    expect(t).toContain(calcMoney(PLAN.standard));
    expect(t).not.toContain(MK_COPY.CALC.MARKETPLACE);
  });

  it("'Platform cut' (zero) is directly followed by the gateway fees line, plus the sentence", () => {
    const rows = [
      ...out.matchAll(/<tr data-calc-line="([a-z]+)">([\s\S]*?)<\/tr>/g),
    ];
    const keys = rows.map((m) => m[1]);
    const cut = keys.indexOf("cut");
    expect(cut).toBeGreaterThan(-1);
    expect(keys[cut + 1]).toBe("gateway");
    expect(text(rows[cut]![2]!)).toBe(
      `${MK_COPY.CALC.PLATFORM_CUT}${calcMoney(0)}`,
    );
    expect(text(rows[cut + 1]![2]!)).toContain("paid to Stripe");
    expect(count(unescape(out), MK_GATEWAY_SENTENCE)).toBe(1);
  });

  it("no plan price shows Price coming soon for the CDS total", () => {
    const soon = html(
      <CalculatorStatic
        claims={DEV}
        planMonthlyCents={{ standard: null, studio: null }}
        path="studio"
      />,
    );
    expect(count(text(soon), PRICE_SOON)).toBe(2);
  });

  it("hides when the stripe claim (or the comparison) is not visible", () => {
    const noStripe = DEV.filter((c) => c.id !== "stripe-online");
    expect(calculatorAvailable(noStripe)).toBe(false);
    expect(
      html(
        <CalculatorStatic
          claims={noStripe}
          planMonthlyCents={PLAN}
          path="standard"
        />,
      ),
    ).toBe("");
    expect(calculatorAvailable(visibleClaims(CLAIMS, true))).toBe(false);
    expect(calculatorAvailable(DEV)).toBe(true);
  });
});
