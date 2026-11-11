// Deck render contract (15-10; 15-UI-SPEC "BladeDeck contents", "Add-ons", "Accessibility contract").
// Rendered with react-dom/server in the node unit project. Prices are built with formatMonthly so
// no price literal sits in marketing code (tests/marketing-boundary.test.ts rule e).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PRICE_SOON, formatMonthly } from "@cds/core/pricing";
import { MK_COPY, MK_PATHS, formulaSentence } from "@cds/core/marketing";
import type { BladeData } from "./Blade";
import { BladeDeck, fanAngles } from "./BladeDeck";
import { BladeRack } from "./BladeRack";
import { ChipField } from "./ChipField";
import { FormulaCard } from "./FormulaCard";
import { PathField } from "./PathField";
import { PriceRun } from "./PriceRun";
import { StepsList } from "./StepsList";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const liCount = (markup: string) => (markup.match(/<li\b/g) ?? []).length;
/** The markup of each <li>…</li> (no nested lists inside blades). */
const items = (markup: string) => markup.match(/<li\b[\s\S]*?<\/li>/g) ?? [];
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");

/** Every aria-label value, unescaped. */
const labels = (markup: string) =>
  [...markup.matchAll(/aria-label="([^"]*)"/g)].map((m) => text(m[1]!));

const NOT_ON = MK_COPY.ADDONS.NOT_ON_PATH;
const INCL = MK_COPY.ADDONS.INCLUDED;

const standard: BladeData = {
  key: "standard",
  name: "Standard",
  number: "No. 00",
  chip: "cobalt",
  href: "/standard",
  priceLines: [`Standard · ${formatMonthly(3900)}`],
  status: "available",
};
const studio: BladeData = {
  key: "studio",
  name: "Studio",
  number: "No. 00",
  chip: "berry",
  href: "/studio",
  priceLines: [`Studio · ${formatMonthly(7900)}`],
  status: "available",
};
const shop: BladeData = {
  key: "shop",
  name: "Shop",
  number: "No. 00",
  chip: "outline",
  href: null,
  priceLines: [],
  status: "coming_soon",
};
const addon = (
  key: string,
  name: string,
  chip: BladeData["chip"],
  n: number,
  priceLines: string[],
  status: BladeData["status"] = "available",
): BladeData => ({
  key,
  name,
  number: `No. 0${n}`,
  chip,
  href: status === "available" ? `/add-ons/${key}` : null,
  priceLines,
  status,
  tagline: `${name} for your site.`,
});

const builderPro = addon("builder-pro", "Builder Pro", "marigold", 1, [
  `Standard · ${formatMonthly(1500)}`,
  `Studio · ${INCL}`,
]);
const credentials = addon("credentials", "Credentials", "violet", 2, [
  `Standard · ${formatMonthly(900)}`,
  `Studio · ${formatMonthly(900)}`,
]);
const testimonials = addon("testimonials", "Testimonials", "teal", 3, [
  `Standard · ${formatMonthly(500)}`,
  `Studio · ${NOT_ON}`,
]);
const events = addon(
  "events",
  "Events",
  "rose",
  4,
  [PRICE_SOON],
  "coming_soon",
);

const many: BladeData[] = [
  standard,
  studio,
  shop,
  builderPro,
  credentials,
  testimonials,
  events,
  ...[5, 6, 7, 8, 9].map((n) =>
    addon(`extra-${n}`, `Extra ${n}`, "sky", n, [PRICE_SOON]),
  ),
];

describe("fanAngles", () => {
  it("spreads up to 72deg total with a step clamped to 6..14deg, symmetric about 0", () => {
    const nine = fanAngles(9);
    expect(nine).toHaveLength(9);
    expect(nine[0]).toBeCloseTo(-36);
    expect(nine[8]).toBeCloseTo(36);
    expect(nine[4]).toBeCloseTo(0);
    const five = fanAngles(5); // 72/4 = 18 -> clamped to 14
    expect(five[1]! - five[0]!).toBeCloseTo(14);
    expect(five[0]).toBeCloseTo(-28);
    expect(fanAngles(1)).toEqual([0]);
  });
});

