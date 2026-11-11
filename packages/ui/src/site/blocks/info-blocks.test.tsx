// Table, FAQ, icon list and stats renderers (07-21; CONT-26, CONT-27, CONT-35;
// T-07-21-01, T-07-21-02, T-07-21-05).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defaultFaqBlock,
  defaultStatsContent,
  defaultTableBlock,
  newTableCell,
  type FaqBlockContent,
  type IconListBlockContent,
  type StatsContent,
  type TableBlockContent,
} from "@cds/core/content";
import { FaqSection } from "./FaqSection";
import { IconListSection } from "./IconListSection";
import { StatsSection } from "./StatsSection";
import { TableSection } from "./TableSection";

const NOW = new Date("2026-10-01T12:00:00.000Z");
const base = {
  layout: "full" as const,
  background: "main" as const,
  isH1Owner: false,
  isFirst: false,
  now: NOW,
};

const table = (c: Partial<TableBlockContent>) =>
  renderToStaticMarkup(
    <TableSection {...base} content={{ ...defaultTableBlock(), ...c }} />,
  );
const faq = (c: Partial<FaqBlockContent>) =>
  renderToStaticMarkup(
    <FaqSection {...base} content={{ ...defaultFaqBlock(), ...c }} />,
  );
const icons = (c: IconListBlockContent) =>
  renderToStaticMarkup(<IconListSection {...base} content={c} />);
const stats = (c: Partial<StatsContent>) =>
  renderToStaticMarkup(
    <StatsSection {...base} content={{ ...defaultStatsContent(), ...c }} />,
  );

const cells = (rows: string[][]) =>
  rows.map((r) => r.map((t) => newTableCell(t)));

