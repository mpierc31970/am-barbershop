// P8 (08-14) the one v1.0 site template (TMPL-01, TMPL-02; CONTEXT A1-Q1, A3-Q1/Q2; D60,
// D183, D276, D-UI-P8-21). Home + About for the standard and studio paths. Pure data: slots
// are imported from the slot barrel; the provisioner receives this through TEMPLATES.
import type { SiteTemplate, TemplatePage } from "@cds/core/templates";
import { readFacts } from "./facts";
import {
  aboutSlot,
  closingCtaSlot,
  contactSlot,
  faqSlot,
  gallerySlot,
  heroSlot,
  hoursLocationSlot,
  introSlot,
  proofSlot,
  servicesSlot,
  teamSlot,
} from "./slots/index";

const HOME: TemplatePage = {
  key: "home",
  slug: "home",
  title: () => "Home",
  navLabel: "Home",
  inNav: true,
  slots: [
    heroSlot,
    introSlot,
    servicesSlot,
    proofSlot,
    hoursLocationSlot,
    contactSlot,
    closingCtaSlot,
  ],
};

const ABOUT: TemplatePage = {
  key: "about",
  slug: "about",
  title: (intake) => {
    const name = readFacts(intake).businessName;
    return name === "" ? "About us" : `About ${name}`;
  },
  navLabel: "About",
  inNav: true,
  slots: [aboutSlot, teamSlot, gallerySlot, faqSlot, contactSlot],
};

export const STANDARD_V1: SiteTemplate = {
  id: "standard-v1",
  version: 1,
  label: "Standard",
  paths: ["standard", "studio"],
  pages: [HOME, ABOUT],
};
