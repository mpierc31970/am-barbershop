// P8 (08-13): helpers shared by the slot fills (TMPL-01, CONTEXT A1-Q3). Blocks start from a
// registered section type's fresh defaults (CORE_SECTIONS lookup, never a default imported by
// name) or from a Suggested preset's builder; slots then override fields. Pure.
import { CORE_SECTIONS } from "@cds/core/content";
import type { PresetContext } from "@cds/core/content/presets";
import type {
  AssemblyFacts,
  AssemblyMediaRef,
  SlotEnv,
} from "@cds/core/templates";

/** A registered core section type's fresh default content (throws on an unknown type). */
export function defaultsOf(type: string): Record<string, unknown> {
  const def = CORE_SECTIONS.find((d) => d.type === type);
  if (!def) throw new Error(`Unknown section type: ${type}`);
  return { ...(def.defaultContent() as Record<string, unknown>) };
}

/** One-line address for the Contact preset: "{street}, {city}" (either part alone). */
export function addressText(f: AssemblyFacts): string {
  return [f.street, f.city].filter((s) => s !== "").join(", ");
}

/** The PresetContext every preset build gets (D-UI-P8-8: phone and/or email always passed). */
export function presetContext(f: AssemblyFacts, env: SlotEnv): PresetContext {
  return {
    addressText: addressText(f),
    phone: f.phone,
    email: f.email,
    formId: env.refs.contactFormId,
    formItemId: env.refs.contactFormItemId,
    businessType: f.businessTypeId,
  };
}

/** Ids of placed refs without a reviewed description (CONTEXT A4-Q2), deduped. */
export function unreviewedIds(
  refs: readonly (AssemblyMediaRef | null | undefined)[],
): string[] {
  const out = new Set<string>();
  for (const r of refs) if (r && !r.alt_reviewed) out.add(r.id);
  return [...out];
}
