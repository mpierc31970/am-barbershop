// @vitest-environment jsdom
// Builder half of the P7 block contract (07-05; CONT-13, CONT-35, D280, D-UI-P7-13;
// 07-UI-SPEC "Block picker", "Heading rules"): SectionForm dispatch through the group
// maps, the fixed "Page title · H1" row, Hero hidden once used, picker groups.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme } from "@cds/core/theme";
import { ToastRegion } from "../hub/Toast";
import { BlockTemplatePicker } from "./BlockTemplatePicker";
import { PageTitleRow, SectionsList } from "./SectionsList";
import { SectionForm } from "./SectionForm";
import type { CoreBlockEditorProps } from "./blocks/types";
import type { BuilderSection } from "./section-form-logic";
import { mount, type Mounted } from "../test-support/dom";

vi.mock("./blocks/group-a", () => {
  function StubEditor({ type, content, errors, popups }: CoreBlockEditorProps) {
    return (
      <p data-stub-editor={type}>
        {`stub:${String(content.heading)}:${Object.keys(errors).length}:${popups.length}`}
      </p>
    );
  }
  return {
    BUILDER_BLOCKS_A: Object.freeze({
      "stub-block": { Editor: StubEditor, picker: "photos-video", order: 1 },
      // A core type with a definition, so the picker group has a tile to show.
      "text-only": { Editor: StubEditor, picker: "information", order: 1 },
    }),
  };
});

const NEUTRAL_THEME = resolveTheme(null);
const noop = () => {};
const ok = async () => true;

let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function row(
  id: string,
  section_type: string,
  content: unknown,
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
  };
}

function form(section: BuilderSection) {
  mounted = mount(
    <ToastRegion>
      <SectionForm
        theme={NEUTRAL_THEME}
        section={section}
        popups={[{ id: "pp", name: "Promo" }]}
        onSave={async () => ({ ok: true, data: section })}
        onDirtyChange={noop}
      />
    </ToastRegion>,
  );
  return mounted.container;
}

function list(h1OwnerId: string | null) {
  mounted = mount(
    <ToastRegion>
      <SectionsList
        sections={[
          row("a", "hero", { heading: "Welcome" }),
          row("b", "text-only", { heading: "About", text: "" }),
        ]}
        selectedId={null}
        h1OwnerId={h1OwnerId}
        onSelect={noop}
        onReorder={ok}
        onToggleHidden={noop}
        onDelete={noop}
        onAdd={noop}
      />
    </ToastRegion>,
  );
  return mounted.container;
}

function picker(hasHero?: boolean) {
  mounted = mount(
    <BlockTemplatePicker onPick={noop} onExit={noop} hasHero={hasHero} />,
  );
  return mounted.container;
}

const tileTitles = (root: HTMLElement) =>
  [...root.querySelectorAll("li button span span:first-child")].map(
    (el) => el.textContent,
  );

describe("SectionForm dispatch (07-05)", () => {
  it("renders a group-map editor with content, errors and popups", () => {
    const root = form(row("s", "stub-block", { heading: "Hi" }));
    const stub = root.querySelector('[data-stub-editor="stub-block"]');
    expect(stub?.textContent).toBe("stub:Hi:0:1");
    expect(root.textContent).not.toContain(
      "This block is set up from its add-on",
    );
  });

  it("falls through to the add-on copy for a type in no map", () => {
    const root = form(row("s", "nowhere-block", {}));
    expect(root.querySelector("[data-stub-editor]")).toBeNull();
    expect(root.textContent).toContain(
      "This block is set up from its add-on. Its content has no fields to edit here.",
    );
  });

  it.each(["__proto__", "constructor", "toString"])(
    "never resolves an editor for %s",
    (type) => {
      const root = form(row("s", type, {}));
      expect(root.querySelector("[data-stub-editor]")).toBeNull();
    },
  );
});

describe("PageTitleRow (D-UI-P7-13)", () => {
  it("shows a fixed, inert first row while no block owns the H1", () => {
    const root = list(null);
    const first = root.querySelector("ol > li");
    expect(first?.hasAttribute("data-page-title-row")).toBe(true);
    expect(first?.textContent).toContain("Page title · H1");
    expect(first?.textContent).toContain(
      "Shows your page title as the main heading, because this page has no Hero.",
    );
    expect(
      first?.querySelector("button, a, [tabindex], [draggable]"),
    ).toBeNull();
    expect(first?.getAttribute("tabindex")).toBeNull();
  });

  it("is absent once a Hero owns the H1, which keeps its badge", () => {
    const root = list("a");
    expect(root.querySelector("[data-page-title-row]")).toBeNull();
    expect(root.textContent).toContain("Page heading (H1)");
  });

  it("is exported for reuse and renders on its own", () => {
    mounted = mount(
      <ol>
        <PageTitleRow />
      </ol>,
    );
    expect(mounted.container.textContent).toContain("Page title · H1");
  });
});

describe("BlockTemplatePicker (CONT-35, 07-UI-SPEC)", () => {
  it("offers Hero only while the page has none", () => {
    expect(tileTitles(picker())).toContain("Hero");
    mounted?.unmount();
    mounted = null;
    expect(tileTitles(picker(true))).not.toContain("Hero");
  });

  it("renders a core group only when a map entry has a core definition", () => {
    const root = picker();
    const headings = [...root.querySelectorAll("h3")].map((h) => h.textContent);
    // stub-block has no core definition, so Photos and video stays absent.
    expect(headings).not.toContain("Photos and video");
    expect(headings).toContain("Information");
    expect(headings.indexOf("Information")).toBe(
      headings.indexOf("Blocks") + 1,
    );
  });
});

describe("builder/site group key parity", () => {
  it("BUILDER_BLOCKS_A/B keys equal SITE_BLOCKS_A/B keys", async () => {
    const realA =
      await vi.importActual<typeof import("./blocks/group-a")>(
        "./blocks/group-a",
      );
    const { BUILDER_BLOCKS_B } = await import("./blocks/group-b");
    const { SITE_BLOCKS_A } = await import("../site/blocks/group-a");
    const { SITE_BLOCKS_B } = await import("../site/blocks/group-b");
    expect(Object.keys(realA.BUILDER_BLOCKS_A).sort()).toEqual(
      Object.keys(SITE_BLOCKS_A).sort(),
    );
    expect(Object.keys(BUILDER_BLOCKS_B).sort()).toEqual(
      Object.keys(SITE_BLOCKS_B).sort(),
    );
  });
});
