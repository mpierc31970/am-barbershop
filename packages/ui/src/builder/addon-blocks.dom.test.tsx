// @vitest-environment jsdom
// Add-on blocks in the builder (05-UI-SPEC "Builder integration"; ADDON-05, ADDON-08). The
// picker offers active add-ons' blocks under "From your add-ons"; a block whose add-on is
// off is dimmed with an "Add-on off" badge, and its form is replaced by an alert while
// delete stays available. Add-on forms are injected: this package imports no add-on.
import { afterEach, describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  FULL_WIDTH_ONLY,
  composeSectionRegistry,
} from "@cds/core/content";
import { resolveTheme } from "@cds/core/theme";
import type { AddonBlockFormProps } from "../hub/addon-types";
import { ToastRegion } from "../hub/Toast";
import { BlockTemplatePicker, type BlockChoice } from "./BlockTemplatePicker";
import { SectionForm } from "./SectionForm";
import { SectionsList } from "./SectionsList";
import type { BuilderSection } from "./section-form-logic";
import { button, click, mount, type Mounted } from "../test-support/dom";

const THEME = resolveTheme(null);

const registry = composeSectionRegistry(CORE_SECTIONS, [
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Quotes from your customers",
    layouts: FULL_WIDTH_ONLY,
    defaultContent: () => ({ heading: "What people say", limit: 6 }),
    validate: (raw) => raw as Record<string, unknown>,
    mapRichText: (c) => c,
    textsOf: () => [],
    urlsOf: () => [],
    headings: { ownsH1: false, blockHeading: "h2" },
    refsOf: () => ({ popups: [], forms: [], media: [] }),
  },
]);

const ADDON_BLOCKS = [
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Quotes from your customers",
    icon: "MessageSquareQuote",
  },
];

const block: BuilderSection = {
  id: "s1",
  page: "p1",
  section_type: "testimonials",
  row_layout: "full",
  content: { heading: "What people say", limit: 6 },
  settings: { background_variant: "main" },
  sort_order: 1,
  is_published: true,
};

const hero: BuilderSection = {
  ...block,
  id: "s2",
  section_type: "hero",
  content: { heading: "Welcome" },
  sort_order: 2,
};

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function headings(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll("h3")).map(
    (h) => h.textContent ?? "",
  );
}

describe("BlockTemplatePicker: From your add-ons", () => {
  it("lists active add-ons' blocks below Blocks and picks their defaults", () => {
    const picked: BlockChoice[] = [];
    mounted = mount(
      <BlockTemplatePicker
        onPick={(c) => picked.push(c)}
        onExit={() => {}}
        addonBlocks={ADDON_BLOCKS}
        registry={registry}
      />,
    );
    const { container } = mounted;
    // Core block groups (07-06, 07-07) sit between Blocks and the add-ons; group-agnostic.
    const CORE_GROUPS = new Set(["Photos and video", "Information"]);
    expect(headings(container).filter((h) => !CORE_GROUPS.has(h))).toEqual([
      "Blocks",
      "From your add-ons",
      "Suggested",
    ]);
    const all = headings(container);
    expect(all.at(-2)).toBe("From your add-ons");
    click(button(container, /Testimonials/));
    expect(picked).toEqual([
      {
        section_type: "testimonials",
        row_layout: "full",
        content: { heading: "What people say", limit: 6 },
      },
    ]);
  });

  it("has no add-on group when none are active", () => {
    mounted = mount(
      <BlockTemplatePicker
        onPick={() => {}}
        onExit={() => {}}
        addonBlocks={[]}
        registry={registry}
      />,
    );
    expect(headings(mounted.container)).not.toContain("From your add-ons");
    expect(mounted.container.textContent).not.toContain("Testimonials");
  });
});

describe("SectionsList: a block whose add-on is off", () => {
  it("keeps its place with an Add-on off badge, dimmed, and delete available", () => {
    const deleted: string[] = [];
    mounted = mount(
      <ToastRegion>
        <SectionsList
          sections={[block, hero]}
          selectedId={null}
          h1OwnerId="s2"
          registry={registry}
          offTypes={new Set(["testimonials"])}
          onSelect={() => {}}
          onReorder={async () => true}
          onToggleHidden={() => {}}
          onDelete={(id) => deleted.push(id)}
          onAdd={() => {}}
        />
      </ToastRegion>,
    );
    const { container } = mounted;
    const rows = container.querySelectorAll("ol > li");
    expect(rows[0]!.textContent).toContain("Testimonials");
    expect(rows[0]!.textContent).toContain("Add-on off");
    expect(rows[1]!.textContent).not.toContain("Add-on off");
    expect(rows[0]!.querySelector(".opacity-60")?.textContent ?? "").toContain(
      "Testimonials",
    );
    click(button(rows[0]!, "More actions for Testimonials block"));
    click(button(rows[0]!, /Delete block/));
    expect(deleted).toEqual(["s1"]);
  });
});

describe("SectionForm: add-on blocks", () => {
  it("an off add-on shows the alert instead of the form, with delete", () => {
    let deletes = 0;
    mounted = mount(
      <SectionForm
        section={block}
        theme={THEME}
        popups={[]}
        registry={registry}
        onSave={async () => ({ ok: false, code: "x", message: "x" })}
        onDirtyChange={() => {}}
        addon={{ slug: "testimonials", name: "Testimonials", active: false }}
        renderAddonForm={() => <p>INJECTED FORM</p>}
        onDelete={() => {
          deletes += 1;
        }}
      />,
    );
    const { container } = mounted;
    expect(container.textContent).toContain(
      "Testimonials is off, so this block doesn't show on your site. Add Testimonials back to show it again, or delete this block.",
    );
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="/hub/add-ons/testimonials"]',
    );
    expect(link?.textContent).toBe("Add Testimonials back");
    expect(container.textContent).not.toContain("INJECTED FORM");
    expect(button(container, "Save block")).toBeNull();
    expect(container.textContent).not.toContain("Background");
    click(button(container, "Delete block"));
    expect(deletes).toBe(1);
  });

  it("an active add-on renders its injected form with the tab link", () => {
    const seen: AddonBlockFormProps[] = [];
    mounted = mount(
      <SectionForm
        section={block}
        theme={THEME}
        popups={[]}
        registry={registry}
        onSave={async () => ({ ok: false, code: "x", message: "x" })}
        onDirtyChange={() => {}}
        addon={{ slug: "testimonials", name: "Testimonials", active: true }}
        renderAddonForm={(type, props) => {
          seen.push(props);
          return <p data-type={type}>INJECTED FORM</p>;
        }}
      />,
    );
    const { container } = mounted;
    expect(container.textContent).toContain("INJECTED FORM");
    expect(
      container.querySelector("[data-type]")?.getAttribute("data-type"),
    ).toBe("testimonials");
    expect(seen[0]!.editHref).toBe("/hub/website?tab=testimonials");
    expect(seen[0]!.content).toMatchObject({ heading: "What people say" });
    expect(button(container, "Save block")).not.toBeNull();
    expect(container.textContent).toContain("Background");
  });
});
