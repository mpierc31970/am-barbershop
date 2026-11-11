"use client";
// Field settings pane (07-18; CONT-25, D231, D233, D119/D120; 07-UI-SPEC "Field settings
// pane"). Label, Type, Placeholder (text types), Help text, Required, Full width (two-column
// layout only), Options (choice types: add, remove, Move up / Move down, and Paste a list),
// Agreement text, Content (heading / paragraph) and Value (hidden). A blocked label,
// placeholder, help text or content shows BLOCKED-FIELD under that input with aria-invalid. The footer's ghost-danger
// Remove field is handled by the editor (Undo toast). Hub primitives only; all text is React
// text.
import {
  BLOCKED_FIELD_COPY,
  BLOCKED_FIELD_RE,
  CHOICE_TYPES,
  CONTENT_REQUIRED_COPY,
  DISPLAY_TYPES,
  FORM_FIELD_TYPES,
  FORM_FIELD_TYPE_LABELS,
  INPUT_TYPES,
  MAX_CONTENT,
  MAX_FIELD_OPTIONS,
  MAX_HELP,
  MAX_HIDDEN_VALUE,
  MAX_LABEL,
  MAX_OPTION,
  MAX_PLACEHOLDER,
  OPTIONS_DUPLICATE_COPY,
  OPTIONS_LIMIT_COPY,
  OPTIONS_REQUIRED_COPY,
  PLACEHOLDER_TYPES,
  PRO_TYPES,
  type FormField,
  type FormFieldType,
  type FormLayout,
} from "@cds/core/forms";
import {
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import { moveInList } from "../../builder/editor-logic";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { Switch } from "../Switch";
import { Select, TextArea, TextField } from "../fields";
import { PASTE_LIST_HELPER, fieldTitle, optionsFromLines } from "./form-logic";

export interface FieldSettingsPaneProps {
  field: FormField;
  layout: FormLayout;
  error: string | undefined;
  readOnly: boolean;
  idPrefix: string;
  onChange: (patch: Partial<Omit<FormField, "id">>) => void;
  onChangeType: (type: FormFieldType) => void;
  onRemove: () => void;
}

const TYPE_OPTIONS = FORM_FIELD_TYPES.filter((t) => !PRO_TYPES.has(t)).map(
  (t) => ({
    value: t,
    label: FORM_FIELD_TYPE_LABELS[t],
  }),
);

const OPTION_ERRORS = new Set([
  OPTIONS_REQUIRED_COPY,
  OPTIONS_DUPLICATE_COPY,
  OPTIONS_LIMIT_COPY,
]);

/** Which input a field-keyed message belongs under. */
function errorSlot(
  field: FormField,
  error: string | undefined,
): "label" | "placeholder" | "help" | "options" | "content" | null {
  if (!error) return null;
  if (error === BLOCKED_FIELD_COPY) {
    if (BLOCKED_FIELD_RE.test(field.label)) return "label";
    if (BLOCKED_FIELD_RE.test(field.placeholder)) return "placeholder";
    if (BLOCKED_FIELD_RE.test(field.help)) return "help";
    if (BLOCKED_FIELD_RE.test(field.content)) return "content";
    return "label";
  }
  if (OPTION_ERRORS.has(error)) return "options";
  if (error === CONTENT_REQUIRED_COPY) return "content";
  return "label";
}

export function FieldSettingsPane({
  field,
  layout,
  error,
  readOnly,
  idPrefix,
  onChange,
  onChangeType,
  onRemove,
}: FieldSettingsPaneProps) {
  const p = `${idPrefix}-${field.id}`;
  const slot = errorSlot(field, error);
  const blockedLabel = BLOCKED_FIELD_RE.test(field.label);
  const blockedPlaceholder =
    PLACEHOLDER_TYPES.has(field.type) &&
    BLOCKED_FIELD_RE.test(field.placeholder);
  const errFor = (s: typeof slot) => (slot === s ? error : undefined);
  const labelError = blockedLabel ? BLOCKED_FIELD_COPY : errFor("label");
  const placeholderError = blockedPlaceholder
    ? BLOCKED_FIELD_COPY
    : errFor("placeholder");
  const isDisplay = DISPLAY_TYPES.has(field.type);
  const helpError =
    !isDisplay && BLOCKED_FIELD_RE.test(field.help)
      ? BLOCKED_FIELD_COPY
      : errFor("help");
  const contentError =
    (isDisplay || field.type === "agreement") &&
    BLOCKED_FIELD_RE.test(field.content)
      ? BLOCKED_FIELD_COPY
      : errFor("content");

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-xl leading-tight font-semibold text-hub-ink">
        {fieldTitle(field)}
      </h2>
      <TextField
        id={`${p}-label`}
        label="Label"
        value={field.label}
        maxLength={MAX_LABEL}
        required={INPUT_TYPES.has(field.type) || field.type === "hidden"}
        error={labelError}
        onChange={(e) => onChange({ label: e.target.value })}
      />
      <Select
        id={`${p}-type`}
        label="Type"
        value={field.type}
        options={TYPE_OPTIONS}
        onChange={(e) => onChangeType(e.target.value as FormFieldType)}
      />
      {PLACEHOLDER_TYPES.has(field.type) ? (
        <TextField
          id={`${p}-placeholder`}
          label="Placeholder"
          value={field.placeholder}
          maxLength={MAX_PLACEHOLDER}
          error={placeholderError}
          onChange={(e) => onChange({ placeholder: e.target.value })}
        />
      ) : null}
      {isDisplay ? null : (
        <TextArea
          id={`${p}-help`}
          label="Help text"
          rows={2}
          value={field.help}
          maxLength={MAX_HELP}
          error={helpError}
          onChange={(e) => onChange({ help: e.target.value })}
        />
      )}
      {INPUT_TYPES.has(field.type) ? (
        <Switch
          id={`${p}-required`}
          label="Required"
          checked={field.required}
          onChange={(v) => onChange({ required: v })}
        />
      ) : null}
      {layout === "2" ? (
        <Switch
          id={`${p}-full`}
          label="Full width"
          checked={field.full_width}
          onChange={(v) => onChange({ full_width: v })}
        />
      ) : null}
      {CHOICE_TYPES.has(field.type) ? (
        <OptionsEditor
          id={`${p}-options`}
          options={field.options}
          error={errFor("options")}
          readOnly={readOnly}
          onChange={(options) => onChange({ options })}
        />
      ) : null}
      {field.type === "agreement" ? (
        <TextArea
          id={`${p}-content`}
          label="Agreement text"
          rows={3}
          value={field.content}
          maxLength={MAX_CONTENT}
          helper="Shown beside the checkbox. Leave it empty to use the label."
          error={contentError}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      ) : null}
      {field.type === "heading" ? (
        <TextField
          id={`${p}-content`}
          label="Content"
          value={field.content}
          maxLength={MAX_CONTENT}
          error={contentError}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      ) : null}
      {field.type === "paragraph" ? (
        <TextArea
          id={`${p}-content`}
          label="Content"
          rows={4}
          value={field.content}
          maxLength={MAX_CONTENT}
          error={contentError}
          onChange={(e) => onChange({ content: e.target.value })}
        />
      ) : null}
      {field.type === "hidden" ? (
        <TextField
          id={`${p}-value`}
          label="Value"
          value={field.value}
          maxLength={MAX_HIDDEN_VALUE}
          helper="Saved with every message. Visitors never see it."
          onChange={(e) => onChange({ value: e.target.value })}
        />
      ) : null}
      {readOnly ? null : (
        <div className="border-t border-hub-border pt-4">
          <Button
            variant="ghost"
            icon={<Trash2 aria-hidden size={16} strokeWidth={2} />}
            onClick={onRemove}
            className="text-hub-danger hover:bg-hub-danger-tint"
          >
            Remove field
          </Button>
        </div>
      )}
    </div>
  );
}

