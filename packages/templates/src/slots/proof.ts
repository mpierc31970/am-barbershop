// P8 (08-13) Home slot 4 `proof` (08-UI-SPEC Home row 4; TMPL-01, TMPL-03; CONTEXT A1-Q4,
// invariants 4 and 5). Add-on `templateSlots` contributions, read through the registry
// (`env.addons.list()`), placed only for add-ons in `env.activeAddons` (T-08-13-03) and only
// when the contribution names this page or no page (contributions.ts, shared with `about`).
// Never imports an add-on. No active contributor -> Left out ("No add-on installed").
import { SLOT_LABELS, type Slot } from "@cds/core/templates";
import { contributionsFor } from "./contributions";

export const proofSlot: Slot = {
  name: "proof",
  label: SLOT_LABELS.proof!,
  fill(intake, env) {
    const { blocks, names, polish } = contributionsFor(intake, env, "proof");
    const extra = polish.length > 0 ? { polish } : {};
    if (blocks.length === 0) {
      return {
        blocks: [],
        source: "omitted",
        note:
          polish.length > 0 ? "Add-on block not placed" : "No add-on installed",
        ...extra,
      };
    }
    return { blocks, source: "provided", note: names.join(", "), ...extra };
  },
};