describe("TableSection", () => {
  const rows = cells([
    ["Plan", "Price", "Visits"],
    ["Basic", "$20", "4"],
    ["Plus", "$35", "8"],
  ]);

  it("renders a header row as th scope=col inside thead", () => {
    const out = table({ heading: "Prices", rows });
    expect(out).toMatch(/<thead[^>]*><tr[^>]*><th scope="col"/);
    expect(out.match(/scope="col"/g)?.length).toBe(3);
    expect(out).not.toContain('scope="row"');
  });

  it("first-column headers render as th scope=row", () => {
    const out = table({ rows, first_column_header: true });
    expect(out.match(/scope="row"/g)?.length).toBe(2);
  });

  it("renders bold, italic and link flags; HTML in text stays escaped", () => {
    const r = cells([["H"], ["x"], ["y"], ["z"]]);
    r[1][0] = { text: "<b>x</b>", bold: true, italic: false, link: "" };
    r[2][0] = { text: "it", bold: false, italic: true, link: "" };
    r[3][0] = {
      text: "go",
      bold: false,
      italic: false,
      link: "https://example.com",
    };
    const out = table({ rows: r, align: ["left"] });
    expect(out).toContain("<strong>&lt;b&gt;x&lt;/b&gt;</strong>");
    expect(out).toContain("<em>it</em>");
    expect(out).toMatch(/<a href="https:\/\/example.com\/?" rel="noopener"/);
  });

  it("drops an unsafe link at render", () => {
    const r = cells([["H"], ["x"]]);
    r[1][0] = {
      text: "x",
      bold: false,
      italic: false,
      link: "javascript:alert(1)",
    };
    expect(table({ rows: r, align: ["left"] })).not.toContain("<a ");
  });

  it("aligns one column only and marks numbers tabular", () => {
    const out = table({ rows, align: ["left", "right", "left"] });
    expect(out.match(/text-right/g)?.length).toBe(3);
    expect(out).toMatch(/text-right tabular-nums[^"]*">\$20/);
  });

  it("is labelled by its h2 heading", () => {
    const out = table({ heading: "Prices", rows });
    const id = out.match(/<h2 id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<table aria-labelledby="${id}"`);
    expect(out).toContain(`role="region" tabindex="0" aria-labelledby="${id}"`);
  });

  it("scroll mode without a heading is a region named Table", () => {
    const out = table({ rows });
    expect(out).toContain('role="region" tabindex="0" aria-label="Table"');
    expect(out).toContain('data-cds-table="scroll"');
  });

  it("cards mode keeps visible header labels and explicit roles", () => {
    const out = table({ rows, mobile: "cards" });
    expect(out).toContain('data-cds-table="cards"');
    expect(out).toContain(
      '<span data-card-label="" class="font-semibold md:hidden">Price: </span>',
    );
    expect(out).toContain('role="columnheader"');
    expect(out).toContain('role="cell"');
    expect(out).toContain("max-md:sr-only");
  });

  it("stripes alternate rows", () => {
    const out = table({ rows, striped: true });
    expect(out.match(/bg-site-surface-raised/g)?.length).toBe(1);
  });

  it("an all-empty table renders nothing; the default does not", () => {
    expect(
      table({
        rows: cells([
          ["", ""],
          ["", ""],
        ]),
      }),
    ).toBe("");
    expect(table({})).toContain("<table");
  });
});

describe("FaqSection", () => {
  const items = [
    {
      id: "a",
      question: "Do you open Sundays?",
      answer: "<p>Yes, 10 to 4.</p>",
    },
    { id: "b", question: "Parking?", answer: "" },
    {
      id: "c",
      question: "Gift cards?",
      answer: "<p>Yes</p><script>alert(1)</script>",
    },
  ];

  it("skips questions without answers", () => {
    const out = faq({ items });
    expect(out.match(/<details/g)?.length).toBe(2);
    expect(out).toContain("Do you open Sundays?");
    expect(out).not.toContain("Parking?");
  });

  it("opens only the first when open_first", () => {
    const out = faq({ items, open_first: true });
    expect(out.match(/<details open=""/g)?.length).toBe(1);
    expect(out.indexOf('open=""')).toBeLessThan(out.indexOf("Gift cards?"));
    expect(faq({ items })).not.toContain('open=""');
  });

  it("sanitizes answers at render", () => {
    const out = faq({ items });
    expect(out).not.toContain("<script");
    expect(out).toContain("<p>Yes</p>");
  });

  it("puts the question in the summary", () => {
    expect(faq({ items })).toMatch(
      /<summary[^>]*><span>Do you open Sundays\?<\/span>/,
    );
  });

  it("renders nothing without answered questions (default included)", () => {
    expect(faq({})).toBe("");
  });
});

describe("IconListSection", () => {
  it("renders titled items with their icon, unknown -> check", () => {
    const out = icons({
      heading: "Why us",
      items: [
        { id: "1", icon: "phone", title: "Call us", text: "Any time" },
        { id: "2", icon: "nope" as never, title: "Fallback", text: "" },
        { id: "3", icon: "star", title: "  ", text: "skipped" },
      ],
    });
    expect(out.match(/<li/g)?.length).toBe(2);
    expect(out).toContain("lucide-phone");
    expect(out).toContain("lucide-check");
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(out).not.toContain("skipped");
    expect(out).toContain("text-site-primary");
  });

  it("renders nothing without titled items", () => {
    expect(
      icons({
        heading: "x",
        items: [{ id: "1", icon: "check", title: "", text: "" }],
      }),
    ).toBe("");
  });
});

describe("StatsSection", () => {
  const items = [
    {
      id: "1",
      value: "1,200",
      prefix: "",
      suffix: "+",
      label: "happy clients",
    },
    { id: "2", value: "4.9", prefix: "", suffix: "", label: "average rating" },
    { id: "3", value: "12abc", prefix: "", suffix: "", label: "bad" },
    { id: "4", value: "50", prefix: "", suffix: "", label: "" },
  ];

  it("prints final numbers and an sr-only accessible name", () => {
    const out = stats({ items });
    expect(out).toContain("1,200");
    expect(out).toContain('<span class="sr-only">1,200+ happy clients</span>');
    expect(out.match(/<li/g)?.length).toBe(2);
    expect(out).toContain("data-cds-count-up");
  });

  it("count_up off renders plain text, no island markup", () => {
    const out = stats({ items, count_up: false });
    expect(out).not.toContain("data-cds-count-up");
    expect(out).toContain("1,200");
  });

  it("renders nothing when every item is incomplete (default included)", () => {
    expect(stats({})).toBe("");
  });
});

describe("headings (CONT-35)", () => {
  it("every block heading is an h2 and none emits h1", () => {
    const outs = [
      table({ heading: "T", rows: cells([["a"], ["b"]]), align: ["left"] }),
      faq({
        heading: "F",
        items: [{ id: "a", question: "Q", answer: "<p>A</p>" }],
      }),
      icons({
        heading: "I",
        items: [{ id: "1", icon: "check", title: "x", text: "" }],
      }),
      stats({
        heading: "S",
        items: [{ id: "1", value: "3", prefix: "", suffix: "", label: "x" }],
      }),
    ];
    for (const out of outs) {
      expect(out).toMatch(/<h2/);
      expect(out).not.toMatch(/<h1/);
    }
  });
});
