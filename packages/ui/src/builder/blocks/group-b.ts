// Builder editors for core block group B (owner 07-07). Picker group (07-UI-SPEC):
// Information: services, team, faq, table, icon-list, hours, map, social.
//
// Keys must equal SITE_BLOCKS_B's (block-contract.dom.test.tsx). SectionForm and the
// block picker read this map; no shared builder file needs editing to add a block.
//
// order uses slots of ten, agreed with 07-06 (tabs 20, stats 50): faq 10, table 30,
// icon-list 40, hours 60, map 70, social 80 (07-UI-SPEC "Block picker" Information order).
// 08-05: services 2 and team 4, first in Information (08-UI-SPEC "Builder changes").
// Editor owners: 07-21 (faq, table, icon-list), 07-24 (hours, map, social).
import { FaqEditor } from "./FaqEditor";
import { HoursEditor } from "./HoursEditor";
import { IconListEditor } from "./IconListEditor";
import { MapEditor } from "./MapEditor";
import { ServicesEditor } from "./ServicesEditor";
import { SocialEditor } from "./SocialEditor";
import { TableEditor } from "./TableEditor";
import { TeamEditor } from "./TeamEditor";
import type { BuilderBlockEntry } from "./types";

export const BUILDER_BLOCKS_B: Readonly<Record<string, BuilderBlockEntry>> =
  Object.freeze({
    services: { Editor: ServicesEditor, picker: "information", order: 2 },
    team: { Editor: TeamEditor, picker: "information", order: 4 },
    faq: { Editor: FaqEditor, picker: "information", order: 10 },
    table: { Editor: TableEditor, picker: "information", order: 30 },
    "icon-list": { Editor: IconListEditor, picker: "information", order: 40 },
    hours: { Editor: HoursEditor, picker: "information", order: 60 },
    map: { Editor: MapEditor, picker: "information", order: 70 },
    social: { Editor: SocialEditor, picker: "information", order: 80 },
  });
