// P8 (08-14): add-on `templateSlots` contributions for one slot (TMPL-03; CONTEXT A1-Q4,
// invariants 4 and 5). Read through the registry (`env.addons.list()`), placed only for
// add-ons in `env.activeAddons` and only when the contribution names this page or no page.
// Shared by `proof` (Home) and `about` (About). Never imports an add-on. Pure.
import type { PresetBlock } from "@cds/core/content/presets";
import {
  slotLabel,
  type AssemblyIntake,
  type SlotEnv,
  type TemplateSlotInput,
} from "@cds/core/templates";

/**
 * The narrowed intake one add-on's contribution sees (invariant 4; 08-REVIEW WR-B04): org
 * context, the core fields plus its own `addon_<slug>_*` fields, and its own intake config.
 * Never another add-on's fields or config, nor team, services, selections or moodboard.
 */
export function slotInputFor(
  intake: AssemblyIntake,
  slug: string,
): TemplateSlotInput {
  const own = `addon_${slug}_`;
  const fields = Object.fromEntries(
    Object.entries(intake.fields ?? {}).filter(
      ([id]) => !id.startsWith("addon_") || id.startsWith(own),
    ),
  );
  const config = intake.addonConfig ?? {};
  return {
    orgId: intake.orgId,
    path: intake.path,
    fields,
    addonConfig: Object.hasOwn(config, slug) ? config[slug]! : null,
  };
}

export function contributionsFor(
  intake: AssemblyIntake,
  env: SlotEnv,
  slot: string,
): { blocks: PresetBlock[]; names: string[]; polish: string[] } {
  const blocks: PresetBlock[] = [];
  const names: string[] = [];
  const polish: string[] = [];
  for (const manifest of env.addons.list()) {
    if (!env.activeAddons.has(manifest.slug)) continue;
    for (const c of manifest.templateSlots ?? []) {
      if (c.slot !== slot) continue;
      if (c.page !== undefined && c.page !== env.pageKey) continue;
      const section = manifest.sections.find((s) => s.type === c.section_type);
      // The add-on section's own first layout (invariant 6 clamp fallback).
      const row_layout = section?.layouts[0] ?? "full";
      // A contribution is optional: one that throws or fails its own section validator is
      // dropped with a polish line, never failing the whole build (08-REVIEW WR-B05).
      let content: unknown;
      try {
        content = c.content(slotInputFor(intake, manifest.slug));
        if (!section) throw new Error("unknown section");
        section.validate(content, row_layout);
      } catch {
        const line = `${slotLabel(slot)} · ${manifest.name} could not be placed`;
        if (!polish.includes(line)) polish.push(line);
        continue;
      }
      blocks.push({ section_type: c.section_type, row_layout, content });
      if (!names.includes(manifest.name)) names.push(manifest.name);
    }
  }
  return { blocks, names, polish };
}
