// Fallback text (ONB-03): what the site shows when an optional field stays empty. null means
// the rule has no text of its own (the section is omitted, or CDS decides at build time).
import { findBusinessType } from "../onboarding/business-types";
import type { FallbackRule } from "./schema";
import type { IntakeSnapshot } from "./snapshot";

export function fallbackText(
  rule: FallbackRule,
  s: IntakeSnapshot,
): string | null {
  const name = s.orgName.trim();
  switch (rule) {
    case "wordmark":
    case "business-name":
      return name === "" ? null : name;
    case "about-from-type": {
      const type = findBusinessType(s.profile.business_type);
      if (!type || name === "") return null;
      const city = s.profile.address.city.trim();
      const seed =
        city === ""
          ? type.aboutSeed.replace(/\s+(in|serving) \{city\}/, "")
          : type.aboutSeed.replaceAll("{city}", city);
      return seed.replaceAll("{name}", name);
    }
    case "contact-for-hours":
      return "Contact us for hours";
    case "public-email": {
      const email = s.profile.public_email.trim();
      return email === "" ? null : email;
    }
    case "address-state": {
      const state = s.profile.address.state.trim();
      return state === "" ? null : state;
    }
    case "omit":
    case "no-section":
    case "cds-writes":
    case "theme-hero":
    case "initials":
    case "cds-choose":
    case "cds-colours":
    case "preview-address":
      return null;
  }
}
