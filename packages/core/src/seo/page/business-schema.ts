// Business type -> schema.org LocalBusiness subtype (07-30 choice 4; CONT-13, D188, D253).
//
// Conservative on purpose: a wrong specific type is worse than the generic LocalBusiness.
// Every BUSINESS_TYPES id is mapped (business-schema.test.ts fails on a new id). The map is a
// literal so the seo subpath never pulls in the onboarding module.
// Pure, Edge-safe (07-02 header rule): no node:, no html cleaner, no next/* imports.

export const SCHEMA_TYPE_BY_BUSINESS: Readonly<Record<string, string>> =
  Object.freeze({
    therapist: "ProfessionalService",
    counselor: "ProfessionalService",
    coach: "ProfessionalService",
    consultant: "ProfessionalService",
    tutor: "ProfessionalService",
    "personal-trainer": "ExerciseGym",
    "yoga-studio": "ExerciseGym",
    photographer: "ProfessionalService",
    accountant: "AccountingService",
    "cleaning-service": "HomeAndConstructionBusiness",
    "home-services": "HomeAndConstructionBusiness",
    bakery: "Bakery",
    restaurant: "Restaurant",
    "retail-store": "Store",
    "paint-store": "Store",
    nonprofit: "NGO",
    "event-host": "LocalBusiness",
    "astrologer-psychic": "LocalBusiness",
    "cbd-shop": "Store",
    "financial-advisor": "FinancialService",
    "hair-salon": "HairSalon",
    barber: "HairSalon",
    "nail-salon": "NailSalon",
    "lash-studio": "BeautySalon",
    "brow-bar": "BeautySalon",
    esthetician: "BeautySalon",
    "day-spa": "DaySpa",
    massage: "HealthAndBeautyBusiness",
    tattoo: "TattooParlor",
    "med-spa": "HealthAndBeautyBusiness",
    "wellness-clinic": "HealthAndBeautyBusiness",
    "pet-grooming": "LocalBusiness",
    other: "LocalBusiness",
  });

/** The schema.org type for a business type id; unknown or missing -> "LocalBusiness". */
export function schemaTypeFor(id: unknown): string {
  if (typeof id !== "string" || !Object.hasOwn(SCHEMA_TYPE_BY_BUSINESS, id)) {
    return "LocalBusiness";
  }
  return SCHEMA_TYPE_BY_BUSINESS[id] ?? "LocalBusiness";
}
