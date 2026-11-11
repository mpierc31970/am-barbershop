// "What's still needed" (ONB-02, D312, D-UI-P6-17). One pure function family shared by the hub
// setup overview, P8 assembly and P11 launch checks. A stage is done when it has been saved at
// least once and no required item in it is missing; optional gaps never block done.
import { INTAKE_FIELDS, type IntakeField } from "./schema";
import type { IntakeSnapshot } from "./snapshot";
import { STAGES, type StageSlug } from "./stages";

export type NeededItem = {
  fieldId: string;
  label: string;
  stage: StageSlug;
  href: string;
  ownerText?: string;
};

function toItem(f: IntakeField): NeededItem {
  const item: NeededItem = {
    fieldId: f.id,
    label: f.label,
    stage: f.stage,
    href: `/hub/setup/${f.stage}#${f.anchor}`,
  };
  if (f.required !== true) item.ownerText = f.fallback.ownerText;
  return item;
}

export function stillNeeded(
  s: IntakeSnapshot,
  extra: readonly IntakeField[] = [],
): { required: NeededItem[]; optional: NeededItem[] } {
  const required: NeededItem[] = [];
  const optional: NeededItem[] = [];
  // Stage order first, then schema order within a stage.
  for (const stage of STAGES) {
    for (const f of [...INTAKE_FIELDS, ...extra]) {
      if (f.stage !== stage.slug || f.present(s)) continue;
      (f.required === true ? required : optional).push(toItem(f));
    }
  }
  return { required, optional };
}

export function stageStatus(
  s: IntakeSnapshot,
  stage: StageSlug,
  extra: readonly IntakeField[] = [],
): {
  status: "not_started" | "started" | "done";
  required: number;
  optional: number;
} {
  const { required, optional } = stillNeeded(s, extra);
  const req = required.filter((i) => i.stage === stage).length;
  const opt = optional.filter((i) => i.stage === stage).length;
  const status = !s.stagesSaved.includes(stage)
    ? "not_started"
    : req > 0
      ? "started"
      : "done";
  return { status, required: req, optional: opt };
}

export function setupProgress(
  s: IntakeSnapshot,
  extra: readonly IntakeField[] = [],
): { done: number; total: 7 } {
  const done = STAGES.filter(
    (st) => stageStatus(s, st.slug, extra).status === "done",
  ).length;
  return { done, total: 7 };
}
