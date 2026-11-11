// ADDON-12: RFC 4180 parser, serializer and formula-injection guard (OWASP CSV injection).
import { describe, expect, it } from "vitest";
import { guardFormula, unguardFormula } from "./formula";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv } from "./parse";
import { exportCsv, serializeCsv, templateCsv } from "./serialize";
import type { CsvSpec } from "./types";

const BOM = String.fromCharCode(0xfeff);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rand: () => number, n: number): number {
  return Math.floor(rand() * n);
}

const ALPHABET = [
  "a",
  "b",
  "Z",
  "1",
  " ",
  ",",
  '"',
  "\r",
  "\n",
  "=",
  "+",
  "-",
  "@",
  "\t",
  "'",
  "é",
  "ß",
  "漢",
  "😀",
];

function randomCell(rand: () => number): string {
  const len = int(rand, 8);
  let s = "";
  for (let i = 0; i < len; i++) s += ALPHABET[int(rand, ALPHABET.length)];
  return s;
}

function ok(text: string) {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r;
}

function err(text: string) {
  const r = parseCsv(text);
  if (r.ok) throw new Error("expected error");
  return r.error;
}

const spec: CsvSpec = {
  collection: "fixture_quotes",
  singular: "testimonial",
  plural: "testimonials",
  naturalKey: ["name", "quote"],
  columns: [
    {
      key: "quote",
      label: "Quote",
      required: true,
      example: "=Great service",
      parse: (raw) => ({ ok: true, value: raw }),
      format: (v) => (v == null ? "" : String(v)),
    },
    {
      key: "name",
      label: "Name",
      required: true,
      example: "Ann, Austin",
      parse: (raw) => ({ ok: true, value: raw }),
      format: (v) => (v == null ? "" : String(v)),
    },
  ],
};

