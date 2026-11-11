"use client";
// Form settings › Builder Pro (10-39; BILL-14, D233; 10-UI-SPEC "Forms Pro",
// D-UI-P10-29/30/32/33). Under a "Builder Pro" heading: Split into steps (ProStepsEditor),
// Send an automatic reply, Send to a different address when…, Let visitors save and finish
// later.
//
// Entitled: every control live. Never bought (not active, no stored settings): one
// FeatureGuard panel (LOCK-PANEL, owner link; others read "Ask your site owner…"), never a
// blurred preview. Paused (not active, stored settings): PAUSED-PRO + every control read-only
// with its value kept; the editor never sends Pro settings then, so the server keeps them.
import {
  MAX_AUTO_REPLY_BODY,
  MAX_AUTO_REPLY_SUBJECT,
  MAX_PRO_ROUTES,
  MAX_RULE_VALUE,
  AUTO_REPLY_EMAIL_COPY,
  ROUTES_LIMIT_COPY,
  type FormField,
  type FormNotifyRoute,
  type FormProSettings,
  type ProRoute,
} from "@cds/core/forms";
import { Lock, Plus, Trash2 } from "lucide-react";
import type { HubLinkComponent } from "../AddonCard";
import { Button } from "../Button";
import { FeatureGuard, lockPanelCopy } from "../FeatureGuard";
import { askOwnerCopy } from "../FeatureInline";
import { IconButton } from "../IconButton";
import { Switch } from "../Switch";
import { InlineAlert } from "../feedback";
import { Select, TextArea, TextField } from "../fields";
import { ProStepsEditor } from "./ProStepsEditor";
import {
  BUILDER_PRO_KEY,
  BUILDER_PRO_NAME,
  answerChoices,
  answerableFields,
  fieldTitle,
  routeOptions,
  type EmailRouteView,
} from "./form-logic";

/** 10-UI-SPEC PAUSED-PRO. */
export const PAUSED_PRO_COPY =
  "Builder Pro is paused because payment stopped. Your forms still work without the Pro features, and nothing was lost.";
export const AUTO_REPLY_HELPER =
  "Write {name} in the message to use the visitor's name (the subject never includes it). It goes to the email address they enter, from your website's name.";
export const ROUTING_LEGEND = "Send to a different address when…";
export const ROUTING_HELPER =
  "Otherwise messages go to the address in Send a copy to.";
export const ROUTING_NO_FIELD = "Add a question first.";
export const SAVE_LATER_HELPER =
  "They get an email link to finish on any device. Unfinished forms are deleted after 30 days.";

export interface ProSettingsPanelProps {
  pro: FormProSettings;
  fields: readonly FormField[];
  routes: readonly EmailRouteView[] | null;
  /** Patch the draft's Pro settings (the editor runs the pure form-logic helpers). */
  onChange: (patch: ProSettingsChange) => void;
  /** Builder Pro is not active. */
  locked: boolean;
  /** Not active but stored settings exist (lapsed): read-only + PAUSED-PRO. */
  paused: boolean;
  canBuy?: boolean;
  /** Server errors keyed pro, pro.rules, pro.steps, pro.auto_reply, pro.routing. */
  errors?: Readonly<Record<string, string>>;
  idPrefix: string;
  LinkComponent?: HubLinkComponent;
}

export type ProSettingsChange =
  | { kind: "steps"; on: boolean }
  | { kind: "add-step" }
  | { kind: "rename-step"; stepId: string; title: string }
  | { kind: "remove-step"; stepId: string }
  | { kind: "auto-reply"; patch: Partial<FormProSettings["auto_reply"]> }
  | { kind: "routing"; routing: ProRoute[] }
  | { kind: "save-resume"; on: boolean };

const NONE = new Set<string>();
const ACTIVE = new Set([BUILDER_PRO_KEY]);

function AskOwnerPanel() {
  return (
    <section
      data-feature-lock={BUILDER_PRO_KEY}
      className="flex flex-col gap-2 rounded-lg bg-hub-surface-2 p-6 font-hub text-hub-ink"
    >
      <p className="flex items-center gap-2 text-base font-semibold">
        <Lock aria-hidden size={16} strokeWidth={2} />
        Part of {BUILDER_PRO_NAME}
      </p>
      <p className="text-base text-hub-ink-muted">
        {askOwnerCopy(BUILDER_PRO_NAME)}
      </p>
    </section>
  );
}

