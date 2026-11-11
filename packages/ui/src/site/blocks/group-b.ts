// Site components for core block group B (owner 07-07): map, table, faq, icon-list, hours,
// social.
//
// SectionRenderer's CORE_SECTION_COMPONENTS spreads this map (before the five base types,
// so a group entry can never replace one). Add the core definition in `@cds/core`
// `content/blocks/group-b.ts` and the component here in the same commit: the parity test
// (page-title.test.tsx) fails when a CORE_SECTIONS type has no component.
// Markup owners: 07-21 (faq, table, icon-list), 07-24 (hours, map, social). hours, map and
// social read coreData.business (PublicBusiness from @cds/db, via apps/web core-block-data).
// 08-05: services and team read coreData.services / coreData.team (published only, 08-08).
import type { ComponentType } from "react";
import type { SectionComponentProps } from "../types";
import { FaqSection } from "./FaqSection";
import { HoursSection } from "./HoursSection";
import { IconListSection } from "./IconListSection";
import { MapSection } from "./MapSection";
import { ServicesSection } from "./ServicesSection";
import { SocialSection } from "./SocialSection";
import { TableSection } from "./TableSection";
import { TeamSection } from "./TeamSection";

export const SITE_BLOCKS_B: Readonly<
  Record<string, ComponentType<SectionComponentProps<never>>>
> = Object.freeze({
  faq: FaqSection,
  table: TableSection,
  "icon-list": IconListSection,
  hours: HoursSection,
  map: MapSection,
  social: SocialSection,
  services: ServicesSection,
  team: TeamSection,
});
