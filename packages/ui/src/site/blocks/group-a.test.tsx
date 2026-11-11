// Site half of core block group A (07-06; CONT-22, CONT-23, CONT-27, CONT-35).
// Stubs render nothing until 07-20 / 07-21 / 07-22; a page with a slider and tabs and no
// Hero still has exactly one h1 (the page title).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CORE_SECTIONS,
  composeSectionRegistry,
  type PublishedPage,
  type PublishedSection,
} from "@cds/core/content";
import { PageRenderer } from "../PageRenderer";
import { SectionRenderer } from "../SectionRenderer";
import { SITE_BLOCKS_A } from "./group-a";

const html = (node: ReactElement) => renderToStaticMarkup(node);
const NOW = new Date("2026-10-01T12:00:00.000Z");
const TYPES = ["gallery", "slider", "tabs", "logo-strip", "stats"];
const registry = composeSectionRegistry(CORE_SECTIONS, []);

function section(type: string, id = `s-${type}`): PublishedSection {
  const def = registry.get(type)!;
  return {
    id,
    section_type: type,
    row_layout: "full",
    settings: { background_variant: "main" },
    content: def.defaultContent(),
  } as PublishedSection;
}

describe("SITE_BLOCKS_A", () => {
  it("holds exactly the five group A types", () => {
    expect(Object.keys(SITE_BLOCKS_A).sort()).toEqual([...TYPES].sort());
    expect(Object.isFrozen(SITE_BLOCKS_A)).toBe(true);
  });

  it.each(TYPES)("%s stub renders empty markup", (type) => {
    const out = html(
      <SectionRenderer
        section={section(type)}
        registry={registry}
        isH1Owner={false}
        isFirst={false}
        now={NOW}
      />,
    );
    expect(out).toBe("");
  });

  it("a page with a slider and tabs and no Hero has exactly one h1 (CONT-35)", () => {
    const page: PublishedPage = {
      version: 1,
      page: {
        id: "p1",
        slug: "home",
        title: "Home",
        seo: {},
        password_protected: false,
      },
      sections: [section("slider"), section("tabs")],
      published_at: NOW.toISOString(),
    } as PublishedPage;
    const out = html(
      <PageRenderer page={page} registry={registry} now={NOW} />,
    );
    expect(out.match(/<h1/g)?.length ?? 0).toBe(1);
    expect(out).toMatch(/<h1 data-page-title=""[^>]*>Home<\/h1>/);
  });
});