describe("BladeDeck", () => {
  const out = html(<BladeDeck blades={many} />);

  it("is a labelled list of at most 9 blades in DOM order", () => {
    expect(out).toMatch(/<ul[^>]*aria-label="Paths and add-ons"/);
    expect(liCount(out)).toBe(9);
    const names = ["Standard", "Studio", "Shop", "Builder Pro", "Credentials"];
    const at = names.map((n) => out.indexOf(`>${n}<`));
    for (const i of at) expect(i).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(out).not.toContain("Extra 8");
  });

  it("renders a fan for 5 or more blades, with Standard lifted by default", () => {
    expect(out).toMatch(/<ul[^>]*data-mk-deck="fan"/);
    const lifted = items(out).filter((li) => li.includes("data-mk-lifted"));
    expect(lifted).toHaveLength(1);
    expect(lifted[0]).toContain(">Standard<");
    expect(out).toContain("--mk-a:");
  });

  it("names every link '<Name>, <price run>'", () => {
    for (const b of many.slice(0, 9).filter((x) => x.status === "available")) {
      const name = [b.name, ...b.priceLines].join(", ");
      expect(text(out.match(/aria-label="([^"]*)"/g)!.join("\n"))).toContain(
        name,
      );
    }
    expect(labels(out)).toContain(
      `Standard, Standard · ${formatMonthly(3900)}`,
    );
  });

  it("keeps coming-soon blades as plain list text, never a link", () => {
    const shopLi = items(out).find((li) => li.includes(">Shop<"))!;
    expect(shopLi).not.toMatch(/<a\b/);
    expect(text(shopLi)).toContain(MK_COPY.COMMON.COMING_SOON);
    const eventsLi = items(out).find((li) => li.includes(">Events<"))!;
    expect(eventsLi).not.toMatch(/<a\b/);
  });

  it("offers See all add-ons for the closed deck", () => {
    expect(out).toMatch(/href="\/add-ons"[^>]*>See all add-ons</);
  });

  it("renders closed-deck rows, not a fan, below 5 blades", () => {
    const four = html(
      <BladeDeck blades={[standard, studio, shop, builderPro]} />,
    );
    expect(four).toContain('data-mk-deck="rows"');
    expect(four).not.toMatch(/<ul[^>]*data-mk-deck="fan"/);
    expect(liCount(four)).toBe(4);
    expect(four).toMatch(/aria-label="Paths and add-ons"/);
  });

  it("draws a blade box as an ink scope, so Coming soon is never white on white (CR-C01)", () => {
    // PathPage renders the add-on deck inside the cobalt / berry field (--mk-fg = card).
    const onCobalt = html(
      <ChipField field="cobalt">
        <BladeDeck blades={[shop, builderPro]} />
      </ChipField>,
    );
    const css = /<style>([\s\S]*?)<\/style>/.exec(onCobalt)?.[1] ?? "";
    const box = /\[data-mk-deck\] \[data-mk-blade-box\] \{([^}]*)\}/.exec(css);
    expect(box?.[1]).toContain("--mk-fg: var(--mk-ink)");
    expect(box?.[1]).toContain("--mk-muted: var(--mk-ink-muted)");
    // the focus ring stays the field's (an ink ring on cobalt would fail contrast)
    expect(box?.[1]).not.toContain("--mk-focus");
    const shopLi = items(onCobalt).find((li) => li.includes(">Shop<"))!;
    expect(shopLi).toContain("data-mk-blade-box");
    expect(text(shopLi)).toContain(MK_COPY.COMMON.COMING_SOON);
  });

  it("respects reduced motion in its stylesheet", () => {
    expect(out).toContain("prefers-reduced-motion");
    // the stylesheet is written raw (child combinators intact, never HTML-escaped)
    const css = /<style>([\s\S]*?)<\/style>/.exec(out)?.[1] ?? "";
    expect(css).toContain("> li");
    expect(css).not.toContain("&gt;");
  });
});

describe("BladeRack", () => {
  const out = html(
    <BladeRack blades={[builderPro, credentials, testimonials, events]} />,
  );

  it("links Add to my site to /start?addon=<slug> for available add-ons only", () => {
    const adds = [...out.matchAll(/href="(\/start\?addon=[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(adds).toEqual([
      "/start?addon=builder-pro",
      "/start?addon=credentials",
      "/start?addon=testimonials",
    ]);
    expect(out).toContain(MK_COPY.ADDONS.ADD);
    const eventsLi = items(out).find((li) => li.includes(">Events<"))!;
    expect(eventsLi).not.toMatch(/<a\b/);
    expect(text(eventsLi)).toContain(MK_COPY.COMMON.COMING_SOON);
  });

  it("makes each rack blade an ink scope for the tag and Add button (CR-C01)", () => {
    const blades = items(out);
    expect(blades.length).toBeGreaterThan(0);
    for (const li of blades) {
      expect(li).toMatch(
        /data-mk-blade="" style="--mk-fg:var\(--mk-ink\);--mk-muted:var\(--mk-ink-muted\)"/,
      );
    }
  });

  it("names each blade link with its price run and links the detail page", () => {
    expect(out).toMatch(/href="\/add-ons\/credentials"/);
    expect(labels(out)).toContain(
      `Credentials, Standard · ${formatMonthly(900)}, Studio · ${formatMonthly(900)}`,
    );
  });

  it("is a list with one item per blade and h3 names by default", () => {
    expect(liCount(out)).toBe(4);
    expect(out).toMatch(/<h3[^>]*>[\s\S]*?Builder Pro/);
    const h2 = html(<BladeRack blades={[builderPro]} headingLevel={2} />);
    expect(h2).toMatch(/<h2[^>]*>[\s\S]*?Builder Pro/);
  });

  it("shows the Not on this path line with a Minus icon", () => {
    const li = items(out).find((x) => x.includes(">Testimonials<"))!;
    expect(li).toMatch(/<svg[^>]*aria-hidden="true"[\s\S]*?Not on this path/);
  });
});

