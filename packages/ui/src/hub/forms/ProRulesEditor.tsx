"use client";
// Forms Pro show/hide rule for one field (10-39; BILL-14, D233; 10-UI-SPEC "Forms Pro",
// D-UI-P10-28). Lives in the field settings pane under the P7 field settings: one rule per
// field, "Show this field only when" / "Hide this field when" + an earlier answerable field
// + a condition + the answer (a Select of options for choice fields, else a TextField).
//
// Locked (Builder Pro not active, no rule yet): the Rule select renders disabled through
// FeatureInline (P7 pro badge + owner link "Add Builder Pro" / "Ask your site owner…").
// Paused (not active, a stored rule): the rule shows read-only, no upsell (the Form settings
// group carries PAUSED-PRO). The server re-checks on save; this lock is cosmetic.
import {
  MAX_RULE_VALUE,
  PRO_RULE_OPS,
  type FormField,
  type ProRule,
  type ProRuleOp,
} from "@cds/core/forms";
import type { HubLinkComponent } from "../AddonCard";
import { FeatureInline } from "../FeatureInline";
import { Select, TextField } from "../fields";
import {
  BUILDER_PRO_KEY,
  BUILDER_PRO_NAME,
  RULE_ACTION_LABELS,
  RULE_OP_LABELS,
  VALUE_RULE_OPS,
  answerChoices,
  fieldTitle,
  ruleSourceFields,
  ruleSummary,
} from "./form-logic";

export const RULES_LEGEND = "Show or hide this field";
export const NO_RULE_SOURCE =
  "Add a question above this field first. Rules look at earlier answers.";
export const RULE_PAUSED_NOTE =
  "Builder Pro is paused. This rule is kept and works again once Builder Pro is back.";

export interface ProRulesEditorProps {
  field: FormField;
  fields: readonly FormField[];
  rule: ProRule | null;
  onChange: (rule: Omit<ProRule, "target"> | null) => void;
  /** Builder Pro is not active (never bought or paused). */
  locked: boolean;
  /** Owner (purchases:run): the lock shows "Add Builder Pro". */
  canBuy?: boolean;
  error?: string;
  idPrefix: string;
  LinkComponent?: HubLinkComponent;
}

const ACTIVE = new Set([BUILDER_PRO_KEY]);
const NONE = new Set<string>();

export function ProRulesEditor({
  field,
  fields,
  rule,
  onChange,
  locked,
  canBuy = false,
  error,
  idPrefix,
  LinkComponent,
}: ProRulesEditorProps) {
  const p = `${idPrefix}-rule`;
  const sources = ruleSourceFields(fields, field.id);
  const paused = locked && rule !== null;
  const action = rule ? rule.action : "none";
  const source = rule
    ? fields.find((f) => f.id === rule.when.field)
    : undefined;
  const choices = answerChoices(source);
  const needsValue = rule ? VALUE_RULE_OPS.has(rule.when.op) : false;

  function pickAction(next: string) {
    if (next === "none") return onChange(null);
    const first = sources[0];
    if (!first) return;
    const act = next === "hide" ? "hide" : "show";
    if (rule) return onChange({ action: act, when: rule.when });
    const opts = answerChoices(first);
    onChange({
      action: act,
      when: { field: first.id, op: "is", value: opts?.[0] ?? "" },
    });
  }

  function patchWhen(patch: Partial<ProRule["when"]>) {
    if (!rule) return;
    onChange({ action: rule.action, when: { ...rule.when, ...patch } });
  }

  const sourceOptions = sources.map((f) => ({
    value: f.id,
    label: fieldTitle(f),
  }));
  if (rule && !sources.some((f) => f.id === rule.when.field)) {
    sourceOptions.unshift({
      value: rule.when.field,
      label: source ? fieldTitle(source) : "Choose a field",
    });
  }

  return (
    <fieldset
      className="flex flex-col gap-3 border-t border-hub-border pt-6"
      data-pro-rules={field.id}
    >
      <legend className="mb-2 text-sm font-semibold text-hub-ink">
        {RULES_LEGEND}
      </legend>
      <FeatureInline
        feature={BUILDER_PRO_KEY}
        entitlements={locked && !paused ? NONE : ACTIVE}
        featureName={BUILDER_PRO_NAME}
        canBuy={canBuy}
        LinkComponent={LinkComponent}
      >
        {(inlineLocked) => (
          <Select
            id={`${p}-action`}
            label="Rule"
            value={action}
            // WR-C07: a stale rule (its field now sits below this one) can always be set
            // to "Always show", even when no field above can drive a rule.
            disabled={inlineLocked || paused || (sources.length === 0 && !rule)}
            helper={
              !locked && sources.length === 0 ? NO_RULE_SOURCE : undefined
            }
            error={error}
            onChange={(e) => pickAction(e.target.value)}
            options={[
              { value: "none", label: RULE_ACTION_LABELS.none },
              { value: "show", label: RULE_ACTION_LABELS.show },
              { value: "hide", label: RULE_ACTION_LABELS.hide },
            ]}
          />
        )}
      </FeatureInline>
      {rule ? (
        <>
          <Select
            id={`${p}-field`}
            label="Field"
            value={rule.when.field}
            disabled={locked}
            onChange={(e) => {
              const next = fields.find((f) => f.id === e.target.value);
              const opts = answerChoices(next);
              patchWhen({
                field: e.target.value,
                value: VALUE_RULE_OPS.has(rule.when.op)
                  ? (opts?.[0] ?? "")
                  : "",
              });
            }}
            options={sourceOptions}
          />
          <Select
            id={`${p}-op`}
            label="Condition"
            value={rule.when.op}
            disabled={locked}
            onChange={(e) => {
              const op = e.target.value as ProRuleOp;
              patchWhen({
                op,
                value: VALUE_RULE_OPS.has(op)
                  ? rule.when.value || (choices?.[0] ?? "")
                  : "",
              });
            }}
            options={PRO_RULE_OPS.map((op) => ({
              value: op,
              label: RULE_OP_LABELS[op],
            }))}
          />
          {needsValue ? (
            choices ? (
              <Select
                id={`${p}-value`}
                label="Answer"
                value={rule.when.value}
                disabled={locked}
                onChange={(e) => patchWhen({ value: e.target.value })}
                options={[
                  ...(choices.includes(rule.when.value)
                    ? []
                    : [
                        {
                          value: rule.when.value,
                          label: rule.when.value || "Choose an answer",
                        },
                      ]),
                  ...choices.map((c) => ({ value: c, label: c })),
                ]}
              />
            ) : (
              <TextField
                id={`${p}-value`}
                label="Answer"
                value={rule.when.value}
                maxLength={MAX_RULE_VALUE}
                disabled={locked}
                onChange={(e) => patchWhen({ value: e.target.value })}
              />
            )
          ) : null}
          <p className="text-sm text-hub-ink-muted" data-rule-summary="">
            {ruleSummary({ ...rule, target: field.id }, fields)}
          </p>
          {paused ? (
            <p className="text-sm text-hub-ink-muted">{RULE_PAUSED_NOTE}</p>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}