export function ProSettingsPanel({
  pro,
  fields,
  routes,
  onChange,
  locked,
  paused,
  canBuy = false,
  errors = {},
  idPrefix,
  LinkComponent,
}: ProSettingsPanelProps) {
  const p = `${idPrefix}-pro`;
  const readOnly = locked;
  const hasEmail = fields.some((f) => f.type === "email");
  const ar = pro.auto_reply;
  const answerable = answerableFields(fields);
  const routeChoices = routeOptions(routes, "");
  const top = errors.pro ?? errors["pro.rules"];

  function setRoute(i: number, patch: Partial<ProRoute>) {
    onChange({
      kind: "routing",
      routing: pro.routing.map((r, j) => (j === i ? { ...r, ...patch } : r)),
    });
  }

  function addRoute() {
    const f = answerable[0];
    if (!f || pro.routing.length >= MAX_PRO_ROUTES) return;
    onChange({
      kind: "routing",
      routing: [
        ...pro.routing,
        {
          field: f.id,
          value: answerChoices(f)?.[0] ?? "",
          route: (routeChoices[0]?.value ?? "inquiries") as FormNotifyRoute,
        },
      ],
    });
  }

  const body = (
    <div className="flex flex-col gap-6">
      {paused ? (
        <InlineAlert tone="warning">{PAUSED_PRO_COPY}</InlineAlert>
      ) : null}
      {top ? <InlineAlert tone="error">{top}</InlineAlert> : null}

      <ProStepsEditor
        steps={pro.steps}
        fields={fields}
        onToggle={(on) => onChange({ kind: "steps", on })}
        onAdd={() => onChange({ kind: "add-step" })}
        onRename={(stepId, title) =>
          onChange({ kind: "rename-step", stepId, title })
        }
        onRemove={(stepId) => onChange({ kind: "remove-step", stepId })}
        locked={readOnly}
        canBuy={canBuy}
        error={errors["pro.steps"]}
        idPrefix={p}
        LinkComponent={LinkComponent}
      />

      <div className="flex flex-col gap-3" data-pro-auto-reply="">
        <Switch
          id={`${p}-auto-reply`}
          label="Send an automatic reply"
          checked={ar.enabled}
          disabled={readOnly || (!hasEmail && !ar.enabled)}
          aria-describedby={hasEmail ? undefined : `${p}-auto-reply-hint`}
          onChange={(enabled) =>
            onChange({ kind: "auto-reply", patch: { enabled } })
          }
        />
        {!hasEmail ? (
          <p id={`${p}-auto-reply-hint`} className="text-sm text-hub-ink-muted">
            {AUTO_REPLY_EMAIL_COPY}
          </p>
        ) : null}
        {ar.enabled ? (
          <>
            <TextField
              id={`${p}-auto-reply-subject`}
              label="Reply subject"
              value={ar.subject}
              maxLength={MAX_AUTO_REPLY_SUBJECT}
              counter={{
                value: ar.subject.length,
                max: MAX_AUTO_REPLY_SUBJECT,
              }}
              disabled={readOnly}
              onChange={(e) =>
                onChange({
                  kind: "auto-reply",
                  patch: { subject: e.target.value },
                })
              }
            />
            <TextArea
              id={`${p}-auto-reply-body`}
              label="Reply message"
              rows={6}
              value={ar.body}
              maxLength={MAX_AUTO_REPLY_BODY}
              counter={{ value: ar.body.length, max: MAX_AUTO_REPLY_BODY }}
              helper={AUTO_REPLY_HELPER}
              disabled={readOnly}
              error={errors["pro.auto_reply"]}
              onChange={(e) =>
                onChange({
                  kind: "auto-reply",
                  patch: { body: e.target.value },
                })
              }
            />
          </>
        ) : errors["pro.auto_reply"] ? (
          <p className="text-sm font-semibold text-hub-danger">
            {errors["pro.auto_reply"]}
          </p>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3" data-pro-routing="">
        <legend className="mb-2 text-sm font-semibold text-hub-ink">
          {ROUTING_LEGEND}
        </legend>
        {pro.routing.map((r, i) => {
          const f = fields.find((x) => x.id === r.field);
          const choices = answerChoices(f);
          const n = i + 1;
          return (
            <div
              key={i}
              className="flex flex-col gap-3 rounded border border-hub-border p-4"
              data-route-row={i}
            >
              <Select
                id={`${p}-route-${i}-field`}
                label={`Rule ${n}: field`}
                value={r.field}
                disabled={readOnly}
                onChange={(e) => {
                  const next = fields.find((x) => x.id === e.target.value);
                  setRoute(i, {
                    field: e.target.value,
                    value: answerChoices(next)?.[0] ?? "",
                  });
                }}
                options={[
                  ...(f && answerable.includes(f)
                    ? []
                    : [
                        {
                          value: r.field,
                          label: f ? fieldTitle(f) : "Choose a field",
                        },
                      ]),
                  ...answerable.map((x) => ({
                    value: x.id,
                    label: fieldTitle(x),
                  })),
                ]}
              />
              {choices ? (
                <Select
                  id={`${p}-route-${i}-value`}
                  label={`Rule ${n}: answer is`}
                  value={r.value}
                  disabled={readOnly}
                  onChange={(e) => setRoute(i, { value: e.target.value })}
                  options={[
                    ...(choices.includes(r.value)
                      ? []
                      : [
                          {
                            value: r.value,
                            label: r.value || "Choose an answer",
                          },
                        ]),
                    ...choices.map((c) => ({ value: c, label: c })),
                  ]}
                />
              ) : (
                <TextField
                  id={`${p}-route-${i}-value`}
                  label={`Rule ${n}: answer is`}
                  value={r.value}
                  maxLength={MAX_RULE_VALUE}
                  disabled={readOnly}
                  onChange={(e) => setRoute(i, { value: e.target.value })}
                />
              )}
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    id={`${p}-route-${i}-to`}
                    label={`Rule ${n}: send to`}
                    value={r.route}
                    disabled={readOnly}
                    onChange={(e) =>
                      setRoute(i, { route: e.target.value as FormNotifyRoute })
                    }
                    options={routeOptions(routes, r.route)}
                  />
                </div>
                {readOnly ? null : (
                  <IconButton
                    label="Remove this routing rule"
                    tooltipAlign="end"
                    icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
                    onClick={() =>
                      onChange({
                        kind: "routing",
                        routing: pro.routing.filter((_, j) => j !== i),
                      })
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
        {readOnly ? null : (
          <Button
            variant="secondary"
            size="sm"
            disabled={
              answerable.length === 0 || pro.routing.length >= MAX_PRO_ROUTES
            }
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={addRoute}
            className="self-start"
          >
            Add a routing rule
          </Button>
        )}
        <p className="text-sm text-hub-ink-muted">
          {answerable.length === 0 && !readOnly
            ? ROUTING_NO_FIELD
            : pro.routing.length >= MAX_PRO_ROUTES
              ? ROUTES_LIMIT_COPY
              : ROUTING_HELPER}
        </p>
        {errors["pro.routing"] ? (
          <p className="text-sm font-semibold text-hub-danger">
            {errors["pro.routing"]}
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-2" data-pro-save-later="">
        <Switch
          id={`${p}-save-later`}
          label="Let visitors save and finish later"
          checked={pro.save_resume}
          disabled={readOnly}
          aria-describedby={`${p}-save-later-helper`}
          onChange={(on) => onChange({ kind: "save-resume", on })}
        />
        <p id={`${p}-save-later-helper`} className="text-sm text-hub-ink-muted">
          {SAVE_LATER_HELPER}
        </p>
      </div>
    </div>
  );

  return (
    <section
      aria-labelledby={`${p}-heading`}
      className="mt-8 flex flex-col gap-6 border-t border-hub-border pt-8"
      data-pro-settings=""
    >
      <h2
        id={`${p}-heading`}
        className="text-xl leading-tight font-semibold text-hub-ink"
      >
        {BUILDER_PRO_NAME}
      </h2>
      <FeatureGuard
        feature={BUILDER_PRO_KEY}
        entitlements={locked && !paused ? NONE : ACTIVE}
        featureName={BUILDER_PRO_NAME}
        canBuy={canBuy}
        LinkComponent={LinkComponent}
        fallback={canBuy ? undefined : <AskOwnerPanel />}
      >
        {body}
      </FeatureGuard>
    </section>
  );
}

/** LOCK-PANEL for docs and tests. */
export const PRO_LOCK_PANEL = lockPanelCopy(BUILDER_PRO_NAME);
