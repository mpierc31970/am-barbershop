"use client";
// Forms Pro steps (10-39; BILL-14, D233; 10-UI-SPEC "Forms Pro", D-UI-P10-29). "Split into
// steps" in Form settings › Builder Pro: on = the form becomes Step 1 holding every field and
// the field list shows step headers; each step has a title, a field count and Remove (its
// fields join the step above). Fields move between steps with Move up / Move down in the
// field list. Up to MAX_PRO_STEPS.
//
// Locked (not active, no steps): the switch renders disabled through FeatureInline. Paused
// (not active, stored steps): everything read-only, values kept (PAUSED-PRO sits above).
import {
  MAX_PRO_STEPS,
  MAX_STEP_TITLE,
  STEPS_LIMIT_COPY,
  type FormField,
  type ProStep,
} from "@cds/core/forms";
import { Plus, Trash2 } from "lucide-react";
import type { HubLinkComponent } from "../AddonCard";
import { Button } from "../Button";
import { FeatureInline } from "../FeatureInline";
import { IconButton } from "../IconButton";
import { Switch } from "../Switch";
import { TextField } from "../fields";
import { BUILDER_PRO_KEY, BUILDER_PRO_NAME } from "./form-logic";

export const STEPS_HELPER =
  "Visitors see one step at a time, with a progress bar.";
export const STEPS_MOVE_HELPER =
  "Move fields between steps with Move up and Move down in the field list.";

export interface ProStepsEditorProps {
  steps: readonly ProStep[];
  fields: readonly FormField[];
  /** on/off, add, rename and remove go through these (pure helpers in form-logic). */
  onToggle: (on: boolean) => void;
  onAdd: () => void;
  onRename: (stepId: string, title: string) => void;
  onRemove: (stepId: string) => void;
  locked: boolean;
  canBuy?: boolean;
  error?: string;
  idPrefix: string;
  LinkComponent?: HubLinkComponent;
}

const ACTIVE = new Set([BUILDER_PRO_KEY]);
const NONE = new Set<string>();

function fieldCount(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "field" : "fields"}`;
}

export function ProStepsEditor({
  steps,
  onToggle,
  onAdd,
  onRename,
  onRemove,
  locked,
  canBuy = false,
  error,
  idPrefix,
  LinkComponent,
}: ProStepsEditorProps) {
  const p = `${idPrefix}-steps`;
  const on = steps.length > 0;
  const paused = locked && on;
  const full = steps.length >= MAX_PRO_STEPS;
  return (
    <div className="flex flex-col gap-3" data-pro-steps="">
      <FeatureInline
        feature={BUILDER_PRO_KEY}
        entitlements={locked && !paused ? NONE : ACTIVE}
        featureName={BUILDER_PRO_NAME}
        canBuy={canBuy}
        LinkComponent={LinkComponent}
      >
        {(inlineLocked) => (
          <Switch
            id={`${p}-on`}
            label="Split into steps"
            checked={on}
            disabled={inlineLocked || locked}
            aria-describedby={`${p}-helper`}
            onChange={onToggle}
          />
        )}
      </FeatureInline>
      <p id={`${p}-helper`} className="text-sm text-hub-ink-muted">
        {STEPS_HELPER}
      </p>
      {on ? (
        <>
          <ol className="flex flex-col gap-4" aria-label="Steps">
            {steps.map((st, i) => (
              <li key={st.id} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextField
                    id={`${p}-${st.id}-title`}
                    label={`Step ${i + 1} title`}
                    value={st.title}
                    maxLength={MAX_STEP_TITLE}
                    disabled={locked}
                    helper={fieldCount(st.fields.length)}
                    onChange={(e) => onRename(st.id, e.target.value)}
                  />
                </div>
                {steps.length > 1 && !locked ? (
                  <IconButton
                    label={`Remove Step ${i + 1}`}
                    tooltipAlign="end"
                    icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
                    onClick={() => onRemove(st.id)}
                    className="mb-6"
                  />
                ) : null}
              </li>
            ))}
          </ol>
          {locked ? null : (
            <div className="flex flex-col gap-1">
              <Button
                variant="secondary"
                size="sm"
                disabled={full}
                icon={<Plus aria-hidden size={16} strokeWidth={2} />}
                onClick={onAdd}
                className="self-start"
              >
                Add step
              </Button>
              {full ? (
                <p className="text-sm text-hub-ink-muted">{STEPS_LIMIT_COPY}</p>
              ) : null}
            </div>
          )}
          <p className="text-sm text-hub-ink-muted">{STEPS_MOVE_HELPER}</p>
        </>
      ) : null}
      {error ? (
        <p className="text-sm font-semibold text-hub-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
