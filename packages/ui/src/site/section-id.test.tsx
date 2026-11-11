// SectionRenderer hands core blocks their stable section id (07-22 decision 1).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  type PublishedSection,
} from "@cds/core/content";
import type { SectionComponentProps } from "./types";

vi.mock("./blocks/group-a", async (orig) => {
  const real = (await orig()) as { SITE_BLOCKS_A: Record<string, unknown> };
  function Probe(props: SectionComponentProps) {
    return <i data-section-id={props.sectionId ?? "none"} />;
  }
  return { SITE_BLOCKS_A: { ...real.SITE_BLOCKS_A, gallery: Probe } };
});

const { SectionRenderer } = await import("./SectionRenderer");

describe("SectionRenderer sectionId", () => {
  it("passes section.id to a core block", () => {
    const section = {
      id: "sec_42",
      section_type: "gallery",
      row_layout: "full",
      settings: null,
      content: {},
    } as unknown as PublishedSection;
    const out = renderToStaticMarkup(
      <SectionRenderer
        section={section}
        registry={composeSectionRegistry(CORE_SECTIONS, [])}
        isH1Owner={false}
        isFirst={false}
        now={new Date(0)}
      />,
    );
    expect(out).toBe('<i data-section-id="sec_42"></i>');
  });
});
