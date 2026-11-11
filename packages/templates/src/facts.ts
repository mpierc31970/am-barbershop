// P8 (08-12): the one defensive parse of AssemblyIntake, CONTEXT A3-Q5 / ONB-03; slots read
// AssemblyFacts only; alt text comes from the intake media refs, never invented.
// Own-property reads with string/array guards (the ui package site/blocks/business.ts style):
// a malformed intake degrades to empty facts and never throws (T-08-12-02). Fallback values
// keep their `fallback` source in fieldSources so slots can report them.
import { DAYS } from "@cds/core/intake";
import { findBusinessType } from "@cds/core/onboarding";
import {
  copyGroupOf,
  type AssemblyFacts,
  type AssemblyIntake,
  type AssemblyMediaRef,
  type AssemblyService,
  type AssemblyTeamMember,
} from "@cds/core/templates";

type Source = "provided" | "fallback";

const own = (o: unknown, k: string): unknown =>
  isObj(o) && Object.prototype.hasOwnProperty.call(o, k)
    ? (o as Record<string, unknown>)[k]
    : undefined;

function isObj(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** One assembled field: { value, source } when well-formed, else null. */
function field(
  fields: unknown,
  id: string,
): { value: unknown; source: Source } | null {
  const f = own(fields, id);
  const source = own(f, "source");
  if (source !== "provided" && source !== "fallback") return null;
  return { value: own(f, "value"), source };
}

/** A field's string value (fallback text included); "" when absent or not a string. */
const text = (fields: unknown, id: string): string =>
  str(field(fields, id)?.value);

/** A media ref copied as-is: alt and alt_reviewed from the intake, never invented. */
function readRef(raw: unknown): AssemblyMediaRef | null {
  const id = own(raw, "id");
  if (typeof id !== "string" || id.trim() === "") return null;
  const alt = own(raw, "alt");
  return {
    id,
    alt: typeof alt === "string" ? alt : "",
    alt_reviewed: own(raw, "alt_reviewed") === true,
  };
}

function readRefs(raw: unknown): AssemblyMediaRef[] {
  if (!Array.isArray(raw)) return [];
  const out: AssemblyMediaRef[] = [];
  for (const r of raw as unknown[]) {
    const ref = readRef(r);
    if (ref) out.push(ref);
  }
  return out;
}

/** Published rows with a string id, in the owner's order. */
function published<T>(raw: unknown): T[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (r) => typeof own(r, "id") === "string" && own(r, "is_published") === true,
  ) as T[];
}

/** Real opening hours: a provided week where some day is open with a range. */
function hasRealHours(fields: unknown): boolean {
  const f = field(fields, "hours");
  if (f?.source !== "provided" || !isObj(f.value)) return false;
  return DAYS.some((d) => {
    const day = own(f.value, d);
    const ranges = own(day, "ranges");
    return (
      own(day, "open") === true && Array.isArray(ranges) && ranges.length > 0
    );
  });
}

function fieldSources(fields: unknown): Record<string, Source> {
  const out: Record<string, Source> = {};
  if (!isObj(fields)) return out;
  for (const id of Object.keys(fields)) {
    const f = field(fields, id);
    if (f) out[id] = f.source;
  }
  return out;
}

/** Parse the intake into the typed facts every slot reads (TMPL-02, TMPL-03). */
export function readFacts(intake: AssemblyIntake): AssemblyFacts {
  const fields = own(intake, "fields");
  const media = own(intake, "media");

  // business_type's fallback is the business name, not a type: only a provided value counts.
  const typeField = field(fields, "business_type");
  const businessTypeId =
    typeField?.source === "provided" ? str(typeField.value) : "";
  const type = findBusinessType(businessTypeId);

  const addressField = field(fields, "address");
  const address =
    addressField?.source === "provided" ? addressField.value : undefined;
  const street = str(own(address, "street"));
  const city = str(own(address, "city"));

  const contact = field(fields, "contact_method")?.value;

  return {
    businessName: text(fields, "org_name"),
    businessTypeId,
    // "Something else" is a picker label, not a fact: it never reaches public copy (CR-B03).
    businessTypeLabel: type
      ? type.id === "other"
        ? ""
        : type.label
      : businessTypeId,
    copyGroup: copyGroupOf(businessTypeId),
    tagline: text(fields, "tagline"),
    headline: text(fields, "headline"),
    about: text(fields, "about"),
    mission: text(fields, "mission"),
    city,
    street,
    serviceArea: text(fields, "service_area"),
    phone: str(own(contact, "phone")),
    email: str(own(contact, "email")),
    hasHours: hasRealHours(fields),
    hasAddress: street !== "" || city !== "",
    heroAsset: readRef(own(media, "hero")),
    logoAsset: readRef(own(media, "logo")),
    galleryAssets: readRefs(own(media, "gallery")),
    services: published<AssemblyService>(own(intake, "services")),
    team: published<AssemblyTeamMember>(own(intake, "team")),
    fieldSources: fieldSources(fields),
  };
}
