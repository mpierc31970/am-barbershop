// Block list and picker markup (03-13; CONT-05, CONT-06; 03-UI-SPEC "SectionsList row",
// "BlockTemplatePicker", "Accessibility contract"). Server-rendered markup in the node
// unit project, like builder-components.test.tsx.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToastRegion } from "../hub/Toast";
import { BlockTemplatePicker } from "./BlockTemplatePicker";
import { resolveTheme } from "@cds/core/theme";
import { SectionForm } from "./SectionForm";
import { SectionsList } from "./SectionsList";
import type { BuilderSection } from "./section-form-logic";

const NEUTRAL_THEME = resolveTheme(null);

const noop = () => {};
const ok = async () => true;

function row(
  id: string,
  section_type: string,
  content: unknown,
  extra: Partial<BuilderSection> = {},
): BuilderSection {
  return {
    id,
    page: "p1",
    section_type,
    row_layout: "full",
    content,
    settings: { background_variant: "main" },
    sort_order: 1,
    is_published: true,
    ...extra,
  };
}

const rows = [
  row("a", "hero", { heading: "Welcome in" }),
  row("b", "columns", { columns: [] }, { row_layout: "40-60" }),
  row(
    "c",
    "text-only",
    { text: "<p>Hidden words</p>" },
    { is_published: false },
  ),
];

function list(selectedId: string | null = "a") {
  return renderToStaticMarkup(
    <ToastRegion>
      <SectionsList
        sections={rows}
        selectedId={selectedId}
        h1OwnerId="a"
        onSelect={noop}
        onReorder={ok}
        onToggleHidden={noop}
        onDelete={noop}
        onAdd={noop}
      />
    </ToastRegion>,
  );
}

describe("SectionsList", () => {
  it("10-32: a paused add-on's block says Paused with PAUSED-BLOCK; an uninstalled one keeps Add-on off", () => {
    const addonRows = [
      row("t", "testimonials-grid", {}),
      row("c2", "credentials-list", {}),
    ];
    const html = renderToStaticMarkup(
      <ToastRegion>
        <SectionsList
          sections={addonRows}
          selectedId={null}
          h1OwnerId={null}
          onSelect={noop}
          onReorder={ok}
          onToggleHidden={noop}
          onDelete={noop}
          onAdd={noop}
          offTypes={new Set(["testimonials-grid", "credentials-list"])}
          pausedTypes={{ "testimonials-grid": "Testimonials" }}
        />
      </ToastRegion>,
    );
    expect(html).toContain(
      "Testimonials is paused, so this block doesn&#x27;t show on your site. It comes back when payment does.",
    );
    expect(html.match(/>Paused</g)).toHaveLength(1);
    expect(html.match(/>Add-on off</g)).toHaveLength(1);
    expect(html.match(/data-paused-block/g)).toHaveLength(1);
  });

  it("names every drag handle after its block", () => {
    const html = list();
    expect(html).toContain('aria-label="Reorder Hero block"');
    expect(html).toContain('aria-label="Reorder Columns block"');
    expect(html).toContain('aria-label="Reorder Text block"');
  });

  it("marks the selected row, the H1 owner and hidden rows", () => {
    const html = list();
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain("H1");
    expect(html).toContain("Hidden");
    expect(html).toContain("opacity-60");
  });

  it("shows preview text, a small layout thumb on columns and Add block", () => {
    const html = list();
    expect(html).toContain("Welcome in");
    expect(html).toContain("Hidden words");
    expect(html).toContain('data-layout="40-60"');
    expect(html).toContain("Add block");
  });

  it("offers Move up / Move down with the ends aria-disabled, still focusable (WR-C11)", () => {
    const html = list();
    const tag = (label: string) =>
      html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ??
      "";
    expect(tag("Move Hero block up")).toContain('aria-disabled="true"');
    expect(tag("Move Text block down")).toContain('aria-disabled="true"');
    // A real `disabled` would drop keyboard focus to <body> when the row reaches an end.
    expect(tag("Move Hero block up")).not.toContain('disabled=""');
    expect(tag("Move Hero block down")).not.toContain('aria-disabled="true"');
  });
});

describe("SectionsList deleted-ref label (07-28, CONT-36)", () => {
  it("shows the server's label, ink-muted, on that row only", () => {
    const html = renderToStaticMarkup(
      <ToastRegion>
        <SectionsList
          sections={rows}
          selectedId={null}
          h1OwnerId="a"
          onSelect={noop}
          onReorder={ok}
          onToggleHidden={noop}
          onDelete={noop}
          onAdd={noop}
          deletedRefLabels={{ b: "Uses a deleted form" }}
        />
      </ToastRegion>,
    );
    expect(html.match(/data-deleted-ref/g)).toHaveLength(1);
    expect(html).toMatch(
      /<span class="text-sm text-hub-ink-muted" data-deleted-ref="[^"]*">Uses a deleted form<\/span>/,
    );
    expect(list(null)).not.toContain("data-deleted-ref");
  });
});