function OptionsEditor({
  id,
  options,
  error,
  readOnly,
  onChange,
}: {
  id: string;
  options: readonly string[];
  error: string | undefined;
  readOnly: boolean;
  onChange: (next: string[]) => void;
}) {
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const full = options.length >= MAX_FIELD_OPTIONS;
  return (
    <fieldset
      className="flex flex-col gap-2"
      aria-describedby={error ? `${id}-error` : undefined}
      aria-invalid={error ? true : undefined}
    >
      <legend className="mb-2 text-sm font-semibold text-hub-ink">
        Options
      </legend>
      <ol className="flex flex-col gap-2">
        {options.map((o, i) => (
          <li key={i} className="flex items-center gap-1">
            <label htmlFor={`${id}-${i}`} className="sr-only">
              Option {i + 1}
            </label>
            <input
              id={`${id}-${i}`}
              value={o}
              maxLength={MAX_OPTION}
              onChange={(e) =>
                onChange(options.map((x, j) => (j === i ? e.target.value : x)))
              }
              className={
                "h-10 min-w-0 flex-1 rounded border border-hub-border-strong bg-hub-surface px-3 " +
                "text-base text-hub-ink hover:border-hub-ink-muted disabled:bg-hub-surface-2"
              }
            />
            {readOnly ? null : (
              <>
                <IconButton
                  size="sm"
                  label={`Move option ${i + 1} up`}
                  icon={<ChevronUp aria-hidden size={16} strokeWidth={2} />}
                  aria-disabled={i === 0 || undefined}
                  onClick={() => onChange(moveInList(options, i, i - 1))}
                />
                <IconButton
                  size="sm"
                  label={`Move option ${i + 1} down`}
                  icon={<ChevronDown aria-hidden size={16} strokeWidth={2} />}
                  aria-disabled={i === options.length - 1 || undefined}
                  onClick={() => onChange(moveInList(options, i, i + 1))}
                />
                <IconButton
                  size="sm"
                  tooltipAlign="end"
                  label={`Remove option ${i + 1}`}
                  icon={<X aria-hidden size={16} strokeWidth={2} />}
                  onClick={() => onChange(options.filter((_, j) => j !== i))}
                />
              </>
            )}
          </li>
        ))}
      </ol>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-hub-danger">
          {error}
        </p>
      ) : null}
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={full}
            icon={<Plus aria-hidden size={16} strokeWidth={2} />}
            onClick={() =>
              onChange([...options, `Option ${options.length + 1}`])
            }
          >
            Add option
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={pasting}
            icon={<ClipboardPaste aria-hidden size={16} strokeWidth={2} />}
            onClick={() => {
              setPasted(options.join("\n"));
              setPasting((v) => !v);
            }}
          >
            Paste a list
          </Button>
        </div>
      )}
      {pasting && !readOnly ? (
        <div className="flex flex-col gap-2 rounded border border-hub-border bg-hub-surface-2 p-3">
          <TextArea
            id={`${id}-paste`}
            label="Your list"
            helper={PASTE_LIST_HELPER}
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onChange(optionsFromLines(pasted));
                setPasting(false);
              }}
            >
              Use this list
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPasting(false)}>
              Keep current options
            </Button>
          </div>
        </div>
      ) : null}
    </fieldset>
  );
}
