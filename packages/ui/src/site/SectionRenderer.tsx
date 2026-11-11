// Registry-dispatching section renderer (CONT-02, CONT-03, CONT-04, D31, D32;
// invariants 5, 6 and 7).
//
// Ported from donor src/components/sections/SectionRenderer.tsx L51-146. The donor's
// fixed switch becomes a lookup: the section type must be registered in the composed
// registry, and core types map to CORE_SECTION_COMPONENTS. A registered type with no core
// component falls back to an injected add-on renderer (05-10: the app passes the registry's
// renderers in, so @cds/ui never imports an add-on). No renderer, or an unknown type,
// renders nothing and never throws. The stored row_layout is clamped on read to the type's
// allowlist; only background_variant is read from settings (invariant 7).
import type { ComponentType } from "react";
import {
  clampLayout,
  type PublishedSection,
  type SectionRegistry,
} from "@cds/core/content";
import { ColumnsSection } from "./ColumnsSection";
import { CtaBannerSection } from "./CtaBannerSection";
import { HeroSection } from "./HeroSection";
import { TextImageSection } from "./TextImageSection";
import { TextOnlySection } from "./TextOnlySection";
import { SITE_BLOCKS_A } from "./blocks/group-a";
import { SITE_BLOCKS_B } from "./blocks/group-b";
import type {
  AddonSectionProps,
  CoreBoundData,
  SectionComponentProps,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- renderers are typed per add-on */
export type InjectedSectionRenderer = ComponentType<
  AddonSectionProps<any, any>
>;
/* eslint-enable @typescript-eslint/no-explicit-any */

const hasOwn = (o: object, k: string) =>
  Object.prototype.hasOwnProperty.call(o, k);

// Keyed exactly like renderable.ts's CORE_SECTION_TYPES (CORE_SECTIONS), so the
// h1/eager-image helper and this dispatch can never disagree about which types render
// (WR-C08; parity test in page-title.test.tsx). P7 blocks plug in through the group maps
// (07-06, 07-07); they are spread first so a group can never replace a base type.
// Each component narrows `content` to its own shape; the registry has validated it.
export const CORE_SECTION_COMPONENTS: Readonly<
  Record<string, ComponentType<SectionComponentProps<never>>>
> = Object.freeze({
  ...SITE_BLOCKS_A,
  ...SITE_BLOCKS_B,
  columns: ColumnsSection,
  hero: HeroSection,
  "text-image": TextImageSection,
  "text-only": TextOnlySection,
  "cta-banner": CtaBannerSection,
});

export interface SectionRendererProps {
  section: PublishedSection;
  registry: SectionRegistry;
  isH1Owner: boolean;
  isFirst: boolean;
  now: Date;
  /** See SectionComponentProps.openablePopups (WR-C07). */
  openablePopups?: ReadonlySet<string>;
  /** Add-on renderers by section type, injected by the app (own-property lookups only). */
  renderers?: Readonly<Record<string, InjectedSectionRenderer>>;
  /** Live data for this section (the add-on's blockData result), passed as `data`. */
  data?: unknown;
  /** Core bound data for the page; passed to core components only, never to add-ons. */
  coreData?: CoreBoundData;
}

export function SectionRenderer({
  section,
  registry,
  isH1Owner,
  isFirst,
  now,
  openablePopups,
  renderers,
  data,
  coreData,
}: SectionRendererProps) {
  const def = registry.get(section.section_type);
  if (!def) return null;
  const type = section.section_type;
  const Core = hasOwn(CORE_SECTION_COMPONENTS, type)
    ? (CORE_SECTION_COMPONENTS[type] as ComponentType<
        SectionComponentProps<unknown>
      >)
    : undefined;
  const Addon =
    !Core && renderers && hasOwn(renderers, type) ? renderers[type] : undefined;
  if (!Core && !Addon) return null;

  const layout = clampLayout(def.layouts, section.row_layout);
  const settings = section.settings as { background_variant?: unknown } | null;
  const background =
    settings?.background_variant === "alternate" ? "alternate" : "main";

  const props: SectionComponentProps<unknown> = {
    content: section.content,
    layout,
    background,
    isH1Owner,
    isFirst,
    now,
    openablePopups,
  };
  if (Core)
    return <Core {...props} coreData={coreData} sectionId={section.id} />;
  const Injected = Addon!;
  return <Injected {...props} data={data} />;
}