describe("BlockTemplatePicker", () => {
  const html = renderToStaticMarkup(
    <BlockTemplatePicker onPick={noop} onExit={noop} />,
  );

  it("lists the five blocks in picker order and the two presets", () => {
    const order = [
      "Hero",
      "Text &amp; image",
      "Text",
      "Call to action",
      "Columns",
      "Photo left, text right",
      "Three features",
    ].map((t) => html.indexOf(`>${t}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("lists the six Suggested presets in order (07-24, 11-49)", () => {
    const suggested = html.slice(html.indexOf(">Suggested<"));
    const order = [
      "Photo left, text right",
      "Three features",
      "Photo gallery",
      "Questions and answers",
      "Contact form and map",
      "Bio with photo",
    ].map((t) => suggested.indexOf(`>${t}<`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(suggested).toContain('data-layout="60-40"');
  });

  it("draws preset LayoutThumbs and offers the way back", () => {
    expect(html).toContain('data-layout="40-60"');
    expect(html).toContain('data-layout="33-33-33"');
    expect(html).toContain("Add a block");
    expect(html).toContain("Back to page");
  });
});

describe("SectionForm", () => {
  const save = async () => ({ ok: false as const, code: "x", message: "x" });
  function form(section: BuilderSection) {
    return renderToStaticMarkup(
      <ToastRegion>
        <SectionForm
          theme={NEUTRAL_THEME}
          section={section}
          popups={[]}
          onSave={save}
          onDirtyChange={noop}
        />
      </ToastRegion>,
    );
  }

  it("hero: every UI-SPEC field, no tagline, Background as the only style control", () => {
    const html = form(
      row("h", "hero", { heading: "Hi", tagline: "ZZ-EYEBROW" }),
    );
    for (const label of [
      "Hero block",
      "Show on page",
      "Heading",
      "Heading accent",
      "Words shown in the accent color",
      "Subtitle",
      "Main button text",
      "Main button link",
      "Second button text",
      "Second button link",
      "Trust line",
      "Image address",
      "Image description",
      "Background",
      "Page color",
      "Alternate color",
      "Save block",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain("ZZ-EYEBROW");
    expect(html).not.toMatch(/tagline/i);
  });

  it("Background swatches sit inside a [data-site] scope, so the site tokens resolve (WR-C09)", () => {
    const html = form(row("t", "text-only", { heading: "A", text: "" }));
    for (const cls of ['bg-site-surface"', 'bg-site-surface-raised"']) {
      const at = html.indexOf(cls);
      expect(at, cls).toBeGreaterThan(-1);
      const before = html.slice(0, at);
      const open = before.lastIndexOf('<span data-site=""');
      expect(open, cls).toBeGreaterThan(-1);
      // No closing </span> between the scope and the swatch: it is the swatch's parent.
      expect(before.slice(open)).not.toContain("</span>");
    }
  });

  it("Save block starts disabled and Discard changes is absent while clean", () => {
    const html = form(row("t", "text-only", { heading: "A", text: "" }));
    expect(html).toMatch(/<button type="submit" disabled=""/);
    expect(html).not.toContain("Discard changes");
  });

  it("call to action and text & image render their field sets", () => {
    const cta = form(row("c", "cta-banner", {}));
    expect(cta).toContain("Call to action block");
    expect(cta).toContain("Description");
    expect(cta).toContain("Button link");
    const ti = form(row("i", "text-image", { list_items: ["One", "Two"] }));
    expect(ti).toContain("List items");
    expect(ti).toContain("One\nTwo");
    expect(ti).toContain("Phone");
    expect(ti).toContain("Quote");
  });

  it("columns uses the ColumnsEditor layout picker", () => {
    const html = form(
      row("k", "columns", { columns: [{ id: "c1", items: [] }] }),
    );
    expect(html).toContain("Columns block");
    expect(html).toContain('role="radiogroup"');
  });

  it("the Show on page switch reflects a hidden block", () => {
    const shown = form(row("s", "text-only", {}));
    const hidden = form(row("s", "text-only", {}, { is_published: false }));
    expect(shown).toMatch(/role="switch"[^>]*checked=""/);
    expect(hidden).not.toMatch(/role="switch"[^>]*checked=""/);
  });
});
