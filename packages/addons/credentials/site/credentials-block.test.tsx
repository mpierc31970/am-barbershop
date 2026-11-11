// Credentials block renderer and the pure blockData transform (ADDON-08; D253,
// D-UI-P5-13, D-UI-P5-14; T-05-44, T-05-45; 05-UI-SPEC "Site blocks > Credentials block").
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  blockData,
  selectCredentials,
  type CredentialGroupView,
  type CredentialItemView,
} from "../server";
import type { CredentialsBlockContent } from "../sections/definition";
import {
  CredentialsBlock,
  detailLine,
  groupsClasses,
} from "./CredentialsBlock";

const NOW = new Date("2026-09-28T12:00:00Z");

function item(
  i: number,
  extra: Partial<CredentialItemView> = {},
): CredentialItemView {
  return {
    id: `c${i}`,
    title: `Credential ${i}`,
    issuer: `Board ${i}`,
    number: null,
    issued_on: "",
    expires_on: "",
    verify_url: "",
    ...extra,
  };
}

const content = (
  c: Partial<CredentialsBlockContent> = {},
): CredentialsBlockContent => ({
  heading: "Credentials",
  group_by_category: true,
  ...c,
});

function html(
  data: CredentialGroupView[],
  c: Partial<CredentialsBlockContent> = {},
  isH1Owner = false,
): string {
  return renderToStaticMarkup(
    <CredentialsBlock
      content={content(c)}
      layout="full"
      background="main"
      isH1Owner={isH1Owner}
      isFirst={false}
      now={NOW}
      data={data}
    />,
  );
}

describe("CredentialsBlock", () => {
  it("renders nothing, not even the heading, with no items", () => {
    expect(html([])).toBe("");
    expect(html([{ category: "Licenses", items: [] }])).toBe("");
    expect(html(undefined as unknown as CredentialGroupView[])).toBe("");
  });

  it("renders an h3 and a list per group, grouped", () => {
    const out = html([
      { category: "Licenses", items: [item(1), item(2)] },
      { category: "Memberships", items: [item(3)] },
    ]);
    expect(out.match(/<h3/g)).toHaveLength(2);
    expect(out).toContain(">Licenses</h3>");
    expect(out.match(/<ul/g)).toHaveLength(2);
    expect(out.match(/<li/g)).toHaveLength(3);
    expect(out).toContain("max-w-[800px]");
    expect(out).toContain("<h2");
  });

  it("renders one list with no group headings when not grouped", () => {
    const out = html([{ category: "", items: [item(1), item(2)] }], {
      group_by_category: false,
    });
    expect(out).not.toContain("<h3");
    expect(out.match(/<ul/g)).toHaveLength(1);
    expect(out.match(/<li/g)).toHaveLength(2);
  });

  it("flows 4 or more groups into 2 columns at 1024px", () => {
    expect(groupsClasses(3)).not.toContain("columns-2");
    expect(groupsClasses(4)).toContain("lg:columns-2");
    const four = html(
      ["A", "B", "C", "D"].map((g, i) => ({ category: g, items: [item(i)] })),
    );
    expect(four).toContain("lg:columns-2");
    expect(four).toContain("break-inside-avoid");
    const two = html([
      { category: "A", items: [item(1)] },
      { category: "B", items: [item(2)] },
    ]);
    expect(two).not.toContain("columns-2");
  });

  it("detail line joins issuer, number and validity", () => {
    expect(
      detailLine(
        item(1, {
          issuer: "Texas Board of Nursing",
          number: "RN123456",
          expires_on: "2027-03-14",
          issued_on: "2019-06-01",
        }),
      ),
    ).toBe(
      "Texas Board of Nursing · License no. RN123456 · Valid through March 2027",
    );
    expect(
      detailLine(item(1, { issuer: "AANA", issued_on: "2019-06-01" })),
    ).toBe("AANA · Since 2019");
    expect(detailLine(item(1, { issuer: "AANA" }))).toBe("AANA");
  });

  it("renders the Verify link in a new tab with a named label (T-05-44)", () => {
    const out = html([
      {
        category: "Licenses",
        items: [
          item(1, {
            title: "Registered Nurse",
            verify_url: "https://bon.texas.gov/verify",
          }),
        ],
      },
    ]);
    expect(out).toContain('href="https://bon.texas.gov/verify"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain(
      'aria-label="Verify Registered Nurse (opens in a new tab)"',
    );
    expect(out).toContain("<svg");
  });

  it("never renders an unsafe verify link as an href", () => {
    const out = html([
      {
        category: "Licenses",
        items: [
          item(1, { verify_url: "javascript:alert(1)" }),
          item(2, { verify_url: "/relative" }),
        ],
      },
    ]);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("<a");
  });

  it("makes the heading the page h1 only when it owns it", () => {
    const g = [{ category: "Licenses", items: [item(1)] }];
    expect(html(g, {}, true)).toContain("<h1");
    expect(html(g, { heading: "" })).not.toContain("<h2");
  });
});