describe("PriceRun", () => {
  it("prints exactly the strings it is given, one per line", () => {
    const lines = [
      `Standard · ${formatMonthly(900)}`,
      `Studio · ${INCL}`,
      `Studio · ${NOT_ON}`,
      PRICE_SOON,
    ];
    const out = html(<PriceRun lines={lines} />);
    expect(out).toContain("mk-figures");
    const spans = [
      ...out.matchAll(/<span data-mk-run-line[^>]*>([\s\S]*?)<\/span>/g),
    ].map((m) => text(m[1]!));
    expect(spans).toEqual(lines);
  });

  it("renders nothing for no lines", () => {
    expect(html(<PriceRun lines={[]} />)).toBe("");
  });
});

describe("FormulaCard", () => {
  const example = {
    title: "A coach",
    parts: [
      { name: "Standard", chip: "cobalt" as const },
      { name: "Newsletter", chip: "rose" as const },
    ],
    total: formatMonthly(8300),
  };

  it("renders nothing for a null example", () => {
    expect(html(<FormulaCard example={null} />)).toBe("");
  });

  it("joins chip dots and names with + and = the catalog total, glyphs aria-hidden", () => {
    const out = html(<FormulaCard example={example} />);
    expect(out).toContain(">A coach<");
    expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>\+<\/span>/);
    expect(out).toMatch(/<span[^>]*aria-hidden="true"[^>]*>=<\/span>/);
    expect(out).toContain(`>${formatMonthly(8300)}<`);
    expect(out.indexOf(">Standard<")).toBeLessThan(out.indexOf(">Newsletter<"));
    expect((out.match(/data-mk-dot/g) ?? []).length).toBe(2);
  });

  it("carries an sr-only sentence", () => {
    const out = html(<FormulaCard example={example} />);
    const sr = /<span class="sr-only">([^<]*)<\/span>/.exec(out)?.[1];
    expect(sr).toBe(
      formulaSentence(
        ["Standard", "Newsletter"],
        formatMonthly(8300).replace("/mo", " a month"),
      ),
    );
    const given = html(
      <FormulaCard example={{ ...example, srSentence: "Custom sentence." }} />,
    );
    expect(given).toContain(">Custom sentence.<");
  });

  it("reads Price coming soon when the catalog total is unset", () => {
    const out = html(
      <FormulaCard example={{ ...example, total: PRICE_SOON }} />,
    );
    expect(out).toContain(`>${PRICE_SOON}<`);
    expect(text(out)).toContain(`Standard plus Newsletter: ${PRICE_SOON}.`);
  });
});

describe("PathField", () => {
  const studio = MK_PATHS.studio;
  const out = html(
    <PathField
      path="studio"
      whoFor={studio.whoFor}
      priceLine={PRICE_SOON}
      included={studio.included}
      startHref={studio.startHref}
      aboutHref={studio.aboutHref}
    />,
  );

  it("is a berry field with the path name, who it's for and the price line", () => {
    expect(out).toContain('data-mk-field="berry"');
    expect(out).toMatch(/<h3[^>]*>Studio<\/h3>/);
    expect(out).toContain(studio.whoFor);
    expect(out).toContain(`>${PRICE_SOON}<`);
  });

  it("lists included lines with a Coming soon tag on unshipped ones only", () => {
    const lis = items(out);
    expect(lis).toHaveLength(studio.included.length);
    studio.included.forEach((line, i) => {
      expect(text(lis[i]!)).toContain(line.text);
      expect(lis[i]!.includes(MK_COPY.COMMON.COMING_SOON)).toBe(!line.shipped);
    });
  });

  it("links Start on Studio and About Studio", () => {
    expect(out).toMatch(/href="\/start\?path=studio"[^>]*>Start on Studio/);
    expect(out).toMatch(/href="\/studio"[^>]*>About Studio/);
  });

  it("omits the price line when the catalog failed", () => {
    const none = html(
      <PathField
        path="standard"
        whoFor={MK_PATHS.standard.whoFor}
        priceLine={null}
        included={MK_PATHS.standard.included}
        startHref={MK_PATHS.standard.startHref}
        aboutHref={MK_PATHS.standard.aboutHref}
      />,
    );
    expect(none).toContain('data-mk-field="cobalt"');
    expect(none).not.toContain("data-mk-path-price");
  });
});

describe("StepsList", () => {
  it("renders the steps as an ordered list", () => {
    const out = html(<StepsList steps={MK_COPY.HOME.STEPS} />);
    expect(out).toMatch(/^<ol\b/);
    expect(liCount(out)).toBe(4);
    for (const s of MK_COPY.HOME.STEPS) {
      expect(out).toContain(s.title);
      expect(out).toContain(s.body);
    }
  });
});
