// Core block group B (owner 07-07): map, table, FAQ, icon list, hours, social.
//
// CORE_SECTIONS spreads P7_SECTIONS_B and SectionTypeMap extends P7SectionContentB, so
// 07-07 registers its blocks here without editing registry.ts. Block files import only
// TYPES from ../registry and runtime helpers from ../items/walk, ../layouts, ../validate
// (never runtime values from registry.ts, which would form an import cycle).
// Do not export from here through blocks/index.ts; that barrel is exports-b.ts's job.
//
// Types registered here (07-07), in 07-UI-SPEC Information order: faq, table, icon-list,
// hours, map, social. hours, social and map read coreData.business (apps/web
// lib/core-block-data.ts); the others are self-contained.
// 08-05 adds services and team (owner 08-04 definitions; TMPL-01, TMPL-02, CONTEXT A3-Q3,
// D253): data-bound blocks reading coreData.services / coreData.team (08-08 loader),
// registered here with their renderer and editor in one commit.
import type { SectionTypeDefinition } from "../registry";
import { faqSection, type FaqBlockContent } from "./faq";
import { hoursSection, type HoursBlockContent } from "./hours";
import { iconListSection, type IconListBlockContent } from "./icon-list";
import { mapSection, type MapBlockContent } from "./map";
import { servicesSection, type ServicesBlockContent } from "./services";
import { socialSection, type SocialBlockContent } from "./social";
import { tableSection, type TableBlockContent } from "./table";
import { teamSection, type TeamBlockContent } from "./team";

/** Content types of group B blocks, keyed by section type (merged into SectionTypeMap). */
export type P7SectionContentB = {
  faq: FaqBlockContent;
  table: TableBlockContent;
  "icon-list": IconListBlockContent;
  hours: HoursBlockContent;
  map: MapBlockContent;
  social: SocialBlockContent;
  services: ServicesBlockContent;
  team: TeamBlockContent;
};

/** Group B block definitions, in block-picker order. */
export const P7_SECTIONS_B: readonly SectionTypeDefinition[] = Object.freeze([
  faqSection,
  tableSection,
  iconListSection,
  hoursSection,
  mapSection,
  socialSection,
  servicesSection,
  teamSection,
]);
