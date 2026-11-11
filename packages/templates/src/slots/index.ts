// P8 (08-14): every template slot (TMPL-01). Home: hero, intro, services, proof,
// hours-location, contact, closing-cta. About: about, team, gallery, faq, contact.
import type { Slot } from "@cds/core/templates";
import { aboutSlot } from "./about";
import { closingCtaSlot } from "./closing-cta";
import { contactSlot } from "./contact";
import { faqSlot } from "./faq";
import { gallerySlot } from "./gallery";
import { heroSlot } from "./hero";
import { hoursLocationSlot } from "./hours-location";
import { introSlot } from "./intro";
import { proofSlot } from "./proof";
import { servicesSlot } from "./services";
import { teamSlot } from "./team";

export {
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
};
export { contributionsFor } from "./contributions";

/** All slots keyed by name (each slot's `name` equals its key). */
export const ALL_SLOTS: Readonly<Record<string, Slot>> = Object.freeze({
  hero: heroSlot,
  intro: introSlot,
  services: servicesSlot,
  proof: proofSlot,
  "hours-location": hoursLocationSlot,
  contact: contactSlot,
  "closing-cta": closingCtaSlot,
  about: aboutSlot,
  team: teamSlot,
  gallery: gallerySlot,
  faq: faqSlot,
});