describe("parseCsv", () => {
  it("strips the BOM and unescapes doubled quotes with mixed line endings", () => {
    const r = ok(`${BOM}Quote,Name\r\n"He said ""hi""",Ann\n`);
    expect(r.header).toEqual(["Quote", "Name"]);
    expect(r.rows).toEqual([['He said "hi"', "Ann"]]);
  });

  it("keeps CRLF inside a quoted cell", () => {
    const r = ok('Quote,Name\r\n"line one\r\nline two",Bo\r\n');
    expect(r.rows).toEqual([["line one\r\nline two", "Bo"]]);
  });

  it("splits rows on lone CR line endings", () => {
    const r = ok("Quote,Name\rA,B\rC,D");
    expect(r.rows).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("ignores trailing blank lines and fully empty rows", () => {
    const r = ok("Quote,Name\nA,B\n\n,\n\n");
    expect(r.rows).toEqual([["A", "B"]]);
  });

  it("keeps empty cells and pads short rows", () => {
    const r = ok("a,b,c\n1,,3\n4\n");
    expect(r.rows).toEqual([
      ["1", "", "3"],
      ["4", "", ""],
    ]);
  });

  it("refuses an empty file", () => {
    expect(err("").code).toBe("empty");
    expect(err(BOM).code).toBe("empty");
    expect(err("\r\n\n").code).toBe("empty");
  });

  it("refuses a header-only file with UI-SPEC copy", () => {
    const e = err("Quote,Name\r\n");
    expect(e.code).toBe("header_only");
    expect(e.message).toBe(
      "This file has no rows. Add rows under the header, then upload it again.",
    );
  });

  it("refuses an unbalanced quote with the not-a-CSV copy", () => {
    const e = err('Quote,Name\n"never closed,Ann\n');
    expect(e.code).toBe("unbalanced_quote");
    expect(e.message).toBe(
      'This file isn\'t a CSV. Save it from Excel or Google Sheets as "CSV", then upload it.',
    );
  });

  it("refuses binary-looking text", () => {
    const e = err("PK\u0003\u0004\u0000\u0000binary");
    expect(e.code).toBe("not_csv");
    expect(e.message).toContain("This file isn't a CSV.");
  });

  it("accepts exactly 2,000 rows and refuses 2,001 with UI-SPEC copy", () => {
    expect(MAX_IMPORT_ROWS).toBe(2000);
    expect(MAX_IMPORT_BYTES).toBe(1_500_000);
    const lines = (n: number) =>
      [
        "Quote,Name",
        ...Array.from({ length: n }, (_, i) => `q${i},n${i}`),
      ].join("\n");
    expect(ok(lines(2000)).rows).toHaveLength(2000);
    const e = err(lines(2001));
    expect(e.code).toBe("too_many_rows");
    expect(e.message).toBe(
      "This file has 2,001 rows. Import up to 2,000 at a time: split the file and upload each part.",
    );
  });

  it("treats a stray quote inside an unquoted field as a literal", () => {
    const r = ok('Quote,Name\n5" tall,Ann\n');
    expect(r.rows).toEqual([['5" tall', "Ann"]]);
  });
});

describe("formula guard", () => {
  it("prefixes an apostrophe to every trigger character", () => {
    for (const c of ["=", "+", "-", "@", "\t", "\r"]) {
      expect(guardFormula(`${c}1`)).toBe(`'${c}1`);
      expect(unguardFormula(`'${c}1`)).toBe(`${c}1`);
    }
  });

  it("leaves safe cells alone", () => {
    expect(guardFormula("hello")).toBe("hello");
    expect(guardFormula("'quoted")).toBe("'quoted");
    expect(unguardFormula("'quoted")).toBe("'quoted");
    expect(guardFormula("")).toBe("");
  });

  it("is lossless for cells that already start with an apostrophe before a trigger", () => {
    expect(guardFormula("'=x")).toBe("''=x");
    expect(unguardFormula(guardFormula("'=x"))).toBe("'=x");
    expect(unguardFormula(guardFormula("''-1"))).toBe("''-1");
  });
});

describe("serializeCsv", () => {
  it("writes a BOM, CRLF endings, quotes when needed and guards formulas", () => {
    const out = serializeCsv(
      ["Quote", "Name"],
      [
        ['He said "hi"', "=SUM(A1)"],
        [" pad", "a,b"],
      ],
    );
    expect(out).toBe(
      `${BOM}Quote,Name\r\n"He said ""hi""\",'=SUM(A1)\r\n" pad","a,b"\r\n`,
    );
  });

  it("round-trips random cells (200 seeded runs)", () => {
    for (let run = 0; run < 200; run++) {
      const rand = mulberry32(run + 1);
      const cols = 1 + int(rand, 4);
      const header = Array.from(
        { length: cols },
        (_, i) => `H${i}${randomCell(rand)}`,
      );
      const rows: string[][] = [];
      const n = 1 + int(rand, 6);
      for (let r = 0; r < n; r++) {
        const row = Array.from({ length: cols }, () => randomCell(rand));
        if (row.join("") === "") row[0] = "x";
        rows.push(row);
      }
      const parsed = ok(serializeCsv(header, rows));
      expect(parsed.header.map(unguardFormula), `seed ${run + 1}`).toEqual(
        header,
      );
      expect(
        parsed.rows.map((r) => r.map(unguardFormula)),
        `seed ${run + 1}`,
      ).toEqual(rows);
    }
  });
});

describe("templateCsv / exportCsv", () => {
  it("templateCsv writes labels and one example row", () => {
    const r = ok(templateCsv(spec));
    expect(r.header).toEqual(["Quote", "Name"]);
    expect(r.rows.map((row) => row.map(unguardFormula))).toEqual([
      ["=Great service", "Ann, Austin"],
    ]);
  });

  it("exportCsv leads with id and formats every column", () => {
    const out = exportCsv(spec, [{ id: "r1", quote: "-great", name: "Ann" }]);
    const r = ok(out);
    expect(r.header).toEqual(["id", "Quote", "Name"]);
    expect(r.rows).toEqual([["r1", "'-great", "Ann"]]);
  });

  it("exportCsv with zero records is a header-only file", () => {
    expect(exportCsv(spec, [])).toBe(`${BOM}id,Quote,Name\r\n`);
  });
});
