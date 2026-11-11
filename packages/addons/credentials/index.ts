// @cds/addon-credentials: the manifest (ADDON-01, ADDON-02, ADDON-08; D35, D36). The second
// proof add-on, the "list" shape: ordered, grouped records with one fixed rendering. Pure
// and client-safe: the registry's "." entry imports this into the builder bundle, so
// nothing here reaches @cds/db, node:* or a React component.
import { defineAddon } from "@cds/core/addons";
import { CREDENTIALS_CONFIG } from "./addon.config";
import { CREDENTIALS_COLLECTIONS } from "./collections";
import { CREDENTIALS_CSV } from "./csv";
import { INSTALL } from "./install";
import { CREDENTIAL_RECORDS } from "./records";
import {
  credentialsSection,
  defaultCredentialsContent,
} from "./sections/definition";
import { TRAINING } from "./training";
import { UNINSTALL } from "./uninstall";

export type { CredentialsBlockContent } from "./sections/definition";

export default defineAddon({
  slug: CREDENTIALS_CONFIG.slug,
  name: CREDENTIALS_CONFIG.name,
  summary: CREDENTIALS_CONFIG.summary,
  category: CREDENTIALS_CONFIG.category,
  version: CREDENTIALS_CONFIG.version,
  order: CREDENTIALS_CONFIG.order,
  visibility: "public",
  paths: ["standard", "studio", "shop"],
  requires: [],
  conflicts: [],
  nav: {
    placement: "tab",
    item: "website",
    label: "Credentials",
    icon: "BadgeCheck",
  },
  sections: [credentialsSection],
  collections: CREDENTIALS_COLLECTIONS,
  records: { credentials: CREDENTIAL_RECORDS },
  install: INSTALL,
  uninstall: UNINSTALL,
  training: TRAINING,
  csv: { credentials: CREDENTIALS_CSV },
  // Template slots (08-07, CONTEXT A1-Q4): placed by assembly only when already active.
  templateSlots: [
    {
      slot: "proof",
      page: "home",
      section_type: "credentials",
      content: () => defaultCredentialsContent(),
    },
    {
      slot: "about",
      page: "about",
      section_type: "credentials",
      content: () => defaultCredentialsContent(),
    },
  ],
  // Privacy policy clause (09-11, AGR-08, D217): read by renderSitePolicy while active. DRAFT.
  privacyClauses: [
    {
      id: "credentials",
      heading: "Credentials",
      what: "License and certification details for our business and staff, such as the person's name, the credential, who issued it and when it expires.",
      why: "To show visitors that we are qualified to do the work we offer.",
      howLong: "Until we remove the credential from this site.",
    },
  ],
  // Intake "People & proof" step (CONTEXT A3-Q5). Intake holds rows on the intake record and
  // never writes this collection (invariant 3). No emails: nothing here sends mail in v1.0.
  intake: {
    records: {
      collection: "credentials",
      csv: "credentials",
      label: "Your licenses and awards",
      addOneLabel: "Add one by one",
    },
  },
});