type Rec = { id: string } & Record<string, unknown>;
const rec = (id: string, sort: number, extra: Record<string, unknown> = {}) =>
  ({
    id,
    title: `T ${id}`,
    issuer: `I ${id}`,
    category: "",
    credential_number: "",
    show_number: false,
    issued_on: "",
    expires_on: "",
    verify_url: "",
    sort_order: sort,
    ...extra,
  }) as Rec;

describe("blockData (pure)", () => {
  it("groups by category in first-seen sort order, Other last", () => {
    const groups = selectCredentials(
      content(),
      [
        rec("m1", 3, { category: "Memberships" }),
        rec("l1", 1, { category: "Licenses" }),
        rec("o1", 0),
        rec("l2", 4, { category: "Licenses" }),
      ],
      NOW,
    );
    expect(groups.map((g) => g.category)).toEqual([
      "Licenses",
      "Memberships",
      "Other",
    ]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["l1", "l2"]);
  });

  it("returns one ungrouped group when group_by_category is off", () => {
    const groups = selectCredentials(
      content({ group_by_category: false }),
      [rec("b", 2, { category: "X" }), rec("a", 1, { category: "Y" })],
      NOW,
    );
    expect(groups).toEqual([
      {
        category: "",
        items: [
          expect.objectContaining({ id: "a" }),
          expect.objectContaining({ id: "b" }),
        ],
      },
    ]);
  });

  it("drops expired credentials using now, keeps one expiring today", () => {
    const groups = selectCredentials(
      content(),
      [
        rec("old", 1, { expires_on: "2026-09-27 00:00:00.000Z" }),
        rec("today", 2, { expires_on: "2026-09-28 00:00:00.000Z" }),
        rec("none", 3),
      ],
      NOW,
    );
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["today", "none"]);
    expect(groups[0]!.items[0]!.expires_on).toBe("2026-09-28");
    expect(
      selectCredentials(
        content(),
        [rec("old", 1, { expires_on: "2020-01-01" })],
        NOW,
      ),
    ).toEqual([]);
  });

  it("shows the number only when show_number is on (T-05-45)", () => {
    const out = blockData(
      [
        { id: "s1", section_type: "credentials", content: content() },
        { id: "s2", section_type: "hero", content: {} },
      ],
      {
        credentials: [
          rec("a", 1, { credential_number: "RN1", show_number: true }),
          rec("b", 2, { credential_number: "RN2", show_number: false }),
          rec("c", 3, { organization: "orgA" }),
        ],
      },
      NOW,
    );
    expect(Object.keys(out)).toEqual(["s1"]);
    const items = out.s1![0]!.items;
    expect(items.find((i) => i.id === "a")!.number).toBe("RN1");
    expect(items.find((i) => i.id === "b")!.number).toBeNull();
    expect(JSON.stringify(out)).not.toContain("RN2");
    expect(Object.keys(items[2]!)).not.toContain("organization");
  });

  it("is empty for a missing collection", () => {
    expect(
      blockData(
        [{ id: "s1", section_type: "credentials", content: content() }],
        {},
        NOW,
      ),
    ).toEqual({ s1: [] });
  });
});
